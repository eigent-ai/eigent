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

import { registerModelConfigurationIpcHandlers } from '../../../../electron/main/modelConfigurations/ipc';
import {
  isSecretSettingName,
  splitEndpoint,
} from '../../../../electron/main/modelConfigurations/secretValues';
import {
  FIRST_DEVICE_CONFIGURATION_ID,
  ModelConfigurationStore,
} from '../../../../electron/main/modelConfigurations/store';
import { WorkspaceSecretBroker } from '../../../../electron/main/workspaceSecrets/broker';
import { WorkspaceSecretVault } from '../../../../electron/main/workspaceSecrets/vault';
import {
  SAVED_VALUE_MARKER,
  type ModelConfigurationSaveRequest,
} from '../../../../src/shared/modelConfiguration';

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

const account = 'a'.repeat(64);
const otherAccount = 'b'.repeat(64);
const KEY = 'unit-test-model-key-0001';

function request(
  overrides: Partial<ModelConfigurationSaveRequest> = {}
): ModelConfigurationSaveRequest {
  return {
    account_scope: account,
    provider_name: 'openai',
    model_type: 'gpt-test',
    endpoint_url: 'https://models.example.test/v1',
    api_key: KEY,
    config: {},
    is_valid: true,
    ...overrides,
  };
}

