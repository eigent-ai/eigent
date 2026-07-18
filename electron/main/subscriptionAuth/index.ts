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

import { BrowserWindow, shell, type IpcMain } from 'electron';
import log from 'electron-log';
import http from 'node:http';
import {
  DEFAULT_CODEX_OAUTH_CALLBACK_HOST,
  DEFAULT_CODEX_OAUTH_CALLBACK_PATH,
  DEFAULT_CODEX_OAUTH_CALLBACK_PORT,
  codexOAuthAuthUrl,
  codexOAuthClientId,
  codexOAuthOriginator,
  codexOAuthRedirectUri,
  codexOAuthScopes,
  codexOAuthTokenUrl,
} from './codexOAuth';
import {
  clearCodexCredential,
  getCodexAccountStatus,
  saveCodexCredential,
} from './credentialStore';
import {
  codexAccountMetadataFromAccessToken,
  expiresAtFromTokenPayload,
} from './oauthToken';
import { createPkcePair } from './pkce';
import { getCodexResolverEnv } from './resolverServer';
import type { CodexSubscriptionIpcResult } from './types';

const CODEX_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

type PendingCodexOAuth = {
  email: string;
  codeVerifier: string;
  redirectUri: string;
  expiresAtMs: number;
};

export type CodexOAuthCallbackResult = {
  handled: boolean;
  error_code?: string;
};

const pendingCodexOAuthByState = new Map<string, PendingCodexOAuth>();
// The local OAuth callback server only needs to run during an active login.
// We start it on demand and stop it once no login is pending (or the state TTL
// lapses), so we don't hold port 1455 for the whole app lifetime.
let oauthCallbackServer: http.Server | null = null;
let oauthCallbackServerStarting: Promise<void> | null = null;
let oauthCallbackIdleTimer: ReturnType<typeof setTimeout> | null = null;
const OAUTH_CALLBACK_IDLE_GRACE_MS = 30 * 1000;

function normalizeEmail(email: unknown): string {
  return typeof email === 'string' ? email.trim() : '';
}

function pruneExpiredOAuthState(now = Date.now()) {
  for (const [state, pending] of pendingCodexOAuthByState.entries()) {
    if (pending.expiresAtMs <= now) {
      pendingCodexOAuthByState.delete(state);
    }
  }
}

function notifyCodexStatusChanged(payload?: { error_code?: string }) {
  for (const browserWindow of BrowserWindow.getAllWindows()) {
    if (!browserWindow.isDestroyed()) {
      browserWindow.webContents.send(
        'subscription-auth:codex-status-changed',
        payload
      );
    }
  }
}

function writeOAuthHtml(
  res: http.ServerResponse,
  statusCode: number,
  title: string,
  body: string
) {
  res.writeHead(statusCode, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    // Close the socket after responding so the callback server can stop
    // promptly instead of lingering on a keep-alive connection.
    connection: 'close',
  });
  res.end(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      color-scheme: light dark;
      background: Canvas;
      color: CanvasText;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      text-align: center;
    }
    main { max-width: 520px; }
    h1 { margin: 0 0 12px; font-size: 28px; }
    p { margin: 0; color: GrayText; line-height: 1.6; }
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p>${body}</p>
  </main>
</body>
</html>`);
}

async function handleLocalOAuthCallback(
  req: http.IncomingMessage,
  res: http.ServerResponse
) {
  const callbackUrl = new URL(
    req.url || '/',
    `http://${DEFAULT_CODEX_OAUTH_CALLBACK_HOST}:${DEFAULT_CODEX_OAUTH_CALLBACK_PORT}`
  );

  if (callbackUrl.pathname !== DEFAULT_CODEX_OAUTH_CALLBACK_PATH) {
    writeOAuthHtml(
      res,
      404,
      'Authentication failed',
      'Callback route not found.'
    );
    return;
  }

  const result = await completeCodexOAuthCallback(callbackUrl);
  if (!result.handled) {
    writeOAuthHtml(
      res,
      400,
      'Authentication failed',
      'Unexpected OAuth callback.'
    );
    return;
  }

  notifyCodexStatusChanged(
    result.error_code ? { error_code: result.error_code } : undefined
  );

  if (result.error_code) {
    writeOAuthHtml(
      res,
      400,
      'Authentication failed',
      'Return to Eigent and try signing in again.'
    );
    stopCallbackServerWhenIdle();
    return;
  }

  writeOAuthHtml(
    res,
    200,
    'Authentication successful',
    'OpenAI Codex is connected. You can close this window.'
  );
  stopCallbackServerWhenIdle();
}

function clearCallbackServerIdleTimer() {
  if (oauthCallbackIdleTimer) {
    clearTimeout(oauthCallbackIdleTimer);
    oauthCallbackIdleTimer = null;
  }
}

