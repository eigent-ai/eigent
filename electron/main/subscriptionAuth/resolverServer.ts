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

import log from 'electron-log';
import crypto from 'node:crypto';
import http from 'node:http';
import { URL } from 'node:url';
import { codexOAuthClientId, codexOAuthTokenUrl } from './codexOAuth';
import { loadCodexCredential, saveCodexCredential } from './credentialStore';
import { expiresAtFromTokenPayload } from './oauthToken';
import type { CodexCredential, CodexResolverRuntime } from './types';

const RESOLVER_SECRET_HEADER = 'x-eigent-resolver-secret';
const EXPIRES_SOON_MS = 60_000;

let runtime: CodexResolverRuntime | null = null;

function writeJson(
  res: http.ServerResponse,
  statusCode: number,
  body: Record<string, unknown>
) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function readRequestJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 32_768) {
        reject(new Error('request_body_too_large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

function isExpired(expiresAt?: string | null): boolean {
  if (!expiresAt) return false;
  const timestamp = Date.parse(expiresAt);
  if (!Number.isFinite(timestamp)) return true;
  return timestamp <= Date.now() + EXPIRES_SOON_MS;
}

function hasValidResolverSecret(
  providedHeader: string | string[] | undefined,
  secret: string
): boolean {
  if (typeof providedHeader !== 'string') return false;
  const provided = Buffer.from(providedHeader);
  const expected = Buffer.from(secret);
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}

async function refreshCodexCredential(
  email: string,
  credential: CodexCredential
): Promise<CodexCredential | null> {
  if (!credential.refresh_token) return null;
  const tokenUrl = codexOAuthTokenUrl();
  const clientId = codexOAuthClientId();

  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('client_id', clientId);
  body.set('refresh_token', credential.refresh_token);

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!response.ok) return null;

  const payload = (await response.json()) as Record<string, unknown>;
  if (typeof payload.access_token !== 'string' || !payload.access_token) {
    return null;
  }

  const refreshed: CodexCredential = {
    ...credential,
    access_token: payload.access_token,
    refresh_token:
      typeof payload.refresh_token === 'string'
        ? payload.refresh_token
        : credential.refresh_token,
    token_type:
      typeof payload.token_type === 'string'
        ? payload.token_type
        : credential.token_type || 'Bearer',
    expires_at: expiresAtFromTokenPayload(payload),
    status: 'connected',
    updated_at: new Date().toISOString(),
  };
  saveCodexCredential(email, refreshed);
  return refreshed;
}

async function handleTokenRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  secret: string
) {
  const providedSecret = req.headers[RESOLVER_SECRET_HEADER];
  if (!hasValidResolverSecret(providedSecret, secret)) {
    writeJson(res, 401, { error_code: 'unauthorized' });
    return;
  }

  let body: any;
  try {
    body = await readRequestJson(req);
  } catch (error: any) {
    writeJson(res, 400, { error_code: error.message || 'invalid_request' });
    return;
  }

  const email = typeof body.email === 'string' ? body.email : '';
  const forceRefresh = body.force_refresh === true;
  if (!email) {
    writeJson(res, 400, { error_code: 'email_required' });
    return;
  }

  try {
    let credential = loadCodexCredential(email);
    if (!credential?.access_token) {
      writeJson(res, 404, { error_code: 'not_connected' });
      return;
    }

    if (forceRefresh || isExpired(credential.expires_at)) {
      credential = await refreshCodexCredential(email, credential);
    }

    if (!credential || isExpired(credential.expires_at)) {
      writeJson(res, 401, {
        error_code: forceRefresh ? 'token_refresh_failed' : 'token_expired',
        status: 'expired',
        expires_at: credential?.expires_at ?? null,
      });
      return;
    }

    writeJson(res, 200, {
      access_token: credential.access_token,
      token_type: credential.token_type || 'Bearer',
      expires_at: credential.expires_at ?? null,
      status: credential.status,
      account_label: credential.account_label ?? null,
    });
  } catch (error: any) {
    log.warn('[CODEX RESOLVER] Failed to resolve local credential:', error);
    writeJson(res, 500, { error_code: 'credential_unavailable' });
  }
}

export async function ensureCodexResolverServer(): Promise<CodexResolverRuntime> {
  if (runtime) return runtime;

  const secret = crypto.randomBytes(32).toString('base64url');
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');

    if (requestUrl.pathname !== '/codex/token') {
      writeJson(res, 404, { error_code: 'not_found' });
      return;
    }

    if (req.method !== 'POST') {
      writeJson(res, 405, { error_code: 'method_not_allowed' });
      return;
    }

    void handleTokenRequest(req, res, secret);
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('invalid_resolver_address'));
        return;
      }
      resolve(address.port);
    });
  });

  runtime = {
    url: `http://127.0.0.1:${port}`,
    secret,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          runtime = null;
          resolve();
        });
      }),
  };

  log.info('[CODEX RESOLVER] Local resolver started', { port });
  return runtime;
}

export async function getCodexResolverEnv(): Promise<Record<string, string>> {
  const resolver = await ensureCodexResolverServer();
  return {
    CODEX_RESOLVER_URL: resolver.url,
    CODEX_RESOLVER_SECRET: resolver.secret,
  };
}
