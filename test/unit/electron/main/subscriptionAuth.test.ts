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

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Reversible fake for Electron safeStorage so the store can be exercised in a
// plain Node test environment.
let encryptionAvailable = true;
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (s: string) => Buffer.from('enc:' + s, 'utf-8'),
    decryptString: (b: Buffer) => b.toString('utf-8').replace(/^enc:/, ''),
  },
}));

vi.mock('electron-log', () => ({
  default: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import {
  DEFAULT_CODEX_OAUTH_AUTH_URL,
  DEFAULT_CODEX_OAUTH_CLIENT_ID,
  DEFAULT_CODEX_OAUTH_REDIRECT_URI,
  DEFAULT_CODEX_OAUTH_SCOPES,
  DEFAULT_CODEX_OAUTH_TOKEN_URL,
  codexOAuthAuthUrl,
  codexOAuthClientId,
  codexOAuthRedirectUri,
  codexOAuthScopes,
  codexOAuthTokenUrl,
} from '../../../../electron/main/subscriptionAuth/codexOAuth';
import {
  clearCodexCredential,
  getCodexAccountStatus,
  getCodexAuthFilePath,
  loadCodexCredential,
  saveCodexCredential,
} from '../../../../electron/main/subscriptionAuth/credentialStore';
import {
  createPkcePair,
  deriveCodeChallenge,
  generateCodeVerifier,
} from '../../../../electron/main/subscriptionAuth/pkce';
import { ensureCodexResolverServer } from '../../../../electron/main/subscriptionAuth/resolverServer';
import type {
  CodexCredential,
  CodexResolverRuntime,
} from '../../../../electron/main/subscriptionAuth/types';

const BASE64URL = /^[A-Za-z0-9_-]+$/;

describe('pkce', () => {
  it('generates a base64url verifier of >= 43 chars', () => {
    const v = generateCodeVerifier();
    expect(v).toMatch(BASE64URL);
    expect(v.length).toBeGreaterThanOrEqual(43);
  });

  it('derives a stable S256 challenge for a known verifier', () => {
    // RFC 7636 Appendix B test vector.
    const challenge = deriveCodeChallenge(
      'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    );
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('produces unique verifiers and states across calls', () => {
    const a = createPkcePair();
    const b = createPkcePair();
    expect(a.codeChallengeMethod).toBe('S256');
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.state).not.toBe(b.state);
    expect(a.codeChallenge).toBe(deriveCodeChallenge(a.codeVerifier));
  });
});

describe('codexOAuth', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses OpenAI Codex OAuth defaults without app configuration', () => {
    vi.stubEnv('CODEX_OAUTH_AUTH_URL', '');
    vi.stubEnv('CODEX_OAUTH_TOKEN_URL', '');
    vi.stubEnv('CODEX_OAUTH_CLIENT_ID', '');
    vi.stubEnv('CODEX_OAUTH_SCOPES', '');
    vi.stubEnv('CODEX_OAUTH_REDIRECT_URI', '');

    expect(codexOAuthAuthUrl()).toBe(DEFAULT_CODEX_OAUTH_AUTH_URL);
    expect(codexOAuthTokenUrl()).toBe(DEFAULT_CODEX_OAUTH_TOKEN_URL);
    expect(codexOAuthClientId()).toBe(DEFAULT_CODEX_OAUTH_CLIENT_ID);
    expect(codexOAuthScopes()).toBe(DEFAULT_CODEX_OAUTH_SCOPES);
    expect(codexOAuthRedirectUri()).toBe(DEFAULT_CODEX_OAUTH_REDIRECT_URI);
  });
});

describe('credentialStore', () => {
  const email = 'User.Name@example.com';
  let homeDir: string;

  beforeEach(() => {
    encryptionAvailable = true;
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-auth-test-'));
    vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  const sample: CodexCredential = {
    access_token: 'access-123',
    refresh_token: 'refresh-456',
    token_type: 'Bearer',
    expires_at: '2026-06-24T12:00:00Z',
    account_label: 'user@example.com',
    scopes: ['openid', 'profile'],
    status: 'connected',
  };

  it('round-trips a credential through encrypted storage', () => {
    saveCodexCredential(email, sample);
    const loaded = loadCodexCredential(email);
    expect(loaded?.access_token).toBe('access-123');
    expect(loaded?.refresh_token).toBe('refresh-456');
    expect(loaded?.account_label).toBe('user@example.com');
    expect(loaded?.status).toBe('connected');
  });

  it('does not write the raw token to disk in plaintext', () => {
    saveCodexCredential(email, sample);
    const raw = fs.readFileSync(getCodexAuthFilePath(email), 'utf-8');
    expect(raw).not.toContain('access-123');
    expect(raw).not.toContain('refresh-456');
    // Non-sensitive metadata is allowed in plaintext.
    expect(raw).toContain('connected');
  });

  it('exposes a non-sensitive status view without token material', () => {
    saveCodexCredential(email, sample);
    const view = getCodexAccountStatus(email);
    expect(view).toEqual({
      connected: true,
      status: 'connected',
      account_label: 'user@example.com',
      expires_at: '2026-06-24T12:00:00Z',
      last_error_code: null,
    });
    expect(JSON.stringify(view)).not.toContain('access-123');
  });

  it('reports not_connected before anything is stored', () => {
    expect(getCodexAccountStatus(email)).toEqual({
      connected: false,
      status: 'not_connected',
    });
    expect(loadCodexCredential(email)).toBeNull();
  });

  it('clears the credential on disconnect (idempotent)', () => {
    saveCodexCredential(email, sample);
    clearCodexCredential(email);
    expect(loadCodexCredential(email)).toBeNull();
    expect(getCodexAccountStatus(email).connected).toBe(false);
    // second clear must not throw
    expect(() => clearCodexCredential(email)).not.toThrow();
  });

  it('refuses to persist when OS encryption is unavailable', () => {
    encryptionAvailable = false;
    expect(() => saveCodexCredential(email, sample)).toThrow(/safeStorage/);
  });
});

describe('resolverServer', () => {
  const email = 'resolver@example.com';
  let homeDir: string;
  let resolver: CodexResolverRuntime | null = null;

  beforeEach(() => {
    encryptionAvailable = true;
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-resolver-test-'));
    vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
  });

  afterEach(async () => {
    if (resolver) {
      await resolver.close();
      resolver = null;
    }
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('requires the shared secret', async () => {
    resolver = await ensureCodexResolverServer();
    const response = await fetch(`${resolver.url}/codex/token`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error_code: 'unauthorized' });
  });

  it('returns a local token only to authorized backend callers', async () => {
    saveCodexCredential(email, {
      access_token: 'resolver-token',
      refresh_token: null,
      token_type: 'Bearer',
      expires_at: null,
      status: 'connected_non_refreshable',
    });

    resolver = await ensureCodexResolverServer();
    const response = await fetch(`${resolver.url}/codex/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-eigent-resolver-secret': resolver.secret,
      },
      body: JSON.stringify({ email }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.access_token).toBe('resolver-token');
    expect(body.token_type).toBe('Bearer');
    expect(body.status).toBe('connected_non_refreshable');
  });

  it('refuses an expired non-refreshable token', async () => {
    saveCodexCredential(email, {
      access_token: 'expired-token',
      refresh_token: null,
      token_type: 'Bearer',
      expires_at: '2000-01-01T00:00:00Z',
      status: 'connected_non_refreshable',
    });

    resolver = await ensureCodexResolverServer();
    const response = await fetch(`${resolver.url}/codex/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-eigent-resolver-secret': resolver.secret,
      },
      body: JSON.stringify({ email }),
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toMatchObject({
      error_code: 'token_expired',
      status: 'expired',
    });
    expect(JSON.stringify(body)).not.toContain('expired-token');
  });

  it('refreshes an expired token when a refresh token is available', async () => {
    vi.stubEnv('CODEX_OAUTH_TOKEN_URL', 'https://codex.example/token');
    vi.stubEnv('CODEX_OAUTH_CLIENT_ID', 'codex-client');
    const realFetch = globalThis.fetch.bind(globalThis);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === 'https://codex.example/token') {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                access_token: 'fresh-token',
                refresh_token: 'fresh-refresh',
                token_type: 'Bearer',
                expires_in: 3600,
              }),
              {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }
            )
          );
        }
        return realFetch(input, init);
      });
    saveCodexCredential(email, {
      access_token: 'expired-token',
      refresh_token: 'old-refresh',
      token_type: 'Bearer',
      expires_at: '2000-01-01T00:00:00Z',
      status: 'connected',
    });

    resolver = await ensureCodexResolverServer();
    const response = await fetch(`${resolver.url}/codex/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-eigent-resolver-secret': resolver.secret,
      },
      body: JSON.stringify({ email }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.access_token).toBe('fresh-token');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://codex.example/token',
      expect.objectContaining({ method: 'POST' })
    );
    const saved = loadCodexCredential(email);
    expect(saved?.access_token).toBe('fresh-token');
    expect(saved?.refresh_token).toBe('fresh-refresh');
  });
});
