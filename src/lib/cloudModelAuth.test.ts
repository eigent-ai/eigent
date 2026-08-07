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

import { proxyFetchGet } from '@/api/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveCloudModelAuth } from './cloudModelAuth';

vi.mock('@/api/http', () => ({
  proxyFetchGet: vi.fn(),
}));

const fetchGet = vi.mocked(proxyFetchGet);

describe('resolveCloudModelAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the Eigent token without fetching a LiteLLM key', async () => {
    fetchGet.mockResolvedValueOnce({
      auth_mode: 'eigent_token',
      api_url: 'https://eigent-proxy.example.com/v1',
    });

    const result = await resolveCloudModelAuth('eigent-user-token');

    expect(result).toEqual({
      apiKey: 'eigent-user-token',
      apiUrl: 'https://eigent-proxy.example.com/v1',
      mode: 'eigent_token',
      warningCode: undefined,
      warningText: undefined,
    });
    expect(fetchGet).toHaveBeenCalledTimes(1);
    expect(fetchGet).toHaveBeenCalledWith('/api/v1/cloud-auth-config');
  });

  it('falls back only when the server does not support the new endpoint', async () => {
    fetchGet.mockRejectedValueOnce({ status: 404 }).mockResolvedValueOnce({
      value: 'sk-legacy',
      api_url: 'https://eigent-proxy.example.com/v1',
    });

    const result = await resolveCloudModelAuth('eigent-user-token');

    expect(result.mode).toBe('legacy_key');
    expect(result.apiKey).toBe('sk-legacy');
    expect(fetchGet).toHaveBeenNthCalledWith(2, '/api/v1/user/key');
  });

  it('does not expose the legacy key path during an auth outage', async () => {
    fetchGet.mockRejectedValueOnce({ status: 503 });

    await expect(
      resolveCloudModelAuth('eigent-user-token')
    ).rejects.toMatchObject({ status: 503 });
    expect(fetchGet).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid new-server response without legacy fallback', async () => {
    fetchGet.mockResolvedValueOnce({
      auth_mode: 'unexpected',
      api_url: 'https://eigent-proxy.example.com/v1',
    });

    await expect(resolveCloudModelAuth('eigent-user-token')).rejects.toThrow(
      'configuration is invalid'
    );
    expect(fetchGet).toHaveBeenCalledTimes(1);
  });
});
