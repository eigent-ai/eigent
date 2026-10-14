# OAuth for custom remote MCP connectors

Branch: `feat/remote-mcp-oauth`

## 1. Problem

A user added Astrocade (`https://mcp.astrocade.com/mcp`) as a custom remote
connector. Eigent shows it as enabled, but the sign-in page never opens and the
agent never receives Astrocade tools.

What actually happens:

- Astrocade requires MCP OAuth. An unauthenticated `initialize` returns `401`
  with `WWW-Authenticate: Bearer resource_metadata="https://mcp.astrocade.com/.well-known/oauth-protected-resource/mcp", scope="creator"`.
- Eigent stores a custom remote connector as a bare `{ "url": ... }` entry in
  `~/.eigent/mcp.json` (`AddCustomConnectorPage.tsx` → `mcpInstall` →
  `backend/app/controller/mcp_controller.py` → `backend/app/service/mcp_config.py`).
- At task time the entry reaches CAMEL `MCPToolkit`. CAMEL's `ServerConfig`
  (camel-ai 0.2.91a7) only supports static `headers`. It never runs OAuth, so the
  connect fails with 401.
- The failure is either swallowed (legacy path: `get_mcp_tools` and
  `_mcp_config` callers log and return no tools) or surfaced as a generic
  `bundle_mcp_start_failed` setup error (pinned runtime-environment path).
  Neither tells the user to sign in.
- The connector switch only means "enabled in config". Nothing tests the
  connection or starts authorization.

## 2. Goals

1. A custom remote connector that requires OAuth can be signed in to from
   Settings → Connectors, with the system browser.
2. Tasks that use the connector get a valid, fresh access token without the user
   doing anything else.
3. Tokens never land in `~/.eigent/mcp.json`, Space configuration, logs,
   environment facts, or the renderer.
4. When sign-in is missing or expired, the user sees a specific, actionable
   message naming the connector, instead of silent tool loss or a generic setup
   error.
5. Connectors that do not need auth behave exactly as today.

## 3. Non-goals for this release

- Mid-task token refresh. Tokens are refreshed before each MCP connect; a task
  that outlives the access-token lifetime may get a 401 later (see §9).
- OAuth for local (stdio) connectors. `mcp-remote` users keep working as today.
- Pre-registered client IDs or client secrets per provider. Start with dynamic
  client registration; add manual client ID entry only if a real provider needs
  it.
- Syncing tokens across devices or to the Eigent server. Tokens are local only.
- Changing the Eigent server `mcp_user` model. It already stores `server_url`.

## 4. Current architecture (relevant parts)

| Step | Where | Notes |
| --- | --- | --- |
| Add remote connector | `src/components/Settings/Connectors/components/AddCustomConnectorPage.tsx` | Posts to server `/api/v1/mcp/import/remote`, then `mcpInstall(name, { url })` |
| Persist config | `backend/app/service/mcp_config.py` | Writes `~/.eigent/mcp.json` |
| List/toggle in UI | `src/components/Settings/Connectors/ConnectorGateway.tsx` | Custom rows render a `Switch`; `active` = enabled |
| Global MCP → runtime | `backend/app/workspace_config/global_resources.py` (`_mcp_entries`, `resolve_global_mcp`) | Rejects `slot://` secrets on global servers |
| Pinned runtime env | `backend/app/workspace_bundle/runtime.py` (`mcp_config_without_secrets`) | Runtime-only config; must not be serialized |
| Build MCP client config | `backend/app/agent/factory/toolkit_assembler.py` (`_mcp_config`, MCP block near `_enabled(config, "mcp")`) | Legacy path uses `skip_failed`; pinned path raises `bundle_mcp_start_failed` |
| Worker MCP tools | `backend/app/agent/tools.py` (`get_mcp_tools`), called from `chat_service.py` | Catches all errors and returns `[]` |
| Setup error to UI | `backend/app/controller/chat_controller.py` (`_environment_setup_error`) | Generic message plus issue codes |
| Local secret broker | `electron/main/workspaceSecrets/*` ↔ `backend/app/workspace_bundle/secrets.py` | Loopback HTTP + capability token via `EIGENT_WORKSPACE_SECRET_BROKER_*` env |
| Existing OAuth helpers | `electron/main/subscriptionAuth/{pkce,resolverServer,credentialStore}.ts` | PKCE, loopback server, `safeStorage` storage (Codex) |

