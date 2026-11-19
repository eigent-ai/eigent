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

public let onDeviceModelID = "apple-on-device"

/// Status of one model, reported by `GET /v1/health`.
public struct ModelHealth: Equatable, Encodable {
  public let id: String
  public let status: String
  public let reason: String?
  public let contextSize: Int?
  public let capabilities: [String]

  public static func available(contextSize: Int) -> ModelHealth {
    ModelHealth(
      id: onDeviceModelID, status: "available", reason: nil, contextSize: contextSize,
      capabilities: ["text"])
  }

  public static func unavailable(_ reason: String) -> ModelHealth {
    ModelHealth(
      id: onDeviceModelID, status: "unavailable", reason: reason, contextSize: nil,
      capabilities: [])
  }

  public init(
    id: String, status: String, reason: String?, contextSize: Int?, capabilities: [String]
  ) {
    self.id = id
    self.status = status
    self.reason = reason
    self.contextSize = contextSize
    self.capabilities = capabilities
  }
}

public struct GenerationSettings: Equatable {
  public let temperature: Double?
  public let maximumResponseTokens: Int?

  public init(temperature: Double?, maximumResponseTokens: Int?) {
    self.temperature = temperature
    self.maximumResponseTokens = maximumResponseTokens
  }
}

/// Model failures, already in the bridge's own vocabulary.
public enum BackendError: Error, Equatable {
  case unavailable(reason: String)
  case contextLengthExceeded
  case contentFiltered
  case unsupportedLanguage
  case rateLimited
  case cancelled
  case failed(String)
}

/// The Foundation Models side. A fake stands in for it in tests.
public protocol ModelBackend: AnyObject {
  func health() -> ModelHealth
  func respond(_ prompt: PreparedPrompt, settings: GenerationSettings) async throws -> String
  /// Calls `onSnapshot` with each cumulative snapshot. Stops when it
  /// returns false.
  func stream(
    _ prompt: PreparedPrompt, settings: GenerationSettings,
    onSnapshot: @escaping (String) -> Bool
  ) async throws
}

/// One generation at a time, with a short queue.
public actor GenerationGate {
  private var busy = false
  private var waiters: [CheckedContinuation<Void, Never>] = []
  private let maxWaiting: Int

  public init(maxWaiting: Int = 4) {
    self.maxWaiting = maxWaiting
  }

  /// False when the queue is full.
  public func enter() async -> Bool {
    if !busy {
      busy = true
      return true
    }
    if waiters.count >= maxWaiting { return false }
    await withCheckedContinuation { continuation in
      waiters.append(continuation)
    }
    return true
  }

  public func leave() {
    if waiters.isEmpty {
      busy = false
    } else {
      waiters.removeFirst().resume()
    }
  }
}

public final class Router {
  private let backend: ModelBackend
  private let gate: GenerationGate
  private let now: () -> Date

  public init(
    backend: ModelBackend, gate: GenerationGate = GenerationGate(),
    now: @escaping () -> Date = Date.init
  ) {
    self.backend = backend
    self.gate = gate
    self.now = now
  }

  /// Handles a request that already passed `AccessCheck`.
  public func handle(_ request: HTTPRequest, writer: ResponseWriter) async {
    switch (request.method, request.path) {
    case ("GET", "/v1/health"):
      _ = writer.write(healthResponse().serialized())
    case ("GET", "/v1/models"):
      _ = writer.write(modelsResponse().serialized())
    case ("POST", "/v1/chat/completions"):
      await chatCompletion(request, writer: writer)
    case (_, "/v1/health"), (_, "/v1/models"), (_, "/v1/chat/completions"):
      _ = writer.write(
        OpenAIError.response(status: 405, code: "method_not_allowed", message: "Method not allowed.")
          .serialized())
    default:
      _ = writer.write(
        OpenAIError.response(status: 404, code: "not_found", message: "Unknown endpoint.")
          .serialized())
    }
  }

  func healthResponse() -> HTTPResponse {
    struct Health: Encodable {
      let status = "ok"
      let models: [ModelHealth]
    }
    return HTTPResponse(status: 200, body: JSONCoding.encode(Health(models: [backend.health()])))
  }

