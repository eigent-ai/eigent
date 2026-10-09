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
import { createSSEAdmissionError } from '@/lib/responseError';
import {
  getConnectionConfig,
  resetConnectionConfig,
  setConnectionConfig,
} from '@/store/connectionStore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FakeRelayBridge,
  RELAY_ORIGIN,
  sseHead,
} from '../../mocks/brainStreamRelayBridge';

const mocks = vi.hoisted(() => ({
  auth: { token: 'synthetic-a', user_id: 1 },
  host: { electronAPI: null as unknown, ipcRenderer: null },
}));
vi.mock('@/store/authStore', () => ({ getAuthStore: () => mocks.auth }));
vi.mock('@/host/createHost', () => ({ createHost: () => mocks.host }));

const encoder = new TextEncoder();
const closedStream = () =>
  new Response(
    new ReadableStream({ start: (controller) => controller.close() }),
    { headers: { 'content-type': 'text/event-stream' } }
  );

describe('sseTransport through the main-process relay', () => {
  let bridge: FakeRelayBridge;
  let windowFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    bridge = new FakeRelayBridge();
    mocks.host = {
      electronAPI: Object.assign(bridge, {
        getLocalControlCapability: async () => 'synthetic-capability',
      }),
      ipcRenderer: null,
    };
    resetConnectionConfig();
    setConnectionConfig({ brainEndpoint: RELAY_ORIGIN, channel: 'desktop' });
    windowFetch = vi.fn(async () => closedStream());
    vi.stubGlobal('fetch', windowFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('relays a Brain event stream and delivers its events', async () => {
    const onmessage = vi.fn();
    const onopen = vi.fn();
    const onclose = vi.fn();
    const done = sseTransport({
      url: '/chat',
      body: { question: 'hi' },
      onmessage,
      onopen,
      onclose,
    });
    const open = await bridge.nextOpen();
    expect(open.request).toMatchObject({
      url: `${RELAY_ORIGIN}/chat`,
      method: 'POST',
      body: '{"question":"hi"}',
      headers: {
        accept: 'text/event-stream',
        authorization: 'Bearer synthetic-a',
        'content-type': 'application/json',
        'x-channel': 'desktop',
        'x-eigent-local-capability': 'synthetic-capability',
        'x-user-id': '1',
      },
    });
    open.resolve(sseHead());
    (await bridge.nextRead()).resolve({
      type: 'data',
      chunk: encoder.encode('id: e1\ndata: one\n\n'),
    });
    (await bridge.nextRead()).resolve({
      type: 'data',
      chunk: encoder.encode('id: e2\ndata: two\n\n'),
    });
    (await bridge.nextRead()).resolve({ type: 'end' });
    await done;

    expect(
      onmessage.mock.calls.map(([event]) => [event.id, event.data])
    ).toEqual([
      ['e1', 'one'],
      ['e2', 'two'],
    ]);
    expect(onopen).toHaveBeenCalledWith(
      expect.objectContaining({ status: 200, ok: true })
    );
    expect(onclose).toHaveBeenCalledOnce();
    expect(getConnectionConfig().sessionId).toBe('session-from-brain');
    expect(windowFetch).not.toHaveBeenCalled();
  });

  it('keeps a Brain endpoint the main process does not manage on window.fetch', async () => {
    setConnectionConfig({ brainEndpoint: 'https://brain.example.com' });
    await sseTransport({ url: '/chat', body: {}, onmessage: vi.fn() });
    expect(windowFetch).toHaveBeenCalledWith(
      'https://brain.example.com/chat',
      expect.objectContaining({ method: 'POST' })
    );
    expect(bridge.brainStreamRelayOpen).not.toHaveBeenCalled();
  });

  it('keeps share and replay playback streams on window.fetch', async () => {
    const url =
      'https://eigent.example/api/v1/chat/share/playback/token?delay_time=0';
    await sseTransport({ url, method: 'GET', onmessage: vi.fn() });
    expect(windowFetch).toHaveBeenCalledWith(url, expect.anything());
    expect(bridge.brainStreamRelayTarget).not.toHaveBeenCalled();
    expect(bridge.brainStreamRelayOpen).not.toHaveBeenCalled();
  });

  it('uses window.fetch when the relay is turned off in main', async () => {
    bridge.target = async () => null;
    await sseTransport({ url: '/chat', body: {}, onmessage: vi.fn() });
    expect(windowFetch).toHaveBeenCalledOnce();
    expect(bridge.brainStreamRelayOpen).not.toHaveBeenCalled();
  });

  it('runs the delivery guard before anything reaches main', async () => {
    const stale = new Error('stale admission');
    await expect(
      sseTransport({
        url: '/chat',
        body: {},
        onmessage: vi.fn(),
        beforeRequest: () => {
          throw stale;
        },
      })
    ).rejects.toBe(stale);
    expect(bridge.brainStreamRelayOpen).not.toHaveBeenCalled();
    expect(windowFetch).not.toHaveBeenCalled();
  });

  it('retries a dropped relayed stream with Last-Event-ID', async () => {
    const errors: unknown[] = [];
    const guard = vi.fn();
    const done = sseTransport({
      url: '/runs/run-1/stream?after_sequence=0',
      method: 'GET',
      onmessage: vi.fn(),
      beforeRequest: guard,
      onerror: (error) => {
        errors.push(error);
        return 0;
      },
    });
    const first = await bridge.nextOpen(1);
    first.resolve(sseHead());
    (await bridge.nextRead()).resolve({
      type: 'data',
      chunk: encoder.encode('id: e7\ndata: x\n\n'),
    });
    (await bridge.nextRead()).resolve({ type: 'error', reason: 'network' });
    const second = await bridge.nextOpen(2);
    expect(errors).toEqual([new TypeError('network error')]);
    expect(guard).toHaveBeenCalledTimes(2);
    expect(second.request.headers['last-event-id']).toBe('e7');
    expect(second.request.streamId).not.toBe(first.request.streamId);
    second.resolve(sseHead());
    (await bridge.nextRead()).resolve({ type: 'end' });
    await done;
    expect(windowFetch).not.toHaveBeenCalled();
  });

  it('surfaces a typed admission rejection from a relayed 409', async () => {
    const done = sseTransport({
      url: '/chat',
      body: {},
      onmessage: vi.fn(),
      async onopen(response) {
        if (!response.ok) throw await createSSEAdmissionError(response, {});
      },
      onerror(error) {
        throw error;
      },
    });
    (await bridge.nextOpen()).resolve({
      ok: true,
      status: 409,
      statusText: 'Conflict',
      headers: [['content-type', 'application/json']],
    });
    (await bridge.nextRead()).resolve({
      type: 'data',
      chunk: encoder.encode(
        JSON.stringify({
          detail: {
            code: 'workspace_model_selection_changed',
            message: 'Choose a model again.',
          },
        })
      ),
    });
    (await bridge.nextRead()).resolve({ type: 'end' });
    await expect(done).rejects.toMatchObject({
      status: 409,
      code: 'workspace_model_selection_changed',
    });
  });

  it('cancels the relayed stream when the caller aborts', async () => {
    const controller = new AbortController();
    const done = sseTransport({
      url: '/runs/run-1/stream?after_sequence=3',
      method: 'GET',
      signal: controller.signal,
      onmessage: vi.fn(),
    });
    const open = await bridge.nextOpen();
    open.resolve(sseHead());
    await bridge.nextRead();
    controller.abort();
    await expect(done).resolves.toBeUndefined();
    expect(bridge.brainStreamRelayCancel).toHaveBeenCalledWith(
      open.request.streamId
    );
  });
});
