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

const mocked = vi.hoisted(() => ({
  getLocalControlCapability: vi.fn(() =>
    Promise.resolve('renderer-capability')
  ),
  showCreditsToast: vi.fn(),
  showStorageToast: vi.fn(),
  showTrafficToast: vi.fn(),
}));

vi.mock('@/host/createHost', () => ({
  createHost: () => ({
    electronAPI: {
      getLocalControlCapability: mocked.getLocalControlCapability,
    },
    ipcRenderer: null,
  }),
}));

vi.mock('@/components/Toast/creditsToast', () => ({
  showCreditsToast: mocked.showCreditsToast,
}));

vi.mock('@/components/Toast/storageToast', () => ({
  showStorageToast: mocked.showStorageToast,
}));

vi.mock('@/components/Toast/trafficToast', () => ({
  showTrafficToast: mocked.showTrafficToast,
}));

import { fetchGet, fetchPost, getBaseURL } from '@/api/http';
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
    mocked.showCreditsToast.mockClear();
    mocked.showStorageToast.mockClear();
    mocked.showTrafficToast.mockClear();
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
    expect(mocked.showCreditsToast).toHaveBeenCalledTimes(1);
  });

  it('attaches the ephemeral renderer capability to Brain requests', async () => {
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));

    await fetchPost(
      '/runs/run-1/cancel',
      { request_id: 'cancel-1' },
      { 'X-Eigent-Local-Capability': 'forged-capability' }
    );

    expect(request).toHaveBeenCalledWith(
      'http://brain.local/runs/run-1/cancel',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Eigent-Local-Capability': 'renderer-capability',
        }),
      })
    );
    const headers = request.mock.calls[0]?.[1]?.headers as Record<
      string,
      string
    >;
    expect(headers['X-Desktop-Instance-ID']).toBeUndefined();
  });

  it('encodes array query values as repeated parameters', async () => {
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));

    await fetchGet('/runs', {
      project_id: 'project 1',
      status: ['pending', 'running', 'waiting_for_user'],
      limit: 1,
    });

    expect(request).toHaveBeenCalledWith(
      'http://brain.local/runs?project_id=project+1&status=pending&status=running&status=waiting_for_user&limit=1',
      expect.objectContaining({ method: 'GET' })
    );
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