## 5. Proposed design

Electron owns OAuth: discovery, client registration, browser sign-in, token
storage, and refresh. The Python backend only asks Electron for a current access
token when it is about to connect, then adds an in-memory `Authorization`
header. CAMEL needs no change.

```
Settings "Sign in"                       Task start
      │                                       │
renderer ──IPC──▶ Electron mcpOAuth      backend toolkit assembly
                  │ discovery (RFC 9728/8414)  │ server has auth.type == "oauth"
                  │ dynamic registration       │
                  │ PKCE + system browser      ├──loopback──▶ Electron token resolver
                  │ loopback callback          │              refresh if needed
                  │ safeStorage token store ◀──┘              returns access token
                                               │
                                     headers.Authorization (memory only)
                                               │
                                       CAMEL MCPToolkit (streamable HTTP / SSE)
```

### 5.1 Config shape (non-secret)

Add an optional `auth` block to a remote entry in `~/.eigent/mcp.json`:

```json
{
  "mcpServers": {
    "astrocade": {
      "url": "https://mcp.astrocade.com/mcp",
      "auth": { "type": "oauth" }
    }
  }
}
```

- `auth` contains no secrets, so it is safe in `mcp.json` and in global
  discovery output.
- Tokens are keyed by (account, connector name, normalized server URL). Changing
  the URL invalidates the stored tokens.
- The backend strips `auth` before handing the config to CAMEL.

### 5.2 Electron: `electron/main/mcpOAuth/`

New module, reusing `subscriptionAuth/pkce.ts` and the `credentialStore.ts`
pattern.

- `discovery.ts`
  - Unauthenticated probe. Parse `WWW-Authenticate` for `resource_metadata` and
    `scope`.
  - Fetch the protected-resource metadata, then the authorization-server
    metadata (RFC 8414, with OIDC discovery as a fallback).
  - Return `{ requiresAuth, authorizationServer, scopes }`.
- `registration.ts`: dynamic client registration (RFC 7591). Store the client ID
  per authorization server. Redirect URI is `http://127.0.0.1:<port>/callback`.
- `flow.ts`
  - Start a one-shot loopback callback server on an OS-chosen port.
  - Open the authorization URL with `shell.openExternal`.
  - Verify `state`, exchange the code with the PKCE verifier and the `resource`
    parameter (RFC 8707).
  - Time out after about 5 minutes and support cancel.
- `store.ts`
  - Per-account encrypted token store using `safeStorage`.
  - Refuse to persist when encryption is unavailable, matching
    `credentialStore.ts` behavior.
- `tokens.ts`: `getAccessToken(account, name, url)` refreshes when the token is
  within about 60s of expiry. Concurrent refreshes for the same key are
  single-flighted, and failures are classified (`signin_required`,
  `refresh_failed`, `network`).
- `ipc.ts` exposes these channels through preload. None of them return tokens to
  the renderer.
  - `mcp-oauth-probe(url)`
  - `mcp-oauth-sign-in(name, url)`
  - `mcp-oauth-sign-out(name, url)`
  - `mcp-oauth-status(name, url)` → `connected | signin_required | error`
- Token resolver for the backend: add a `POST /mcp-oauth/token` route to the
  existing `WorkspaceSecretBroker` loopback server. It uses the same capability
  check and env plumbing. Request `{ name, url }`, response
  `{ access_token, expires_at }` or `{ error }`.

**Dependency decision:** either implement discovery, registration and exchange
by hand (about 300 LOC; the repo already has PKCE), or add
`@modelcontextprotocol/sdk` and use its `auth()` helper with a custom
`OAuthClientProvider`. Recommendation: use the SDK helper if its bundle size and
ESM packaging work in the Electron main build; otherwise implement by hand.
Decide in Phase 1.

### 5.3 Backend

