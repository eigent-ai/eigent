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

const storage = vi.hoisted(() => ({
  available: true,
  backend: 'keychain',
  encryptFails: false,
}));
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => storage.available,
    getSelectedStorageBackend: () => storage.backend,
    encryptString: (value: string) => {
      if (storage.encryptFails) throw new Error('native keyring locked');
      return Buffer.from(value).map((byte) => byte ^ 42);
    },
    decryptString: (value: Buffer) => value.map((byte) => byte ^ 42).toString(),
  },
  shell: { openExternal: vi.fn() },
}));

import {
  McpOAuthService,
  registerMcpOAuthIpc,
} from '../../../../electron/main/mcpOAuth';
import {
  normalizeServerUrl,
  parseChallenge,
  probeMcpOAuth,
  safeOAuthUrl,
} from '../../../../electron/main/mcpOAuth/discovery';
import { signInFlow } from '../../../../electron/main/mcpOAuth/flow';
import { McpOAuthStore } from '../../../../electron/main/mcpOAuth/store';
import {
  McpOAuthTokens,
  requestToken,
} from '../../../../electron/main/mcpOAuth/tokens';
import type { McpOAuthCredential } from '../../../../electron/main/mcpOAuth/types';
import { WorkspaceSecretBroker } from '../../../../electron/main/workspaceSecrets/broker';

