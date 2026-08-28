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

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'kwallet6',
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}));

import { WorkspaceSecretBroker } from '../../../../electron/main/workspaceSecrets/broker';
import { registerWorkspaceSecretIpcHandlers } from '../../../../electron/main/workspaceSecrets/ipc';
import type {
  WorkspaceSecretLookup,
  WorkspaceSecretPutRequest,
} from '../../../../electron/main/workspaceSecrets/types';
import {
  WorkspaceSecretBindingMismatchError,
  WorkspaceSecretVault,
} from '../../../../electron/main/workspaceSecrets/vault';

function fakeCrypto(
  options: {
    available?: boolean;
    backend?: string;
    failDecrypt?: boolean;
  } = {}
) {
  return {
    isEncryptionAvailable: () => options.available ?? true,
    getSelectedStorageBackend: () => options.backend ?? 'kwallet6',
    encryptString: (value: string) =>
      Buffer.from(`cipher:${Buffer.from(value).toString('base64')}`, 'utf8'),
    decryptString: (value: Buffer) => {
      if (options.failDecrypt) throw new Error('rotated keychain');
      const encoded = value.toString('utf8').replace(/^cipher:/u, '');
      return Buffer.from(encoded, 'base64').toString('utf8');
    },
  };
}

const scope = {
  account_scope_digest: 'a'.repeat(64),
  space_id: 'space-1',
  revision_id: 'bundle@1',
  slot_id: 'mcp.github.env.GITHUB_TOKEN',
};

describe('WorkspaceSecretVault', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-vault-test-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  function vault(
    options: Parameters<typeof fakeCrypto>[0] = {},
    platform: NodeJS.Platform = 'darwin'
  ) {
    return new WorkspaceSecretVault({
      rootDir: path.join(rootDir, 'secure'),
      crypto: fakeCrypto(options),
      platform,
      now: () => new Date('2026-08-11T00:00:00.000Z'),
    });
  }

  it('encrypts each value and writes only scoped metadata with secure permissions', () => {
    const store = vault();
    const fsync = vi.spyOn(fs, 'fsyncSync');
    const result = store.put({ ...scope, value: 'sentinel-super-secret' });
    const disk = fs.readFileSync(store.filePath, 'utf8');

    expect(result.state).toBe('available');
    expect(result.secret_ref).toMatch(/^wsvault_[A-Za-z0-9_-]{32}$/u);
    expect(result).not.toHaveProperty('value');
    expect(disk).not.toContain('sentinel-super-secret');
    expect(disk).not.toContain(
      Buffer.from('sentinel-super-secret').toString('base64')
    );
    expect(disk).toContain(scope.slot_id);
    expect(fs.statSync(store.rootDir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(store.filePath).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(store.rootDir)).toEqual([
      'workspace-secret-vault.v1.json',
    ]);
    expect(fsync).toHaveBeenCalledTimes(2);
    expect(store.resolve(result)).toBe('sentinel-super-secret');
  });

  it('creates an immutable candidate reference when the tuple is rebound', () => {
    const store = vault();
    const first = store.put({ ...scope, value: 'first-value' });
    const second = store.put({ ...scope, value: 'second-value' });

    expect(second.secret_ref).not.toBe(first.secret_ref);
    expect(store.resolve(first)).toBe('first-value');
    expect(store.resolve(second)).toBe('second-value');
  });

  it('rejects Linux basic_text rather than creating a plaintext fallback', () => {
    const store = vault({ backend: 'basic_text' }, 'linux');

    expect(() => store.put({ ...scope, value: 'must-not-be-written' })).toThrow(
      /basic_text/
    );
    expect(fs.existsSync(store.filePath)).toBe(false);
  });

  it('fails closed when OS encryption is unavailable', () => {
    const store = vault({ available: false });

    expect(() =>
      store.put({ ...scope, value: 'must-remain-memory-only' })
    ).toThrow(/encryption is unavailable/);
    expect(fs.existsSync(store.filePath)).toBe(false);
  });

  it('reports unreadable ciphertext as needs_rebind without returning a value', () => {
    const writer = vault();
    const created = writer.put({ ...scope, value: 'rotating-secret' });
    const reader = vault({ failDecrypt: true });

    const result = reader.status(created);
    expect(result.state).toBe('needs_rebind');
    expect(result).not.toHaveProperty('value');
    expect(() => reader.resolve(created)).toThrow(/rebound/);
  });

  it('rejects a secret_ref replayed under a different binding tuple', () => {
    const store = vault();
    const created = store.put({ ...scope, value: 'scoped-secret' });

    expect(() => store.status({ ...created, space_id: 'other-space' })).toThrow(
      WorkspaceSecretBindingMismatchError
    );
  });

  it('preserves the previous durable record if the atomic rename fails', () => {
    const store = vault();
    const created = store.put({ ...scope, value: 'durable-old-value' });
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('simulated crash before rename');
    });

    expect(() =>
      store.put({ ...scope, value: 'uncommitted-new-value' })
    ).toThrow(/simulated crash/);
    expect(store.resolve(created)).toBe('durable-old-value');
    expect(
      fs.readdirSync(store.rootDir).filter((name) => name.endsWith('.tmp'))
    ).toEqual([]);
  });

  it('turns a malformed vault into needs_rebind and refuses destructive overwrite', () => {
    const store = vault();
    fs.mkdirSync(store.rootDir, { recursive: true });
    fs.writeFileSync(store.filePath, '{truncated');
    const lookup: WorkspaceSecretLookup = {
      ...scope,
      secret_ref: `wsvault_${'A'.repeat(32)}`,
    };

    expect(store.status(lookup).state).toBe('needs_rebind');
    expect(() => store.put({ ...scope, value: 'new-value' })).toThrow(
      /corrupted/
    );
    expect(fs.readFileSync(store.filePath, 'utf8')).toBe('{truncated');
  });
});

