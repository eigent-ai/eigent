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

const CODEX_OAUTH_AUTH_URL_ENV = 'CODEX_OAUTH_AUTH_URL';
const CODEX_OAUTH_TOKEN_URL_ENV = 'CODEX_OAUTH_TOKEN_URL';
const CODEX_OAUTH_CLIENT_ID_ENV = 'CODEX_OAUTH_CLIENT_ID';
const CODEX_OAUTH_SCOPES_ENV = 'CODEX_OAUTH_SCOPES';
const CODEX_OAUTH_REDIRECT_URI_ENV = 'CODEX_OAUTH_REDIRECT_URI';
const CODEX_OAUTH_ORIGINATOR_ENV = 'CODEX_OAUTH_ORIGINATOR';

// Keep this module free of Electron APIs so future eigent-cli code can share
// the Codex provider constants and override behavior.
export const DEFAULT_CODEX_OAUTH_AUTH_URL =
  'https://auth.openai.com/oauth/authorize';
export const DEFAULT_CODEX_OAUTH_TOKEN_URL =
  'https://auth.openai.com/oauth/token';
export const DEFAULT_CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const DEFAULT_CODEX_OAUTH_SCOPES = 'openid profile email offline_access';
export const DEFAULT_CODEX_OAUTH_CALLBACK_HOST = 'localhost';
export const DEFAULT_CODEX_OAUTH_CALLBACK_PORT = 1455;
export const DEFAULT_CODEX_OAUTH_CALLBACK_PATH = '/auth/callback';
export const DEFAULT_CODEX_OAUTH_REDIRECT_URI = `http://${DEFAULT_CODEX_OAUTH_CALLBACK_HOST}:${DEFAULT_CODEX_OAUTH_CALLBACK_PORT}${DEFAULT_CODEX_OAUTH_CALLBACK_PATH}`;
// Pin the same originator the codex-rs CLI / OpenClaw advertise on the
// authorize request, matching the runtime `originator: codex_cli_rs` header so
// the OAuth identity is consistent end-to-end.
export const DEFAULT_CODEX_OAUTH_ORIGINATOR = 'codex_cli_rs';

export function codexOAuthAuthUrl(): string {
  return (
    process.env[CODEX_OAUTH_AUTH_URL_ENV]?.trim() ||
    DEFAULT_CODEX_OAUTH_AUTH_URL
  );
}

export function codexOAuthTokenUrl(): string {
  return (
    process.env[CODEX_OAUTH_TOKEN_URL_ENV]?.trim() ||
    DEFAULT_CODEX_OAUTH_TOKEN_URL
  );
}

export function codexOAuthClientId(): string {
  return (
    process.env[CODEX_OAUTH_CLIENT_ID_ENV]?.trim() ||
    DEFAULT_CODEX_OAUTH_CLIENT_ID
  );
}

export function codexOAuthScopes(): string {
  return (
    process.env[CODEX_OAUTH_SCOPES_ENV]?.trim() || DEFAULT_CODEX_OAUTH_SCOPES
  );
}

export function codexOAuthRedirectUri(): string {
  return (
    process.env[CODEX_OAUTH_REDIRECT_URI_ENV]?.trim() ||
    DEFAULT_CODEX_OAUTH_REDIRECT_URI
  );
}

export function codexOAuthOriginator(): string {
  return (
    process.env[CODEX_OAUTH_ORIGINATOR_ENV]?.trim() ||
    DEFAULT_CODEX_OAUTH_ORIGINATOR
  );
}
