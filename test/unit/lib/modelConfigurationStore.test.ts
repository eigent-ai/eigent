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
  deleteLocalModelConfiguration,
  importLocalModelConfigurations,
  linkLocalModelConfiguration,
  listLocalModelConfigurations,
  modelAccountScope,
  resetLocalModelConfigurationMemory,
  saveLocalModelConfiguration,
  setLocalModelConfigurationDefault,
} from '@/lib/modelConfigurationStore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({ electronAPI: null as any }));
vi.mock('@/host/createHost', () => ({
  createHost: () => ({ electronAPI: host.electronAPI, ipcRenderer: null }),
}));

const account = { user_id: 7, email: 'person@example.test' };
const KEY = 'unit-test-model-key-0001';
const input = {
  provider_name: 'openai',
  model_type: 'gpt-test',
  endpoint_url: 'https://models.example.test/v1',
  api_key: KEY,
  config: { api_version: '2026-01-01' },
  is_valid: true,
};

beforeEach(() => {
  host.electronAPI = null;
  resetLocalModelConfigurationMemory();
});
afterEach(() => vi.unstubAllEnvs());

describe('account scope', () => {
  it('names the account and server by a digest that holds no identity', async () => {
    const scope = await modelAccountScope(account);

    expect(scope).toMatch(/^[a-f0-9]{64}$/);
    expect(scope).not.toContain('person');
    expect(await modelAccountScope(account)).toBe(scope);
    expect(await modelAccountScope({ ...account, user_id: 8 })).not.toBe(scope);
  });

  it('keeps a cloud account with its models when the service address changes', async () => {
    vi.stubEnv('VITE_USE_LOCAL_PROXY', 'false');
    vi.stubEnv('VITE_STACK_PROJECT_ID', 'project-one');
    vi.stubEnv('VITE_BASE_URL', 'https://service.example.test');
    const scope = await modelAccountScope(account);

    vi.stubEnv('VITE_BASE_URL', 'https://moved.example.test');
    vi.stubEnv('VITE_PROXY_URL', 'https://moved.example.test');
    expect(await modelAccountScope(account)).toBe(scope);
    // Another sign-in project holds other accounts.
    vi.stubEnv('VITE_STACK_PROJECT_ID', 'project-two');
    expect(await modelAccountScope(account)).not.toBe(scope);
  });

  it('names a self-hosted account by the address of its server', async () => {
    vi.stubEnv('VITE_USE_LOCAL_PROXY', 'true');
    vi.stubEnv('VITE_STACK_PROJECT_ID', 'project-one');
    vi.stubEnv('VITE_BASE_URL', 'http://localhost:3001');
    const scope = await modelAccountScope(account);

    vi.stubEnv('VITE_BASE_URL', 'http://other-host.example.test:3001');
    expect(await modelAccountScope(account)).not.toBe(scope);
    vi.stubEnv('VITE_BASE_URL', 'http://localhost:3001/');
    expect(await modelAccountScope(account)).toBe(scope);
  });
});

