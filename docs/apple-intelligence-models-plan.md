# Apple Intelligence models plan

> **Status: proposal.** This plan lets people on a Mac with Apple Intelligence
> use Apple's built-in models in Eigent: the on-device model with no API key,
> download or server, and, on macOS 27, Apple's Private Cloud Compute model.
> Nothing here is implemented yet. The meeting notes plan
> (`docs/meeting-notes-plan.md`, separate pull request) builds on it.

## 1. Goal

1. **Zero-setup local model.** On an eligible Mac, **Apple Intelligence**
   appears in Settings → Models as a local provider. Picking it needs no
   endpoint, key or model download. Prompts sent to the on-device model stay on
   the Mac.
2. **Honest limits.** The on-device model is small: a 4,096-token context on
   macOS 26, text only, and no thinking effort. Eigent shows these limits up
   front, refuses work that does not fit instead of cutting it silently, and
   never switches to another model when Apple's model is unavailable.
3. **Optional Private Cloud Compute.** On macOS 27, offer Apple's Private
   Cloud Compute model as a second, clearly labelled model that runs on Apple's
   servers. Off until the person turns it on.
4. **A base for meeting notes.** The same macOS helper later records audio and
   transcribes speech for the meeting notes feature.

Apple does not give apps access to Siri itself. Apps reach the same system
models through Apple's Foundation Models framework, so the UI calls the
provider **Apple Intelligence**, not Siri.

## 2. Terms

| Term                        | Meaning                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| Apple Intelligence          | The provider name in Settings and the model picker                                         |
| On-device model             | `SystemLanguageModel` (macOS 26+): runs on the Mac                                         |
| Private Cloud Compute model | `PrivateCloudComputeLanguageModel` (macOS 27+): runs on Apple's servers                    |
| Apple bridge                | A small signed Swift helper that Eigent ships on Apple silicon Macs and the backend starts |
| Context size                | The model's token window for instructions, history, tool definitions and the response      |

## 3. What exists today

**In Eigent**

- **Local providers.** Ollama, vLLM, SGLang, LM Studio and LLaMA.cpp are
  listed in `src/components/Settings/Models/localModels.ts`. The person enters
  an endpoint, and the backend talks to it over an OpenAI-compatible API.
  Provider records are free-form (`provider_name`, `model_type`,
  `endpoint_url`), so a new provider needs no server change.
- **Model construction.** The backend builds every model through CAMEL's
  `ModelFactory.create` in `backend/app/agent/agent_model.py`.
  `PLATFORM_ALIAS_MAPPING` in `backend/app/model/model_platform.py` already
  maps providers such as `llama.cpp` to `openai-compatible-model`.
  `/model/list` and `/model/validate` live in
  `backend/app/controller/model_controller.py`.
- **Environment capabilities.** The backend reports what its machine can do
  (`backend/app/hands/capabilities.py`, `/health?detail=true`).
- **Bundled binaries.** The desktop app passes bundled tool paths to the
  backend as environment variables (`EIGENT_BUNDLED_GIT` in
  `electron/main/init.ts`). `resources/prebuilt` ships as `prebuilt/`
  (`electron-builder.json`). macOS builds run on self-hosted arm64 and x64
  runners. The repository has no Swift code yet.
- **Thinking effort.** Supported efforts come from
  `backend/app/workspace_config/model_capabilities.json`; see
  `docs/model-capabilities.md`.

**In Apple's SDK** (checked against the macOS 27.2 SDK)

- `SystemLanguageModel` (macOS 26+):
  - `availability` is `.available` or `.unavailable(reason)`, where the reason
    is `deviceNotEligible`, `appleIntelligenceNotEnabled` or `modelNotReady`.
  - `contextSize` is 4,096 on macOS 26 and reported by the model on 27.
    `tokenCount(for:)` (26.4+) counts prompts, instructions, tools and
    schemas.
  - `supportedLanguages` lists the languages it accepts. On macOS 27,
    `variant` reports `core3` or `coreAdvanced3`.
- `PrivateCloudComputeLanguageModel` (macOS 27+):
  - `availability` (`deviceNotEligible`, `systemNotReady`), `quotaUsage` and
    an async `contextSize`.
  - Errors include `networkFailure`, `quotaLimitReached` and
    `serviceUnavailable`.
- On macOS 27 both models report `capabilities`: `vision`,
  `guidedGeneration`, `reasoning` and `toolCalling`.
