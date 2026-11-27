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
  configurationHint,
  deleteConfiguredProvider,
  fetchConfiguredModelInventory,
  fetchConfiguredProviders,
  saveConfiguredProvider,
  selectableConfiguredModels,
  setConfiguredProviderDefault,
} from '@/lib/configuredModels';
import { useModelVisibilityStore } from '@/store/modelVisibilityStore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localModelList, localModelRecord } from '../helpers/localModels';
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  setDefault: vi.fn(),
  importEarlier: vi.fn(),
  register: vi.fn(),
  registerDefault: vi.fn(),
  unregister: vi.fn(),
  setModelType: vi.fn(),
  http: vi.fn(),
}));
// Any call to the server from this module would go through here.
vi.mock('@/api/http', () => ({
  proxyFetchGet: mocks.http,
  proxyFetchPost: mocks.http,
  proxyFetchPut: mocks.http,
  proxyFetchDelete: mocks.http,
}));
vi.mock('@/lib/modelConfigurationStore', () => ({
  SAVED_VALUE_MARKER: '[saved on this device]',
  listLocalModelConfigurations: mocks.list,
  saveLocalModelConfiguration: mocks.save,
  deleteLocalModelConfiguration: mocks.remove,
  setLocalModelConfigurationDefault: mocks.setDefault,
}));
vi.mock('@/lib/modelProviderRegistration', () => ({
  importEarlierModelConfigurations: mocks.importEarlier,
  registerModelConfiguration: mocks.register,
  registerDefaultModelConfiguration: mocks.registerDefault,
  unregisterModelConfiguration: mocks.unregister,
}));
const account = { user_id: 7, email: 'person@example.test' };
vi.mock('@/store/authStore', () => ({
  getAuthStore: () => ({ ...account, setModelType: mocks.setModelType }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.importEarlier.mockResolvedValue(false);
  mocks.register.mockResolvedValue(null);
  useModelVisibilityStore.setState({ hiddenByAccount: {} });
});
describe('Configured model identity', () => {
  it('reads the models from this device without collapsing repeated providers', async () => {
    mocks.list.mockResolvedValue(
      localModelList([
        { id: 1, provider_name: 'openai' },
        { id: 2, provider_name: 'openai' },
      ])
    );
    expect(
      (await fetchConfiguredProviders()).map((record) => record.id)
    ).toEqual([1, 2]);
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 7 })
    );
    // The list is local: no model provider route of the server is called.
    expect(mocks.http).not.toHaveBeenCalled();
    expect(mocks.importEarlier).not.toHaveBeenCalled();
  });
  it('takes over the earlier model list once when nothing is saved here', async () => {
    mocks.list
      .mockResolvedValueOnce({
        storage: 'secure',
        imported: false,
        records: [],
      })
      .mockResolvedValueOnce(
        localModelList([
          { id: 57, provider_name: 'openai', key_state: 'needed' },
        ])
      );
    mocks.importEarlier.mockResolvedValue(true);

    const inventory = await fetchConfiguredModelInventory();
    expect(inventory.records.map((record) => record.id)).toEqual([57]);
    expect(inventory.records[0].key_state).toBe('needed');
    expect(inventory.keyStorage).toBe('secure');
    expect(mocks.importEarlier).toHaveBeenCalledTimes(1);
  });
  it('does not take a list over again, or over models saved on this device', async () => {
    mocks.list.mockResolvedValue({
      storage: 'session',
      imported: true,
      records: [],
    });
    expect((await fetchConfiguredModelInventory()).keyStorage).toBe('session');
    mocks.list.mockResolvedValue({
      storage: 'secure',
      imported: false,
      records: [localModelRecord({ id: 2147483648, provider_name: 'openai' })],
    });
    expect(await fetchConfiguredProviders()).toHaveLength(1);
    expect(mocks.importEarlier).not.toHaveBeenCalled();
  });
  it('keeps an empty list when there is no earlier list to take over', async () => {
    mocks.list.mockResolvedValue({
      storage: 'secure',
      imported: false,
      records: [],
    });
    expect(await fetchConfiguredProviders()).toEqual([]);
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });
  it('reports a store that cannot be read instead of an empty inventory', async () => {
    mocks.list.mockRejectedValue(new Error('store unavailable'));
    await expect(fetchConfiguredProviders()).rejects.toThrow(
      'store unavailable'
    );
  });
  it('saves on this device and only then tells the server the plain settings', async () => {
    const saved = localModelRecord({
      id: 2147483648,
      provider_name: 'openai',
      api_key: 'unit-test-model-key-0001',
    });
    mocks.save.mockResolvedValue(saved);
    const changed = vi.fn();
    window.addEventListener('eigent:model-configurations-changed', changed);
    const input = {
      provider_name: 'openai',
      model_type: 'gpt-test',
      endpoint_url: 'https://models.example.test/v1',
      api_key: 'unit-test-model-key-0001',
      config: {},
      is_valid: true,
    };

    expect(await saveConfiguredProvider(input)).toBe(saved);
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 7 }),
      input
    );
    // What goes to the server is the saved view, which holds no key.
    expect(mocks.register).toHaveBeenCalledWith(saved);
    expect(JSON.stringify(mocks.register.mock.calls)).not.toContain(
      'unit-test-model-key-0001'
    );
    expect(mocks.http).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledTimes(1);
    window.removeEventListener('eigent:model-configurations-changed', changed);
  });
  it('does not tell the server about a model that could not be saved', async () => {
    mocks.save.mockRejectedValue(new Error('no secure storage'));
    await expect(
      saveConfiguredProvider({
        provider_name: 'openai',
        model_type: 'gpt-test',
        endpoint_url: '',
        config: {},
        is_valid: true,
      })
    ).rejects.toThrow('no secure storage');
    expect(mocks.register).not.toHaveBeenCalled();
  });
  it('removes a model from this device and from what the server knows', async () => {
    await deleteConfiguredProvider({ id: 57, server_id: 57 });
    expect(mocks.remove).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 7 }),
      57
    );
    expect(mocks.unregister).toHaveBeenCalledWith(57);
  });
  it('keeps repeated provider and model names distinct by record ID', () => {
    const choices = selectableConfiguredModels({
      records: [
        {
          id: 11,
          provider_name: 'openai',
          model_type: 'gpt-5',
          api_key: 'first',
          endpoint_url: '',
          is_valid: 2,
        },
        {
          id: 12,
          provider_name: 'openai',
          model_type: 'gpt-5',
          api_key: 'second',
          endpoint_url: '',
          is_valid: 2,
        },
      ],
      cloudModels: [],
      hidden: [],
      cloudAvailable: false,
      codexConnected: false,
      codexModelType: '',
    });
    expect(choices.map((choice) => choice.id)).toEqual([
      'provider:11',
      'provider:12',
    ]);
  });

  it('names saved models without their gateway provider prefix', () => {
    const choices = selectableConfiguredModels({
      records: [
        {
          id: 21,
          provider_name: 'openrouter',
          model_type: 'google/gemini-4-carbon',
          api_key: 'key',
          endpoint_url: '',
          is_valid: 2,
        },
      ],
      cloudModels: [],
      hidden: [],
      cloudAvailable: false,
      codexConnected: true,
      codexModelType: 'gpt-5-codex',
    });
    expect(choices.map((choice) => choice.name)).toEqual([
      'gemini-4-carbon',
      'gpt-5-codex',
    ]);
  });

  it('names what sets repeated configurations apart without showing a key', () => {
    const record = (id: number, endpoint_url: string, api_key: string) =>
      localModelRecord({
        id,
        provider_name: 'openai',
        model_type: 'gpt-5',
        api_key,
        endpoint_url,
      });
    const work = record(11, 'https://work.example.test/v1', 'unit-work-1111');
    const personal = record(
      12,
      'https://api.example.test/v1',
      'unit-home-2222'
    );
    const backup = record(13, 'https://api.example.test/v1', 'unit-back-3333');
    const other = { ...work, id: 15, model_type: 'gpt-4.1' };
    const records = [work, personal, backup, other];

    expect(configurationHint(other, records)).toBe('');
    expect(configurationHint(work, records)).toBe('work.example.test');
    // Same host: told apart by position, never by part of a key.
    expect(configurationHint(personal, records)).toBe('#2');
    expect(configurationHint(backup, records)).toBe('#3');
    for (const item of records)
      expect(configurationHint(item, records)).not.toMatch(/1111|2222|3333/);
  });
  it('excludes paid Eigent choices until the account plan is known', () => {
    const choices = selectableConfiguredModels({
      records: [],
      cloudModels: [
        {
          id: 'free',
          display_name: 'Free',
          model_type: 'free',
          model_platform: 'eigent',
          provider_family: 'eigent',
          kind: 'chat',
          min_plan_key: 'free',
        },
        {
          id: 'pro',
          display_name: 'Pro',
          model_type: 'pro',
          model_platform: 'eigent',
          provider_family: 'eigent',
          kind: 'chat',
          min_plan_key: 'pro',
        },
      ],
      hidden: [],
      cloudAvailable: true,
      codexConnected: false,
      codexModelType: '',
      planKey: null,
    });
    expect(choices.map((choice) => choice.id)).toEqual(['cloud:free']);
  });
  it('names Eigent Cloud models without a gateway provider prefix', () => {
    const cloud = (id: string, display_name: string) => ({
      id,
      display_name,
      model_type: id,
      model_platform: 'openai-compatible-model',
      provider_family: 'google',
      kind: 'chat' as const,
      min_plan_key: 'free',
    });
    const choices = selectableConfiguredModels({
      records: [],
      cloudModels: [
        cloud('openai/gemini-4-carbon', 'openai/gemini-4-carbon'),
        cloud('gpt-5.5', 'GPT-5.5'),
      ],
      hidden: [],
      cloudAvailable: true,
      codexConnected: false,
      codexModelType: '',
      planKey: 'free',
    });
    expect(choices.map((choice) => choice.name)).toEqual([
      'gemini-4-carbon',
      'GPT-5.5',
    ]);
  });
  it('sets the default on this device and then tells the server', async () => {
    const record = localModelRecord({
      id: 6,
      provider_name: 'ollama',
      model_type: 'qwen',
    });
    await setConfiguredProviderDefault(record);
    expect(mocks.setDefault).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 7 }),
      6
    );
    expect(mocks.registerDefault).toHaveBeenCalledWith(record);
    expect(mocks.setModelType).toHaveBeenCalledWith('local');
  });
  it('does not change the model category when the default cannot be saved', async () => {
    mocks.setDefault.mockRejectedValueOnce(new Error('store unavailable'));
    await expect(
      setConfiguredProviderDefault(
        localModelRecord({ id: 6, provider_name: 'ollama', model_type: 'qwen' })
      )
    ).rejects.toThrow('store unavailable');
    expect(mocks.setModelType).not.toHaveBeenCalled();
    expect(mocks.registerDefault).not.toHaveBeenCalled();
  });
  it('isolates frontend visibility preferences by account', () => {
    useModelVisibilityStore.getState().setHidden('one', 'gpt', true);
    useModelVisibilityStore.getState().setHidden('one', 'gpt', true);
    useModelVisibilityStore.getState().setHidden('two', 'claude', true);
    expect(useModelVisibilityStore.getState().hiddenByAccount).toEqual({
      one: ['gpt'],
      two: ['claude'],
    });
    useModelVisibilityStore.getState().setHidden('one', 'gpt', false);
    expect(useModelVisibilityStore.getState().hiddenByAccount.two).toEqual([
      'claude',
    ]);
  });
});
