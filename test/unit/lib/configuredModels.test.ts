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
  fetchConfiguredProviders,
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
