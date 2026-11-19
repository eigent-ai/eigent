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

// eigent-apple-bridge
//
// Started by the Eigent backend. Protocol:
//   1. The backend writes a random token and a newline to stdin.
//   2. The bridge binds 127.0.0.1 on an ephemeral port and prints the port
//      as its first line of output.
//   3. The bridge serves OpenAI-compatible requests that carry the token.
//   4. It exits when stdin closes (the backend is gone) or after 10 minutes
//      without requests.
//
// Logs never contain prompt or response text.

import AppleBridgeCore
import Darwin
import Foundation

func fail(_ message: String, code: Int32) -> Never {
  FileHandle.standardError.write(Data("eigent-apple-bridge: \(message)\n".utf8))
  exit(code)
}

signal(SIGPIPE, SIG_IGN)

guard let token = readLine(strippingNewline: true), token.count >= 32 else {
  fail("expected a token of at least 32 characters on stdin", code: 2)
}

let server: SocketServer = {
  do {
    return try SocketServer()
  } catch {
    fail("could not listen on 127.0.0.1: \(error)", code: 3)
  }
}()

/// Tracks the time since the last request and requests still running.
final class Activity {
  private let lock = NSLock()
  private var lastRequest = Date()
  private var running = 0

  func begin() {
    lock.lock()
    running += 1
    lastRequest = Date()
    lock.unlock()
  }

  func end() {
    lock.lock()
    running -= 1
    lastRequest = Date()
    lock.unlock()
  }

  func idleFor(atLeast seconds: TimeInterval) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return running == 0 && Date().timeIntervalSince(lastRequest) >= seconds
  }
}

let idleLimit: TimeInterval = 10 * 60
let activity = Activity()
let router = Router(backend: AppleModelBackend())
let port = server.port

server.serve { client in
  defer { close(client) }
  let writer = SocketWriter(descriptor: client)
  switch RequestReader.read(client) {
  case .incomplete:
    return
  case .invalid:
    _ = writer.write(
      HTTPResponse(status: 400, body: Data("{\"error\":{\"code\":\"bad_request\"}}".utf8))
        .serialized())
  case .complete(let request):
    if let rejection = AccessCheck.rejection(for: request, token: token, port: port) {
      _ = writer.write(rejection.serialized())
      return
    }
    activity.begin()
    let done = DispatchSemaphore(value: 0)
    Task {
      await router.handle(request, writer: writer)
      done.signal()
    }
    done.wait()
    activity.end()
  }
}

// The port is the first line of output; the backend waits for it.
print(port)
fflush(stdout)

// The backend keeps stdin open. When it exits, stdin closes and so does the
// bridge, so a crashed backend never leaves a bridge behind.
Thread.detachNewThread {
  while readLine() != nil {}
  exit(0)
}

let idleTimer = DispatchSource.makeTimerSource(queue: DispatchQueue.global())
idleTimer.schedule(deadline: .now() + 30, repeating: 30)
idleTimer.setEventHandler {
  if activity.idleFor(atLeast: idleLimit) { exit(0) }
}
idleTimer.resume()

dispatchMain()
