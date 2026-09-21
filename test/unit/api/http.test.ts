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
  getAuthStore: () => mocked.auth,
}));

const mocked = vi.hoisted(() => ({
  auth: { token: null as string | null, user_id: 1 },
  getLocalControlCapability: vi.fn(() =>
    Promise.resolve('renderer-capability')
  ),
  reportError: vi.fn(() => 'task'),
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

vi.mock('@/lib/notifyError', () => ({
  reportError: mocked.reportError,
}));

vi.mock('@/components/Toast/storageToast', () => ({
  showStorageToast: mocked.showStorageToast,
}));

vi.mock('@/components/Toast/trafficToast', () => ({
  showTrafficToast: mocked.showTrafficToast,
}));

import { fetchGet, fetchPost, getBaseURL, proxyFetchPut } from '@/api/http';
import { getAccountEnvironmentKey } from '@/lib/authEnvironment';
import {
  resetConnectionConfig,
  setConnectionConfig,
} from '@/store/connectionStore';

describe('api/http handleResponse', () => {
  beforeEach(() => {
    mocked.auth = { token: null, user_id: 1 };
    resetConnectionConfig();
    setConnectionConfig({
      brainEndpoint: 'http://brain.local',
      channel: 'web',
    });
    mocked.reportError.mockClear();
    mocked.showStorageToast.mockClear();
    mocked.showTrafficToast.mockClear();
    vi.restoreAllMocks();
  });

  it.each(['brain', 'server'])(
    'does not send a %s request under a changed account after async URL resolution',
    async (target) => {
      const fetch = vi.spyOn(globalThis, 'fetch');
      const options = {
        expectedAccountKey: getAccountEnvironmentKey(mocked.auth),
      };
      const request =
        target === 'brain'
          ? fetchGet('/runs/exact-run', undefined, undefined, options)
          : proxyFetchPut(
              '/api/v1/execution/exact-execution',
              { status: 'completed' },
              undefined,
              options
            );
      mocked.auth = { token: 'test-other-account', user_id: 2 };
      await expect(request).rejects.toThrow('account changed');
      expect(fetch).not.toHaveBeenCalled();
    }
  );

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
    expect(mocked.reportError).toHaveBeenCalledTimes(1);
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

  it('forwards an optional POST abort signal without reporting cancellation as an error', async () => {
    const controller = new AbortController();
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new DOMException('Request aborted', 'AbortError'));

    await expect(
      fetchPost(
        '/chat/project-1/runtime/retire-idle',
        { run_id: 'ended-run' },
        undefined,
        { signal: controller.signal }
      )
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(request).toHaveBeenCalledWith(
      'http://brain.local/chat/project-1/runtime/retire-idle',
      expect.objectContaining({
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({ run_id: 'ended-run' }),
      })
    );
    expect(mocked.reportError).not.toHaveBeenCalled();
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
