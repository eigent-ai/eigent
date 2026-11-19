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
import XCTest

@testable import AppleBridgeCore

final class FakeBackend: ModelBackend {
  var healthValue = ModelHealth.available(contextSize: 4096)
  var snapshots: [String] = []
  var reply = "Hello"
  var error: BackendError?
  var receivedPrompt: PreparedPrompt?
  var receivedSettings: GenerationSettings?

  func health() -> ModelHealth { healthValue }

  func respond(_ prompt: PreparedPrompt, settings: GenerationSettings) async throws -> String {
    receivedPrompt = prompt
    receivedSettings = settings
    if let error { throw error }
    return reply
  }

  func stream(
    _ prompt: PreparedPrompt, settings: GenerationSettings,
    onSnapshot: @escaping (String) -> Bool
  ) async throws {
    receivedPrompt = prompt
    for snapshot in snapshots where !onSnapshot(snapshot) { return }
    if let error { throw error }
  }
}

final class BufferWriter: ResponseWriter {
  var data = Data()
  var acceptWrites = Int.max

  func write(_ chunk: Data) -> Bool {
    guard acceptWrites > 0 else { return false }
    acceptWrites -= 1
    data.append(chunk)
    return true
  }

  var text: String { String(decoding: data, as: UTF8.self) }
}

func request(
  _ method: String, _ path: String, body: String = "",
  headers: [String: String] = [:]
) -> HTTPRequest {
  HTTPRequest(method: method, path: path, headers: headers, body: Data(body.utf8))
}

func chatBody(stream: Bool = false, extra: String = "") -> String {
  """
  {"model":"apple-on-device","stream":\(stream),"temperature":0,"max_tokens":64,
   "messages":[{"role":"system","content":"Be brief."},{"role":"user","content":"Hi"}]\(extra)}
  """
}

final class HTTPParserTests: XCTestCase {
  func testParsesRequestWithBody() {
    let raw = "POST /v1/chat/completions?x=1 HTTP/1.1\r\nHost: 127.0.0.1:9\r\nContent-Length: 2\r\n\r\n{}"
    guard case .complete(let parsed) = HTTPParser.parse(Data(raw.utf8)) else {
      return XCTFail("expected a complete request")
    }
    XCTAssertEqual(parsed.method, "POST")
    XCTAssertEqual(parsed.path, "/v1/chat/completions")
    XCTAssertEqual(parsed.header("HOST"), "127.0.0.1:9")
    XCTAssertEqual(parsed.body, Data("{}".utf8))
  }

  func testWaitsForTheWholeBody() {
    let raw = "POST / HTTP/1.1\r\nContent-Length: 5\r\n\r\n{}"
    XCTAssertEqual(HTTPParser.parse(Data(raw.utf8)), .incomplete)
  }

  func testRejectsDuplicateHostAndChunkedBodies() {
    let duplicate = "GET / HTTP/1.1\r\nHost: a\r\nHost: b\r\n\r\n"
    XCTAssertEqual(HTTPParser.parse(Data(duplicate.utf8)), .invalid)
    let chunked = "POST / HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n"
    XCTAssertEqual(HTTPParser.parse(Data(chunked.utf8)), .invalid)
  }
}

final class AccessCheckTests: XCTestCase {
  let token = String(repeating: "t", count: 40)
  let good = ["Host": "127.0.0.1:4000", "Authorization": "Bearer " + String(repeating: "t", count: 40)]

  func testAcceptsTheBackend() {
    XCTAssertNil(AccessCheck.rejection(for: request("GET", "/v1/health", headers: good), token: token, port: 4000))
  }

  func testRejectsBrowserOrigin() {
    var headers = good
    headers["Origin"] = "http://localhost:3000"
    XCTAssertEqual(
      AccessCheck.rejection(for: request("GET", "/v1/health", headers: headers), token: token, port: 4000)?
        .status, 403)
  }

  func testRejectsOtherHosts() {
    var headers = good
    headers["Host"] = "evil.example:4000"
    XCTAssertEqual(
      AccessCheck.rejection(for: request("GET", "/v1/health", headers: headers), token: token, port: 4000)?
        .status, 403)
  }

  func testRejectsWrongToken() {
    var headers = good
    headers["Authorization"] = "Bearer nope"
    XCTAssertEqual(
      AccessCheck.rejection(for: request("GET", "/v1/health", headers: headers), token: token, port: 4000)?
        .status, 401)
  }
}

final class PromptPreparationTests: XCTestCase {
  func testSystemMessagesBecomeInstructions() throws {
    let prepared = try PromptPreparation.prepare([
      ChatMessage(role: "system", content: .text("Be brief.")),
      ChatMessage(role: "user", content: .text("Hi")),
    ])
    XCTAssertEqual(prepared, PreparedPrompt(instructions: "Be brief.", prompt: "Hi"))
  }

  func testEarlierTurnsAreWrittenIntoThePrompt() throws {
    let prepared = try PromptPreparation.prepare([
      ChatMessage(role: "user", content: .text("One")),
      ChatMessage(role: "assistant", content: .text("Two")),
      ChatMessage(role: "user", content: .parts([ContentPart(type: "text", text: "Three")])),
    ])
    XCTAssertNil(prepared.instructions)
    XCTAssertTrue(prepared.prompt.contains("User: One"))
    XCTAssertTrue(prepared.prompt.contains("Assistant: Two"))
    XCTAssertTrue(prepared.prompt.hasSuffix("Three"))
  }

