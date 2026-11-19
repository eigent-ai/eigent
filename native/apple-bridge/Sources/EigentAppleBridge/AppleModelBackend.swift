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
import Foundation

#if canImport(FoundationModels)
  import FoundationModels
#endif

/// The on-device model through Apple's Foundation Models framework.
///
/// Every call sits behind `#available(macOS 26, *)`. On older macOS the
/// bridge still runs and reports `unsupported_os`.
final class AppleModelBackend: ModelBackend {
  /// The on-device context on macOS 26. Later releases report their own
  /// size; reading it is left for a later version (plan §6).
  static let minimumContextSize = 4096

  func health() -> ModelHealth {
    #if canImport(FoundationModels)
      if #available(macOS 26.0, *) {
        return Self.onDeviceHealth()
      }
    #endif
    return .unavailable("unsupported_os")
  }

  func respond(_ prompt: PreparedPrompt, settings: GenerationSettings) async throws -> String {
    #if canImport(FoundationModels)
      if #available(macOS 26.0, *) {
        do {
          let session = Self.session(for: prompt)
          let response = try await session.respond(
            to: prompt.prompt, options: Self.options(settings))
          return response.content
        } catch {
          throw Self.map(error)
        }
      }
    #endif
    throw BackendError.unavailable(reason: "unsupported_os")
  }

  func stream(
    _ prompt: PreparedPrompt, settings: GenerationSettings,
    onSnapshot: @escaping (String) -> Bool
  ) async throws {
    #if canImport(FoundationModels)
      if #available(macOS 26.0, *) {
        do {
          let session = Self.session(for: prompt)
          let stream = session.streamResponse(
            to: prompt.prompt, options: Self.options(settings))
          for try await snapshot in stream {
            // Leaving the loop drops the stream, which ends the generation
            // when the client has disconnected.
            if !onSnapshot(snapshot.content) { break }
          }
          return
        } catch {
          throw Self.map(error)
        }
      }
    #endif
    throw BackendError.unavailable(reason: "unsupported_os")
  }
}

#if canImport(FoundationModels)
  @available(macOS 26.0, *)
  extension AppleModelBackend {
    static func onDeviceHealth() -> ModelHealth {
      switch SystemLanguageModel.default.availability {
      case .available:
        return .available(contextSize: minimumContextSize)
      case .unavailable(let reason):
        switch reason {
        case .deviceNotEligible:
          return .unavailable("not_eligible")
        case .appleIntelligenceNotEnabled:
          return .unavailable("apple_intelligence_off")
        case .modelNotReady:
          return .unavailable("model_not_ready")
        @unknown default:
          return .unavailable("unavailable")
        }
      @unknown default:
        return .unavailable("unavailable")
      }
    }

    static func session(for prompt: PreparedPrompt) -> LanguageModelSession {
      if let instructions = prompt.instructions {
        return LanguageModelSession(instructions: instructions)
      }
      return LanguageModelSession()
    }

    static func options(_ settings: GenerationSettings) -> GenerationOptions {
      // OpenAI's temperature 0 means "always the most likely token".
      if settings.temperature == 0 {
        return GenerationOptions(
          sampling: .greedy, maximumResponseTokens: settings.maximumResponseTokens)
      }
      return GenerationOptions(
        temperature: settings.temperature, maximumResponseTokens: settings.maximumResponseTokens)
    }

    /// Error mapping from plan §4.2.
    static func map(_ error: Error) -> BackendError {
      if let mapped = error as? BackendError { return mapped }
      if error is CancellationError { return .cancelled }
      if let generation = error as? LanguageModelSession.GenerationError {
        switch generation {
        case .exceededContextWindowSize:
          return .contextLengthExceeded
        case .guardrailViolation, .refusal:
          return .contentFiltered
        case .unsupportedLanguageOrLocale:
          return .unsupportedLanguage
        case .rateLimited:
          return .rateLimited
        case .assetsUnavailable:
          return .unavailable(reason: "model_not_ready")
        default:
          return .failed(generation.localizedDescription)
        }
      }
      return .failed(error.localizedDescription)
    }
  }
#endif
