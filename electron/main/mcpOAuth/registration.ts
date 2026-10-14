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

import { jsonBody, oauthFetch } from './discovery';
import { McpOAuthError, type AuthorizationServer } from './types';

export async function registerClient(
  server: AuthorizationServer,
  redirectUri: string,
  signal?: AbortSignal
): Promise<string> {
  if (!server.registration_endpoint)
    throw new McpOAuthError('unsupported_provider');
  // A fresh registration binds this flow's OS-selected callback port. Reusing
  // a client registered against a previous port breaks exact redirect matching.
  const response = await oauthFetch(server.registration_endpoint, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Eigent',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new McpOAuthError('unsupported_provider');
  }
  const body = await jsonBody(response);
  if (
    typeof body.client_id !== 'string' ||
    !body.client_id ||
    (body.token_endpoint_auth_method !== undefined &&
      body.token_endpoint_auth_method !== 'none')
  ) {
    throw new McpOAuthError('unsupported_provider');
  }
  return body.client_id;
}