describe('workspace secret IPC', () => {
  it('runs the main-renderer guard before every vault operation', () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (...args: any[]) => unknown) => {
        handlers.set(channel, handler);
      }),
    };
    const vault = {
      put: vi.fn(),
      status: vi.fn(),
      delete: vi.fn(),
    };
    const guard = vi.fn(() => {
      throw new Error('untrusted sender');
    });
    registerWorkspaceSecretIpcHandlers(ipcMain as any, vault as any, guard);

    expect([...handlers.keys()]).toEqual([
      'workspace-secret:put',
      'workspace-secret:status',
      'workspace-secret:delete',
    ]);
    for (const channel of [
      'workspace-secret:put',
      'workspace-secret:status',
      'workspace-secret:delete',
    ]) {
      expect(() => handlers.get(channel)!({ sender: { id: 99 } }, {})).toThrow(
        /untrusted sender/
      );
    }
    expect(guard).toHaveBeenCalledTimes(3);
    expect(vault.put).not.toHaveBeenCalled();
    expect(vault.status).not.toHaveBeenCalled();
    expect(vault.delete).not.toHaveBeenCalled();
  });
});

describe('WorkspaceSecretBroker', () => {
  let rootDir: string;
  let broker: WorkspaceSecretBroker | null = null;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-broker-test-'));
  });

  afterEach(async () => {
    await broker?.close();
    broker = null;
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('requires its random capability and keeps single-item resolution closed', async () => {
    const store = new WorkspaceSecretVault({
      rootDir: path.join(rootDir, 'secure'),
      crypto: fakeCrypto(),
    });
    const request: WorkspaceSecretPutRequest = {
      ...scope,
      value: 'broker-must-not-return-this',
    };
    const created = store.put(request);
    broker = new WorkspaceSecretBroker(store, () => Buffer.alloc(32, 7));
    const runtime = await broker.start();
    expect(runtime.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);

    const unauthorized = await fetch(
      `${runtime.endpoint}/v1/workspace-secrets/verify`,
      {
        method: 'POST',
        body: JSON.stringify(created),
      }
    );
    expect(unauthorized.status).toBe(401);

    const authorized = await fetch(
      `${runtime.endpoint}/v1/workspace-secrets/verify`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${runtime.capability}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(created),
      }
    );
    expect(authorized.status).toBe(200);
    const body = await authorized.text();
    expect(body).toContain('available');
    expect(body).not.toContain('broker-must-not-return-this');

    const resolveAttempt = await fetch(
      `${runtime.endpoint}/v1/workspace-secrets/resolve`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${runtime.capability}` },
        body: JSON.stringify(created),
      }
    );
    expect(resolveAttempt.status).toBe(404);
  });

  it('resolves a batch only with the process capability and exact identity', async () => {
    const sentinel = 'resolved-only-inside-brain';
    const store = new WorkspaceSecretVault({
      rootDir: path.join(rootDir, 'secure'),
      crypto: fakeCrypto(),
    });
    const created = store.put({ ...scope, value: sentinel });
    broker = new WorkspaceSecretBroker(store, () => Buffer.alloc(32, 9));
    const runtime = await broker.start();
    const endpoint = `${runtime.endpoint}/v1/workspace-secrets/resolve-batch`;
    const body = JSON.stringify({ bindings: [created] });

    const unauthorized = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: 'Bearer wrong-process-capability',
        'content-type': 'application/json',
      },
      body,
    });
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.text()).not.toContain(sentinel);

    const authorized = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${runtime.capability}`,
        'content-type': 'application/json',
      },
      body,
    });
    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toEqual({
      resolutions: [
        { ...scope, secret_ref: created.secret_ref, value: sentinel },
      ],
    });

    const mismatched = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${runtime.capability}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        bindings: [{ ...created, revision_id: 'bundle@2' }],
      }),
    });
    expect(mismatched.status).toBe(403);
    const mismatchBody = await mismatched.text();
    expect(mismatchBody).toContain('binding_scope_mismatch');
    expect(mismatchBody).not.toContain(sentinel);
  });

  it('verifies up to 100 bindings in one ordered response without values', async () => {
    const lookups: WorkspaceSecretLookup[] = [
      {
        ...scope,
        secret_ref: `wsvault_${'A'.repeat(32)}`,
        slot_id: 'available-slot',
      },
      {
        ...scope,
        secret_ref: `wsvault_${'B'.repeat(32)}`,
        slot_id: 'missing-slot',
      },
      {
        ...scope,
        secret_ref: `wsvault_${'C'.repeat(32)}`,
        slot_id: 'rebind-slot',
      },
    ];
    const store = {
      status: vi.fn((lookup: WorkspaceSecretLookup) => ({
        ...lookup,
        state:
          lookup.slot_id === 'available-slot'
            ? 'available'
            : lookup.slot_id === 'missing-slot'
              ? 'missing'
              : 'needs_rebind',
      })),
    };
    broker = new WorkspaceSecretBroker(
      store as unknown as WorkspaceSecretVault
    );
    const runtime = await broker.start();

    const response = await fetch(
      `${runtime.endpoint}/v1/workspace-secrets/verify-batch`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${runtime.capability}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ bindings: lookups }),
      }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.statuses.map((item: { state: string }) => item.state)).toEqual([
      'available',
      'missing',
      'needs_rebind',
    ]);
    expect(JSON.stringify(body)).not.toContain('value');
    expect(store.status).toHaveBeenCalledTimes(3);
  });

  it('rejects batches larger than 100 before consulting the vault', async () => {
    const store = { status: vi.fn() };
    broker = new WorkspaceSecretBroker(
      store as unknown as WorkspaceSecretVault
    );
    const runtime = await broker.start();
    const response = await fetch(
      `${runtime.endpoint}/v1/workspace-secrets/verify-batch`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${runtime.capability}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          bindings: Array.from({ length: 101 }, () => ({
            secret_ref: 'x',
            account_scope_digest: 'x',
            space_id: 'x',
            revision_id: 'x',
            slot_id: 'x',
          })),
        }),
      }
    );

    expect(response.status).toBe(400);
    expect(store.status).not.toHaveBeenCalled();
  });

  it('rejects a valid reference presented with different metadata', async () => {
    const store = new WorkspaceSecretVault({
      rootDir: path.join(rootDir, 'secure'),
      crypto: fakeCrypto(),
    });
    const created = store.put({ ...scope, value: 'tuple-bound' });
    broker = new WorkspaceSecretBroker(store);
    const runtime = await broker.start();

    const response = await fetch(
      `${runtime.endpoint}/v1/workspace-secrets/verify`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${runtime.capability}` },
        body: JSON.stringify({ ...created, revision_id: 'bundle@2' }),
      }
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error_code: 'binding_scope_mismatch',
    });
  });

  it('fails the whole batch when any binding tuple is mismatched', async () => {
    const store = new WorkspaceSecretVault({
      rootDir: path.join(rootDir, 'secure'),
      crypto: fakeCrypto(),
    });
    const created = store.put({ ...scope, value: 'tuple-bound-batch' });
    broker = new WorkspaceSecretBroker(store);
    const runtime = await broker.start();

    const response = await fetch(
      `${runtime.endpoint}/v1/workspace-secrets/verify-batch`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${runtime.capability}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          bindings: [created, { ...created, slot_id: 'different-slot' }],
        }),
      }
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error_code: 'binding_scope_mismatch',
    });
  });

  it('rejects oversized request bodies before parsing them', async () => {
    const store = new WorkspaceSecretVault({
      rootDir: path.join(rootDir, 'secure'),
      crypto: fakeCrypto(),
    });
    broker = new WorkspaceSecretBroker(store);
    const runtime = await broker.start();

    const response = await fetch(
      `${runtime.endpoint}/v1/workspace-secrets/verify`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${runtime.capability}` },
        body: JSON.stringify({ padding: 'x'.repeat(17 * 1024) }),
      }
    );
    expect(response.status).toBe(413);
  });
});
