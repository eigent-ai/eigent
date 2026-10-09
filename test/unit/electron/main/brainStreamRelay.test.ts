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

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isBrainStreamRelayDisabled,
  registerBrainStreamRelay,
  type BrainStreamRelay,
  type BrainStreamRelayOptions,
} from '../../../../electron/main/brainStreamRelay';
import {
  BRAIN_STREAM_RELAY_CANCEL_CHANNEL,
  BRAIN_STREAM_RELAY_OPEN_CHANNEL,
  BRAIN_STREAM_RELAY_READ_CHANNEL,
  BRAIN_STREAM_RELAY_TARGET_CHANNEL,
  type BrainStreamRelayOpenResult,
  type BrainStreamRelayReadResult,
  type BrainStreamRelayRequest,
} from '../../../../src/shared/brainStreamRelay';
import {
  eventually,
  openEventStream,
  startBrainEventStreamServer,
  type BrainEventStreamServer,
} from '../../../fixtures/brainEventStreamServer';

class FakeWebContents extends EventEmitter {
  destroyed = false;
  readonly mainFrame = { name: 'main-frame' };

  constructor(readonly id: number) {
    super();
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  destroy(): void {
    this.destroyed = true;
    this.emit('destroyed');
  }
}

class FakeIpcMain {
  readonly handlers = new Map<string, (event: any, ...args: any[]) => any>();

  handle(channel: string, listener: (event: any, ...args: any[]) => any) {
    if (this.handlers.has(channel)) {
      throw new Error(`Attempted to register a second handler for ${channel}`);
    }
    this.handlers.set(channel, listener);
  }

  removeHandler(channel: string) {
    this.handlers.delete(channel);
  }

  async invoke(event: unknown, channel: string, ...args: unknown[]) {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`No handler registered for ${channel}`);
    return handler(event, ...args);
  }
}

const decoder = new TextDecoder();
let streamCounter = 0;
const nextStreamId = () =>
  `stream-${String(++streamCounter).padStart(12, '0')}`;

