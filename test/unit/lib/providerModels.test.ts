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

import { fetchProviderModels } from '@/lib/providerModels';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

describe('fetchProviderModels errors', () => {
  it.each([
    [401, 'Invalid API key. Check your API key and click Refresh again.'],
    [
      403,
      'Access denied. Check your API key permissions and account access, then click Refresh again.',
    ],
    [500, 'Failed to fetch models: 500 Server Error'],
  ])(
    'explains HTTP %s without exposing credentials',
    async (status, message) => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue({ ok: false, status, statusText: 'Server Error' })
      );
      await expect(
        fetchProviderModels('https://example.com/v1', '/models', 'bad-key')
      ).rejects.toThrow(message);
    }
  );

  it('can fetch models after a rejected key is corrected', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'ling-chat' }] }),
      });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      fetchProviderModels('https://example.com/v1', '/models', 'bad-key')
    ).rejects.toThrow('Invalid API key');
    await expect(
      fetchProviderModels('https://example.com/v1', '/models', 'new-key')
    ).resolves.toMatchObject([{ models: [{ id: 'ling-chat' }] }]);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(
      'Bearer new-key'
    );
  });
});
