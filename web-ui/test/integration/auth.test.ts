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

import { getAuthStore } from '@/store/authStore';
import {
  loginWithPassword,
  logoutWeb,
  refreshAccessToken,
} from '@web/api/server';
import { getRefreshToken, setRefreshToken } from '@web/lib/authTokens';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const proxyFetchPost = vi.fn();

vi.mock('@/api/http', () => ({
  proxyFetchPost: (...args: unknown[]) => proxyFetchPost(...args),
  proxyFetchGet: vi.fn(),
  proxyFetchPut: vi.fn(),
  proxyFetchDelete: vi.fn(),
}));

describe('web auth integration', () => {
  beforeEach(() => {
    logoutWeb();
    proxyFetchPost.mockReset();
  });

  it('logs in and stores refresh token', async () => {
    proxyFetchPost.mockResolvedValueOnce({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      email: 'user@example.com',
    });

    await loginWithPassword('user@example.com', 'secret');

    expect(getAuthStore().token).toBe('access-1');
    expect(getRefreshToken()).toBe('refresh-1');
  });

  it('refreshes access token', async () => {
    setRefreshToken('refresh-old');
    proxyFetchPost.mockResolvedValueOnce({
      access_token: 'access-2',
      refresh_token: 'refresh-2',
      email: 'user@example.com',
    });

    const ok = await refreshAccessToken();
    expect(ok).toBe(true);
    expect(getAuthStore().token).toBe('access-2');
  });
});