let directory: string;
const identity = {
  account: 'alice@example.com',
  name: 'Astrocade',
  url: 'https://mcp.example.com/mcp',
};
const server = {
  issuer: 'https://auth.example.com',
  authorization_endpoint: 'https://auth.example.com/authorize',
  token_endpoint: 'https://auth.example.com/token',
  registration_endpoint: 'https://auth.example.com/register',
};
const credential = (): McpOAuthCredential => ({
  access_token: 'secret-access',
  refresh_token: 'secret-refresh',
  expires_at: Date.now() + 3600_000,
  client_id: 'client',
  resource: identity.url,
  server,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
let fallback = false;
function mockProvider() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === identity.url)
      return new Response('', {
        status: 401,
        headers: {
          'www-authenticate': `Bearer resource_metadata="https://mcp.example.com/metadata", scope="creator"`,
        },
      });
    if (url.endsWith('/metadata'))
      return json({
        resource: identity.url,
        authorization_servers: [server.issuer],
        scopes_supported: ['other'],
      });
    if (url.includes('/.well-known/')) {
      if (fallback && url.includes('oauth-authorization-server'))
        return json({}, 404);
      return json({ ...server, code_challenge_methods_supported: ['S256'] });
    }
    if (url === server.registration_endpoint) {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        token_endpoint_auth_method: 'none',
      });
      return json(
        { client_id: 'dynamic-client', token_endpoint_auth_method: 'none' },
        201
      );
    }
    if (url === server.token_endpoint)
      return json({
        token_type: 'Bearer',
        access_token: 'secret-new',
        refresh_token: 'rotated-refresh',
        expires_in: 3600,
      });
    throw new Error('unexpected test endpoint');
  });
}
const realFetch = globalThis.fetch;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-oauth-test-'));
  storage.available = true;
  storage.backend = 'keychain';
  storage.encryptFails = false;
  fallback = false;
});
afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe('remote MCP OAuth', () => {
  it('parses quoted 401 challenge fields and normalizes only equivalent URLs', () => {
    expect(
      parseChallenge(
        'Bearer scope="creator read", resource_metadata="https://example.com/meta?a=b"'
      )
    ).toEqual({
      metadata: 'https://example.com/meta?a=b',
      scopes: ['creator', 'read'],
    });
    expect(normalizeServerUrl('HTTPS://EXAMPLE.COM/')).toBe(
      'https://example.com'
    );
    for (const url of [
      'http://example.com',
      'file:///secret',
      'https://user:pass@example.com',
      'https://example.com/#token',
    ])
      expect(() => safeOAuthUrl(url)).toThrow();
    expect(safeOAuthUrl('http://127.0.0.1:1234/meta')).toContain('127.0.0.1');
  });

  it('discovers metadata with RFC 8414 before the OIDC fallback', async () => {
    fallback = true;
    const provider = mockProvider();
    vi.stubGlobal('fetch', provider);
    const result = await probeMcpOAuth(identity.url);
    expect(result).toMatchObject({
      requiresAuth: true,
      scopes: ['creator'],
      authorizationServer: server,
    });
    expect(provider.mock.calls.map(([url]) => url)).toEqual([
      identity.url,
      'https://mcp.example.com/metadata',
      'https://auth.example.com/.well-known/oauth-authorization-server',
      'https://auth.example.com/.well-known/openid-configuration',
    ]);
    expect(
      provider.mock.calls.every(([, init]) => init?.redirect === 'error')
    ).toBe(true);
  });

  it('leaves unauthenticated remotes unchanged', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ result: {} }))
    );
    expect(await probeMcpOAuth(identity.url)).toMatchObject({
      requiresAuth: false,
    });
  });

  it('refuses metadata with a different issuer or resource and reports required auth', async () => {
    const provider = mockProvider();
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) =>
      url.endsWith('/metadata')
        ? json({
            resource: 'https://other.example.com',
            authorization_servers: [server.issuer],
          })
        : provider(url, init)
    );
    await expect(probeMcpOAuth(identity.url)).rejects.toMatchObject({
      code: 'invalid_metadata',
      requiresAuth: true,
    });
  });

  it('encrypts tokens and isolates accounts, names, and server URLs across restarts', () => {
    const store = new McpOAuthStore(directory);
    store.write(identity, credential());
    const file = path.join(directory, fs.readdirSync(directory)[0]);
    expect(fs.readFileSync(file).toString()).not.toContain('secret-access');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(new McpOAuthStore(directory).read(identity)?.access_token).toBe(
      'secret-access'
    );
    expect(store.read({ ...identity, account: 'bob@example.com' })).toBeNull();
    expect(
      store.read({ ...identity, url: 'https://mcp.example.com/other' })
    ).toBeNull();
    expect(store.read({ ...identity, name: 'Another' })).toBeNull();
  });

  it.each([false, 'basic_text'])('refuses plaintext storage (%s)', (mode) => {
    if (mode === false) storage.available = false;
    else storage.backend = mode;
    expect(() =>
      new McpOAuthStore(directory, 'linux').write(identity, credential())
    ).toThrow('encryption_unavailable');
    expect(fs.readdirSync(directory)).toEqual([]);
  });

  it('reports a keyring encryption failure without writing a token file', () => {
    storage.encryptFails = true;
    expect(() =>
      new McpOAuthStore(directory).write(identity, credential())
    ).toThrow('encryption_unavailable');
    expect(fs.readdirSync(directory)).toEqual([]);
  });

  it('single-flights refresh and persists rotated refresh credentials', async () => {
    const store = new McpOAuthStore(directory);
    store.write(identity, { ...credential(), expires_at: Date.now() - 1 });
    const provider = mockProvider();
    vi.stubGlobal('fetch', provider);
    const tokens = new McpOAuthTokens(store);
    const results = await Promise.all([
      tokens.getAccessToken(identity),
      tokens.getAccessToken(identity),
      tokens.getAccessToken(identity),
    ]);
    expect(results.map((result) => result.access_token)).toEqual([
      'secret-new',
      'secret-new',
      'secret-new',
    ]);
    expect(provider).toHaveBeenCalledTimes(1);
    const parameters = new URLSearchParams(
      String(provider.mock.calls[0][1]?.body)
    );
    expect(parameters.get('resource')).toBe(identity.url);
    expect(parameters.get('grant_type')).toBe('refresh_token');
    expect(store.read(identity)?.refresh_token).toBe('rotated-refresh');
  });

  it('can use a fresh token when a provider omits the optional expires_in field', async () => {
    const provider = vi.fn(async () =>
      json({ access_token: 'opaque-token', token_type: 'Bearer' })
    );
    vi.stubGlobal('fetch', provider);
    const result = await requestToken(
      server.token_endpoint,
      new URLSearchParams({ grant_type: 'authorization_code' })
    );
    const store = new McpOAuthStore(directory);
    store.write(identity, {
      ...credential(),
      ...result,
      refresh_token: undefined,
    });
    expect(
      (await new McpOAuthTokens(store).getAccessToken(identity)).access_token
    ).toBe('opaque-token');
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('deletes invalid grants and never leaks response details', async () => {
    const store = new McpOAuthStore(directory);
    store.write(identity, { ...credential(), expires_at: 0 });
    vi.stubGlobal('fetch', async () =>
      json({ error: 'invalid_grant', error_description: 'secret-access' }, 400)
    );
    await expect(
      new McpOAuthTokens(store).getAccessToken(identity)
    ).rejects.toMatchObject({ message: 'signin_required' });
    expect(store.read(identity)).toBeNull();
  });

  it('requires sign-in again when the registered client is rejected', async () => {
    const store = new McpOAuthStore(directory);
    store.write(identity, { ...credential(), expires_at: 0 });
    vi.stubGlobal('fetch', async () => json({ error: 'invalid_client' }, 401));
    const tokens = new McpOAuthTokens(store);
    await expect(tokens.getAccessToken(identity)).rejects.toMatchObject({
      message: 'signin_required',
    });
    expect(tokens.status(identity)).toEqual({ state: 'signin_required' });
  });

  it('keeps credentials and reports refresh failure for non-JSON server errors', async () => {
    const store = new McpOAuthStore(directory);
    store.write(identity, { ...credential(), expires_at: 0 });
    vi.stubGlobal(
      'fetch',
      async () => new Response('<html>Bad gateway</html>', { status: 502 })
    );
    await expect(
      new McpOAuthTokens(store).getAccessToken(identity)
    ).rejects.toMatchObject({ message: 'refresh_failed' });
    expect(store.read(identity)).not.toBeNull();
  });

  it('does not treat a legacy SSE endpoint rejecting POST as a probe failure', async () => {
    vi.stubGlobal(
      'fetch',
      async () => new Response('Method Not Allowed', { status: 405 })
    );
    await expect(probeMcpOAuth(identity.url)).resolves.toEqual({
      requiresAuth: false,
      resource: identity.url,
      scopes: [],
    });
  });

  it('cannot restore tokens from an in-flight refresh after sign-out', async () => {
    const store = new McpOAuthStore(directory);
    store.write(identity, { ...credential(), expires_at: 0 });
    let resolve!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        })
    );
    const tokens = new McpOAuthTokens(store);
    const pending = tokens.getAccessToken(identity);
    tokens.invalidate(identity);
    resolve(
      json({ access_token: 'stale', token_type: 'bearer', expires_in: 3600 })
    );
    await expect(pending).rejects.toThrow('signin_required');
    expect(store.read(identity)).toBeNull();
  });

  it('uses a one-shot loopback callback, PKCE, resource, and dynamic registration', async () => {
    const provider = mockProvider();
    vi.stubGlobal('fetch', provider);
    let callbackUrl = '';
    const result = await signInFlow(
      identity.url,
      async (value) => {
        const authorization = new URL(value);
        callbackUrl = authorization.searchParams.get('redirect_uri')!;
        expect(callbackUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
        expect(authorization.searchParams.get('resource')).toBe(identity.url);
        expect(authorization.searchParams.get('code_challenge_method')).toBe(
          'S256'
        );
        const callback = new URL(callbackUrl);
        callback.searchParams.set(
          'state',
          authorization.searchParams.get('state')!
        );
        callback.searchParams.set('code', 'test-code');
        const response = await realFetch(callback);
        expect(response.status).toBe(200);
      },
      new AbortController().signal
    );
    expect(result).toMatchObject({
      access_token: 'secret-new',
      client_id: 'dynamic-client',
    });
    const exchange = provider.mock.calls.find(
      ([url]) => url === server.token_endpoint
    )!;
    const body = new URLSearchParams(String(exchange[1]?.body));
    expect(body.get('code_verifier')).toHaveLength(43);
    expect(body.get('resource')).toBe(identity.url);
    await expect(realFetch(callbackUrl)).rejects.toThrow();
  });

  it('rejects mismatched callback state before exchanging tokens', async () => {
    const provider = mockProvider();
    vi.stubGlobal('fetch', provider);
    await expect(
      signInFlow(
        identity.url,
        async (value) => {
          const authorization = new URL(value);
          const callback = new URL(
            authorization.searchParams.get('redirect_uri')!
          );
          callback.searchParams.set('state', 'wrong');
          callback.searchParams.set('code', 'test-code');
          expect((await realFetch(callback)).status).toBe(400);
        },
        new AbortController().signal
      )
    ).rejects.toThrow('state_mismatch');
    expect(
      provider.mock.calls.some(([url]) => url === server.token_endpoint)
    ).toBe(false);
  });

  it.each(['cancel', 'timeout'])(
    'closes the loopback callback on %s',
    async (action) => {
      vi.stubGlobal('fetch', mockProvider());
      const controller = new AbortController();
      let callback = '';
      const pending = signInFlow(
        identity.url,
        async (value) => {
          callback = new URL(value).searchParams.get('redirect_uri')!;
          if (action === 'cancel') controller.abort();
        },
        controller.signal,
        100
      );
      await expect(pending).rejects.toThrow(
        action === 'cancel' ? 'cancelled' : 'timeout'
      );
      await expect(realFetch(callback)).rejects.toThrow();
    }
  );

  it('never exposes credentials through status or IPC and guards every handler', async () => {
    const store = new McpOAuthStore(directory);
    store.write(identity, credential());
    const service = new McpOAuthService(new McpOAuthTokens(store), vi.fn());
    expect(service.tokens.status(identity)).toEqual({ state: 'connected' });
    const handlers = new Map<string, Function>();
    const guard = vi.fn(() => {
      throw new Error('untrusted');
    });
    registerMcpOAuthIpc(
      {
        handle: (channel: string, handler: Function) =>
          handlers.set(channel, handler),
      } as never,
      guard
    );
    for (const handler of handlers.values())
      await expect(handler({}, identity)).rejects.toThrow('untrusted');
    expect(handlers.size).toBe(5);
    expect(guard).toHaveBeenCalledTimes(5);
  });

  it('protects the backend token resolver with the existing capability', async () => {
    const broker = new WorkspaceSecretBroker({} as never);
    const runtime = await broker.start();
    try {
      expect(
        (
          await realFetch(`${runtime.endpoint}/mcp-oauth/token`, {
            method: 'POST',
            body: JSON.stringify(identity),
          })
        ).status
      ).toBe(401);
      const response = await realFetch(`${runtime.endpoint}/mcp-oauth/token`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${runtime.capability}` },
        body: JSON.stringify({ account: '' }),
      });
      expect(await response.json()).toEqual({ error: 'invalid_request' });
    } finally {
      await runtime.close();
    }
  });
});