function stopLocalOAuthCallbackServer() {
  clearCallbackServerIdleTimer();
  const server = oauthCallbackServer;
  oauthCallbackServer = null;
  oauthCallbackServerStarting = null;
  if (!server) return;
  server.close((error) => {
    if (error) {
      log.warn('[CODEX AUTH] Failed to stop OAuth callback server:', error);
    } else {
      log.info('[CODEX AUTH] Local OAuth callback server stopped');
    }
  });
}

// Stop the server once nothing is pending; otherwise keep it for the other
// in-flight login(s).
function stopCallbackServerWhenIdle() {
  if (pendingCodexOAuthByState.size === 0) {
    stopLocalOAuthCallbackServer();
  }
}

// Auto-stop after the state TTL (+ grace) so an abandoned login never leaves
// the port held indefinitely.
function armCallbackServerIdleTimeout() {
  clearCallbackServerIdleTimer();
  oauthCallbackIdleTimer = setTimeout(() => {
    oauthCallbackIdleTimer = null;
    pruneExpiredOAuthState();
    if (pendingCodexOAuthByState.size === 0) {
      stopLocalOAuthCallbackServer();
    } else {
      armCallbackServerIdleTimeout();
    }
  }, CODEX_OAUTH_STATE_TTL_MS + OAUTH_CALLBACK_IDLE_GRACE_MS);
  // Never keep the app alive just for this timer.
  oauthCallbackIdleTimer.unref?.();
}

async function ensureLocalOAuthCallbackServer(): Promise<void> {
  if (oauthCallbackServer) {
    armCallbackServerIdleTimeout();
    return;
  }
  if (oauthCallbackServerStarting) return oauthCallbackServerStarting;

  oauthCallbackServerStarting = new Promise<void>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      void handleLocalOAuthCallback(req, res).catch((error) => {
        log.warn('[CODEX AUTH] Local OAuth callback failed:', error);
        writeOAuthHtml(
          res,
          500,
          'Authentication failed',
          'Eigent could not complete the OAuth callback.'
        );
      });
    });

    const handleListenError = (error: NodeJS.ErrnoException) => {
      oauthCallbackServer = null;
      oauthCallbackServerStarting = null;
      reject(
        new Error(
          error.code === 'EADDRINUSE'
            ? 'oauth_callback_port_in_use'
            : 'oauth_callback_unavailable'
        )
      );
    };

    server.once('error', handleListenError);
    server.listen(
      DEFAULT_CODEX_OAUTH_CALLBACK_PORT,
      DEFAULT_CODEX_OAUTH_CALLBACK_HOST,
      () => {
        server.off('error', handleListenError);
        // Keep logging post-startup errors instead of crashing the process.
        server.on('error', (error) => {
          log.warn('[CODEX AUTH] OAuth callback server error:', error);
        });
        oauthCallbackServer = server;
        oauthCallbackServerStarting = null;
        armCallbackServerIdleTimeout();
        log.info('[CODEX AUTH] Local OAuth callback server started', {
          host: DEFAULT_CODEX_OAUTH_CALLBACK_HOST,
          port: DEFAULT_CODEX_OAUTH_CALLBACK_PORT,
        });
        resolve();
      }
    );
  });

  return oauthCallbackServerStarting;
}

export function registerCodexSubscriptionAuthIpcHandlers(ipcMain: IpcMain) {
  ipcMain.handle('subscription-auth:codex-status', (_event, email: unknown) => {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      return {
        connected: false,
        status: 'not_connected',
        last_error_code: 'email_required',
      };
    }
    return getCodexAccountStatus(normalizedEmail);
  });

  ipcMain.handle(
    'subscription-auth:codex-disconnect',
    (_event, email: unknown): CodexSubscriptionIpcResult => {
      const normalizedEmail = normalizeEmail(email);
      if (!normalizedEmail) {
        return { success: false, error_code: 'email_required' };
      }
      clearCodexCredential(normalizedEmail);
      return { success: true };
    }
  );

  ipcMain.handle(
    'subscription-auth:codex-login',
    async (_event, email: unknown): Promise<CodexSubscriptionIpcResult> => {
      const normalizedEmail = normalizeEmail(email);
      if (!normalizedEmail) {
        return { success: false, error_code: 'email_required' };
      }

      try {
        await ensureLocalOAuthCallbackServer();
      } catch (error: any) {
        log.warn('[CODEX AUTH] Failed to start local OAuth callback:', error);
        const errorCode =
          error?.message === 'oauth_callback_port_in_use'
            ? 'oauth_callback_port_in_use'
            : 'oauth_callback_unavailable';
        return { success: false, error_code: errorCode };
      }

      pruneExpiredOAuthState();
      const pkce = createPkcePair();
      const redirectUri = codexOAuthRedirectUri();
      pendingCodexOAuthByState.set(pkce.state, {
        email: normalizedEmail,
        codeVerifier: pkce.codeVerifier,
        redirectUri,
        expiresAtMs: Date.now() + CODEX_OAUTH_STATE_TTL_MS,
      });

      const authUrl = codexOAuthAuthUrl();
      const clientId = codexOAuthClientId();
      const url = new URL(authUrl);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('state', pkce.state);
      url.searchParams.set('code_challenge', pkce.codeChallenge);
      url.searchParams.set('code_challenge_method', pkce.codeChallengeMethod);
      url.searchParams.set('scope', codexOAuthScopes());
      url.searchParams.set('id_token_add_organizations', 'true');
      url.searchParams.set('codex_cli_simplified_flow', 'true');
      url.searchParams.set('originator', codexOAuthOriginator());

      try {
        await shell.openExternal(url.toString());
      } catch (error) {
        pendingCodexOAuthByState.delete(pkce.state);
        stopCallbackServerWhenIdle();
        log.warn('[CODEX AUTH] Failed to open OAuth URL:', error);
        return { success: false, error_code: 'oauth_open_browser_failed' };
      }
      return { success: true };
    }
  );
}

