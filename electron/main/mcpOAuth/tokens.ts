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
import { McpOAuthStore, identityKey } from './store';
import {
  McpOAuthError,
  type McpOAuthCredential,
  type McpOAuthIdentity,
  type McpOAuthStatus,
} from './types';

export async function requestToken(
  endpoint: string,
  parameters: URLSearchParams,
  signal?: AbortSignal
): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_at: number;
}> {
  const response = await oauthFetch(endpoint, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: parameters.toString(),
  });
  const body = await jsonBody(response);
  if (!response.ok)
    throw new McpOAuthError(
      body.error === 'invalid_grant' ? 'signin_required' : 'refresh_failed'
    );
  if (
    typeof body.access_token !== 'string' ||
    !body.access_token ||
    /[\r\n]/.test(body.access_token) ||
    typeof body.token_type !== 'string' ||
    body.token_type.toLowerCase() !== 'bearer' ||
    (body.expires_in !== undefined &&
      (typeof body.expires_in !== 'number' ||
        !Number.isFinite(body.expires_in) ||
        body.expires_in <= 0))
  ) {
    throw new McpOAuthError('invalid_metadata');
  }
  return {
    access_token: body.access_token,
    ...(typeof body.refresh_token === 'string'
      ? { refresh_token: body.refresh_token }
      : {}),
    // Unknown lifetimes get a short conservative window, never an immortal token.
    expires_at:
      Date.now() +
      (typeof body.expires_in === 'number' ? body.expires_in * 1000 : 300_000),
  };
}

export class McpOAuthTokens {
  private readonly refreshes = new Map<string, Promise<McpOAuthCredential>>();
  private readonly generations = new Map<string, number>();
  constructor(readonly store = new McpOAuthStore()) {}

  invalidate(identity: McpOAuthIdentity): void {
    const key = identityKey(identity);
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
    this.store.delete(identity);
  }

  status(identity: McpOAuthIdentity): McpOAuthStatus {
    try {
      const value = this.store.read(identity);
      return {
        state:
          value &&
          (value.expires_at > Date.now() + 60_000 || value.refresh_token)
            ? 'connected'
            : 'signin_required',
      };
    } catch (error) {
      return {
        state:
          error instanceof McpOAuthError && error.code === 'signin_required'
            ? 'signin_required'
            : 'error',
        error: error instanceof McpOAuthError ? error.code : 'network',
      };
    }
  }

  async getAccessToken(
    identity: McpOAuthIdentity
  ): Promise<McpOAuthCredential> {
    const key = identityKey(identity);
    const current = this.store.read(identity);
    if (!current) throw new McpOAuthError('signin_required');
    if (current.expires_at > Date.now() + 60_000) return current;
    if (!current.refresh_token) throw new McpOAuthError('signin_required');
    const pending = this.refreshes.get(key);
    if (pending) return pending;
    const generation = this.generations.get(key) ?? 0;
    const refresh = (async () => {
      try {
        const result = await requestToken(
          current.server.token_endpoint,
          new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: current.refresh_token!,
            client_id: current.client_id,
            resource: current.resource,
          })
        );
        if ((this.generations.get(key) ?? 0) !== generation)
          throw new McpOAuthError('signin_required');
        const credential = { ...current, ...result };
        this.store.write(identity, credential);
        return credential;
      } catch (error) {
        if (
          error instanceof McpOAuthError &&
          error.code === 'signin_required' &&
          (this.generations.get(key) ?? 0) === generation
        )
          this.invalidate(identity);
        throw error;
      }
    })();
    this.refreshes.set(key, refresh);
    try {
      return await refresh;
    } finally {
      if (this.refreshes.get(key) === refresh) this.refreshes.delete(key);
    }
  }
}
