// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

import Foundation

/// One parsed HTTP/1.1 request. Header names are lowercased.
public struct HTTPRequest: Equatable {
  public let method: String
  public let path: String
  public let headers: [String: String]
  public let body: Data

  public init(method: String, path: String, headers: [String: String], body: Data) {
    self.method = method
    self.path = path
    self.headers = Dictionary(
      headers.map { ($0.key.lowercased(), $0.value) }, uniquingKeysWith: { first, _ in first })
    self.body = body
  }

  public func header(_ name: String) -> String? {
    headers[name.lowercased()]
  }
}

public enum HTTPParseResult: Equatable {
  case incomplete
  case invalid
  case complete(HTTPRequest)
}

/// A deliberately small HTTP/1.1 request parser. The bridge serves one
/// request per connection, so it needs no keep-alive or chunked bodies.
public enum HTTPParser {
  public static let maxHeaderBytes = 32 * 1024
  public static let maxBodyBytes = 8 * 1024 * 1024

  public static func parse(_ data: Data) -> HTTPParseResult {
    let separator = Data("\r\n\r\n".utf8)
    guard let headerEnd = data.range(of: separator) else {
      return data.count > maxHeaderBytes ? .invalid : .incomplete
    }
    guard headerEnd.lowerBound - data.startIndex <= maxHeaderBytes,
      let head = String(data: data[data.startIndex..<headerEnd.lowerBound], encoding: .utf8)
    else {
      return .invalid
    }

    var lines = head.components(separatedBy: "\r\n")
    let requestLine = lines.removeFirst().split(separator: " ")
    guard requestLine.count == 3, requestLine[2].hasPrefix("HTTP/1.") else {
      return .invalid
    }

    var headers: [String: String] = [:]
    for line in lines {
      guard let colon = line.firstIndex(of: ":") else { return .invalid }
      let name = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
      let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
      // Duplicate headers (two Hosts, for example) are a smuggling signal.
      guard !name.isEmpty, headers[name] == nil else { return .invalid }
      headers[name] = value
    }
    guard headers["transfer-encoding"] == nil else { return .invalid }

    var length = 0
    if let raw = headers["content-length"] {
      guard let parsed = Int(raw), parsed >= 0, parsed <= maxBodyBytes else {
        return .invalid
      }
      length = parsed
    }
    let bodyStart = headerEnd.upperBound
    guard data.endIndex - bodyStart >= length else { return .incomplete }

    let target = String(requestLine[1])
    let path = target.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
      .first.map(String.init) ?? target
    return .complete(
      HTTPRequest(
        method: String(requestLine[0]),
        path: path,
        headers: headers,
        body: data.subdata(in: bodyStart..<(bodyStart + length))
      ))
  }
}

public struct HTTPResponse: Equatable {
  public var status: Int
  public var contentType: String
  public var body: Data

  public init(status: Int, contentType: String = "application/json", body: Data) {
    self.status = status
    self.contentType = contentType
    self.body = body
  }

  /// Full response with a Content-Length. Every connection closes after one
  /// response. No CORS headers are ever sent.
  public func serialized() -> Data {
    var head = "HTTP/1.1 \(status) \(HTTPResponse.reason(status))\r\n"
    head += "Content-Type: \(contentType)\r\n"
    head += "Content-Length: \(body.count)\r\n"
    head += "Cache-Control: no-store\r\n"
    head += "Connection: close\r\n\r\n"
    var data = Data(head.utf8)
    data.append(body)
    return data
  }

  /// Head of a server-sent events response. The body follows as events and
  /// ends when the connection closes.
  public static func eventStreamHead() -> Data {
    var head = "HTTP/1.1 200 OK\r\n"
    head += "Content-Type: text/event-stream\r\n"
    head += "Cache-Control: no-store\r\n"
    head += "Connection: close\r\n\r\n"
    return Data(head.utf8)
  }

  static func reason(_ status: Int) -> String {
    switch status {
    case 200: return "OK"
    case 400: return "Bad Request"
    case 401: return "Unauthorized"
    case 403: return "Forbidden"
    case 404: return "Not Found"
    case 405: return "Method Not Allowed"
    case 429: return "Too Many Requests"
    case 503: return "Service Unavailable"
    default: return "Internal Server Error"
    }
  }
}

/// Where a handler writes its response. Returns false once the client is gone.
public protocol ResponseWriter: AnyObject {
  func write(_ data: Data) -> Bool
}
