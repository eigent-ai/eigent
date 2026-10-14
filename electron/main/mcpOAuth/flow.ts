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

import http from 'node:http';
import { createPkcePair } from '../subscriptionAuth/pkce';
import { probeMcpOAuth } from './discovery';
import { registerClient } from './registration';
import { requestToken } from './tokens';
import { McpOAuthError, type McpOAuthCredential } from './types';

export async function signInFlow(
  url: string,
  openBrowser: (url: string) => Promise<void>,
  signal: AbortSignal,
  timeoutMs = 300_000
): Promise<McpOAuthCredential> {
  const externalSignal = signal;
  const timeoutController = new AbortController();
  signal = AbortSignal.any([externalSignal, timeoutController.signal]);
  const pkce = createPkcePair();
  let complete: (code: string) => void;
  let fail: (error: Error) => void;
  const codePromise = new Promise<string>((resolve, reject) => {
    complete = resolve;
    fail = reject;
  });
  // Callback may fail while discovery is still in flight.
  void codePromise.catch(() => undefined);
  let received = false;
  const server = http.createServer((request, response) => {
    response.setHeader('cache-control', 'no-store');
    response.setHeader('connection', 'close');
    let callback: URL;
    try {
      callback = new URL(request.url ?? '/', 'http://127.0.0.1');
    } catch {
      response.writeHead(400);
      response.end();
      return;
    }
    if (
      request.method !== 'GET' ||
      callback.pathname !== '/callback' ||
      received
    ) {
      response.writeHead(404);
      response.end();
      return;
    }
    if (callback.searchParams.get('state') !== pkce.state) {
      response.writeHead(400);
      response.end('Invalid sign-in state.');
      received = true;
      fail(new McpOAuthError('state_mismatch'));
      return;
    }
    received = true;
    const code = callback.searchParams.get('code');
    if (!code || callback.searchParams.has('error')) {
      response.writeHead(400);
      response.end('Sign-in was not completed.');
      fail(new McpOAuthError('signin_required'));
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('You can return to Eigent to finish signing in.');
    complete(code);
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  const abort = () => fail(new McpOAuthError('cancelled'));
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => {
    fail(new McpOAuthError('timeout'));
    timeoutController.abort();
  }, timeoutMs);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    if (signal.aborted) throw new McpOAuthError('cancelled');
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new McpOAuthError('network');
    const redirectUri = `http://127.0.0.1:${address.port}/callback`;
    const discovery = await probeMcpOAuth(url, signal);
    if (!discovery.requiresAuth || !discovery.authorizationServer)
      throw new McpOAuthError('unsupported_provider');
    const metadata = discovery.authorizationServer;
    const clientId = await registerClient(metadata, redirectUri, signal);
    const authorization = new URL(metadata.authorization_endpoint);
    const parameters = {
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: pkce.codeChallenge,
      code_challenge_method: 'S256',
      state: pkce.state,
      resource: discovery.resource,
      ...(discovery.scopes.length ? { scope: discovery.scopes.join(' ') } : {}),
    };
    for (const [key, value] of Object.entries(parameters))
      authorization.searchParams.set(key, value);
    if (signal.aborted) throw new McpOAuthError('cancelled');
    await openBrowser(authorization.href);
    const code = await codePromise;
    const result = await requestToken(
      metadata.token_endpoint,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        redirect_uri: redirectUri,
        code_verifier: pkce.codeVerifier,
        resource: discovery.resource,
      }),
      signal
    );
    return {
      ...result,
      client_id: clientId,
      resource: discovery.resource,
      server: metadata,
    };
  } catch (error) {
    if (timeoutController.signal.aborted) throw new McpOAuthError('timeout');
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