describe('Brain event stream relay (main process)', () => {
  let server: BrainEventStreamServer;
  let ipc: FakeIpcMain;
  let relay: BrainStreamRelay;
  let renderer: FakeWebContents;
  let managedPort: number | null;
  let warn: ReturnType<typeof vi.fn>;

  const trustedEvent = () => ({
    sender: renderer,
    senderFrame: renderer.mainFrame,
  });
  const install = (overrides: Partial<BrainStreamRelayOptions> = {}) => {
    relay?.dispose();
    ipc = new FakeIpcMain();
    relay = registerBrainStreamRelay({
      ipcMain: ipc,
      getManagedBackendPort: () => managedPort,
      isTrustedSender: (event) =>
        event.sender === renderer && event.senderFrame === renderer.mainFrame,
      log: { warn },
      ...overrides,
    });
  };
  const open = (
    request: Partial<BrainStreamRelayRequest> = {},
    event: unknown = trustedEvent()
  ) =>
    ipc.invoke(event, BRAIN_STREAM_RELAY_OPEN_CHANNEL, {
      streamId: nextStreamId(),
      url: `${server.origin}/runs/run-1/stream?after_sequence=0`,
      method: 'GET',
      headers: { accept: 'text/event-stream' },
      ...request,
    }) as Promise<BrainStreamRelayOpenResult>;
  const read = (streamId: string, event: unknown = trustedEvent()) =>
    ipc.invoke(
      event,
      BRAIN_STREAM_RELAY_READ_CHANNEL,
      streamId
    ) as Promise<BrainStreamRelayReadResult>;
  const cancel = (streamId: string, event: unknown = trustedEvent()) =>
    ipc.invoke(event, BRAIN_STREAM_RELAY_CANCEL_CHANNEL, streamId);
  const readText = async (streamId: string) => {
    const result = await read(streamId);
    if (result.type !== 'data')
      throw new Error(`Expected data: ${result.type}`);
    return decoder.decode(result.chunk);
  };

  beforeEach(async () => {
    server = await startBrainEventStreamServer();
    managedPort = server.port;
    renderer = new FakeWebContents(7);
    warn = vi.fn();
    install();
  });

  afterEach(async () => {
    relay.dispose();
    await server.close();
  });

  it('relays the head first, then body chunks in order, then the end', async () => {
    server.handler = (exchange) => openEventStream(exchange);
    const streamId = nextStreamId();
    const head = await open({ streamId });
    expect(head).toEqual({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: expect.arrayContaining([
        ['content-type', 'text/event-stream'],
        ['x-session-id', 'session-from-brain'],
      ]),
    });
    // Browsers never expose Set-Cookie to scripts; neither does the relay.
    expect(
      (head as Extract<BrainStreamRelayOpenResult, { ok: true }>).headers.some(
        ([name]) => name.toLowerCase() === 'set-cookie'
      )
    ).toBe(false);

    const exchange = await server.exchange(0);
    const received: string[] = [];
    for (const event of ['first', 'second', 'third']) {
      exchange.response.write(`data: ${event}\n\n`);
      received.push(await readText(streamId));
    }
    expect(received).toEqual([
      'data: first\n\n',
      'data: second\n\n',
      'data: third\n\n',
    ]);
    exchange.response.end('data: last\n\n');
    let tail = '';
    for (;;) {
      const next = await read(streamId);
      if (next.type === 'end') break;
      if (next.type !== 'data') throw new Error(`Unexpected ${next.type}`);
      tail += decoder.decode(next.chunk);
    }
    expect(tail).toBe('data: last\n\n');
    expect(relay.activeStreamCount()).toBe(0);
  });

  it('forwards the request without adding cookies or changing the body', async () => {
    const body = JSON.stringify({ project_id: 'p-1', question: 'hello ✓' });
    await open({
      url: `${server.origin}/chat`,
      method: 'POST',
      headers: {
        accept: 'text/event-stream',
        'content-type': 'application/json',
        authorization: 'Bearer synthetic-token',
        'x-channel': 'desktop',
        'x-eigent-local-capability': 'synthetic-capability',
        'last-event-id': 'event-7',
      },
      body,
    });
    const { request } = await server.exchange(0);
    expect(request).toMatchObject({ method: 'POST', url: '/chat', body });
    expect(request.headers).toMatchObject({
      host: `localhost:${server.port}`,
      accept: 'text/event-stream',
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
      'accept-encoding': 'identity',
      authorization: 'Bearer synthetic-token',
      'x-channel': 'desktop',
      'x-eigent-local-capability': 'synthetic-capability',
      'last-event-id': 'event-7',
    });
    expect(request.headers.cookie).toBeUndefined();
  });

  it('keeps the status, headers and body of a non-2xx response', async () => {
    const detail = JSON.stringify({
      detail: {
        code: 'workspace_model_selection_changed',
        message: 'Choose the model again.',
      },
    });
    server.handler = ({ response }) => {
      response.writeHead(409, 'Conflict', {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(detail),
        'x-session-id': 'session-from-brain',
      });
      response.end(detail);
    };
    const streamId = nextStreamId();
    const head = await open({
      streamId,
      url: `${server.origin}/chat`,
      method: 'POST',
      body: '{}',
    });
    expect(head).toMatchObject({
      ok: true,
      status: 409,
      statusText: 'Conflict',
    });
    expect(
      (head as Extract<BrainStreamRelayOpenResult, { ok: true }>).headers
    ).toEqual(
      expect.arrayContaining([
        ['content-type', 'application/json'],
        ['x-session-id', 'session-from-brain'],
        ['content-length', String(Buffer.byteLength(detail))],
      ])
    );
    let text = '';
    for (;;) {
      const next = await read(streamId);
      if (next.type === 'end') break;
      if (next.type !== 'data') throw new Error(`Unexpected ${next.type}`);
      text += decoder.decode(next.chunk);
    }
    expect(JSON.parse(text)).toEqual(JSON.parse(detail));
  });

  it('closes the upstream connection when cancelled before headers', async () => {
    server.handler = () => undefined; // Hold the response head back.
    const streamId = nextStreamId();
    const opening = open({ streamId });
    const exchange = await server.exchange(0);
    expect(server.subscriberCount()).toBe(1);
    await expect(cancel(streamId)).resolves.toBe(true);
    await expect(opening).resolves.toEqual({ ok: false, reason: 'closed' });
    await exchange.disconnected;
    expect(server.subscriberCount()).toBe(0);
    expect(relay.activeStreamCount()).toBe(0);
  });

  it('closes the upstream connection when cancelled mid-stream', async () => {
    const streamId = nextStreamId();
    await open({ streamId });
    const exchange = await server.exchange(0);
    exchange.response.write('data: first\n\n');
    expect(await readText(streamId)).toBe('data: first\n\n');
    const pendingRead = read(streamId);
    await cancel(streamId);
    await expect(pendingRead).resolves.toEqual({
      type: 'error',
      reason: 'closed',
    });
    await exchange.disconnected;
    expect(server.subscriberCount()).toBe(0);
    await expect(read(streamId)).resolves.toEqual({
      type: 'error',
      reason: 'closed',
    });
  });

  it('honours a cancellation that overtakes its open', async () => {
    const streamId = nextStreamId();
    await expect(cancel(streamId)).resolves.toBe(false);
    await expect(open({ streamId })).resolves.toEqual({
      ok: false,
      reason: 'closed',
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.exchanges).toHaveLength(0);
  });

  it('reports network failures before and after the head', async () => {
    const streamId = nextStreamId();
    await open({ streamId });
    const exchange = await server.exchange(0);
    exchange.response.write('data: first\n\n');
    expect(await readText(streamId)).toBe('data: first\n\n');
    const pendingRead = read(streamId);
    exchange.socket.destroy();
    await expect(pendingRead).resolves.toEqual({
      type: 'error',
      reason: 'network',
    });

    managedPort = server.port;
    await server.close();
    await expect(open()).resolves.toEqual({ ok: false, reason: 'network' });
    expect(relay.activeStreamCount()).toBe(0);
  });

  it('delivers bytes received before a failure, then the failure', async () => {
    const streamId = nextStreamId();
    await open({ streamId });
    const exchange = await server.exchange(0);
    exchange.response.write('data: last words\n\n', () =>
      setTimeout(() => exchange.socket.destroy(), 50)
    );
    await exchange.disconnected;
    expect(await readText(streamId)).toBe('data: last words\n\n');
    await expect(read(streamId)).resolves.toEqual({
      type: 'error',
      reason: 'network',
    });
  });

  it('reads ahead while the renderer is busy and batches what it buffered', async () => {
    const streamId = nextStreamId();
    await open({ streamId });
    const exchange = await server.exchange(0);
    const events = ['one', 'two', 'three'].map((name) => `data: ${name}\n\n`);
    for (const event of events) exchange.response.write(event);
    exchange.response.end();
    // The relay closes its socket only after it has received the whole body.
    await eventually(() => server.openConnectionCount() === 0);
    // The body arrived while nothing was read; one read returns all of it.
    expect(await readText(streamId)).toBe(events.join(''));
    await expect(read(streamId)).resolves.toEqual({ type: 'end' });
  });

  it.each([
    ['another port', () => `http://localhost:${server.port + 1}/chat`],
    ['another host', () => `http://example.com:${server.port}/chat`],
    ['IPv6 loopback', () => `http://[::1]:${server.port}/chat`],
    ['https', () => `https://localhost:${server.port}/chat`],
    ['credentials', () => `http://user:pw@localhost:${server.port}/chat`],
  ])('declines a disallowed origin: %s', async (_label, url) => {
    await expect(
      open({ url: url(), method: 'POST', body: '{}' })
    ).resolves.toEqual({ ok: false, reason: 'declined' });
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/Declined a stream: (origin|url)$/)
    );
  });

  it.each([
    ['GET', '/health'],
    ['GET', '/chat'],
    ['POST', '/chat/project-1/status'],
    ['POST', '/chat?debug=1'],
    ['POST', '/runs/run-1/stream'],
    ['GET', '/runs/run-1/stream/extra'],
    ['GET', '/runs/run-1/events'],
    ['GET', '/runs/a%2Fb/stream'],
    ['GET', '/runs/run-1/stream?after_sequence=1&tail=1'],
    ['GET', '/runs/run-1/stream?after_sequence=-1'],
    ['GET', '/runs/run-1/stream#fragment'],
    ['PUT', '/chat'],
    ['DELETE', '/runs/run-1/stream'],
    ['PATCH', '/chat'],
  ])('declines a disallowed route: %s %s', async (method, routePath) => {
    await expect(
      open({
        url: `${server.origin}${routePath}`,
        method: method as BrainStreamRelayRequest['method'],
        ...(method === 'POST' ? { body: '{}' } : {}),
      })
    ).resolves.toEqual({ ok: false, reason: 'declined' });
  });

  it.each([
    ['cookie', { cookie: 'a=b' }],
    ['host', { host: 'example.com' }],
    ['transfer-encoding', { 'transfer-encoding': 'chunked' }],
    ['header injection', { authorization: 'Bearer x\r\nX-Injected: 1' }],
  ])('declines a disallowed request header: %s', async (_label, headers) => {
    await expect(open({ headers })).resolves.toEqual({
      ok: false,
      reason: 'declined',
    });
  });

  it('declines a body on GET and malformed requests', async () => {
    await expect(open({ body: 'x' })).resolves.toEqual({
      ok: false,
      reason: 'declined',
    });
    await expect(open({ streamId: 'short' })).resolves.toEqual({
      ok: false,
      reason: 'declined',
    });
    await expect(
      ipc.invoke(trustedEvent(), BRAIN_STREAM_RELAY_OPEN_CHANNEL, 'nope')
    ).resolves.toEqual({ ok: false, reason: 'declined' });
  });

  it('never contacts the server for a declined request', async () => {
    await open({ url: `${server.origin}/health` });
    await open({ method: 'PUT' as BrainStreamRelayRequest['method'] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.exchanges).toHaveLength(0);
    expect(server.openConnectionCount()).toBe(0);
  });

  it('rejects every channel for an unknown sender', async () => {
    const stranger = new FakeWebContents(99);
    const subFrame = { sender: renderer, senderFrame: { name: 'iframe' } };
    for (const event of [
      { sender: stranger, senderFrame: stranger.mainFrame },
      subFrame,
    ]) {
      await expect(
        ipc.invoke(event, BRAIN_STREAM_RELAY_TARGET_CHANNEL)
      ).rejects.toThrow('restricted to the main renderer');
      await expect(open({}, event)).rejects.toThrow(
        'restricted to the main renderer'
      );
      await expect(read('stream-000000000001', event)).rejects.toThrow(
        'restricted to the main renderer'
      );
      await expect(cancel('stream-000000000001', event)).rejects.toThrow(
        'restricted to the main renderer'
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.exchanges).toHaveLength(0);
  });

  it('scopes reads and cancellation to the sender that opened the stream', async () => {
    const other = new FakeWebContents(8);
    let trusted: FakeWebContents = renderer;
    install({ isTrustedSender: (event) => event.sender === trusted });
    const streamId = nextStreamId();
    await open({ streamId });
    trusted = other;
    const otherEvent = { sender: other, senderFrame: other.mainFrame };
    await expect(read(streamId, otherEvent)).resolves.toEqual({
      type: 'error',
      reason: 'closed',
    });
    await expect(cancel(streamId, otherEvent)).resolves.toBe(false);
    expect(relay.activeStreamCount(renderer.id)).toBe(1);
  });

  it('exposes only the managed Brain origins', async () => {
    await expect(
      ipc.invoke(trustedEvent(), BRAIN_STREAM_RELAY_TARGET_CHANNEL)
    ).resolves.toEqual({
      origins: [
        `http://localhost:${server.port}`,
        `http://127.0.0.1:${server.port}`,
      ],
    });
    // While the Brain restarts, nothing is relayed and callers retry.
    managedPort = null;
    await expect(
      ipc.invoke(trustedEvent(), BRAIN_STREAM_RELAY_TARGET_CHANNEL)
    ).resolves.toBeNull();
    await expect(open()).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.exchanges).toHaveLength(0);
  });

  it('can be disabled with EIGENT_DISABLE_STREAM_RELAY', async () => {
    expect(isBrainStreamRelayDisabled({})).toBe(false);
    expect(
      isBrainStreamRelayDisabled({ EIGENT_DISABLE_STREAM_RELAY: '1' })
    ).toBe(true);
    expect(
      isBrainStreamRelayDisabled({ EIGENT_DISABLE_STREAM_RELAY: 'TRUE' })
    ).toBe(true);
    expect(
      isBrainStreamRelayDisabled({ EIGENT_DISABLE_STREAM_RELAY: '0' })
    ).toBe(false);
    install({ enabled: false });
    await expect(
      ipc.invoke(trustedEvent(), BRAIN_STREAM_RELAY_TARGET_CHANNEL)
    ).resolves.toBeNull();
    await expect(open()).resolves.toEqual({ ok: false, reason: 'declined' });
  });

  it.each(['destroyed', 'did-navigate', 'render-process-gone'])(
    'closes every stream of a renderer on %s',
    async (teardown) => {
      const ids = [nextStreamId(), nextStreamId()];
      for (const streamId of ids) await open({ streamId });
      const exchanges = await Promise.all([
        server.exchange(0),
        server.exchange(1),
      ]);
      const pendingRead = read(ids[0]);
      if (teardown === 'destroyed') renderer.destroy();
      else renderer.emit(teardown);
      await expect(pendingRead).resolves.toEqual({
        type: 'error',
        reason: 'closed',
      });
      await Promise.all(exchanges.map((exchange) => exchange.disconnected));
      expect(server.subscriberCount()).toBe(0);
      expect(relay.activeStreamCount()).toBe(0);
      if (teardown === 'destroyed') {
        expect(renderer.listenerCount('did-navigate')).toBe(0);
      }
    }
  );

  it('closes a stream that the renderer stopped reading', async () => {
    install({ unreadTimeoutMs: 100 });
    const streamId = nextStreamId();
    await open({ streamId });
    const exchange = await server.exchange(0);
    await exchange.disconnected;
    expect(relay.activeStreamCount()).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      '[StreamRelay] Closed a stream that was no longer read'
    );
  });

  it('declines streams beyond the per-renderer limit', async () => {
    install({ maxStreamsPerSender: 2 });
    await open();
    await open();
    await expect(open()).resolves.toEqual({ ok: false, reason: 'declined' });
    expect(relay.activeStreamCount(renderer.id)).toBe(2);
  });

  it('pushes back on the Brain instead of buffering an unread stream', async () => {
    const streamId = nextStreamId();
    let written = 0;
    let stalled = false;
    server.handler = ({ response }) => {
      openEventStream({ response } as never);
      const block = `data: ${'x'.repeat(64 * 1024 - 8)}\n\n`;
      const pump = () => {
        while (written < 256 * 1024 * 1024) {
          written += block.length;
          if (!response.write(block)) {
            const timer = setTimeout(() => {
              stalled = true;
            }, 500);
            response.once('drain', () => {
              clearTimeout(timer);
              pump();
            });
            return;
          }
        }
      };
      pump();
    };
    await open({ streamId });
    await eventually(() => stalled, 15_000);
    // Node and the kernel hold a few socket buffers; nothing near the total.
    expect(written).toBeLessThan(64 * 1024 * 1024);
    const before = written;
    for (let index = 0; index < 64; index += 1) await read(streamId);
    await eventually(() => written > before, 5000);
  }, 30_000);

  it('serves more than six concurrent streams without blocking other requests', async () => {
    const ids = Array.from({ length: 10 }, nextStreamId);
    const heads = await Promise.all(ids.map((streamId) => open({ streamId })));
    expect(heads.every((head) => head.ok)).toBe(true);
    expect(server.subscriberCount()).toBe(10);
    expect(relay.activeStreamCount()).toBe(10);

    // An ordinary request to the same Brain still completes immediately.
    const started = Date.now();
    const status = await new Promise<string>((resolve, reject) => {
      http
        .get(`${server.origin}/status`, (response) => {
          let text = '';
          response.on('data', (chunk) => (text += chunk));
          response.on('end', () => resolve(text));
        })
        .on('error', reject);
    });
    expect(JSON.parse(status)).toEqual({ subscriber_count: 10 });
    expect(Date.now() - started).toBeLessThan(2000);

    // Every relayed stream is still live and readable.
    for (const [index, streamId] of ids.entries()) {
      (await server.exchange(index)).response.write(`data: ${index}\n\n`);
      expect(await readText(streamId)).toBe(`data: ${index}\n\n`);
    }
    relay.closeAll();
    await eventually(() => server.subscriberCount() === 0);
  });

  it('removes its IPC handlers on dispose', () => {
    expect([...ipc.handlers.keys()].sort()).toEqual(
      [
        BRAIN_STREAM_RELAY_CANCEL_CHANNEL,
        BRAIN_STREAM_RELAY_OPEN_CHANNEL,
        BRAIN_STREAM_RELAY_READ_CHANNEL,
        BRAIN_STREAM_RELAY_TARGET_CHANNEL,
      ].sort()
    );
    relay.dispose();
    expect(ipc.handlers.size).toBe(0);
  });

  it('never logs request details', async () => {
    await open({
      url: `${server.origin}/health`,
      headers: { authorization: 'Bearer synthetic-token' },
    });
    for (const [message] of warn.mock.calls) {
      expect(message).not.toContain('synthetic-token');
      expect(message).not.toContain('/health');
      expect(message).not.toContain(String(server.port));
    }
  });
});

describe('Brain event stream relay wiring', () => {
  it('registers the relay for the main renderer frame and the managed Brain', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'electron/main/index.ts'),
      'utf8'
    );
    expect(source).toMatch(
      /registerBrainStreamRelay\(\{[\s\S]*?getManagedBackendPort: \(\) =>\s*isPythonProcessRunning\(\) \? backendPort : null,[\s\S]*?isTrustedSender: \(event\) =>\s*isMainRendererFrame\(/u
    );
    expect(source).toMatch(
      /function isMainRendererFrame\([\s\S]*?event\.senderFrame === event\.sender\.mainFrame/u
    );
    const preload = fs.readFileSync(
      path.resolve(process.cwd(), 'electron/preload/index.ts'),
      'utf8'
    );
    for (const method of [
      'brainStreamRelayTarget',
      'brainStreamRelayOpen',
      'brainStreamRelayRead',
      'brainStreamRelayCancel',
    ]) {
      expect(preload).toContain(`${method}:`);
    }
  });
});