- New `backend/app/service/mcp_oauth.py`
  - `apply_mcp_oauth(config: dict) -> dict` returns a deep copy where every
    server with `auth.type == "oauth"` has `auth` removed and
    `headers["Authorization"] = "Bearer <token>"`.
  - Raises `McpOAuthRequired(name)` or `McpOAuthUnavailable(name, reason)`.
  - Talks to the broker using the same client conventions as
    `workspace_bundle/secrets.py` (loopback-only endpoint, capability, size
    limits, short timeout).
- Call `apply_mcp_oauth` at the last step before `MCPToolkit(...)` in both paths:
  - `toolkit_assembler.py` MCP block (legacy and pinned)
  - `agent/tools.py:get_mcp_tools` (workers)

  Never store the result back on `options`, the runtime environment, or the
  journal.
- `global_resources.py`: allow the `auth` key on global entries, and keep
  rejecting `slot://` values. Discovery output can expose `requiresSignIn: true`
  but never token state.
- Error surfacing:
  - Pinned path: map `McpOAuthRequired` to
    `EnvironmentSetupRequiredError([f"mcp_oauth_required:{name}"])` instead of
    `bundle_mcp_start_failed`.
  - Legacy and worker paths: keep running without that server, but emit a task
    notice event (`mcp_connector_unavailable`, `{ name, reason }`) so the task
    view can show it. Reuse the existing SSE notice channel rather than a new
    transport.
  - Also classify plain 401 failures from CAMEL on servers without `auth` as
    `mcp_auth_failed:{name}` so misconfigured remotes stop failing silently.
- Logging: never log headers. Add a redaction test.

### 5.4 Renderer / UI

Required reading before implementation: `docs/design-system/design.md` and
`docs/product-terminology.md`.

- **Add remote connector** (`AddCustomConnectorPage.tsx`): after URL
  validation, call `mcp-oauth-probe`.
  - If auth is required, save with `auth: { type: "oauth" }` and go straight to
    sign-in.
  - If the probe fails due to network, save anyway and let the user retry from
    the row.
- **Connector row / detail** (`ConnectorGateway.tsx`), for remote connectors
  with `auth.type == "oauth"`:
  - Status `Tag` (`src/components/ui/tag.tsx`), using feedback tone only where
    it carries meaning:
    - Connected: `success`
    - Sign-in required: `warning`
    - Error: `error`
  - Actions: `Button variant="secondary" size="sm"` for *Sign in* / *Reconnect*;
    *Sign out* in the existing row overflow, or as `variant="ghost"` if there is
    no overflow.
  - While the browser flow is open, show a pending state with *Cancel*. The
    existing `Switch` keeps meaning enabled/disabled.
  - Primitives: `Button`, `Switch`, `Tag`, `DsText`, `DsIcon`. No new
    primitives, raw colors, or local icon sizing (the current row's
    `h-5 w-5` icon classes are pre-existing; do not copy them into new code).
- **Task view:** render `mcp_oauth_required:*` and the
  `mcp_connector_unavailable` notice as a specific message, for example
  "Astrocade needs you to sign in." with a *Sign in* action that runs the same
  IPC flow.
- **Copy:** add keys under `connectors.*` in all 11 locales
  (`src/i18n/locales/*/connectors.json`). Use sentence case and Task/Session
  wording per `docs/product-terminology.md`. Never "Run" or "Project" in visible
  copy.

## 6. Phases

### Phase 0: Confirm paths (0.5 day)

- Reproduce with Astrocade on the current build. Record which path the task
  takes (pinned runtime vs legacy), what the user sees, and the exact log lines.
- Confirm the broker is always started when the backend runs, including Linux
  AppImage and local-proxy dev mode.
- Make the SDK-vs-hand-rolled decision (§5.2).

### Phase 1: Electron OAuth core (1.5 days)

- `mcpOAuth/` discovery, registration, flow, store, tokens, IPC, preload types
  (`src/types/electron.d.ts`).
- Unit tests with a mocked authorization server:
  - 401 parsing
  - metadata fallback order
  - registration
  - state mismatch rejection
  - code exchange
  - refresh and single-flight
  - `safeStorage` unavailable
  - timeout and cancel

### Phase 2: Backend token injection (1 day)

