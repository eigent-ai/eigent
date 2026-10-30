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

import crypto from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type {
  WorkspaceSecretBrokerRuntime,
  WorkspaceSecretLookup,
} from './types';
import {
  WorkspaceSecretBindingMismatchError,
  WorkspaceSecretVault,
  WorkspaceSecretVaultError,
} from './vault';

const LOOPBACK_HOST = '127.0.0.1';
const MAX_REQUEST_BODY_BYTES = 16 * 1024;
const MAX_BATCH_BINDINGS = 100;
const REQUEST_TIMEOUT_MS = 5_000;

function sendJson(
  response: ServerResponse,
  status: number,
  body: Record<string, unknown>
): void {
  const value = JSON.stringify(body);
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(value),
    pragma: 'no-cache',
  });
  response.end(value);
}

function isAuthorized(request: IncomingMessage, capability: string): boolean {
  const value = request.headers.authorization;
  if (typeof value !== 'string') return false;
  const actual = Buffer.from(value, 'utf8');
  const expected = Buffer.from(`Bearer ${capability}`, 'utf8');
  return (
    actual.length === expected.length &&
    crypto.timingSafeEqual(actual, expected)
  );
}

function parseLookup(value: unknown): WorkspaceSecretLookup {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WorkspaceSecretVaultError('Invalid workspace secret request');
  }
  const body = value as Record<string, unknown>;
  const values = [
    body.secret_ref,
    body.account_scope_digest,
    body.space_id,
    body.revision_id,
    body.slot_id,
  ];
  if (values.some((item) => typeof item !== 'string')) {
    throw new WorkspaceSecretVaultError('Invalid workspace secret request');
  }
  return {
    secret_ref: body.secret_ref as string,
    account_scope_digest: body.account_scope_digest as string,
    space_id: body.space_id as string,
    revision_id: body.revision_id as string,
    slot_id: body.slot_id as string,
  };
}

function parseLookupBatch(value: unknown): WorkspaceSecretLookup[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WorkspaceSecretVaultError('Invalid workspace secret request');
  }
  const bindings = (value as Record<string, unknown>).bindings;
  if (
    !Array.isArray(bindings) ||
    bindings.length === 0 ||
    bindings.length > MAX_BATCH_BINDINGS
  ) {
    throw new WorkspaceSecretVaultError('Invalid workspace secret batch');
  }
  return bindings.map(parseLookup);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      fail(new WorkspaceSecretVaultError('Workspace secret request timed out'));
      request.destroy();
    });
    request.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_REQUEST_BODY_BYTES) {
        fail(
          new WorkspaceSecretVaultError('Workspace secret request too large')
        );
        chunks.length = 0;
        request.removeAllListeners('data');
        request.resume();
        return;
      }
      chunks.push(buffer);
    });
    request.on('error', fail);
    request.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new WorkspaceSecretVaultError('Invalid JSON request'));
      }
    });
  });
}

/**
 * A process-capability-authenticated channel for the Brain.
 *
 * The random capability is created in Electron main and passed only to the
 * Brain process at spawn. Python removes it from ``os.environ`` immediately so
 * agent subprocesses cannot inherit broker authority. Renderer IPC deliberately
 * exposes put/status/delete only; resolving a value is available solely through
 * this private loopback channel and always requires the complete binding tuple.
 */
export class WorkspaceSecretBroker {
  private server: http.Server | null = null;
  private runtime: WorkspaceSecretBrokerRuntime | null = null;

  constructor(
    private readonly vault: WorkspaceSecretVault,
    private readonly randomBytes: (size: number) => Buffer = crypto.randomBytes
  ) {}

  async start(): Promise<WorkspaceSecretBrokerRuntime> {
    if (this.runtime) return this.runtime;
    const capability = this.randomBytes(32).toString('base64url');
    const server = http.createServer((request, response) => {
      void this.handle(request, response, capability);
    });
    server.requestTimeout = REQUEST_TIMEOUT_MS;
    server.headersTimeout = REQUEST_TIMEOUT_MS;
    server.keepAliveTimeout = 1_000;
    server.maxRequestsPerSocket = 100;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, LOOPBACK_HOST, () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('Workspace secret broker did not bind a TCP port');
    }
    this.server = server;
    this.runtime = {
      endpoint: `http://${LOOPBACK_HOST}:${address.port}`,
      capability,
      close: async () => this.close(),
    };
    return this.runtime;
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.runtime = null;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
    capability: string
  ): Promise<void> {
    response.setHeader('connection', 'close');
    if (!isAuthorized(request, capability)) {
      sendJson(response, 401, { error_code: 'unauthorized' });
      return;
    }
    if (request.method !== 'POST') {
      sendJson(response, 405, { error_code: 'method_not_allowed' });
      return;
    }
    const isSingleVerify = request.url === '/v1/workspace-secrets/verify';
    const isBatchVerify = request.url === '/v1/workspace-secrets/verify-batch';
    const isBatchResolve =
      request.url === '/v1/workspace-secrets/resolve-batch';
    if (!isSingleVerify && !isBatchVerify && !isBatchResolve) {
      sendJson(response, 404, { error_code: 'not_found' });
      return;
    }
    try {
      const body = await readJsonBody(request);
      if (isBatchResolve) {
        const resolutions = parseLookupBatch(body).map((lookup) => ({
          ...lookup,
          value: this.vault.resolve(lookup),
        }));
        sendJson(response, 200, { resolutions });
      } else if (isBatchVerify) {
        const statuses = parseLookupBatch(body).map((lookup) =>
          this.vault.status(lookup)
        );
        sendJson(response, 200, { statuses });
      } else {
        const status = this.vault.status(parseLookup(body));
        const code =
          status.state === 'available'
            ? 200
            : status.state === 'needs_rebind'
              ? 409
              : 404;
        sendJson(response, code, { status });
      }
    } catch (error) {
      if (error instanceof WorkspaceSecretBindingMismatchError) {
        sendJson(response, 403, {
          error_code: 'binding_scope_mismatch',
        });
      } else if (error instanceof WorkspaceSecretVaultError) {
        const status = error.message.includes('too large') ? 413 : 400;
        sendJson(response, status, { error_code: 'invalid_request' });
      } else {
        sendJson(response, 500, { error_code: 'secret_broker_failed' });
      }
    }
  }
}
