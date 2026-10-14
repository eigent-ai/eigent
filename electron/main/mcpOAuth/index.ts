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

import { shell, type IpcMain, type IpcMainInvokeEvent } from 'electron';
import { oauthFetch, probeMcpOAuth } from './discovery';
import { signInFlow } from './flow';
import { identityKey } from './store';
import { McpOAuthTokens } from './tokens';
import {
  McpOAuthError,
  errorCode,
  type McpOAuthIdentity,
  type McpOAuthStatus,
} from './types';

export class McpOAuthService {
  private readonly pending = new Map<string, AbortController>();
  constructor(
    readonly tokens = new McpOAuthTokens(),
    private readonly openBrowser = shell.openExternal
  ) {}

  async signIn(identity: McpOAuthIdentity): Promise<McpOAuthStatus> {
    const key = identityKey(identity);
    this.cancel(identity);
    const controller = new AbortController();
    this.pending.set(key, controller);
    try {
      this.tokens.store.assertAvailable();
      const credential = await signInFlow(
        identity.url,
        this.openBrowser,
        controller.signal
      );
      if (controller.signal.aborted)
        return { state: 'signin_required', error: 'cancelled' };
      this.tokens.invalidate(identity);
      this.tokens.store.write(identity, credential);
      return { state: 'connected' };
    } catch (error) {
      const code = errorCode(error);
      return {
        state:
          code === 'signin_required' || code === 'cancelled'
            ? 'signin_required'
            : 'error',
        error: code,
      };
    } finally {
      if (this.pending.get(key) === controller) this.pending.delete(key);
    }
  }

  cancel(identity: McpOAuthIdentity): void {
    this.pending.get(identityKey(identity))?.abort();
  }

  async signOut(identity: McpOAuthIdentity): Promise<void> {
    this.cancel(identity);
    let credential;
    try {
      credential = this.tokens.store.read(identity);
    } catch {
      /* Delete even if the keyring is locked. */
    }
    this.tokens.invalidate(identity);
    if (credential?.server.revocation_endpoint) {
      try {
        const response = await oauthFetch(
          credential.server.revocation_endpoint,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              token: credential.refresh_token ?? credential.access_token,
              client_id: credential.client_id,
            }).toString(),
          }
        );
        await response.body?.cancel();
      } catch {
        /* Local sign-out succeeds even when revocation is unavailable. */
      }
    }
  }
}

let service: McpOAuthService | undefined;
export function getMcpOAuthService(): McpOAuthService {
  return (service ??= new McpOAuthService());
}

export function registerMcpOAuthIpc(
  ipcMain: IpcMain,
  guard: (event: IpcMainInvokeEvent) => void
): void {
  ipcMain.handle('mcp-oauth-probe', async (event, url: string) => {
    guard(event);
    try {
      if (typeof url !== 'string' || url.length > 4096)
        return { error: 'invalid_request' };
      const result = await probeMcpOAuth(url);
      // Renderer only needs the auth marker, never endpoints or credentials.
      return { requiresAuth: result.requiresAuth };
    } catch (error) {
      return {
        error: errorCode(error),
        requiresAuth: error instanceof McpOAuthError && error.requiresAuth,
      };
    }
  });
  for (const action of ['sign-in', 'sign-out', 'status', 'cancel'] as const) {
    ipcMain.handle(
      `mcp-oauth-${action}`,
      async (event, identity: McpOAuthIdentity) => {
        guard(event);
        try {
          identityKey(identity);
          const oauth = getMcpOAuthService();
          if (action === 'sign-in') return await oauth.signIn(identity);
          if (action === 'sign-out') {
            await oauth.signOut(identity);
            return { state: 'signin_required' };
          }
          if (action === 'cancel') {
            oauth.cancel(identity);
            return { state: 'signin_required' };
          }
          return oauth.tokens.status(identity);
        } catch (error) {
          return { state: 'error', error: errorCode(error) };
        }
      }
    );
  }
}
