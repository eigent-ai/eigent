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

export type McpOAuthErrorCode =
  | 'signin_required'
  | 'refresh_failed'
  | 'network'
  | 'encryption_unavailable'
  | 'unsupported_provider'
  | 'invalid_metadata'
  | 'invalid_request'
  | 'cancelled'
  | 'timeout'
  | 'state_mismatch';

export class McpOAuthError extends Error {
  constructor(
    readonly code: McpOAuthErrorCode,
    readonly requiresAuth = false
  ) {
    super(code);
  }
}

export interface McpOAuthIdentity {
  account: string;
  name: string;
  url: string;
}

export interface McpOAuthStatus {
  state: 'connected' | 'signin_required' | 'error';
  error?: McpOAuthErrorCode;
}

export interface AuthorizationServer {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  revocation_endpoint?: string;
}

export interface McpOAuthDiscovery {
  requiresAuth: boolean;
  resource: string;
  scopes: string[];
  authorizationServer?: AuthorizationServer;
}

export interface McpOAuthCredential {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  client_id: string;
  resource: string;
  server: AuthorizationServer;
}

export function errorCode(error: unknown): McpOAuthErrorCode {
  return error instanceof McpOAuthError ? error.code : 'network';
}