- Broker route `/mcp-oauth/token` plus `backend/app/service/mcp_oauth.py`.
- Wire `apply_mcp_oauth` into `toolkit_assembler.py` and `agent/tools.py`.
- Allow `auth` in `global_resources.py`.
- Error mapping (`mcp_oauth_required`, `mcp_auth_failed`, notice event).
- Tests:
  - header injection
  - `auth` stripped before CAMEL
  - no token in `options`, journal, discovery, or logs
  - non-auth servers unchanged
  - broker unavailable → clear reason

### Phase 3: UI (1 day)

- Probe on add, status tag, Sign in / Reconnect / Sign out, pending and cancel
  states, task-view message, and locale keys in all 11 locales.
- Tests: `ConnectorGateway.test.tsx`, `AddCustomConnectorPage` tests, and the
  task-view notice rendering.

### Phase 4: Verification (0.5–1 day)

- Manual end-to-end with Astrocade on macOS and Linux (AppImage, ideally
  Bazzite or another immutable Fedora variant).
- Light/dark, keyboard focus, 200% zoom, long localized strings.
- Regression check: an unauthenticated remote MCP and a local stdio MCP still
  work.

Rough total: **4.5–5.5 days**. This is an estimate, not a measured one.

## 7. Security requirements

- Access and refresh tokens exist only in:
  - Electron main memory
  - the `safeStorage`-encrypted store
  - backend memory for the lifetime of the MCP connection
- The loopback callback binds `127.0.0.1` only, is one-shot, validates `state`,
  and closes after success, failure or timeout.
- The broker route requires the existing capability and accepts loopback only.
- `resource` (RFC 8707) is sent on authorization and token requests, so tokens
  are audience-bound to the MCP server URL.
- Never follow a `resource_metadata` or authorization-server URL with a non-HTTPS
  scheme, except `http://localhost` and `http://127.0.0.1` for local dev.
- Sign out deletes local tokens. Revocation (RFC 7009) is best effort when the
  server advertises it.
- No tokens in renderer IPC payloads, logs, crash reports, PostHog events, or
  exported diagnostics zips.

## 8. Acceptance criteria

- Adding `https://mcp.astrocade.com/mcp` as a remote connector prompts sign-in,
  opens the system browser, and the row shows **Connected** after approval.
- A Task that uses Astrocade lists and calls its tools with no extra prompts.
  The same holds after an app restart and after the access token expires
  (refresh path).
- With no sign-in, starting a Task shows a specific "needs sign-in" message
  naming the connector, with a working *Sign in* action.
- `~/.eigent/mcp.json`, Space configuration exports, and logs contain no token
  material.
- Existing unauthenticated remote and local connectors are unaffected.
- On Linux without a usable keyring, sign-in fails with a clear explanation
  rather than storing plaintext.

## 9. Risks and open questions

- **Linux keyring:** `safeStorage` needs a secret service, such as GNOME Keyring
  or KWallet. On a minimal setup it may be unavailable. Is a clear error
  acceptable for v1, or do we want an explicit, opt-in weaker fallback?
- **Mid-task expiry:** static headers cannot refresh during a long Task. If this
  matters, the follow-up is upstream in CAMEL: add `auth: httpx.Auth` to
  `ServerConfig` and pass it to `streamablehttp_client` / `sse_client`. Then
  use a backend `httpx.Auth` that calls the broker on 401. Track it as a
  separate CAMEL PR.
- **Providers without dynamic client registration:** some will require a
  pre-registered client ID or a fixed redirect port. Add a manual "client ID"
  field only when a real provider needs it.
- **Broker ownership:** confirm with the owners of `workspaceSecrets` that adding
  the `/mcp-oauth/token` route there is acceptable. The alternative is a sibling
  resolver modeled on `subscriptionAuth/resolverServer.ts`, with its own env
  plumbing.
- **Remote Control and cloud runs:** tokens are device-local, so a Task executed
  elsewhere cannot use them. It should report `mcp_oauth_required` rather than
  attempting the flow.

## 10. Validation commands

```bash
npm run type-check
npx vitest run test/unit/components/Settings/Connectors
npx vitest run test/unit/electron/main
npm run check:design-tokens
npm run lint
git diff --check
cd backend && uv run pytest tests -k "mcp"
```

Run the locale parity check when connector copy changes.
