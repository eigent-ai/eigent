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
  fetchConfiguredProviders,
  selectableConfiguredModels,
  setConfiguredProviderDefault,
} from '@/lib/configuredModels';
import { useModelVisibilityStore } from '@/store/modelVisibilityStore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  setModelType: vi.fn(),
}));
vi.mock('@/api/http', () => ({
  proxyFetchGet: mocks.get,
  proxyFetchPost: mocks.post,
}));
vi.mock('@/store/authStore', () => ({
  getAuthStore: () => ({ setModelType: mocks.setModelType }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  useModelVisibilityStore.setState({ hiddenByAccount: {} });
});
describe('Configured model identity', () => {
  it('loads all pages without collapsing repeated providers', async () => {
    mocks.get
      .mockResolvedValueOnce({
        items: [{ id: 1, provider_name: 'openai' }],
        pages: 2,
        total: 2,
      })
      .mockResolvedValueOnce({
        items: [{ id: 2, provider_name: 'openai' }],
        pages: 2,
        total: 2,
      });
    expect(
      (await fetchConfiguredProviders()).map((record) => record.id)
    ).toEqual([1, 2]);
    expect(mocks.get).toHaveBeenLastCalledWith('/api/v1/providers', {
      page: 2,
      size: 100,
    });
  });
  it('supports local proxy array responses', async () => {
    mocks.get.mockResolvedValue([{ id: 5, provider_name: 'ollama' }]);
    expect(await fetchConfiguredProviders()).toHaveLength(1);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
  it('rejects error envelopes instead of treating them as an empty inventory', async () => {
    mocks.get.mockResolvedValue({ code: 1, text: 'Server unavailable' });
    await expect(fetchConfiguredProviders()).rejects.toThrow(
      'Configured providers request failed'
    );
    mocks.get.mockResolvedValue({ code: 1, items: [] });
    await expect(fetchConfiguredProviders()).rejects.toThrow(
      'Configured providers request failed'
    );
    mocks.get.mockResolvedValue({ detail: 'Server unavailable' });
    await expect(fetchConfiguredProviders()).rejects.toThrow(
      'Invalid configured providers response'
    );
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

  it('names what sets repeated configurations apart', () => {
    const record = (id: number, endpoint_url: string, api_key: string) => ({
      id,
      provider_name: 'openai',
      model_type: 'gpt-5',
      api_key,
      endpoint_url,
    });
    const work = record(11, 'https://work.example.test/v1', 'sk-work-1111');
    const personal = record(12, 'https://api.example.test/v1', 'sk-home-2222');
    const backup = record(13, 'https://api.example.test/v1', 'sk-back-3333');
    const keyless = record(14, 'https://api.example.test/v1', 'not-required');
    const other = { ...work, id: 15, model_type: 'gpt-4.1' };
    const records = [work, personal, backup, other];

    expect(configurationHint(other, records)).toBe('');
    expect(configurationHint(work, records)).toBe('work.example.test');
    expect(configurationHint(personal, records)).toBe('…2222');
    expect(configurationHint(backup, records)).toBe('…3333');
    expect(configurationHint(keyless, [personal, keyless])).toBe('#14');
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
  it('fails safely when a paginated endpoint repeats the same page', async () => {
    mocks.get.mockResolvedValue({ items: [{ id: 1 }], total: 200, pages: 2 });
    // Repeated IDs cannot be mistaken for two separate configurations.
    await expect(fetchConfiguredProviders()).rejects.toThrow(
      'Provider pagination did not advance'
    );
  });
  it('does not change the model category when preference save fails', async () => {
    mocks.post.mockRejectedValueOnce(new Error('offline'));
    await expect(
      setConfiguredProviderDefault({
        id: 6,
        provider_name: 'ollama',
        model_type: 'qwen',
        api_key: '',
        endpoint_url: '',
      })
    ).rejects.toThrow('offline');
    expect(mocks.setModelType).not.toHaveBeenCalled();
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