describe('ModelConfigurationStore', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-config-test-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  function store(
    options: Parameters<typeof fakeCrypto>[0] = {},
    platform: NodeJS.Platform = 'darwin'
  ) {
    return new ModelConfigurationStore({
      rootDir: path.join(rootDir, 'secure'),
      crypto: fakeCrypto(options),
      platform,
      now: () => new Date('2026-11-20T00:00:00.000Z'),
    });
  }

  it('encrypts the key and never returns it to the caller that saved it', () => {
    const configurations = store();
    const view = configurations.save(request());
    const disk = fs.readFileSync(configurations.filePath, 'utf8');

    expect(JSON.stringify(view)).not.toContain(KEY);
    expect(view).not.toHaveProperty('api_key');
    expect(view.has_api_key).toBe(true);
    expect(view.key_state).toBe('saved');
    expect(view.is_valid).toBe(2);
    expect(disk).not.toContain(KEY);
    expect(disk).not.toContain(Buffer.from(KEY).toString('base64'));
    expect(JSON.stringify(configurations.list(account))).not.toContain(KEY);
    expect(
      configurations.resolve({ account_scope: account, id: view.id }).api_key
    ).toBe(KEY);
    if (process.platform !== 'win32') {
      expect(fs.statSync(configurations.rootDir).mode & 0o777).toBe(0o700);
      expect(fs.statSync(configurations.filePath).mode & 0o777).toBe(0o600);
    }
    expect(fs.readdirSync(configurations.rootDir)).toEqual([
      'model-configurations.v1.json',
    ]);
  });

  it('issues identifiers that a server-issued 32-bit identifier cannot equal', () => {
    const configurations = store();
    const first = configurations.save(request());
    const second = configurations.save(request({ model_type: 'gpt-other' }));
    configurations.delete({ account_scope: account, id: second.id });
    const third = configurations.save(request({ model_type: 'gpt-third' }));

    expect(first.id).toBe(FIRST_DEVICE_CONFIGURATION_ID);
    expect(first.id).toBeGreaterThan(2_147_483_647);
    expect(second.id).toBe(first.id + 1);
    // A removed identifier is not handed out again.
    expect(third.id).toBe(first.id + 2);
    expect(() =>
      configurations.resolve({ account_scope: account, id: 42 })
    ).toThrow(/not found/);
  });

  it('keeps one account from seeing or resolving another account’s models', () => {
    const configurations = store();
    const view = configurations.save(request());

    expect(configurations.list(otherAccount).records).toEqual([]);
    expect(() =>
      configurations.resolve({ account_scope: otherAccount, id: view.id })
    ).toThrow(/not found/);
    expect(() =>
      configurations.save(request({ account_scope: otherAccount, id: view.id }))
    ).toThrow(/not found/);
    expect(() => configurations.list('not-a-scope')).toThrow(/scope/);
  });

  it('keeps the saved key when an edit does not send one', () => {
    const configurations = store();
    const view = configurations.save(request());
    const edited = configurations.save(
      request({ id: view.id, api_key: undefined, model_type: 'gpt-next' })
    );

    expect(edited.id).toBe(view.id);
    expect(edited.model_type).toBe('gpt-next');
    expect(edited.key_state).toBe('saved');
    expect(
      configurations.resolve({ account_scope: account, id: view.id }).api_key
    ).toBe(KEY);
  });

  it('hides secret provider settings and keeps them behind the marker', () => {
    const configurations = store();
    const view = configurations.save(
      request({
        provider_name: 'aws-bedrock-converse',
        api_key: '',
        config: {
          region_name: 'us-test-1',
          aws_access_key_id: 'unit-test-access-id',
          aws_secret_access_key: 'unit-test-secret-value',
          aws_session_token: '',
          model_config_dict: {
            max_tokens: 512,
            extra_headers: {
              'X-Api-Key': 'unit-test-header-value',
              'X-Title': 'Eigent',
            },
          },
        },
        secret_fields: ['aws_access_key_id', 'aws_secret_access_key'],
      })
    );
    const disk = fs.readFileSync(configurations.filePath, 'utf8');

    expect(view.encrypted_config).toEqual({
      region_name: 'us-test-1',
      aws_access_key_id: SAVED_VALUE_MARKER,
      aws_secret_access_key: SAVED_VALUE_MARKER,
      aws_session_token: '',
      model_config_dict: {
        max_tokens: 512,
        extra_headers: { 'X-Api-Key': SAVED_VALUE_MARKER, 'X-Title': 'Eigent' },
      },
    });
    expect(view.has_api_key).toBe(false);
    expect(view.key_state).toBe('saved');
    for (const value of [
      'unit-test-access-id',
      'unit-test-secret-value',
      'unit-test-header-value',
    ]) {
      expect(disk).not.toContain(value);
      expect(JSON.stringify(view)).not.toContain(value);
    }

    // Sending the markers back keeps the values; a new value replaces one.
    configurations.save(
      request({
        id: view.id,
        provider_name: 'aws-bedrock-converse',
        api_key: undefined,
        config: {
          ...view.encrypted_config,
          aws_secret_access_key: 'unit-test-secret-second',
        },
      })
    );
    expect(
      configurations.resolve({ account_scope: account, id: view.id }).config
    ).toEqual({
      region_name: 'us-test-1',
      aws_access_key_id: 'unit-test-access-id',
      aws_secret_access_key: 'unit-test-secret-second',
      aws_session_token: '',
      model_config_dict: {
        max_tokens: 512,
        extra_headers: {
          'X-Api-Key': 'unit-test-header-value',
          'X-Title': 'Eigent',
        },
      },
    });
  });

  it('drops a marker that has no saved value behind it', () => {
    const configurations = store();
    const view = configurations.save(
      request({ config: { aws_secret_access_key: SAVED_VALUE_MARKER } })
    );

    expect(view.encrypted_config).toEqual({});
  });

  it('keeps credentials inside an endpoint address out of the visible address', () => {
    const configurations = store();
    const full = 'https://user:unit-test-pass@models.example.test/v1?sig=abc';
    const view = configurations.save(request({ endpoint_url: full }));
    const disk = fs.readFileSync(configurations.filePath, 'utf8');

    expect(view.endpoint_url).toBe('https://models.example.test/v1');
    expect(view.endpoint_has_secret).toBe(true);
    expect(disk).not.toContain('unit-test-pass');
    expect(
      configurations.resolve({ account_scope: account, id: view.id }).api_url
    ).toBe(full);

    // Saving the visible address again keeps the full one.
    configurations.save(
      request({
        id: view.id,
        api_key: undefined,
        endpoint_url: view.endpoint_url,
      })
    );
    expect(
      configurations.resolve({ account_scope: account, id: view.id }).api_url
    ).toBe(full);

    // A different address replaces it.
    const moved = configurations.save(
      request({
        id: view.id,
        api_key: undefined,
        endpoint_url: 'https://other.example.test/v1',
      })
    );
    expect(moved.endpoint_has_secret).toBe(false);
    expect(
      configurations.resolve({ account_scope: account, id: view.id }).api_url
    ).toBe('https://other.example.test/v1');
  });

  it('keeps one default per account', () => {
    const configurations = store();
    const first = configurations.save(request({ prefer: true }));
    const second = configurations.save(
      request({ model_type: 'gpt-other', prefer: true })
    );
    const defaults = () =>
      configurations
        .list(account)
        .records.filter((record) => record.prefer)
        .map((record) => record.id);

    expect(defaults()).toEqual([second.id]);
    configurations.setDefault({ account_scope: account, id: first.id });
    expect(defaults()).toEqual([first.id]);
    configurations.setDefault({ account_scope: account, id: null });
    expect(defaults()).toEqual([]);
    expect(() =>
      configurations.setDefault({ account_scope: account, id: first.id + 99 })
    ).toThrow(/not found/);
  });

  it('removes a configuration and its key', () => {
    const configurations = store();
    const view = configurations.save(request());
    configurations.delete({ account_scope: account, id: view.id });

    expect(configurations.list(account).records).toEqual([]);
    expect(fs.readFileSync(configurations.filePath, 'utf8')).not.toContain(
      Buffer.from(JSON.stringify({ api_key: KEY }))
        .toString('base64')
        .slice(0, 16)
    );
    expect(() =>
      configurations.resolve({ account_scope: account, id: view.id })
    ).toThrow(/not found/);
  });

  it('asks for the key again when this device can no longer read it', () => {
    const view = store().save(request());
    const later = store({ failDecrypt: true });
    const listed = later.list(account).records[0];

    expect(listed.id).toBe(view.id);
    expect(listed.key_state).toBe('needed');
    expect(listed.is_valid).toBe(1);
    expect(() =>
      later.resolve({ account_scope: account, id: view.id })
    ).toThrow(/entered again/);
  });

  it('holds keys in memory only when the device has no usable key store', () => {
    const configurations = store({ backend: 'basic_text' }, 'linux');
    const view = configurations.save(request());
    const disk = fs.readFileSync(configurations.filePath, 'utf8');

    expect(configurations.storage()).toBe('session');
    expect(disk).not.toContain(KEY);
    expect(
      JSON.parse(disk).accounts[account].records[String(view.id)].secret
    ).toBe(null);
    expect(
      configurations.resolve({ account_scope: account, id: view.id }).api_key
    ).toBe(KEY);

    // After a restart the model is still listed and asks for its key.
    const restarted = store({ available: false });
    expect(restarted.list(account).records[0].key_state).toBe('needed');
  });

  it('keeps a model with no key usable without a key store', () => {
    const configurations = store({ available: false });
    const view = configurations.save(
      request({
        provider_name: 'ollama',
        api_key: 'not-required',
        endpoint_url: 'http://localhost:11434/v1',
      })
    );
    const restarted = store({ available: false });

    expect(view.key_state).toBe('not_required');
    expect(restarted.list(account).records[0].is_valid).toBe(2);
    expect(
      restarted.resolve({ account_scope: account, id: view.id }).api_key
    ).toBe('not-required');
  });

  it('takes over an earlier model list once, without keys, keeping its identifiers', () => {
    const configurations = store();
    const earlier = [
      {
        id: 57,
        provider_name: 'openai',
        model_type: 'gpt-test',
        endpoint_url: 'https://user:unit-test-pass@models.example.test/v1',
        config: { api_version: '2026-01-01', api_key: 'unit-test-stray-value' },
        prefer: true,
        needs_key: true,
      },
      {
        id: 58,
        provider_name: 'ollama',
        model_type: 'local-test',
        endpoint_url: 'http://localhost:11434/v1',
        config: { model_platform: 'ollama' },
        prefer: true,
        needs_key: false,
      },
      {
        id: FIRST_DEVICE_CONFIGURATION_ID,
        provider_name: 'openai',
        model_type: 'out-of-range',
        endpoint_url: '',
        config: {},
        prefer: false,
        needs_key: true,
      },
    ];

    expect(configurations.list(account).imported).toBe(false);
    configurations.importRecords({ account_scope: account, records: earlier });
    const listed = configurations.list(account);
    const disk = fs.readFileSync(configurations.filePath, 'utf8');

    expect(listed.imported).toBe(true);
    expect(listed.records.map((record) => record.id)).toEqual([57, 58]);
    expect(listed.records[0]).toMatchObject({
      id: 57,
      server_id: 57,
      endpoint_url: 'https://models.example.test/v1',
      encrypted_config: { api_version: '2026-01-01' },
      prefer: true,
      key_state: 'needed',
      is_valid: 1,
    });
    // A model that needs no key is usable right away.
    expect(listed.records[1]).toMatchObject({
      id: 58,
      prefer: false,
      key_state: 'not_required',
      is_valid: 2,
    });
    expect(disk).not.toContain('unit-test-pass');
    expect(disk).not.toContain('unit-test-stray-value');
    expect(() =>
      configurations.resolve({ account_scope: account, id: 57 })
    ).toThrow(/entered again/);

    // Entering the key completes the setup under the same identifier.
    const completed = configurations.save(request({ id: 57 }));
    expect(completed).toMatchObject({
      id: 57,
      server_id: 57,
      key_state: 'saved',
    });
    expect(configurations.resolveByServerId(account, 57).api_key).toBe(KEY);

    // A second take-over never overwrites what is on the device.
    configurations.importRecords({
      account_scope: account,
      records: [{ ...earlier[0], id: 99, model_type: 'late' }],
    });
    expect(configurations.list(account).records.map((item) => item.id)).toEqual(
      [57, 58]
    );
  });

  it('does not take over a list when models are already saved', () => {
    const configurations = store();
    const view = configurations.save(request());
    configurations.importRecords({
      account_scope: account,
      records: [
        {
          id: 5,
          provider_name: 'openai',
          model_type: 'gpt-old',
          endpoint_url: '',
          config: {},
          prefer: false,
          needs_key: true,
        },
      ],
    });

    expect(configurations.list(account).records.map((item) => item.id)).toEqual(
      [view.id]
    );
  });

  it('links a configuration to its server record and resolves it by that record', () => {
    const configurations = store();
    const view = configurations.save(request());

    expect(view.server_id).toBe(null);
    expect(() => configurations.resolveByServerId(account, 31)).toThrow(
      /not found/
    );
    configurations.setServerId({
      account_scope: account,
      id: view.id,
      server_id: 31,
    });
    expect(configurations.list(account).records[0].server_id).toBe(31);
    expect(configurations.resolveByServerId(account, 31).id).toBe(view.id);
    expect(() => configurations.resolveByServerId(otherAccount, 31)).toThrow(
      /not found/
    );
    // An edit keeps the link.
    expect(
      configurations.save(request({ id: view.id, api_key: undefined }))
        .server_id
    ).toBe(31);
    expect(() =>
      configurations.setServerId({
        account_scope: account,
        id: view.id,
        server_id: FIRST_DEVICE_CONFIGURATION_ID,
      })
    ).toThrow(/server link/);
  });

  it('starts empty and keeps an unreadable file aside instead of failing', () => {
    const configurations = store();
    fs.mkdirSync(configurations.rootDir, { recursive: true });
    fs.writeFileSync(configurations.filePath, '{ not json');

    expect(configurations.list(account).records).toEqual([]);
    const view = configurations.save(request());
    expect(configurations.list(account).records.map((item) => item.id)).toEqual(
      [view.id]
    );
    expect(fs.existsSync(`${configurations.filePath}.unreadable`)).toBe(true);
  });

  it('reports a file it cannot read instead of replacing it', () => {
    const configurations = store();
    fs.mkdirSync(configurations.rootDir, { recursive: true });
    // Something that is not a regular file sits where the store file belongs.
    fs.mkdirSync(configurations.filePath);
    fs.writeFileSync(path.join(configurations.filePath, 'kept'), 'kept');

    expect(() => configurations.list(account)).toThrow(/could not be read/);
    expect(() => configurations.save(request())).toThrow(/could not be read/);
    expect(
      fs.readFileSync(path.join(configurations.filePath, 'kept'), 'utf8')
    ).toBe('kept');
  });

  it('rejects malformed requests', () => {
    const configurations = store();

    expect(() => configurations.save(request({ provider_name: '' }))).toThrow(
      /provider/
    );
    expect(() => configurations.save(request({ model_type: '' }))).toThrow(
      /model/
    );
    expect(() =>
      configurations.save(request({ config: [] as unknown as object as never }))
    ).toThrow(/settings/);
    expect(() =>
      configurations.save(request({ api_key: 'k'.repeat(17 * 1024) }))
    ).toThrow(/key/);
  });
});

