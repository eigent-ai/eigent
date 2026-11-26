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

/// What one Foundation Models session needs: optional instructions and the
/// prompt to answer.
public struct PreparedPrompt: Equatable {
  public let instructions: String?
  public let prompt: String

  public init(instructions: String?, prompt: String) {
    self.instructions = instructions
    self.prompt = prompt
  }
}

public enum PromptPreparationError: Error, Equatable {
  case noMessages
  case lastMessageNotUser
  case toolsUnsupported
  case unsupportedContent(String)
  case unsupportedRole(String)
}

/// Turns OpenAI chat messages into one stateless request.
///
/// The first version is text only: `system` and `developer` messages become
/// the session instructions, and earlier `user` and `assistant` turns are
/// written into the prompt ahead of the latest user message. Rebuilding a
/// native `Transcript` comes with tool calling (plan §6, PR 3).
public enum PromptPreparation {
  public static func prepare(_ messages: [ChatMessage]) throws -> PreparedPrompt {
    guard !messages.isEmpty else { throw PromptPreparationError.noMessages }

    var instructions: [String] = []
    var turns: [(role: String, text: String)] = []
    for message in messages {
      if let calls = message.toolCalls, !calls.isEmpty {
        throw PromptPreparationError.toolsUnsupported
      }
      switch message.role {
      case "system", "developer":
        let text = try plainText(message.content)
        if !text.isEmpty { instructions.append(text) }
      case "user", "assistant":
        let text = try plainText(message.content)
        turns.append((role: message.role, text: text))
      case "tool", "function":
        throw PromptPreparationError.toolsUnsupported
      default:
        throw PromptPreparationError.unsupportedRole(message.role)
      }
    }

    guard let last = turns.last, last.role == "user" else {
      throw PromptPreparationError.lastMessageNotUser
    }
    let earlier = turns.dropLast()
    let prompt: String
    if earlier.isEmpty {
      prompt = last.text
    } else {
      let history = earlier.map { turn in
        "\(turn.role == "user" ? "User" : "Assistant"): \(turn.text)"
      }.joined(separator: "\n\n")
      prompt = """
        Conversation so far:

        \(history)

        Reply to the user's latest message:

        \(last.text)
        """
    }
    return PreparedPrompt(
      instructions: instructions.isEmpty ? nil : instructions.joined(separator: "\n\n"),
      prompt: prompt
    )
  }

  static func plainText(_ content: MessageContent?) throws -> String {
    switch content {
    case .none:
      return ""
    case .text(let text):
      return text
    case .parts(let parts):
      var texts: [String] = []
      for part in parts {
        guard part.type == "text" else {
          throw PromptPreparationError.unsupportedContent(part.type)
        }
        texts.append(part.text ?? "")
      }
      return texts.joined(separator: "\n")
    }
  }
}

/// Foundation Models streams cumulative snapshots. OpenAI streams deltas.
public struct SnapshotDeltaTracker {
  private var emitted = ""

  public init() {}

  /// The text added since the last snapshot. If the model revised text it
  /// already sent, the revision cannot be taken back, so only text beyond
  /// what was already sent is returned.
  public mutating func delta(for snapshot: String) -> String {
    if snapshot.hasPrefix(emitted) {
      let added = String(snapshot.dropFirst(emitted.count))
      emitted = snapshot
      return added
    }
    guard snapshot.count > emitted.count else { return "" }
    let added = String(snapshot.dropFirst(emitted.count))
    emitted = snapshot
    return added
  }
}
