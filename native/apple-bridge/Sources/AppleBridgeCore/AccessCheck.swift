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

/// Only the backend that started the bridge may call it.
///
/// - A request with an `Origin` header comes from a web page: rejected.
/// - The `Host` must be exactly `127.0.0.1:<port>`, which stops DNS rebinding.
/// - The bearer token was handed to the bridge on stdin by the backend.
public enum AccessCheck {
  public static func rejection(for request: HTTPRequest, token: String, port: Int)
    -> HTTPResponse?
  {
    if request.header("origin") != nil {
      return OpenAIError.response(
        status: 403, code: "forbidden_origin", message: "Browser requests are not accepted.")
    }
    guard request.header("host") == "127.0.0.1:\(port)" else {
      return OpenAIError.response(
        status: 403, code: "forbidden_host", message: "Unexpected Host header.")
    }
    guard let authorization = request.header("authorization"),
      constantTimeEquals(authorization, "Bearer \(token)")
    else {
      return OpenAIError.response(
        status: 401, code: "invalid_api_key", message: "Missing or wrong bridge token.")
    }
    return nil
  }

  static func constantTimeEquals(_ lhs: String, _ rhs: String) -> Bool {
    let left = Array(lhs.utf8)
    let right = Array(rhs.utf8)
    guard left.count == right.count else { return false }
    var difference: UInt8 = 0
    for index in 0..<left.count {
      difference |= left[index] ^ right[index]
    }
    return difference == 0
  }
}
