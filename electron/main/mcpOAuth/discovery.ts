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

import {
  McpOAuthError,
  type AuthorizationServer,
  type McpOAuthDiscovery,
} from './types';

export function safeOAuthUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new McpOAuthError('invalid_metadata');
  }
  if (
    (url.protocol !== 'https:' &&
      !(
        url.protocol === 'http:' &&
        ['127.0.0.1', 'localhost'].includes(url.hostname)
      )) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new McpOAuthError('invalid_metadata');
  }
  return url.href;
}

export function normalizeServerUrl(value: string): string {
  const url = new URL(safeOAuthUrl(value));
  return url.pathname === '/' && !url.search ? url.origin : url.href;
}

// Disallow redirects: in particular a token POST must never be forwarded to a
// different origin or an insecure endpoint supplied by remote metadata.
export async function oauthFetch(
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  try {
    return await fetch(safeOAuthUrl(url), {
      ...init,
      redirect: 'error',
      signal: init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(10_000)])
        : AbortSignal.timeout(10_000),
    });
  } catch {
    if (init.signal?.aborted) throw new McpOAuthError('cancelled');
    throw new McpOAuthError('network');
  }
}

export async function jsonBody(
  response: Response
): Promise<Record<string, unknown>> {
  const limit = 64 * 1024;
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new McpOAuthError('invalid_metadata');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new McpOAuthError('invalid_metadata');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new McpOAuthError('invalid_metadata');
      chunks.push(value);
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new McpOAuthError('invalid_metadata');
    }
    return body as Record<string, unknown>;
  } catch {
    throw new McpOAuthError('invalid_metadata');
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export function parseChallenge(header: string): {
  metadata?: string;
  scopes: string[];
} {
  const parameter = (name: string) => {
    const match = header.match(
      new RegExp(
        `(?:^|[\\s,])${name}\\s*=\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|([^\\s,]+))`,
        'i'
      )
    );
    return (match?.[1] ?? match?.[2])?.replace(/\\(.)/g, '$1');
  };
  return {
    metadata: parameter('resource_metadata'),
    scopes: (parameter('scope') ?? '').split(/\s+/).filter(Boolean),
  };
}

async function discoverAuthorizationServer(
  issuerValue: string,
  signal?: AbortSignal
): Promise<AuthorizationServer> {
  const issuer = normalizeServerUrl(issuerValue);
  const url = new URL(issuer);
  const suffix = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
  const candidates = [
    ...new Set([
      `${url.origin}/.well-known/oauth-authorization-server${suffix}`,
      `${url.origin}/.well-known/openid-configuration${suffix}`,
      `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`,
    ]),
  ];
  for (const candidate of candidates) {
    const response = await oauthFetch(candidate, { signal });
    if (response.status === 404 || response.status === 405) continue;
    if (!response.ok) throw new McpOAuthError('invalid_metadata');
    const metadata = await jsonBody(response);
    if (
      typeof metadata.issuer !== 'string' ||
      normalizeServerUrl(metadata.issuer) !== issuer ||
      typeof metadata.authorization_endpoint !== 'string' ||
      typeof metadata.token_endpoint !== 'string'
    ) {
      throw new McpOAuthError('invalid_metadata');
    }
    if (
      !Array.isArray(metadata.code_challenge_methods_supported) ||
      !metadata.code_challenge_methods_supported.includes('S256')
    ) {
      throw new McpOAuthError('unsupported_provider');
    }
    return {
      issuer,
      authorization_endpoint: safeOAuthUrl(metadata.authorization_endpoint),
      token_endpoint: safeOAuthUrl(metadata.token_endpoint),
      ...(typeof metadata.registration_endpoint === 'string'
        ? {
            registration_endpoint: safeOAuthUrl(metadata.registration_endpoint),
          }
        : {}),
      ...(typeof metadata.revocation_endpoint === 'string'
        ? { revocation_endpoint: safeOAuthUrl(metadata.revocation_endpoint) }
        : {}),
    };
  }
  throw new McpOAuthError('invalid_metadata');
}

export async function probeMcpOAuth(
  serverUrl: string,
  signal?: AbortSignal
): Promise<McpOAuthDiscovery> {
  const resource = normalizeServerUrl(serverUrl);
  const response = await oauthFetch(resource, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'Eigent', version: '1.0' },
      },
    }),
  });
  const challenge = parseChallenge(
    response.headers.get('www-authenticate') ?? ''
  );
  await response.body?.cancel();
  // Only a 401 identifies an OAuth-protected resource. Other statuses, such
  // as 405 from a legacy SSE endpoint, are left to the MCP transport itself.
  if (response.status !== 401)
    return { requiresAuth: false, resource, scopes: [] };
  try {
    return await discoverProtectedResource(resource, challenge, signal);
  } catch (error) {
    throw new McpOAuthError(
      error instanceof McpOAuthError ? error.code : 'invalid_metadata',
      true
    );
  }
}

async function discoverProtectedResource(
  resource: string,
  challenge: ReturnType<typeof parseChallenge>,
  signal?: AbortSignal
): Promise<McpOAuthDiscovery> {
  const url = new URL(resource);
  const candidates = challenge.metadata
    ? [challenge.metadata]
    : [
        ...new Set([
          `${url.origin}/.well-known/oauth-protected-resource${url.pathname === '/' ? '' : url.pathname}`,
          `${url.origin}/.well-known/oauth-protected-resource`,
        ]),
      ];
  for (const candidate of candidates) {
    const result = await oauthFetch(candidate, { signal });
    if (result.status === 404) continue;
    if (!result.ok) throw new McpOAuthError('invalid_metadata');
    const metadata = await jsonBody(result);
    if (
      typeof metadata.resource !== 'string' ||
      normalizeServerUrl(metadata.resource) !== resource ||
      !Array.isArray(metadata.authorization_servers) ||
      typeof metadata.authorization_servers[0] !== 'string'
    ) {
      throw new McpOAuthError('invalid_metadata');
    }
    const scopes = challenge.scopes.length
      ? challenge.scopes
      : Array.isArray(metadata.scopes_supported)
        ? metadata.scopes_supported.filter(
            (item): item is string => typeof item === 'string'
          )
        : [];
    return {
      requiresAuth: true,
      resource,
      scopes,
      authorizationServer: await discoverAuthorizationServer(
        metadata.authorization_servers[0],
        signal
      ),
    };
  }
  throw new McpOAuthError('invalid_metadata');
}
