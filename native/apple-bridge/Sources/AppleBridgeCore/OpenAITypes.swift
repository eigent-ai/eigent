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

/// Accepts any JSON value without keeping it. Used where the bridge only
/// needs to know that a field is present.
public struct IgnoredJSON: Decodable {
  public init(from decoder: Decoder) throws {}
}

public struct ContentPart: Decodable {
  public let type: String
  public let text: String?
}

public enum MessageContent: Decodable {
  case text(String)
  case parts([ContentPart])

  public init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if let text = try? container.decode(String.self) {
      self = .text(text)
    } else {
      self = .parts(try container.decode([ContentPart].self))
    }
  }
}

public struct ChatMessage: Decodable {
  public let role: String
  public let content: MessageContent?
  public let toolCalls: [IgnoredJSON]?

  enum CodingKeys: String, CodingKey {
    case role
    case content
    case toolCalls = "tool_calls"
  }

  public init(role: String, content: MessageContent?, toolCalls: [IgnoredJSON]? = nil) {
    self.role = role
    self.content = content
    self.toolCalls = toolCalls
  }
}

public struct ResponseFormat: Decodable {
  public let type: String
}

public struct ChatCompletionRequest: Decodable {
  public let model: String
  public let messages: [ChatMessage]
  public let stream: Bool?
  public let temperature: Double?
  public let maxTokens: Int?
  public let maxCompletionTokens: Int?
  public let tools: [IgnoredJSON]?
  public let responseFormat: ResponseFormat?

  enum CodingKeys: String, CodingKey {
    case model
    case messages
    case stream
    case temperature
    case maxTokens = "max_tokens"
    case maxCompletionTokens = "max_completion_tokens"
    case tools
    case responseFormat = "response_format"
  }
}

struct AssistantMessage: Encodable {
  let role = "assistant"
  let content: String
}

struct CompletionChoice: Encodable {
  let index: Int
  let message: AssistantMessage
  let finishReason: String
}

struct ChatCompletion: Encodable {
  let id: String
  let object = "chat.completion"
  let created: Int
  let model: String
  let choices: [CompletionChoice]
}

struct ChunkDelta: Encodable {
  let role: String?
  let content: String?
}

struct ChunkChoice: Encodable {
  let index: Int
  let delta: ChunkDelta
  let finishReason: String?
}

struct ChatCompletionChunk: Encodable {
  let id: String
  let object = "chat.completion.chunk"
  let created: Int
  let model: String
  let choices: [ChunkChoice]
}

struct ErrorBody: Encodable {
  let message: String
  let type: String
  let code: String
}

struct ErrorEnvelope: Encodable {
  let error: ErrorBody
}

public enum OpenAIError {
  public static func response(status: Int, code: String, message: String) -> HTTPResponse {
    let type = status >= 500 ? "server_error" : "invalid_request_error"
    let envelope = ErrorEnvelope(error: ErrorBody(message: message, type: type, code: code))
    return HTTPResponse(status: status, body: JSONCoding.encode(envelope))
  }
}

enum JSONCoding {
  static func encode<T: Encodable>(_ value: T) -> Data {
    let encoder = JSONEncoder()
    encoder.keyEncodingStrategy = .convertToSnakeCase
    encoder.outputFormatting = [.sortedKeys]
    return (try? encoder.encode(value)) ?? Data("{}".utf8)
  }
}
