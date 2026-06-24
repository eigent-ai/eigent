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

// Shared types for the Codex subscription auth feature (desktop-local).
// See docs/models/codex-subscription-auth-review.md — token is stored
// locally and never leaves the user's machine.

export type CodexAccountStatus =
  | 'connected'
  | 'connected_non_refreshable'
  | 'expired'
  | 'revoked'
  | 'plan_unavailable'
  | 'quota_exceeded'
  | 'error';

// Full credential, including secret token material. Lives only inside the
// Electron main process; the secret fields are encrypted at rest.
export interface CodexCredential {
  access_token: string;
  refresh_token?: string | null;
  token_type?: string | null;
  // ISO-8601 access-token expiry, if known.
  expires_at?: string | null;
  account_label?: string | null;
  external_account_id?: string | null;
  scopes?: string[] | null;
  status: CodexAccountStatus;
  last_error_code?: string | null;
  last_error_message?: string | null;
  updated_at?: string | null;
}

// Non-sensitive subset safe to hand to the renderer / show in the UI.
// Never contains token material.
export interface CodexAccountStatusView {
  connected: boolean;
  status: CodexAccountStatus | 'not_connected';
  account_label?: string | null;
  expires_at?: string | null;
  last_error_code?: string | null;
}

export interface CodexSubscriptionIpcResult {
  success: boolean;
  error_code?: string;
  error?: string;
}

export interface CodexResolverRuntime {
  url: string;
  secret: string;
  close: () => Promise<void>;
}
