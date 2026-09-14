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

import { useIntegrationManagement } from '@/hooks/useIntegrationManagement';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  email: '',
  get: vi.fn(),
  checkAgentTool: vi.fn(),
}));

vi.mock('@/api/http', () => ({
  proxyFetchGet: mocks.get,
  proxyFetchPost: vi.fn(),
  proxyFetchPut: vi.fn(),
  proxyFetchDelete: vi.fn(),
  fetchPost: vi.fn(),
  fetchDelete: vi.fn(),
}));
vi.mock('@/host', () => ({ useHost: () => null }));
vi.mock('@/store/authStore', () => ({
  useAuthStore: () => ({
    email: mocks.email,
    modelType: 'custom',
    checkAgentTool: mocks.checkAgentTool,
  }),
}));

const items: Parameters<typeof useIntegrationManagement>[0] = [];
const configs = [{ config_name: 'QUERIT_ENABLED', config_value: 'true' }];
let userNumber = 0;

describe('integration configuration snapshot hydration', () => {
  beforeEach(() => {
    mocks.email = `connector-test-${++userNumber}@example.com`;
    mocks.get.mockReset().mockResolvedValue(configs);
  });

  it('provides cached configuration on the first render when reopening for the same user', async () => {
    const initial = renderHook(() => useIntegrationManagement(items));
    await waitFor(() =>
      expect(initial.result.current.configsLoading).toBe(false)
    );
    initial.unmount();
    mocks.get.mockClear();

    const frames: Array<{ configs: unknown[]; loading: boolean }> = [];
    renderHook(() => {
      const state = useIntegrationManagement(items);
      frames.push({ configs: state.configs, loading: state.configsLoading });
      return state;
    });

    expect(frames[0]).toEqual({ configs, loading: false });
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('does not expose another user’s cached configuration on mount', async () => {
    const initial = renderHook(() => useIntegrationManagement(items));
    await waitFor(() =>
      expect(initial.result.current.configsLoading).toBe(false)
    );
    initial.unmount();
    mocks.email = 'different-connector-user@example.com';
    mocks.get.mockImplementation(() => new Promise(() => {}));

    const frames: Array<{ configs: unknown[]; loading: boolean }> = [];
    renderHook(() => {
      const state = useIntegrationManagement(items);
      frames.push({ configs: state.configs, loading: state.configsLoading });
      return state;
    });

    expect(frames[0]).toEqual({ configs: [], loading: true });
  });
});