  func modelsResponse() -> HTTPResponse {
    struct Model: Encodable {
      let id: String
      let object = "model"
      let created = 0
      let ownedBy = "apple"
    }
    struct Models: Encodable {
      let object = "list"
      let data: [Model]
    }
    return HTTPResponse(
      status: 200, body: JSONCoding.encode(Models(data: [Model(id: onDeviceModelID)])))
  }

  private func chatCompletion(_ request: HTTPRequest, writer: ResponseWriter) async {
    let parsed: ChatCompletionRequest
    do {
      parsed = try JSONDecoder().decode(ChatCompletionRequest.self, from: request.body)
    } catch {
      _ = writer.write(
        OpenAIError.response(
          status: 400, code: "invalid_request", message: "The request body is not valid JSON."
        ).serialized())
      return
    }
    guard parsed.model == onDeviceModelID else {
      _ = writer.write(
        OpenAIError.response(
          status: 404, code: "model_not_found", message: "Unknown model \(parsed.model).")
          .serialized())
      return
    }
    if let tools = parsed.tools, !tools.isEmpty {
      _ = writer.write(Router.toolsUnsupported().serialized())
      return
    }
    if let format = parsed.responseFormat, format.type != "text" {
      _ = writer.write(
        OpenAIError.response(
          status: 400, code: "unsupported_response_format",
          message: "Structured output is not supported by this version of the bridge."
        ).serialized())
      return
    }

    let prompt: PreparedPrompt
    do {
      prompt = try PromptPreparation.prepare(parsed.messages)
    } catch let error as PromptPreparationError {
      _ = writer.write(Router.response(for: error).serialized())
      return
    } catch {
      _ = writer.write(
        OpenAIError.response(status: 400, code: "invalid_request", message: "Invalid messages.")
          .serialized())
      return
    }

    let health = backend.health()
    guard health.status == "available" else {
      _ = writer.write(
        Router.response(for: .unavailable(reason: health.reason ?? "unavailable")).serialized())
      return
    }

    guard await gate.enter() else {
      _ = writer.write(
        OpenAIError.response(
          status: 429, code: "rate_limited", message: "Too many requests are waiting.")
          .serialized())
      return
    }
    let settings = GenerationSettings(
      temperature: parsed.temperature,
      maximumResponseTokens: parsed.maxCompletionTokens ?? parsed.maxTokens
    )
    if parsed.stream == true {
      await streamCompletion(prompt, settings: settings, model: parsed.model, writer: writer)
    } else {
      await completion(prompt, settings: settings, model: parsed.model, writer: writer)
    }
    await gate.leave()
  }

  private func completion(
    _ prompt: PreparedPrompt, settings: GenerationSettings, model: String,
    writer: ResponseWriter
  ) async {
    let text: String
    let finishReason: String
    do {
      text = try await backend.respond(prompt, settings: settings)
      finishReason = "stop"
    } catch let error as BackendError where error == .contentFiltered {
      text = ""
      finishReason = "content_filter"
    } catch let error as BackendError {
      _ = writer.write(Router.response(for: error).serialized())
      return
    } catch {
      _ = writer.write(Router.response(for: .failed(String(describing: error))).serialized())
      return
    }
    let body = ChatCompletion(
      id: completionID(), created: timestamp(), model: model,
      choices: [
        CompletionChoice(
          index: 0, message: AssistantMessage(content: text), finishReason: finishReason)
      ])
    _ = writer.write(HTTPResponse(status: 200, body: JSONCoding.encode(body)).serialized())
  }

