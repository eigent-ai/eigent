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
  createBrainStreamRelayFetch,
  resolveEventStreamFetch,
  type StreamFetch,
} from '@/api/brainStreamRelay';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FakeRelayBridge as FakeBridge,
  RELAY_ORIGIN as ORIGIN,
  sseHead,
} from '../../mocks/brainStreamRelayBridge';

const mocks = vi.hoisted(() => ({
  host: { electronAPI: null as unknown, ipcRenderer: null },
}));
vi.mock('@/host/createHost', () => ({ createHost: () => mocks.host }));

const RUN_STREAM = `${ORIGIN}/runs/run-1/stream?after_sequence=0`;
const encoder = new TextEncoder();

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('renderer event stream relay fetch', () => {
  let bridge: FakeBridge;
  let fallback: ReturnType<typeof vi.fn<StreamFetch>>;
  let relayFetch: StreamFetch;

  beforeEach(() => {
    bridge = new FakeBridge();
    fallback = vi.fn<StreamFetch>(async () => new Response('fallback'));
    relayFetch = createBrainStreamRelayFetch(
      bridge,
      [ORIGIN, 'http://127.0.0.1:5001'],
      fallback
    );
  });

  it('assembles a Response from the relayed head and body chunks', async () => {
    const responsePromise = relayFetch(RUN_STREAM, {
      method: 'GET',
      headers: { accept: 'text/event-stream', 'X-Channel': 'desktop' },
    });
    const { request, resolve } = bridge.lastOpen();
    expect(request).toEqual({
      streamId: expect.stringMatching(/^[0-9a-f]{32}$/),
      url: RUN_STREAM,
      method: 'GET',
      headers: {
        accept: 'text/event-stream',
        'x-channel': 'desktop',
        'accept-language': 'en-US,en;q=0.9',
      },
    });
    resolve(
      sseHead({
        headers: [
          ['content-type', 'text/event-stream'],
          ['x-session-id', 'session-from-brain'],
          ['X-Trace', 'a'],
          ['X-Trace', 'b'],
        ],
      })
    );
    const response = await responsePromise;
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
    expect(response.statusText).toBe('OK');
    expect(response.ok).toBe(true);
    expect(response.url).toBe(RUN_STREAM);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(response.headers.get('x-session-id')).toBe('session-from-brain');
    expect(response.headers.get('x-trace')).toBe('a, b');

    const reader = response.body!.getReader();
    // Nothing is requested from main until the reader asks for it.
    await flush();
    expect(bridge.brainStreamRelayRead).not.toHaveBeenCalled();
    const decoder = new TextDecoder();
    const received: string[] = [];
    for (const chunk of ['data: one\n\n', 'data: two\n\n']) {
      const reading = reader.read();
      const read = await bridge.nextRead();
      expect(read.streamId).toBe(request.streamId);
      read.resolve({ type: 'data', chunk: encoder.encode(chunk) });
      const { value } = await reading;
      received.push(decoder.decode(value));
    }
    const ending = reader.read();
    (await bridge.nextRead()).resolve({ type: 'end' });
    await expect(ending).resolves.toEqual({ done: true, value: undefined });
    expect(received).toEqual(['data: one\n\n', 'data: two\n\n']);
    expect(bridge.brainStreamRelayCancel).not.toHaveBeenCalled();
  });

  it('keeps a non-2xx JSON body readable through clone() and json()', async () => {
    const detail = {
      detail: { code: 'workspace_model_selection_changed', message: 'x' },
    };
    const responsePromise = relayFetch(`${ORIGIN}/chat`, {
      method: 'POST',
      body: '{"question":"hi"}',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(bridge.lastOpen().request).toMatchObject({
      method: 'POST',
      body: '{"question":"hi"}',
      headers: { 'content-type': 'application/json' },
    });
    bridge.lastOpen().resolve({
      ok: true,
      status: 409,
      statusText: 'Conflict',
      headers: [['content-type', 'application/json']],
    });
    const response = await responsePromise;
    expect(response.ok).toBe(false);
    expect(response.status).toBe(409);
    expect(response.statusText).toBe('Conflict');
    const cloneText = response.clone().text();
    (await bridge.nextRead()).resolve({
      type: 'data',
      chunk: encoder.encode(JSON.stringify(detail)),
    });
    (await bridge.nextRead()).resolve({ type: 'end' });
    expect(JSON.parse(await cloneText)).toEqual(detail);
    await expect(response.json()).resolves.toEqual(detail);
  });

  it('gives null-body statuses no body and releases the relayed stream', async () => {
    const responsePromise = relayFetch(RUN_STREAM);
    bridge.lastOpen().resolve(sseHead({ status: 204, statusText: '' }));
    const response = await responsePromise;
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(bridge.brainStreamRelayCancel).toHaveBeenCalledWith(
      bridge.lastOpen().request.streamId
    );
  });

  it('rejects a status no Response can represent', async () => {
    const responsePromise = relayFetch(RUN_STREAM);
    bridge.lastOpen().resolve(sseHead({ status: 101 }));
    await expect(responsePromise).rejects.toThrow(TypeError);
    expect(bridge.brainStreamRelayCancel).toHaveBeenCalledOnce();
  });

  it('drops an invalid status text instead of failing', async () => {
    const responsePromise = relayFetch(RUN_STREAM);
    bridge.lastOpen().resolve(sseHead({ statusText: 'Bad\r\nText' }));
    expect((await responsePromise).statusText).toBe('');
  });

  it('aborts before headers and cancels the relayed request', async () => {
    const controller = new AbortController();
    const responsePromise = relayFetch(RUN_STREAM, {
      signal: controller.signal,
    });
    const { request, resolve } = bridge.lastOpen();
    controller.abort();
    await expect(responsePromise).rejects.toMatchObject({ name: 'AbortError' });
    expect(bridge.brainStreamRelayCancel).toHaveBeenCalledWith(
      request.streamId
    );
    resolve(sseHead()); // A late head is ignored.
    await flush();
    expect(bridge.brainStreamRelayRead).not.toHaveBeenCalled();
  });

  it('propagates an abort reason that the caller supplied', async () => {
    const controller = new AbortController();
    const reason = new Error('owner left');
    const responsePromise = relayFetch(RUN_STREAM, {
      signal: controller.signal,
    });
    controller.abort(reason);
    await expect(responsePromise).rejects.toBe(reason);
  });

  it('aborts mid-stream: the pending read rejects and main is told once', async () => {
    const controller = new AbortController();
    const responsePromise = relayFetch(RUN_STREAM, {
      signal: controller.signal,
    });
    bridge.lastOpen().resolve(sseHead());
    const response = await responsePromise;
    const reader = response.body!.getReader();
    const reading = reader.read();
    const pendingRead = await bridge.nextRead();
    controller.abort();
    await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    expect(bridge.brainStreamRelayCancel).toHaveBeenCalledOnce();
    expect(bridge.brainStreamRelayCancel).toHaveBeenCalledWith(
      pendingRead.streamId
    );
    pendingRead.resolve({ type: 'error', reason: 'closed' }); // ignored
    await flush();
    expect(bridge.brainStreamRelayCancel).toHaveBeenCalledOnce();
  });

  it('does not open anything for an already aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      relayFetch(RUN_STREAM, { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(bridge.brainStreamRelayOpen).not.toHaveBeenCalled();
  });

  it('cancels the relayed stream when the body is cancelled', async () => {
    const responsePromise = relayFetch(RUN_STREAM);
    bridge.lastOpen().resolve(sseHead());
    const response = await responsePromise;
    await response.body!.cancel();
    expect(bridge.brainStreamRelayCancel).toHaveBeenCalledWith(
      bridge.lastOpen().request.streamId
    );
  });

  it.each(['network', 'unavailable', 'closed'] as const)(
    'reports a %s open failure like a failed fetch',
    async (reason) => {
      const responsePromise = relayFetch(RUN_STREAM);
      bridge.lastOpen().resolve({ ok: false, reason });
      await expect(responsePromise).rejects.toThrow(
        new TypeError('Failed to fetch')
      );
      expect(fallback).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['a network failure', { type: 'error', reason: 'network' }],
    ['a closed stream', { type: 'error', reason: 'closed' }],
  ] as const)(
    'errors the body as a network error after %s',
    async (_label, result) => {
      const responsePromise = relayFetch(RUN_STREAM);
      bridge.lastOpen().resolve(sseHead());
      const reader = (await responsePromise).body!.getReader();
      const reading = reader.read();
      (await bridge.nextRead()).resolve(result);
      await expect(reading).rejects.toThrow(new TypeError('network error'));
    }
  );

  it('errors the body when the read IPC itself fails', async () => {
    const responsePromise = relayFetch(RUN_STREAM);
    bridge.lastOpen().resolve(sseHead());
    const reader = (await responsePromise).body!.getReader();
    const reading = reader.read();
    (await bridge.nextRead()).reject(new Error('IPC gone'));
    await expect(reading).rejects.toThrow(TypeError);
  });

  it.each([
    [
      'declined by main',
      (open: FakeBridge['opens'][number]) =>
        open.resolve({ ok: false, reason: 'declined' }),
    ],
    [
      'an IPC failure',
      (open: FakeBridge['opens'][number]) =>
        open.reject(new Error('restricted to the main renderer')),
    ],
  ])('falls back to window.fetch when %s', async (_label, settle) => {
    const init = { method: 'GET', headers: { accept: 'text/event-stream' } };
    const responsePromise = relayFetch(RUN_STREAM, init);
    settle(bridge.lastOpen());
    await expect((await responsePromise).text()).resolves.toBe('fallback');
    expect(fallback).toHaveBeenCalledWith(RUN_STREAM, init);
  });

  it.each([
    [
      'a configured remote endpoint',
      'https://brain.example.com/chat',
      'POST',
      {},
    ],
    ['another port', 'http://localhost:5002/chat', 'POST', {}],
    ['another route', `${ORIGIN}/health`, 'GET', {}],
    ['another method', `${ORIGIN}/chat`, 'PUT', {}],
    ['an unknown header', `${ORIGIN}/chat`, 'POST', { 'X-Custom': '1' }],
  ])('never sends %s through main', async (_label, url, method, headers) => {
    const init = { method, headers, body: '{}' };
    await relayFetch(url, init);
    expect(fallback).toHaveBeenCalledWith(url, init);
    expect(bridge.brainStreamRelayOpen).not.toHaveBeenCalled();
  });

  it('never relays non-text bodies or Request objects', async () => {
    const blobInit = { method: 'POST', body: new Blob(['{}']) };
    await relayFetch(`${ORIGIN}/chat`, blobInit);
    const request = new Request(`${ORIGIN}/chat`, { method: 'POST' });
    await relayFetch(request);
    expect(fallback).toHaveBeenNthCalledWith(1, `${ORIGIN}/chat`, blobInit);
    expect(fallback).toHaveBeenNthCalledWith(2, request, undefined);
    expect(bridge.brainStreamRelayOpen).not.toHaveBeenCalled();
  });

  it('keeps an explicit Accept-Language header', async () => {
    void relayFetch(RUN_STREAM, { headers: { 'Accept-Language': 'zh-CN' } });
    expect(bridge.lastOpen().request.headers['accept-language']).toBe('zh-CN');
  });
});

describe('resolveEventStreamFetch', () => {
  let bridge: FakeBridge;
  const fallback = vi.fn<StreamFetch>(async () => new Response('fallback'));

  beforeEach(() => {
    bridge = new FakeBridge();
    mocks.host = { electronAPI: bridge, ipcRenderer: null };
    fallback.mockClear();
  });

  it('uses window.fetch without a relay bridge (web build)', async () => {
    mocks.host = { electronAPI: null, ipcRenderer: null };
    await expect(
      resolveEventStreamFetch(`${ORIGIN}/chat`, 'POST', fallback)
    ).resolves.toBe(fallback);
    mocks.host = {
      electronAPI: { getBackendPort: vi.fn() },
      ipcRenderer: null,
    };
    await expect(
      resolveEventStreamFetch(`${ORIGIN}/chat`, 'POST', fallback)
    ).resolves.toBe(fallback);
  });

  it('does not ask main about routes it never relays', async () => {
    const shareUrl = 'https://eigent.example/api/v1/chat/share/playback/t';
    await expect(
      resolveEventStreamFetch(shareUrl, 'GET', fallback)
    ).resolves.toBe(fallback);
    expect(bridge.brainStreamRelayTarget).not.toHaveBeenCalled();
  });

  it.each([
    ['is disabled or has no Brain', async () => null],
    ['rejects the sender', async () => Promise.reject(new Error('restricted'))],
    ['lists no origins', async () => ({ origins: [] })],
  ])('uses window.fetch when main %s', async (_label, target) => {
    bridge.target = target as FakeBridge['target'];
    await expect(
      resolveEventStreamFetch(`${ORIGIN}/chat`, 'POST', fallback)
    ).resolves.toBe(fallback);
  });

  it('relays a Brain event stream when main manages its origin', async () => {
    const streamFetch = await resolveEventStreamFetch(
      RUN_STREAM,
      'GET',
      fallback
    );
    expect(streamFetch).not.toBe(fallback);
    void streamFetch(RUN_STREAM, { method: 'GET' });
    expect(bridge.brainStreamRelayOpen).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
  });
});
