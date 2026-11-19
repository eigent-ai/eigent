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

import AppleBridgeCore
import Darwin
import Foundation

enum SocketServerError: Error {
  case socket(Int32)
  case bind(Int32)
  case listen(Int32)
  case address(Int32)
}

/// A loopback-only TCP listener on an ephemeral port.
final class SocketServer {
  let port: Int
  private let descriptor: Int32

  init() throws {
    let descriptor = socket(AF_INET, SOCK_STREAM, 0)
    guard descriptor >= 0 else { throw SocketServerError.socket(errno) }

    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_port = 0
    address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
    let bound = withUnsafePointer(to: &address) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { socketAddress in
        bind(descriptor, socketAddress, socklen_t(MemoryLayout<sockaddr_in>.size))
      }
    }
    guard bound == 0 else {
      close(descriptor)
      throw SocketServerError.bind(errno)
    }
    guard listen(descriptor, 16) == 0 else {
      close(descriptor)
      throw SocketServerError.listen(errno)
    }

    var chosen = sockaddr_in()
    var length = socklen_t(MemoryLayout<sockaddr_in>.size)
    let named = withUnsafeMutablePointer(to: &chosen) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { socketAddress in
        getsockname(descriptor, socketAddress, &length)
      }
    }
    guard named == 0 else {
      close(descriptor)
      throw SocketServerError.address(errno)
    }
    self.descriptor = descriptor
    self.port = Int(UInt16(bigEndian: chosen.sin_port))
  }

  /// Accepts connections on a background thread and hands each one to
  /// `handler` on a global queue.
  func serve(_ handler: @escaping (Int32) -> Void) {
    let descriptor = self.descriptor
    Thread.detachNewThread {
      while true {
        let client = accept(descriptor, nil, nil)
        if client < 0 {
          if errno == EINTR || errno == ECONNABORTED { continue }
          return
        }
        DispatchQueue.global().async { handler(client) }
      }
    }
  }
}

/// Writes to a client socket. Returns false once the client has gone.
final class SocketWriter: ResponseWriter {
  private let descriptor: Int32

  init(descriptor: Int32) {
    self.descriptor = descriptor
  }

  func write(_ data: Data) -> Bool {
    data.withUnsafeBytes { buffer -> Bool in
      guard var pointer = buffer.baseAddress else { return true }
      var remaining = buffer.count
      while remaining > 0 {
        let written = Darwin.write(descriptor, pointer, remaining)
        if written < 0 && errno == EINTR { continue }
        if written <= 0 { return false }
        pointer = pointer.advanced(by: written)
        remaining -= written
      }
      return true
    }
  }
}

/// Reads one request from a client socket. `.incomplete` means the client
/// closed or timed out first; `.invalid` requests get a 400.
enum RequestReader {
  static func read(_ descriptor: Int32) -> HTTPParseResult {
    var timeout = timeval(tv_sec: 30, tv_usec: 0)
    setsockopt(
      descriptor, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
    var noSignal: Int32 = 1
    setsockopt(
      descriptor, SOL_SOCKET, SO_NOSIGPIPE, &noSignal, socklen_t(MemoryLayout<Int32>.size))

    var received = Data()
    let capacity = 16 * 1024
    var chunk = [UInt8](repeating: 0, count: capacity)
    while true {
      let result = HTTPParser.parse(received)
      if result != .incomplete { return result }
      let count = Darwin.read(descriptor, &chunk, capacity)
      if count < 0 && errno == EINTR { continue }
      if count <= 0 { return .incomplete }
      received.append(chunk, count: count)
    }
  }
}