- `LanguageModelSession` provides:
  - `respond` and `streamResponse`. Streaming yields cumulative snapshots, not
    deltas.
  - `Tool`, guided generation with `DynamicGenerationSchema`, and
    `GenerationOptions` (temperature, greedy sampling, maximum response
    tokens). `prewarm` loads the model ahead of the first request.
  - Sessions can start from a `Transcript`. `Transcript.Prompt`, `Response`,
    `ToolCall` and `ToolOutput` have public initializers.
- Errors include `exceededContextWindowSize`, `guardrailViolation`,
  `unsupportedLanguageOrLocale`, `rateLimited`, `refusal` and
  `assetsUnavailable`.
- Apple Intelligence needs Apple silicon. Intel Macs are never eligible.
- Foundation Models is a Swift-only API. There is no Objective-C surface to
  call from Python.

**Prior art.** [anarlog](https://github.com/fastrepl/anarlog), an MIT-licensed
meeting notetaker, ships Apple Intelligence as an experimental text-only
provider:

- A Swift static library with a C ABI, linked into the app, creates one
  `LanguageModelSession` per request.
- It maps each availability reason to a message and caps responses at 4,096
  tokens.
- It ignores tool definitions with a warning and passes JSON schemas as prompt
  guidance.
- It allows five minutes before the first token, for model warm-up.

This plan keeps its availability handling and its honesty about limits. It
uses a separate process instead, because Eigent's backend is a separate Python
process.

## 4. Design

### 4.1 Shape

```
Renderer (Settings → Models, model picker)
        │ existing backend routes
        ▼
Backend (Python) ── starts on demand and supervises ──┐
        │ OpenAI-compatible HTTP, 127.0.0.1, token     │
        ▼                                              │
Apple bridge (Swift, Apple silicon Macs only) ◀───────┘
        │
FoundationModels: SystemLanguageModel · PrivateCloudComputeLanguageModel
```

Why a separate helper with an OpenAI-compatible surface:

- The backend already reaches every local provider through CAMEL's
  OpenAI-compatible client, so this adds no new Python model adapter.
- The backend can run without the desktop app. When the backend owns the
  helper, any client connected to a backend on a Mac gets the provider, and a
  backend elsewhere reports it as unavailable.
- A crash or hang inside the framework ends the helper, not the backend.

Alternatives considered:

- **B. A Swift library loaded into the Electron main process** (like
  `electron/main/native/macos-window.ts`), with model calls proxied over IPC.
  Rejected: the backend could not use it on its own, and long generations
  would run in the main process.
- **C. Python bindings.** Rejected: Foundation Models has no Objective-C
  surface.

### 4.2 Apple bridge

**Build and packaging**

- Source: a Swift package in `native/apple-bridge/`, producing one executable,
  `eigent-apple-bridge`.
- It is built only for the arm64 macOS package, with an SDK that has the
  macOS 27 APIs. FoundationModels is weak-linked, and every call sits behind
  `#available(macOS 26, *)` or `#available(macOS 27, *)`. On older macOS the
  binary still launches and reports `unsupported_os`.
- It ships in `resources/prebuilt/apple-bridge/`, signed with the hardened
  runtime and notarized with the app. The desktop app passes its path to the
  backend as `EIGENT_APPLE_BRIDGE`.
- Developers build it with `npm run build:apple-bridge` (`swift build`). If
  the binary is missing, the provider shows "Not available in this build".

**Lifecycle**

- The backend starts the bridge on first need: Settings opens the provider,
  the person runs **Test**, or a Run selects the model. It is not started at
  app launch.
- The backend creates a random token and passes it on stdin. The bridge binds
  `127.0.0.1` on port 0 and prints the chosen port as its first line of
  output.
- The bridge stops after 10 minutes without requests. A crash restarts it with
  backoff. After three crashes in five minutes, the provider reports
  `bridge_unavailable`, and the Settings card offers **Try again**.

**Security**

- Every request needs `Authorization: Bearer <token>`.
- Requests that carry an `Origin` header, or a `Host` other than
  `127.0.0.1:<port>`, are rejected, so web pages and DNS rebinding cannot reach
  it. No CORS headers are sent.
- Logs never contain prompt or response text.

**Endpoints**

| Endpoint                    | Purpose                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| `GET /v1/health`            | Per model: status, reason, context size, variant, capabilities, languages, quota (PCC only) |
| `GET /v1/models`            | `apple-on-device`, plus `apple-private-cloud` on macOS 27                                   |
| `POST /v1/chat/completions` | OpenAI-compatible chat, `stream` true or false                                              |
| `POST /v1/token-count`      | Token count for instructions, messages and tools; used by the context check in §4.3         |

**Request mapping** for `/v1/chat/completions`

- **Conversation.** The bridge holds no conversation state. Each request
  rebuilds a `Transcript` from the messages:
  - `system` messages become instructions;
  - earlier `user` and `assistant` turns become `Prompt` and `Response`
    entries;
  - assistant `tool_calls` and `tool` messages become `ToolCalls` and
    `ToolOutput` entries.

  A new `LanguageModelSession` starts from that transcript and answers the last
  user or tool message.

- **Tools.** This applies only when the model reports `toolCalling`. Each
  OpenAI function tool becomes a `Tool` whose arguments use a
  `DynamicGenerationSchema` built from its JSON Schema. The bridge never runs a
  tool. When the model calls one, the bridge records the arguments, stops the
  turn and returns `tool_calls` with `finish_reason: "tool_calls"`. The backend
  runs the tool through its normal permission and approval path and sends the
  result in the next request. The first version returns one tool call per turn.
  If the model does not report `toolCalling`, a request that includes tools
  gets `400 tools_unsupported`.
- **Structured output.** `response_format: json_schema` uses guided generation.
  The schema is converted to a `DynamicGenerationSchema` covering objects,
  arrays, strings, numbers, integers, booleans and enums. Unsupported keywords
  return `400 unsupported_schema` and are not dropped silently.
- **Options.** `max_tokens` maps to `maximumResponseTokens`, and `temperature`
  maps to `temperature`. `temperature: 0` selects greedy sampling.
- **Images.** Image parts are accepted only when the model reports `vision`.
  Otherwise the request gets `400 unsupported_content`.
- **Streaming.** `stream: true` returns `chat.completion.chunk` events. The
  bridge turns each cumulative snapshot into the text added since the last
  one.
- **Usage.** Token counts come from `tokenCount(for:)` where available.
  Otherwise usage is omitted and recorded as unknown.
- **Concurrency and cancellation.** Generations run one at a time per model,
  with a small queue. A full queue returns `429`. When the client disconnects,
  the generation is cancelled.

**Error mapping** (OpenAI-style codes, so the backend's existing handling
applies)

| Framework error                          | HTTP | Code                                      |
| ---------------------------------------- | ---- | ----------------------------------------- |
| `exceededContextWindowSize`              | 400  | `context_length_exceeded`                 |
| `guardrailViolation`, `refusal`          | 200  | `finish_reason: "content_filter"`         |
| `unsupportedLanguageOrLocale`            | 400  | `unsupported_language`                    |
| `rateLimited`, `quotaLimitReached` (PCC) | 429  | `rate_limited` / `quota_exceeded`         |
| `modelNotReady`, `assetsUnavailable`     | 503  | `model_not_ready`                         |
| `networkFailure`, `serviceUnavailable`   | 503  | `service_unavailable`                     |
| Apple Intelligence off / not eligible    | 503  | `apple_intelligence_off` / `not_eligible` |

### 4.3 Backend

- **Supervisor.** A new `backend/app/apple_bridge/` module starts, stops,
  restarts and health-checks the bridge, and caches health for 30 seconds.
  `/health?detail=true` reports whether a bridge binary is present. Live model
  status comes from a new `GET /model/apple-intelligence/status`, which starts
  the bridge if needed.
- **Provider.**
  - The provider id is `apple-intelligence`, with model types
    `apple-on-device` and `apple-private-cloud`. It is aliased to
    `openai-compatible-model` in `PLATFORM_ALIAS_MAPPING`.
  - The saved record keeps an empty endpoint and the key `not-required`. When
    the model is built, the backend fills in the live bridge URL and token, so
    a stale port is never stored.
  - `/model/list` and `/model/validate` go through the bridge. Validation runs
    a short generation.
- **Context check.** Before a Run starts with an Apple model, the backend
  counts the tokens of the instructions, tool definitions and first message
  (`/v1/token-count`). If they do not fit in the context size minus a reserve
  for the answer, the Run does not start. The composer says the model's
  context is too small for this Session and offers to change the model. The
  model's token limit is set to its reported context size, so the existing
  history trimming starts earlier for these models.
- **No fallback.** If the bridge is down or the model is not ready, the Run
  fails with that reason. It never moves to another provider.
- **Warm-up.** The bridge calls `prewarm` when a Run or a test starts. The
  backend's existing 600-second model request timeout covers the first load.
- **Thinking effort.** Not offered. The catalog registers both models without
  effort levels, so the picker hides the control instead of guessing
  (`docs/model-capabilities.md`).

### 4.4 Settings and model picker

Reuse the existing provider card and configuration dialog in
`src/components/Settings/Models/` (`ConfigModelCard`,
`ModelConfigurationDialog`), badges and `Button` variants from
`src/components/ui`, and `DsIcon`. No new primitive.

- **Where it shows.** An **Apple Intelligence** card in the local providers
  group, on macOS only. On Intel Macs and older macOS it shows "Not available
  on this Mac" and the reason.
- **No fields.** There is no endpoint or key. A status line shows one of:
  - Ready;
  - Turn on Apple Intelligence in System Settings, with **Open System
    Settings**;
  - The model is still downloading;
  - Requires macOS 26 or later;
  - This Mac doesn't support Apple Intelligence.
- **Models.**
  - **On-device model**: shown whenever the provider is available.
  - **Private Cloud Compute** (macOS 27): off by default, with the note "Runs
    on Apple's servers through Private Cloud Compute. Not on this Mac."
  - Each model shows meta badges, such as "Text only", "Tools" and
    "Context 4K".
- **Test.** **Test** runs a short generation and shows how long it took.
- **Model picker.** Apple models appear in the local group with an "On this
  Mac" meta label. A model is disabled, with a tooltip saying why, when the
  current Session's tools or instructions do not fit its context.
- **Copy and localization.** Copy is sentence case and added to all shipped
  locales. Do not use "Siri" in the UI.

### 4.5 Privacy

- With the on-device model, prompts and responses do not leave the Mac
  through this provider. Session history is stored and synced the same way as
  with any other model. The help text says this, so "local model" is not read
  as "local history".
- Private Cloud Compute sends requests to Apple's servers. The card says so,
  and it stays off until the person turns it on.

## 5. Open questions

1. **Tool calling.** Does ending the turn from `Tool.call` and rebuilding the
   transcript work reliably? How much context does Eigent's default tool set
   need? PR 1 includes a spike with the real single-agent prompt. It records
   token counts for macOS 26, both macOS 27 variants and Private Cloud Compute,
   and appends them to this plan.
2. **Private Cloud Compute access.** Does a Developer ID app distributed
   outside the App Store get it? Does it need an entitlement, and how does the
   quota behave? Ship it in the first version or later?
3. **Helper form.** Does Foundation Models work from a command-line helper
   started by the Python backend? The same question applies to the microphone
   permission that meeting notes needs. The fallback is a minimal background
   app bundle inside the app's resources.
4. **Minimum macOS.** Which minimum macOS does the bridge target, compared
   with the app?
5. **Unsupported languages.** How should Eigent tell the person when they
   write in a language the on-device model does not support? The bridge
   returns `unsupported_language`; the UI copy is still open.

## 6. Pull requests and order

1. **Bridge and spike.**
   - Swift package, build script and arm64-only packaging.
   - Backend supervisor, `/v1/health`, `/v1/models` and text-only
     `/v1/chat/completions`.
   - Spike results for §5 Q1–Q3, appended to this plan.
2. **Provider.**
   - Backend: provider resolution, streaming, guided JSON, error mapping,
     validation, the context check and catalog entries.
   - UI: the Settings card, model picker states and locales.
3. **Tool calling.** Enable tool-using Sessions when the model reports
   `toolCalling` and the Session fits its context.
4. **Private Cloud Compute.** Behind its setting, after Q2 is answered.

The meeting notes plan uses PR 1 (the bridge) and PR 2 (on-device summaries).
Its own work can start in parallel.

## 7. Testing

- **Swift unit tests** (`swift test` on the macOS runners):
  - messages to transcript;
  - JSON Schema to `DynamicGenerationSchema`;
  - error mapping, snapshot-to-delta streaming and the token, `Origin` and
    `Host` checks.

  Framework calls sit behind a protocol, so the tests do not need Apple
  Intelligence.

- **Backend unit tests** use a fake bridge server:
  - supervisor start, restart, backoff and idle stop;
  - URL and token substitution, the context check, no fallback and error
    codes.
- **Renderer unit tests:**
  - one card state per availability reason, the card hidden off macOS, the
    Private Cloud Compute label;
  - disabled picker entries with their reason.
- **Manual, on real Macs:**
  1. Apple silicon, macOS 26, Apple Intelligence on: test, chat, streaming,
     cancel.
  2. Apple Intelligence off: the status line and **Open System Settings**.
  3. Model still downloading.
  4. Intel Mac: not available.
  5. macOS 27: context size and variant shown; Private Cloud Compute on and
     off.
  6. Kill the bridge during a generation: the Run fails with a clear reason
     and no fallback.
  7. A local web page cannot call the bridge.
- **Packaging.** A signed, notarized build starts the bridge under the hardened
  runtime.