async function exchangeCodexOAuthCode(
  code: string,
  pending: PendingCodexOAuth
): Promise<Record<string, unknown>> {
  const tokenUrl = codexOAuthTokenUrl();
  const clientId = codexOAuthClientId();

  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('client_id', clientId);
  body.set('code', code);
  body.set('redirect_uri', pending.redirectUri);
  body.set('code_verifier', pending.codeVerifier);

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`token_exchange_failed_${response.status}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const accessToken = payload.access_token;
  if (typeof accessToken !== 'string' || !accessToken.trim()) {
    throw new Error('token_exchange_missing_access_token');
  }
  return payload;
}

export async function completeCodexOAuthCallback(
  callbackUrl: URL
): Promise<CodexOAuthCallbackResult> {
  pruneExpiredOAuthState();
  const state = callbackUrl.searchParams.get('state');
  const provider = callbackUrl.searchParams.get('provider');
  const pending = state ? pendingCodexOAuthByState.get(state) : undefined;
  if (!pending && provider !== 'codex') {
    return { handled: false };
  }
  if (!state || !pending) {
    log.warn('[CODEX AUTH] Ignoring OAuth callback without matching state');
    return { handled: true, error_code: 'oauth_state_mismatch' };
  }
  if (pending.expiresAtMs <= Date.now()) {
    pendingCodexOAuthByState.delete(state);
    log.warn('[CODEX AUTH] Ignoring expired OAuth callback state');
    return { handled: true, error_code: 'oauth_state_expired' };
  }

  pendingCodexOAuthByState.delete(state);

  const error = callbackUrl.searchParams.get('error');
  if (error) {
    log.warn('[CODEX AUTH] OAuth callback returned an error:', error);
    return { handled: true, error_code: error };
  }

  const code = callbackUrl.searchParams.get('code');
  if (!code) {
    log.warn('[CODEX AUTH] OAuth callback did not include a code');
    return { handled: true, error_code: 'oauth_code_missing' };
  }

  try {
    const tokenPayload = await exchangeCodexOAuthCode(code, pending);
    const accountMetadata = codexAccountMetadataFromAccessToken(
      tokenPayload.access_token as string
    );
    saveCodexCredential(pending.email, {
      access_token: tokenPayload.access_token as string,
      refresh_token:
        typeof tokenPayload.refresh_token === 'string'
          ? tokenPayload.refresh_token
          : null,
      token_type:
        typeof tokenPayload.token_type === 'string'
          ? tokenPayload.token_type
          : 'Bearer',
      expires_at: expiresAtFromTokenPayload(tokenPayload),
      account_label:
        typeof tokenPayload.account_label === 'string'
          ? tokenPayload.account_label
          : accountMetadata.account_label || pending.email,
      external_account_id:
        typeof tokenPayload.external_account_id === 'string'
          ? tokenPayload.external_account_id
          : accountMetadata.external_account_id,
      scopes:
        typeof tokenPayload.scope === 'string'
          ? tokenPayload.scope.split(/\s+/).filter(Boolean)
          : codexOAuthScopes().split(/\s+/).filter(Boolean),
      status:
        typeof tokenPayload.refresh_token === 'string'
          ? 'connected'
          : 'connected_non_refreshable',
      updated_at: new Date().toISOString(),
    });
  } catch (error: any) {
    const errorCode =
      typeof error?.message === 'string'
        ? error.message
        : 'token_exchange_failed';
    log.warn('[CODEX AUTH] Failed to complete OAuth callback:', errorCode);
    return { handled: true, error_code: errorCode };
  }

  return { handled: true };
}

export { getCodexResolverEnv };