  private func streamCompletion(
    _ prompt: PreparedPrompt, settings: GenerationSettings, model: String,
    writer: ResponseWriter
  ) async {
    let id = completionID()
    let created = timestamp()
    var headSent = false
    var clientGone = false
    var tracker = SnapshotDeltaTracker()

    func send(_ data: Data) -> Bool {
      if !headSent {
        headSent = true
        guard writer.write(HTTPResponse.eventStreamHead()) else { return false }
      }
      return writer.write(data)
    }
    func chunk(content: String?, role: String?, finishReason: String?) -> Data {
      let body = ChatCompletionChunk(
        id: id, created: created, model: model,
        choices: [
          ChunkChoice(
            index: 0, delta: ChunkDelta(role: role, content: content), finishReason: finishReason)
        ])
      var data = Data("data: ".utf8)
      data.append(JSONCoding.encode(body))
      data.append(Data("\n\n".utf8))
      return data
    }

    var finishReason = "stop"
    do {
      try await backend.stream(prompt, settings: settings) { snapshot in
        let added = tracker.delta(for: snapshot)
        if added.isEmpty { return true }
        let role: String? = headSent ? nil : "assistant"
        if !send(chunk(content: added, role: role, finishReason: nil)) {
          clientGone = true
          return false
        }
        return true
      }
    } catch let error as BackendError where error == .contentFiltered {
      finishReason = "content_filter"
    } catch let error as BackendError {
      if !headSent {
        _ = writer.write(Router.response(for: error).serialized())
      } else {
        // Headers are gone, so report the failure as an SSE error event.
        _ = writer.write(Router.streamError(for: error))
      }
      return
    } catch {
      let failure = BackendError.failed(String(describing: error))
      if !headSent {
        _ = writer.write(Router.response(for: failure).serialized())
      } else {
        _ = writer.write(Router.streamError(for: failure))
      }
      return
    }
    if clientGone { return }
    _ = send(chunk(content: nil, role: nil, finishReason: finishReason))
    _ = send(Data("data: [DONE]\n\n".utf8))
  }

  private func completionID() -> String {
    "chatcmpl-\(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased())"
  }

  private func timestamp() -> Int {
    Int(now().timeIntervalSince1970)
  }

  static func toolsUnsupported() -> HTTPResponse {
    OpenAIError.response(
      status: 400, code: "tools_unsupported",
      message:
        "Apple Intelligence can't use tools in this version of Eigent. Use another model for tasks that need tools."
    )
  }

  static func response(for error: PromptPreparationError) -> HTTPResponse {
    switch error {
    case .toolsUnsupported:
      return toolsUnsupported()
    case .unsupportedContent(let type):
      return OpenAIError.response(
        status: 400, code: "unsupported_content",
        message: "Apple Intelligence accepts text only, not \(type).")
    case .noMessages, .lastMessageNotUser:
      return OpenAIError.response(
        status: 400, code: "invalid_request", message: "The last message must come from the user.")
    case .unsupportedRole(let role):
      return OpenAIError.response(
        status: 400, code: "invalid_request", message: "Unsupported message role \(role).")
    }
  }

  /// Error mapping from plan §4.2.
  public static func response(for error: BackendError) -> HTTPResponse {
    let (status, code, message) = describe(error)
    return OpenAIError.response(status: status, code: code, message: message)
  }

  static func streamError(for error: BackendError) -> Data {
    let (_, code, message) = describe(error)
    var data = Data("data: ".utf8)
    data.append(
      JSONCoding.encode(
        ErrorEnvelope(error: ErrorBody(message: message, type: "server_error", code: code))))
    data.append(Data("\n\n".utf8))
    return data
  }

  static func describe(_ error: BackendError) -> (Int, String, String) {
    switch error {
    case .unavailable(let reason):
      return (503, reason, unavailableMessage(reason))
    case .contextLengthExceeded:
      return (
        400, "context_length_exceeded",
        "This conversation is too long for the on-device model's context."
      )
    case .contentFiltered:
      return (200, "content_filter", "The model declined to answer.")
    case .unsupportedLanguage:
      return (
        400, "unsupported_language", "The on-device model doesn't support this language yet."
      )
    case .rateLimited:
      return (429, "rate_limited", "Apple Intelligence is busy. Try again in a moment.")
    case .cancelled:
      return (499, "cancelled", "The request was cancelled.")
    case .failed(let detail):
      return (500, "generation_failed", "Apple Intelligence couldn't answer: \(detail)")
    }
  }

  static func unavailableMessage(_ reason: String) -> String {
    switch reason {
    case "apple_intelligence_off":
      return "Turn on Apple Intelligence in System Settings."
    case "model_not_ready":
      return "The Apple Intelligence model is still downloading."
    case "not_eligible":
      return "This Mac doesn't support Apple Intelligence."
    case "unsupported_os":
      return "Apple Intelligence in Eigent requires macOS 26 or later."
    default:
      return "Apple Intelligence is not available."
    }
  }
}
