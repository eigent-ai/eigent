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

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/store/authStore', () => ({
  getAuthStore: () => ({ token: null }),
}));

const showCreditsToast = vi.fn();
const showStorageToast = vi.fn();
const showTrafficToast = vi.fn();

vi.mock('@/components/Toast/creditsToast', () => ({
  showCreditsToast,
}));

vi.mock('@/components/Toast/storageToast', () => ({
  showStorageToast,
}));

vi.mock('@/components/Toast/trafficToast', () => ({
  showTrafficToast,
}));

import { fetchPost, getBaseURL } from '@/api/http';
import {
  resetConnectionConfig,
  setConnectionConfig,
} from '@/store/connectionStore';

describe('api/http handleResponse', () => {
  beforeEach(() => {
    resetConnectionConfig();
    setConnectionConfig({
      brainEndpoint: 'http://brain.local',
      channel: 'web',
    });
    showCreditsToast.mockClear();
    showStorageToast.mockClear();
    showTrafficToast.mockClear();
    vi.restoreAllMocks();
  });

  it('throws for non-JSON error responses instead of returning stream object', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>bad gateway</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      })
    );

    await expect(fetchPost('/chat', { question: 'x' })).rejects.toThrow();
  });

  it('keeps code-based handling reachable for non-OK JSON responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 20, text: 'insufficient credits' }), {
        status: 402,
        headers: { 'content-type': 'application/json' },
      })
    );

    const res = await fetchPost('/chat', { question: 'x' });
    expect(res.code).toBe(20);
    expect(showCreditsToast).toHaveBeenCalledTimes(1);
  });
});

describe('api/http getBaseURL', () => {
  beforeEach(() => {
    resetConnectionConfig();
  });

  it('uses latest connection config endpoint without stale module cache', async () => {
    setConnectionConfig({ brainEndpoint: 'http://localhost:5001' });
    await expect(getBaseURL()).resolves.toBe('http://localhost:5001');

    setConnectionConfig({ brainEndpoint: 'http://localhost:5002' });
    await expect(getBaseURL()).resolves.toBe('http://localhost:5002');
  });
});