describe('secret setting names', () => {
  it('treats credential names as secret and counters as plain', () => {
    for (const name of [
      'api_key',
      'apiKey',
      'X-Api-Key',
      'Authorization',
      'aws_secret_access_key',
      'aws_session_token',
      'password',
      'Ocp-Apim-Subscription-Key',
    ]) {
      expect(isSecretSettingName(name)).toBe(true);
    }
    for (const name of [
      'max_tokens',
      'max_completion_tokens',
      'temperature',
      'region_name',
      'api_version',
      'azure_deployment_name',
      'tokenizer',
      'author',
    ]) {
      expect(isSecretSettingName(name)).toBe(false);
    }
  });

  it('leaves a plain endpoint address unchanged', () => {
    expect(splitEndpoint(' https://models.example.test/v1 ')).toEqual({
      visible: 'https://models.example.test/v1',
      hasSecret: false,
    });
    expect(splitEndpoint('not a url')).toEqual({
      visible: 'not a url',
      hasSecret: false,
    });
  });
});

describe('model configuration channels', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-config-ipc-'));
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  function parts() {
    const configurations = new ModelConfigurationStore({
      rootDir: path.join(rootDir, 'secure'),
      crypto: fakeCrypto(),
      platform: 'darwin',
    });
    const vault = new WorkspaceSecretVault({
      rootDir: path.join(rootDir, 'secure'),
      crypto: fakeCrypto(),
      platform: 'darwin',
    });
    return { configurations, vault };
  }

  it('gives the app window no channel that returns a key', () => {
    const { configurations } = parts();
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const guard = vi.fn();
    registerModelConfigurationIpcHandlers(
      {
        handle: (name: string, handler: any) => handlers.set(name, handler),
      } as any,
      configurations,
      guard
    );

    expect([...handlers.keys()].sort()).toEqual([
      'model-configuration:delete',
      'model-configuration:import',
      'model-configuration:list',
      'model-configuration:save',
      'model-configuration:set-default',
      'model-configuration:set-server-id',
    ]);
    const saved = handlers.get('model-configuration:save')!({}, request());
    const listed = handlers.get('model-configuration:list')!(
      {},
      { account_scope: account }
    );
    expect(JSON.stringify([saved, listed])).not.toContain(KEY);
    expect(guard).toHaveBeenCalledTimes(2);
  });

  it('refuses a caller the guard rejects before touching the store', () => {
    const { configurations } = parts();
    const handlers = new Map<string, (...args: any[]) => unknown>();
    registerModelConfigurationIpcHandlers(
      {
        handle: (name: string, handler: any) => handlers.set(name, handler),
      } as any,
      configurations,
      () => {
        throw new Error('restricted');
      }
    );

    for (const handler of handlers.values()) {
      expect(() => handler({}, request())).toThrow('restricted');
    }
    expect(fs.existsSync(configurations.filePath)).toBe(false);
  });

  it('resolves a configuration only for a caller that holds the capability', async () => {
    const { configurations, vault } = parts();
    const view = configurations.save(request());
    const broker = new WorkspaceSecretBroker(vault, undefined, configurations);
    const runtime = await broker.start();
    const call = (body: unknown, capability = runtime.capability) =>
      fetch(`${runtime.endpoint}/v1/model-configurations/resolve`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${capability}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });

    try {
      const denied = await call(
        { account_scope: account, credential_id: view.id },
        'x'.repeat(runtime.capability.length)
      );
      expect(denied.status).toBe(401);
      expect(await denied.text()).not.toContain(KEY);

      const resolved = await call({
        account_scope: account,
        credential_id: view.id,
      });
      expect(resolved.status).toBe(200);
      expect((await resolved.json()).configuration).toMatchObject({
        id: view.id,
        provider_name: 'openai',
        api_key: KEY,
        api_url: 'https://models.example.test/v1',
      });

      const missing = await call({
        account_scope: account,
        credential_id: view.id + 1,
      });
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ error_code: 'not_found' });

      const otherOwner = await call({
        account_scope: otherAccount,
        credential_id: view.id,
      });
      expect(otherOwner.status).toBe(404);

      const malformed = await call({ account_scope: account });
      expect(malformed.status).toBe(400);

      configurations.setServerId({
        account_scope: account,
        id: view.id,
        server_id: 31,
      });
      const byServerRecord = await call({
        account_scope: account,
        server_provider_id: 31,
      });
      expect(byServerRecord.status).toBe(200);
      expect((await byServerRecord.json()).configuration.id).toBe(view.id);
      const ambiguous = await call({
        account_scope: account,
        credential_id: view.id,
        server_provider_id: 31,
      });
      expect(ambiguous.status).toBe(400);
    } finally {
      await runtime.close();
    }
  });

  it('does not serve configurations when the broker was started without a store', async () => {
    const { vault } = parts();
    const broker = new WorkspaceSecretBroker(vault);
    const runtime = await broker.start();
    try {
      const response = await fetch(
        `${runtime.endpoint}/v1/model-configurations/resolve`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${runtime.capability}` },
          body: '{}',
        }
      );
      expect(response.status).toBe(404);
    } finally {
      await runtime.close();
    }
  });
});
