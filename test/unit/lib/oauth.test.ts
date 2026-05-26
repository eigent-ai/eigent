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

import { OAuth, mcpMap } from '@/lib/oauth';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock Response that resolves .json() with the given body. */
function mockJsonResponse(body: any, ok = true): Response {
  return {
    ok,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------
describe('OAuth', () => {
  let oauth: OAuth;

  beforeEach(() => {
    oauth = new OAuth();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------
  describe('constructor', () => {
    it('initialises with default property values', () => {
      const instance = new OAuth();
      expect(instance.client_name).toBe('Eigent');
      expect(instance.client_uri).toBe('https://eigent.ai/');
      expect(instance.redirect_uris).toEqual([]);
      expect(instance.url).toBe('');
      expect(instance.authServerUrl).toBe('');
      expect(instance.codeVerifier).toBe('');
      expect(instance.provider).toBe('');
    });

    it('calls startOauth when mcpName is provided', () => {
      const spy = vi
        .spyOn(OAuth.prototype, 'startOauth')
        .mockResolvedValue(undefined as any);
      const instance = new OAuth('Notion');
      expect(spy).toHaveBeenCalledWith('Notion');
      spy.mockRestore();
    });

    it('does NOT call startOauth when mcpName is omitted', () => {
      const spy = vi.spyOn(OAuth.prototype, 'startOauth');
      new OAuth();
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  // -----------------------------------------------------------------------
  // startOauth
  // -----------------------------------------------------------------------
  describe('startOauth', () => {
    it('throws if mcpName is not in mcpMap', async () => {
      await expect(oauth.startOauth('Unknown')).rejects.toThrow(
        'MCP Unknown not found'
      );
    });

    it('sets properties and calls helper methods in order', async () => {
      const resourceMeta = { resource: 'https://api.notion.com' };
      const authServerMeta = {
        registration_endpoint: 'https://auth.notion.com/register',
        authorization_endpoint: 'https://auth.notion.com/authorize',
        grant_types_supported: ['authorization_code'],
        response_types_supported: ['code'],
      };
      const clientData = { client_id: 'cid-123' };

      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockJsonResponse(resourceMeta))
        .mockResolvedValueOnce(mockJsonResponse(authServerMeta))
        .mockResolvedValueOnce(mockJsonResponse(clientData));

      // Mock pkceChallenge so generateAuthUrl works without real crypto
      vi.spyOn(oauth, 'pkceChallenge').mockResolvedValue({
        code_verifier: 'verifier-abc',
        code_challenge: 'challenge-xyz',
      });

      // Intercept window.location.href assignment (jsdom doesn't support navigation)
      let capturedHref = '';
      const originalLocation = window.location;
      Object.defineProperty(window, 'location', {
        value: { ...originalLocation },
        writable: true,
        configurable: true,
      });
      Object.defineProperty(window.location, 'href', {
        set(value: string) {
          capturedHref = value;
        },
        get() {
          return capturedHref || 'http://localhost:3000/';
        },
        configurable: true,
      });

      await oauth.startOauth('Notion');

      expect(oauth.url).toBe('https://mcp.notion.com/mcp');
      expect(oauth.provider).toBe('notion');
      expect(oauth.authServerUrl).toBe('https://mcp.notion.com');
      expect(oauth.resourceMetadata).toEqual(resourceMeta);
      expect(oauth.authorizationServerMetadata).toEqual(authServerMeta);
      expect(oauth.registerClientData).toEqual(clientData);
      expect(oauth.codeVerifier).toBe('verifier-abc');

      // Verify location.href was set to the generated auth URL
      expect(capturedHref).toContain('response_type=code');
      expect(capturedHref).toContain('client_id=cid-123');
      expect(capturedHref).toContain('code_challenge=challenge-xyz');
      expect(capturedHref).toContain('code_challenge_method=S256');

      // Restore original location
      Object.defineProperty(window, 'location', {
        value: originalLocation,
        writable: true,
        configurable: true,
      });
    });

    it('uses custom resourcePath and authorizationServerPath when provided on mcp entry', async () => {
      // Temporarily extend mcpMap
      const originalNotion = { ...mcpMap['Notion'] };
      (mcpMap as any)['TestMCP'] = {
        url: 'https://example.com/api',
        provider: 'test',
        resourcePath: '/custom-resource',
        authorizationServerPath: '/custom-auth',
      };

      // Suppress jsdom navigation error for location.href assignment
      const originalLocation = window.location;
      let capturedHref = '';
      Object.defineProperty(window, 'location', {
        value: { ...originalLocation },
        writable: true,
        configurable: true,
      });
      Object.defineProperty(window.location, 'href', {
        set(value: string) {
          capturedHref = value;
        },
        get() {
          return capturedHref || 'http://localhost:3000/';
        },
        configurable: true,
      });

      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockJsonResponse({}))
        .mockResolvedValueOnce(mockJsonResponse({}))
        .mockResolvedValueOnce(mockJsonResponse({ client_id: 'x' }));

      vi.spyOn(oauth, 'pkceChallenge').mockResolvedValue({
        code_verifier: 'v',
        code_challenge: 'c',
      });

      await oauth.startOauth('TestMCP');

      expect(oauth.resourcePath).toBe('/custom-resource');
      expect(oauth.authorizationServerPath).toBe('/custom-auth');

      // Cleanup
      delete (mcpMap as any)['TestMCP'];
      Object.assign(mcpMap['Notion'], originalNotion);
      Object.defineProperty(window, 'location', {
        value: originalLocation,
        writable: true,
        configurable: true,
      });
    });
  });

  // -----------------------------------------------------------------------
  // getResourceMetadata
  // -----------------------------------------------------------------------
  describe('getResourceMetadata', () => {
    it('fetches and returns JSON from authServerUrl + resourcePath', async () => {
      oauth.authServerUrl = 'https://auth.example.com';
      oauth.resourcePath = '/.well-known/oauth-protected-resource';
      const expected = { resource: 'https://api.example.com' };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse(expected)
      );

      const result = await oauth.getResourceMetadata();
      expect(result).toEqual(expected);
      expect(fetch).toHaveBeenCalledWith(
        'https://auth.example.com/.well-known/oauth-protected-resource'
      );
    });
  });

  // -----------------------------------------------------------------------
  // getAuthorizationServerMetadata
  // -----------------------------------------------------------------------
  describe('getAuthorizationServerMetadata', () => {
    it('fetches and returns JSON from authServerUrl + authorizationServerPath', async () => {
      oauth.authServerUrl = 'https://auth.example.com';
      oauth.authorizationServerPath = '/.well-known/oauth-authorization-server';
      const expected = {
        registration_endpoint: 'https://auth.example.com/register',
        authorization_endpoint: 'https://auth.example.com/authorize',
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse(expected)
      );

      const result = await oauth.getAuthorizationServerMetadata();
      expect(result).toEqual(expected);
      expect(fetch).toHaveBeenCalledWith(
        'https://auth.example.com/.well-known/oauth-authorization-server'
      );
    });
  });

  // -----------------------------------------------------------------------
  // clientRegistration
  // -----------------------------------------------------------------------
  describe('clientRegistration', () => {
    it('POSTs client details to registration_endpoint and returns result', async () => {
      oauth.authorizationServerMetadata = {
        registration_endpoint: 'https://auth.example.com/register',
        grant_types_supported: ['authorization_code'],
        response_types_supported: ['code'],
      };
      oauth.redirect_uris = [
        'https://dev.eigent.ai/api/v1/oauth/test/callback',
      ];
      const response = { client_id: 'new-id', client_secret: 'secret' };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse(response)
      );

      const result = await oauth.clientRegistration();
      expect(result).toEqual(response);
      expect(fetch).toHaveBeenCalledWith(
        'https://auth.example.com/register',
        expect.objectContaining({
          method: 'POST',
        })
      );

      // Verify body contains correct fields
      const callArgs = (fetch as any).mock.calls[0][1];
      const body = JSON.parse(callArgs.body);
      expect(body.client_name).toBe('Eigent');
      expect(body.token_endpoint_auth_method).toBe('none');
      expect(body.grant_types).toEqual(['authorization_code']);
    });
  });

  // -----------------------------------------------------------------------
  // generateAuthUrl
  // -----------------------------------------------------------------------
  describe('generateAuthUrl', () => {
    it('builds correct OAuth URL with PKCE params', async () => {
      oauth.authorizationServerMetadata = {
        authorization_endpoint: 'https://auth.example.com/authorize',
      };
      oauth.registerClientData = { client_id: 'my-client-id' };
      oauth.redirect_uris = ['https://dev.eigent.ai/callback'];

      vi.spyOn(oauth, 'pkceChallenge').mockResolvedValue({
        code_verifier: 'abc123',
        code_challenge: 'def456',
      });

      const url = await oauth.generateAuthUrl();

      expect(oauth.codeVerifier).toBe('abc123');
      expect(url).toContain('response_type=code');
      expect(url).toContain('client_id=my-client-id');
      expect(url).toContain('redirect_uri=https://dev.eigent.ai/callback');
      expect(url).toContain('code_challenge_method=S256');
      expect(url).toContain('code_challenge=def456');
    });
  });

  // -----------------------------------------------------------------------
  // getToken
  // -----------------------------------------------------------------------
  describe('getToken', () => {
    beforeEach(() => {
      oauth.authorizationServerMetadata = {
        token_endpoint: 'https://auth.example.com/token',
      };
      oauth.registerClientData = { client_id: 'cid' };
      oauth.codeVerifier = 'verifier123';
      oauth.redirect_uris = ['https://dev.eigent.ai/callback'];
      oauth.provider = 'notion';
    });

    it('exchanges code for token and saves it', async () => {
      const tokenResponse = {
        access_token: 'at-123',
        refresh_token: 'rt-456',
        expires_in: 3600,
        token_type: 'Bearer',
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse(tokenResponse)
      );
      const saveSpy = vi.spyOn(oauth, 'saveToken');

      const token = await oauth.getToken('auth-code', 'user@test.com');

      expect(token).toEqual(tokenResponse);
      expect(saveSpy).toHaveBeenCalledWith(
        'notion',
        'user@test.com',
        expect.objectContaining({
          access_token: 'at-123',
          refresh_token: 'rt-456',
        })
      );

      // Verify saved token has expires_at computed from expires_in
      const savedData = saveSpy.mock.calls[0][2] as any;
      expect(savedData.expires_at).toBeGreaterThan(Date.now() - 2000);
      expect(savedData.meta.authorizationServerMetadata).toEqual(
        oauth.authorizationServerMetadata
      );
    });

    it('includes client_secret in params when registerClientData has one', async () => {
      oauth.registerClientData = {
        client_id: 'cid',
        client_secret: 'cs-secret',
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ access_token: 'x' })
      );
      vi.spyOn(oauth, 'saveToken');

      await oauth.getToken('code', 'u@e.com');

      const fetchBody = (fetch as any).mock.calls[0][1].body as string;
      expect(fetchBody).toContain('client_secret=cs-secret');
    });

    it('includes resource param when resourceMetadata is set', async () => {
      oauth.resourceMetadata = { resource: 'https://api.notion.com' };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ access_token: 'x' })
      );
      vi.spyOn(oauth, 'saveToken');

      await oauth.getToken('code', 'u@e.com');

      const fetchBody = (fetch as any).mock.calls[0][1].body as string;
      expect(fetchBody).toContain('resource=https%3A%2F%2Fapi.notion.com');
    });

    it('defaults expires_in to 3600 when not present in response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ access_token: 'x' })
      );
      vi.spyOn(oauth, 'saveToken');

      await oauth.getToken('code', 'u@e.com');

      const savedData = (oauth.saveToken as any).mock.calls[0][2] as any;
      // expires_in default = 3600 → expires_at = Date.now() + 3600000
      expect(savedData.expires_at).toBeGreaterThan(Date.now() + 3500000);
      expect(savedData.expires_at).toBeLessThan(Date.now() + 3700000);
    });
  });

  // -----------------------------------------------------------------------
  // refreshToken
  // -----------------------------------------------------------------------
  describe('refreshToken', () => {
    it('returns early when no stored token or no refresh_token', async () => {
      vi.spyOn(oauth, 'loadToken').mockReturnValue(null);
      const result = await oauth.refreshToken('notion', 'u@e.com');
      expect(result).toBeUndefined();
    });

    it('returns early when token has no refresh_token field', async () => {
      vi.spyOn(oauth, 'loadToken').mockReturnValue({ access_token: 'x' });
      const result = await oauth.refreshToken('notion', 'u@e.com');
      expect(result).toBeUndefined();
    });

    it('throws when metadata is missing in stored token', async () => {
      vi.spyOn(oauth, 'loadToken').mockReturnValue({
        refresh_token: 'rt',
        meta: {},
      });

      await expect(oauth.refreshToken('notion', 'u@e.com')).rejects.toThrow(
        'no metadata for notion - u@e.com'
      );
    });

    it('refreshes token and saves new token data', async () => {
      const storedToken = {
        refresh_token: 'old-rt',
        meta: {
          authorizationServerMetadata: {
            token_endpoint: 'https://auth.example.com/token',
          },
          registerClientData: { client_id: 'cid' },
          resourceMetadata: { resource: 'https://api.example.com' },
        },
      };
      vi.spyOn(oauth, 'loadToken').mockReturnValue(storedToken);

      const newTokenResponse = {
        access_token: 'new-at',
        refresh_token: 'new-rt',
        expires_in: 7200,
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse(newTokenResponse)
      );
      const saveSpy = vi.spyOn(oauth, 'saveToken');

      const result = await oauth.refreshToken('notion', 'u@e.com');

      expect(result).toEqual(newTokenResponse);

      // Verify fetch was called with refresh_token grant
      const fetchCall = (fetch as any).mock.calls[0];
      expect(fetchCall[0]).toBe('https://auth.example.com/token');
      const fetchBody = fetchCall[1].body as string;
      expect(fetchBody).toContain('grant_type=refresh_token');
      expect(fetchBody).toContain('refresh_token=old-rt');

      // Verify new token saved
      expect(saveSpy).toHaveBeenCalledWith(
        'notion',
        'u@e.com',
        expect.objectContaining({
          access_token: 'new-at',
        })
      );
    });

    it('includes client_secret when present in registerClientData', async () => {
      vi.spyOn(oauth, 'loadToken').mockReturnValue({
        refresh_token: 'rt',
        meta: {
          authorizationServerMetadata: {
            token_endpoint: 'https://auth.example.com/token',
          },
          registerClientData: { client_id: 'cid', client_secret: 'cs' },
        },
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ access_token: 'new' })
      );
      vi.spyOn(oauth, 'saveToken');

      await oauth.refreshToken('notion', 'u@e.com');

      const fetchBody = (fetch as any).mock.calls[0][1].body as string;
      expect(fetchBody).toContain('client_secret=cs');
    });

    it('calls electronAPI.envWrite when available (notion provider)', async () => {
      const envWriteMock = vi.fn().mockResolvedValue(undefined);
      (window as any).electronAPI = { envWrite: envWriteMock };

      vi.spyOn(oauth, 'loadToken').mockReturnValue({
        refresh_token: 'rt',
        meta: {
          authorizationServerMetadata: {
            token_endpoint: 'https://auth.example.com/token',
          },
          registerClientData: { client_id: 'cid' },
        },
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockJsonResponse({ access_token: 'new-at', expires_in: 3600 })
      );
      vi.spyOn(oauth, 'saveToken');

      await oauth.refreshToken('notion', 'user@test.com');

      expect(envWriteMock).toHaveBeenCalledWith('user@test.com', {
        key: 'NOTION_TOKEN',
        value: 'new-at',
      });

      delete (window as any).electronAPI;
    });
  });

  // -----------------------------------------------------------------------
  // Token Storage (saveToken, loadToken, clearToken, getAllTokens)
  // -----------------------------------------------------------------------
  describe('token storage', () => {
    it('saveToken stores token under provider → email', () => {
      oauth.saveToken('notion', 'user@test.com', {
        access_token: 'at',
        refresh_token: 'rt',
      });

      const stored = oauth.loadToken('notion', 'user@test.com');
      expect(stored).toEqual({
        access_token: 'at',
        refresh_token: 'rt',
      });
    });

    it('loadToken returns null for unknown provider', () => {
      expect(oauth.loadToken('unknown', 'user@test.com')).toBeNull();
    });

    it('loadToken returns null for unknown email under known provider', () => {
      oauth.saveToken('notion', 'a@test.com', { access_token: 'x' });
      expect(oauth.loadToken('notion', 'b@test.com')).toBeNull();
    });

    it('clearToken removes specific email entry', () => {
      oauth.saveToken('notion', 'a@test.com', { access_token: 'a' });
      oauth.saveToken('notion', 'b@test.com', { access_token: 'b' });

      oauth.clearToken('notion', 'a@test.com');

      expect(oauth.loadToken('notion', 'a@test.com')).toBeNull();
      expect(oauth.loadToken('notion', 'b@test.com')).toEqual({
        access_token: 'b',
      });
    });

    it('clearToken removes provider key when last email is cleared', () => {
      oauth.saveToken('notion', 'only@test.com', { access_token: 'x' });
      oauth.clearToken('notion', 'only@test.com');

      const all = oauth.getAllTokens();
      expect(all).toEqual({});
    });

    it('clearToken is no-op when provider or email does not exist', () => {
      oauth.saveToken('notion', 'a@test.com', { access_token: 'a' });
      // Should not throw
      oauth.clearToken('nonexistent', 'x@test.com');
      oauth.clearToken('notion', 'nonexistent@test.com');

      expect(oauth.loadToken('notion', 'a@test.com')).toEqual({
        access_token: 'a',
      });
    });

    it('getAllTokens returns empty object when nothing stored', () => {
      expect(oauth.getAllTokens()).toEqual({});
    });

    it('getAllTokens returns all providers and emails', () => {
      oauth.saveToken('notion', 'a@t.com', { at: '1' });
      oauth.saveToken('google', 'b@t.com', { at: '2' });

      const all = oauth.getAllTokens();
      expect(Object.keys(all)).toHaveLength(2);
      expect(all.notion['a@t.com']).toEqual({ at: '1' });
      expect(all.google['b@t.com']).toEqual({ at: '2' });
    });

    it('saveToken overwrites existing token for same provider+email', () => {
      oauth.saveToken('notion', 'u@t.com', { v: 1 });
      oauth.saveToken('notion', 'u@t.com', { v: 2 });

      expect(oauth.loadToken('notion', 'u@t.com')).toEqual({ v: 2 });
    });
  });

  // -----------------------------------------------------------------------
  // pkceChallenge
  // -----------------------------------------------------------------------
  describe('pkceChallenge', () => {
    it('returns code_verifier and code_challenge of correct shape', async () => {
      const result = await oauth.pkceChallenge();
      expect(result).toHaveProperty('code_verifier');
      expect(result).toHaveProperty('code_challenge');
      expect(typeof result.code_verifier).toBe('string');
      expect(typeof result.code_challenge).toBe('string');
    });

    it('returns verifier of default length 43', async () => {
      const result = await oauth.pkceChallenge();
      expect(result.code_verifier.length).toBe(43);
    });

    it('returns verifier of custom length within 43-128', async () => {
      const result = await oauth.pkceChallenge(64);
      expect(result.code_verifier.length).toBe(64);
    });

    it('returns verifier of max length 128', async () => {
      const result = await oauth.pkceChallenge(128);
      expect(result.code_verifier.length).toBe(128);
    });

    it('throws for length < 43', async () => {
      await expect(oauth.pkceChallenge(42)).rejects.toThrow(
        'Expected length 43~128. Got 42'
      );
    });

    it('throws for length > 128', async () => {
      await expect(oauth.pkceChallenge(129)).rejects.toThrow(
        'Expected length 43~128. Got 129'
      );
    });

    it('challenge is base64url-encoded (no +, /, =)', async () => {
      const result = await oauth.pkceChallenge();
      expect(result.code_challenge).not.toMatch(/\+/);
      expect(result.code_challenge).not.toMatch(/\//);
      expect(result.code_challenge).not.toMatch(/=/);
    });

    it('produces deterministic challenge for same verifier', async () => {
      const result1 = await oauth.pkceChallenge();
      // Generate challenge from same verifier
      const challenge2 = await oauth.generateChallenge(result1.code_verifier);
      expect(challenge2).toBe(result1.code_challenge);
    });
  });

  // -----------------------------------------------------------------------
  // generateVerifier / random
  // -----------------------------------------------------------------------
  describe('generateVerifier', () => {
    it('produces a string of the specified length', async () => {
      const v = await oauth.generateVerifier(50);
      expect(v.length).toBe(50);
    });

    it('only contains characters from the PKCE mask', async () => {
      const mask =
        'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';
      const v = await oauth.generateVerifier(100);
      for (const ch of v) {
        expect(mask).toContain(ch);
      }
    });
  });

  // -----------------------------------------------------------------------
  // mcpMap export
  // -----------------------------------------------------------------------
  describe('mcpMap', () => {
    it('contains Notion entry with correct structure', () => {
      expect(mcpMap).toHaveProperty('Notion');
      expect(mcpMap.Notion).toEqual(
        expect.objectContaining({
          url: expect.any(String),
          provider: expect.any(String),
        })
      );
    });

    it('Notion provider is "notion"', () => {
      expect(mcpMap.Notion.provider).toBe('notion');
    });
  });
});