describe('desktop store', () => {
  const view = {
    id: 2147483648,
    server_id: null,
    provider_name: 'openai',
    model_type: 'gpt-test',
    endpoint_url: 'https://models.example.test/v1',
    encrypted_config: { api_version: '2026-01-01' },
    prefer: false,
    is_valid: 2,
    has_api_key: true,
    endpoint_has_secret: false,
    key_state: 'saved',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
  beforeEach(() => {
    host.electronAPI = {
      modelConfigurationList: vi.fn(async () => ({
        storage: 'secure',
        imported: true,
        records: [view],
      })),
      modelConfigurationSave: vi.fn(async () => view),
      modelConfigurationSetDefault: vi.fn(async () => undefined),
      modelConfigurationDelete: vi.fn(async () => undefined),
      modelConfigurationImport: vi.fn(async () => undefined),
      modelConfigurationSetServerId: vi.fn(async () => undefined),
    };
  });

  it('lists what the host returns and names each model by reference', async () => {
    const scope = await modelAccountScope(account);
    const list = await listLocalModelConfigurations(account);

    expect(host.electronAPI.modelConfigurationList).toHaveBeenCalledWith({
      account_scope: scope,
    });
    expect(list.storage).toBe('secure');
    expect(list.records).toEqual([
      {
        ...view,
        model_credential: { account_scope: scope, credential_id: view.id },
      },
    ]);
    expect(list.records[0]).not.toHaveProperty('api_key');
  });

  it('hands the key to the host once and gets no key back', async () => {
    const scope = await modelAccountScope(account);
    const saved = await saveLocalModelConfiguration(account, input);

    expect(host.electronAPI.modelConfigurationSave).toHaveBeenCalledWith({
      ...input,
      account_scope: scope,
    });
    expect(JSON.stringify(saved)).not.toContain(KEY);
    expect(saved.model_credential).toEqual({
      account_scope: scope,
      credential_id: view.id,
    });
  });

  it('scopes every other operation to the same account', async () => {
    const scope = await modelAccountScope(account);
    await setLocalModelConfigurationDefault(account, view.id);
    await deleteLocalModelConfiguration(account, view.id);
    await linkLocalModelConfiguration(account, view.id, 31);
    await importLocalModelConfigurations(account, []);

    expect(host.electronAPI.modelConfigurationSetDefault).toHaveBeenCalledWith({
      account_scope: scope,
      id: view.id,
    });
    expect(host.electronAPI.modelConfigurationDelete).toHaveBeenCalledWith({
      account_scope: scope,
      id: view.id,
    });
    expect(host.electronAPI.modelConfigurationSetServerId).toHaveBeenCalledWith(
      { account_scope: scope, id: view.id, server_id: 31 }
    );
    expect(host.electronAPI.modelConfigurationImport).toHaveBeenCalledWith({
      account_scope: scope,
      records: [],
    });
  });

  it('saves nothing and lists nothing while signed out', async () => {
    const signedOut = { user_id: null, email: '' };

    expect((await listLocalModelConfigurations(signedOut)).records).toEqual([]);
    await expect(saveLocalModelConfiguration(signedOut, input)).rejects.toThrow(
      'Sign in'
    );
    expect(host.electronAPI.modelConfigurationList).not.toHaveBeenCalled();
    expect(host.electronAPI.modelConfigurationSave).not.toHaveBeenCalled();
  });
});

describe('browser, without a desktop store', () => {
  it('keeps models in this page only, apart per account', async () => {
    const saved = await saveLocalModelConfiguration(account, input);
    const list = await listLocalModelConfigurations(account);

    expect(list.storage).toBe('memory');
    expect(list.records.map((record) => record.id)).toEqual([saved.id]);
    // No local backend channel exists here: the page holds the key itself.
    expect(list.records[0].api_key).toBe(KEY);
    expect(list.records[0].model_credential).toBeUndefined();
    expect(
      (await listLocalModelConfigurations({ ...account, user_id: 8 })).records
    ).toEqual([]);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('keeps the key on an edit that sends none, and one default per account', async () => {
    const first = await saveLocalModelConfiguration(account, {
      ...input,
      prefer: true,
    });
    const second = await saveLocalModelConfiguration(account, {
      ...input,
      model_type: 'gpt-other',
      prefer: true,
    });
    const { api_key: _key, ...withoutKey } = input;
    const edited = await saveLocalModelConfiguration(account, {
      ...withoutKey,
      id: first.id,
      model_type: 'gpt-next',
    });

    expect(edited.api_key).toBe(KEY);
    expect(edited.key_state).toBe('saved');
    const defaults = async () =>
      (await listLocalModelConfigurations(account)).records
        .filter((record) => record.prefer)
        .map((record) => record.id);
    expect(await defaults()).toEqual([second.id]);
    await setLocalModelConfigurationDefault(account, first.id);
    expect(await defaults()).toEqual([first.id]);
    await deleteLocalModelConfiguration(account, second.id);
    expect(
      (await listLocalModelConfigurations(account)).records.map(
        (record) => record.id
      )
    ).toEqual([first.id]);
  });

  it('takes over an earlier list once, without keys', async () => {
    const earlier = [
      {
        id: 57,
        provider_name: 'openai',
        model_type: 'gpt-test',
        endpoint_url: 'https://models.example.test/v1',
        config: {},
        prefer: true,
        needs_key: true,
      },
      {
        id: 58,
        provider_name: 'ollama',
        model_type: 'local-test',
        endpoint_url: 'http://localhost:11434/v1',
        config: {},
        prefer: true,
        needs_key: false,
      },
    ];
    expect((await listLocalModelConfigurations(account)).imported).toBe(false);
    await importLocalModelConfigurations(account, earlier);
    await importLocalModelConfigurations(account, [{ ...earlier[0], id: 99 }]);
    const list = await listLocalModelConfigurations(account);

    expect(list.imported).toBe(true);
    expect(list.records).toMatchObject([
      { id: 57, server_id: 57, prefer: true, key_state: 'needed', is_valid: 1 },
      {
        id: 58,
        server_id: 58,
        prefer: false,
        key_state: 'not_required',
        is_valid: 2,
      },
    ]);
    // Entering the key completes the model under the same identifier.
    const completed = await saveLocalModelConfiguration(account, {
      ...input,
      id: 57,
    });
    expect(completed).toMatchObject({
      id: 57,
      key_state: 'saved',
      is_valid: 2,
    });
  });
});