  func testRejectsToolTurnsImagesAndTrailingAssistant() {
    XCTAssertThrowsError(
      try PromptPreparation.prepare([ChatMessage(role: "tool", content: .text("x"))])
    ) { XCTAssertEqual($0 as? PromptPreparationError, .toolsUnsupported) }
    XCTAssertThrowsError(
      try PromptPreparation.prepare([
        ChatMessage(role: "user", content: .parts([ContentPart(type: "image_url", text: nil)]))
      ])
    ) { XCTAssertEqual($0 as? PromptPreparationError, .unsupportedContent("image_url")) }
    XCTAssertThrowsError(
      try PromptPreparation.prepare([ChatMessage(role: "assistant", content: .text("x"))])
    ) { XCTAssertEqual($0 as? PromptPreparationError, .lastMessageNotUser) }
  }
}

final class SnapshotDeltaTrackerTests: XCTestCase {
  func testTurnsSnapshotsIntoDeltas() {
    var tracker = SnapshotDeltaTracker()
    XCTAssertEqual(tracker.delta(for: "Hel"), "Hel")
    XCTAssertEqual(tracker.delta(for: "Hello"), "lo")
    XCTAssertEqual(tracker.delta(for: "Hello"), "")
    XCTAssertEqual(tracker.delta(for: "Hello, world"), ", world")
  }
}

final class RouterTests: XCTestCase {
  func testHealthReportsTheModel() async {
    let backend = FakeBackend()
    backend.healthValue = .unavailable("apple_intelligence_off")
    let writer = BufferWriter()
    await Router(backend: backend).handle(request("GET", "/v1/health"), writer: writer)
    XCTAssertTrue(writer.text.contains("\"reason\":\"apple_intelligence_off\""))
    XCTAssertTrue(writer.text.contains("\"id\":\"apple-on-device\""))
  }

  func testNonStreamingCompletion() async {
    let backend = FakeBackend()
    let writer = BufferWriter()
    await Router(backend: backend).handle(
      request("POST", "/v1/chat/completions", body: chatBody()), writer: writer)
    XCTAssertTrue(writer.text.hasPrefix("HTTP/1.1 200"))
    XCTAssertTrue(writer.text.contains("\"content\":\"Hello\""))
    XCTAssertTrue(writer.text.contains("\"finish_reason\":\"stop\""))
    XCTAssertEqual(backend.receivedPrompt, PreparedPrompt(instructions: "Be brief.", prompt: "Hi"))
    XCTAssertEqual(
      backend.receivedSettings, GenerationSettings(temperature: 0, maximumResponseTokens: 64))
  }

  func testStreamingSendsDeltasThenDone() async {
    let backend = FakeBackend()
    backend.snapshots = ["Hel", "Hello"]
    let writer = BufferWriter()
    await Router(backend: backend).handle(
      request("POST", "/v1/chat/completions", body: chatBody(stream: true)), writer: writer)
    XCTAssertTrue(writer.text.contains("text/event-stream"))
    XCTAssertTrue(writer.text.contains("\"content\":\"Hel\""))
    XCTAssertTrue(writer.text.contains("\"content\":\"lo\""))
    XCTAssertTrue(writer.text.hasSuffix("data: [DONE]\n\n"))
  }

  func testStreamingStopsWhenTheClientLeaves() async {
    let backend = FakeBackend()
    backend.snapshots = ["a", "ab", "abc"]
    let writer = BufferWriter()
    writer.acceptWrites = 2  // head and first chunk
    await Router(backend: backend).handle(
      request("POST", "/v1/chat/completions", body: chatBody(stream: true)), writer: writer)
    XCTAssertFalse(writer.text.contains("[DONE]"))
  }

  func testToolsAreRejected() async {
    let writer = BufferWriter()
    await Router(backend: FakeBackend()).handle(
      request(
        "POST", "/v1/chat/completions",
        body: chatBody(extra: ",\"tools\":[{\"type\":\"function\"}]")),
      writer: writer)
    XCTAssertTrue(writer.text.hasPrefix("HTTP/1.1 400"))
    XCTAssertTrue(writer.text.contains("tools_unsupported"))
  }

  func testUnavailableModelIsA503WithItsReason() async {
    let backend = FakeBackend()
    backend.healthValue = .unavailable("model_not_ready")
    let writer = BufferWriter()
    await Router(backend: backend).handle(
      request("POST", "/v1/chat/completions", body: chatBody()), writer: writer)
    XCTAssertTrue(writer.text.hasPrefix("HTTP/1.1 503"))
    XCTAssertTrue(writer.text.contains("\"code\":\"model_not_ready\""))
  }

  func testErrorMapping() async {
    let cases: [(BackendError, String)] = [
      (.contextLengthExceeded, "HTTP/1.1 400"),
      (.unsupportedLanguage, "HTTP/1.1 400"),
      (.rateLimited, "HTTP/1.1 429"),
      (.contentFiltered, "HTTP/1.1 200"),
    ]
    for (error, prefix) in cases {
      let backend = FakeBackend()
      backend.error = error
      let writer = BufferWriter()
      await Router(backend: backend).handle(
        request("POST", "/v1/chat/completions", body: chatBody()), writer: writer)
      XCTAssertTrue(writer.text.hasPrefix(prefix), "\(error)")
    }
  }

  func testQueueLimit() async {
    let gate = GenerationGate(maxWaiting: 0)
    let first = await gate.enter()
    let second = await gate.enter()
    XCTAssertTrue(first)
    XCTAssertFalse(second)
    await gate.leave()
    let third = await gate.enter()
    XCTAssertTrue(third)
  }
}
