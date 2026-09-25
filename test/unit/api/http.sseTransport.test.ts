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

import { sseTransport } from '@/api/http';
import { setConnectionConfig } from '@/store/connectionStore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { token: 'synthetic-a', user_id: 1 },
}));
vi.mock('@/store/authStore', () => ({ getAuthStore: () => mocks.auth }));
vi.mock('@/host/createHost', () => ({
  createHost: () => ({ electronAPI: null, ipcRenderer: null }),
}));

const closedStream = () =>
  new Response(
    new ReadableStream({ start: (controller) => controller.close() }),
    { headers: { 'content-type': 'text/event-stream' } }
  );
const outcome = (promise: Promise<void>) =>
  promise.then(
    () => ({ ok: true, error: undefined }),
    (error: unknown) => ({ ok: false, error })
  );

describe('SSE delivery through the actual fetch-event-source library', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.auth = { token: 'synthetic-a', user_id: 1 };
    setConnectionConfig({
      brainEndpoint: 'http://brain.fixture.invalid',
      channel: 'web',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('Unexpected network');
      })
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([true, false])(
    'retains normal network retry and close (guard=%s)',
    async (guarded) => {
      const networkError = new TypeError('Synthetic NetworkError');
      const fetch = vi
        .fn()
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce(closedStream());
      vi.stubGlobal('fetch', fetch);
      const guard = vi.fn();
      const onerror = vi.fn();
      const onopen = vi.fn();
      const onclose = vi.fn();
      const result = outcome(
        sseTransport({
          url: '/chat',
          beforeRequest: guarded ? guard : undefined,
          onerror,
          onopen,
          onclose,
          onmessage: vi.fn(),
        })
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await result).toEqual({ ok: true, error: undefined });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(guard).toHaveBeenCalledTimes(guarded ? 2 : 0);
      expect(onerror).toHaveBeenCalledOnce();
      expect(onerror).toHaveBeenCalledWith(networkError);
      expect(onopen).toHaveBeenCalledOnce();
      expect(onclose).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it.each([false, true])(
    'rejects a retry guard TypeError even if cleanup aborts the library (%s)',
    async (abortInsideGuard) => {
      const controller = new AbortController();
      const rejected = new TypeError('NetworkError: invalid admission context');
      const fetch = vi
        .fn()
        .mockRejectedValue(new TypeError('Synthetic connection loss'));
      vi.stubGlobal('fetch', fetch);
      let checks = 0;
      const onerror = vi.fn();
      const onopen = vi.fn();
      const result = outcome(
        sseTransport({
          url: '/chat',
          signal: controller.signal,
          onmessage: vi.fn(),
          onopen,
          onerror,
          beforeRequest: () => {
            if (++checks === 2) {
              if (abortInsideGuard) controller.abort();
              throw rejected;
            }
          },
        })
      );
      await vi.advanceTimersByTimeAsync(1000);
      expect(await result).toEqual({ ok: false, error: rejected });
      expect(checks).toBe(2);
      expect(fetch).toHaveBeenCalledOnce();
      expect(onerror).toHaveBeenCalledOnce(); // only the real connection error
      expect(onopen).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(5000);
      expect(fetch).toHaveBeenCalledOnce();
    }
  );

  it('validates a visibility-driven connection rebuild before delivery', async () => {
    let hidden = false;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    const fetch = vi.fn(
      (_url: unknown, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          );
        })
    );
    vi.stubGlobal('fetch', fetch);
    let current = true;
    const stale = new Error('stale admission');
    const result = outcome(
      sseTransport({
        url: '/chat',
        openWhenHidden: false,
        onmessage: vi.fn(),
        beforeRequest: () => {
          if (!current) throw stale;
        },
      })
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledOnce();
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    current = false;
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(await result).toEqual({ ok: false, error: stale });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps frozen headers/body, Last-Event-ID, and per-connection signals on reconnect', async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          stream = controller;
          controller.enqueue(
            new TextEncoder().encode('id: event-7\ndata: checkpoint\n\n')
          );
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } }
    );
    const requests: RequestInit[] = [];
    const fetch = vi.fn(async (_url, init: RequestInit) => {
      requests.push({ ...init, headers: { ...init.headers } });
      return requests.length === 1 ? response : closedStream();
    });
    vi.stubGlobal('fetch', fetch);
    const body = { run_id: 'same-run', resume_request_id: 'same-request' };
    const onmessage = vi.fn();
    const guard = vi.fn();
    const result = outcome(
      sseTransport({ url: '/chat', body, onmessage, beforeRequest: guard })
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(onmessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'event-7', data: 'checkpoint' })
    );
    body.resume_request_id = 'later-ui-choice';
    mocks.auth = { token: 'synthetic-b', user_id: 2 };
    stream.error(new TypeError('Synthetic connection loss after open'));
    await vi.advanceTimersByTimeAsync(1000);
    expect((await result).ok).toBe(true);
    expect(guard).toHaveBeenCalledTimes(2);
    expect(requests[1].body).toBe(requests[0].body);
    expect(requests[1].headers).toMatchObject({
      Authorization: 'Bearer synthetic-a',
      'X-User-ID': '1',
      'last-event-id': 'event-7',
    });
    expect(requests[1].signal).not.toBe(requests[0].signal);
    expect(requests[1].signal?.aborted).toBe(true); // normal close disposes it
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops a queued automatic retry on caller abort', async () => {
    const controller = new AbortController();
    const fetch = vi
      .fn()
      .mockRejectedValue(new TypeError('Synthetic connection loss'));
    vi.stubGlobal('fetch', fetch);
    const guard = vi.fn();
    const result = outcome(
      sseTransport({
        url: '/chat',
        signal: controller.signal,
        beforeRequest: guard,
        onmessage: vi.fn(),
      })
    );
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect((await result).ok).toBe(true); // retain the library's normal abort contract
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledOnce();
    expect(guard).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
