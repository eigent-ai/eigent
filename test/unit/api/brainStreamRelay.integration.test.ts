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
  BRAIN_STREAM_RELAY_CANCEL_CHANNEL,
  BRAIN_STREAM_RELAY_OPEN_CHANNEL,
  BRAIN_STREAM_RELAY_READ_CHANNEL,
  BRAIN_STREAM_RELAY_TARGET_CHANNEL,
} from '@/shared/brainStreamRelay';
import {
  resetConnectionConfig,
  setConnectionConfig,
} from '@/store/connectionStore';
import { EventStreamContentType } from '@microsoft/fetch-event-source';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  registerBrainStreamRelay,
  type BrainStreamRelay,
} from '../../../electron/main/brainStreamRelay';
import {
  eventually,
  startBrainEventStreamServer,
  type BrainEventStreamServer,
} from '../../fixtures/brainEventStreamServer';

/**
 * The whole relay in one process: sseTransport and fetch-event-source in the
 * renderer, the real main-process relay behind a structured-clone IPC, and
 * an HTTP server standing in for the Brain.
 */

const mocks = vi.hoisted(() => ({
  auth: { token: 'synthetic-a', user_id: 1 },
  host: { electronAPI: null as unknown, ipcRenderer: null },
}));
vi.mock('@/store/authStore', () => ({ getAuthStore: () => mocks.auth }));
vi.mock('@/host/createHost', () => ({ createHost: () => mocks.host }));

class InProcessIpcMain {
  readonly handlers = new Map<string, (event: any, ...args: any[]) => any>();
  handle(channel: string, listener: (event: any, ...args: any[]) => any) {
    this.handlers.set(channel, listener);
  }
  removeHandler(channel: string) {
    this.handlers.delete(channel);
  }
}

class MainRenderer extends EventEmitter {
  readonly id = 1;
  readonly mainFrame = {};
  isDestroyed() {
    return false;
  }
}

describe('Brain event stream relay end to end', () => {
  let server: BrainEventStreamServer;
  let relay: BrainStreamRelay;
  let renderer: MainRenderer;
  let windowFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    server = await startBrainEventStreamServer();
    const ipcMain = new InProcessIpcMain();
    renderer = new MainRenderer();
    relay = registerBrainStreamRelay({
      ipcMain,
      getManagedBackendPort: () => server.port,
      isTrustedSender: (event) =>
        event.sender === renderer && event.senderFrame === renderer.mainFrame,
    });
    const event = { sender: renderer, senderFrame: renderer.mainFrame };
    // Electron copies IPC arguments and results with structured clone.
    const invoke = async (channel: string, ...args: unknown[]) => {
      const handler = ipcMain.handlers.get(channel)!;
      return structuredClone(await handler(event, ...structuredClone(args)));
    };
    mocks.host = {
      electronAPI: {
        getLocalControlCapability: async () => 'synthetic-capability',
        brainStreamRelayTarget: () => invoke(BRAIN_STREAM_RELAY_TARGET_CHANNEL),
        brainStreamRelayOpen: (request: unknown) =>
          invoke(BRAIN_STREAM_RELAY_OPEN_CHANNEL, request),
        brainStreamRelayRead: (streamId: string) =>
          invoke(BRAIN_STREAM_RELAY_READ_CHANNEL, streamId),
        brainStreamRelayCancel: (streamId: string) =>
          invoke(BRAIN_STREAM_RELAY_CANCEL_CHANNEL, streamId),
      },
      ipcRenderer: null,
    };
    resetConnectionConfig();
    setConnectionConfig({ brainEndpoint: server.origin, channel: 'desktop' });
    const realFetch = globalThis.fetch;
    windowFetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      realFetch(input, init)
    );
    vi.stubGlobal('fetch', windowFetch);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    relay.dispose();
    await server.close();
  });

  const subscriberCountFromBrain = async () => {
    const response = await fetch(`${server.origin}/status`);
    return ((await response.json()) as { subscriber_count: number })
      .subscriber_count;
  };

  it('delivers events in order and detaches the subscriber on abort', async () => {
    const controller = new AbortController();
    const received: string[] = [];
    const done = sseTransport({
      url: '/runs/run-1/stream?after_sequence=0',
      method: 'GET',
      signal: controller.signal,
      onmessage: (event) => {
        received.push(event.data);
      },
    });
    const exchange = await server.exchange(0);
    expect(exchange.request.headers).toMatchObject({
      accept: EventStreamContentType,
      authorization: 'Bearer synthetic-a',
      'x-eigent-local-capability': 'synthetic-capability',
    });
    for (const [index, data] of ['plan', 'tool', 'approval'].entries()) {
      exchange.response.write(`id: ${index}\ndata: ${data}\n\n`);
    }
    await eventually(() => received.length === 3);
    expect(received).toEqual(['plan', 'tool', 'approval']);
    await expect(subscriberCountFromBrain()).resolves.toBe(1);

    controller.abort();
    await expect(done).resolves.toBeUndefined();
    await exchange.disconnected;
    await expect(subscriberCountFromBrain()).resolves.toBe(0);
    expect(relay.activeStreamCount()).toBe(0);
    // Only the status checks above went through the renderer's own fetch.
    expect(windowFetch).toHaveBeenCalledTimes(2);
  });

  it('closes cleanly when the Brain ends the stream', async () => {
    const onclose = vi.fn();
    const received: string[] = [];
    const done = sseTransport({
      url: '/chat',
      body: { question: 'hello' },
      onmessage: (event) => {
        received.push(event.data);
      },
      onclose,
    });
    const exchange = await server.exchange(0);
    expect(exchange.request).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ question: 'hello' }),
    });
    exchange.response.end('data: done\n\n');
    await done;
    expect(received).toEqual(['done']);
    expect(onclose).toHaveBeenCalledOnce();
    expect(relay.activeStreamCount()).toBe(0);
    expect(windowFetch).not.toHaveBeenCalled();
  });

  it('surfaces a typed admission rejection with its original body', async () => {
    const detail = JSON.stringify({
      detail: {
        code: 'workspace_model_selection_changed',
        message: 'Choose a model again.',
      },
    });
    server.handler = ({ response }) => {
      response.writeHead(409, 'Conflict', {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(detail),
      });
      response.end(detail);
    };
    const statuses: number[] = [];
    await expect(
      sseTransport({
        url: '/chat',
        body: {},
        onmessage: vi.fn(),
        async onopen(response) {
          statuses.push(response.status);
          if (!response.ok) {
            throw await createSSEAdmissionError(response, {});
          }
        },
        onerror(error) {
          throw error;
        },
      })
    ).rejects.toMatchObject({
      status: 409,
      code: 'workspace_model_selection_changed',
      response: expect.objectContaining({ body: detail }),
    });
    expect(statuses).toEqual([409]);
  });

  it('reconnects through the relay with Last-Event-ID after a drop', async () => {
    const errors: unknown[] = [];
    const received: string[] = [];
    const done = sseTransport({
      url: '/runs/run-1/stream?after_sequence=0',
      method: 'GET',
      onmessage: (event) => {
        received.push(event.data);
      },
      onerror: (error) => {
        errors.push(error);
        return 0;
      },
    });
    const first = await server.exchange(0);
    first.response.write('id: 41\ndata: before\n\n');
    await eventually(() => received.length === 1);
    first.socket.destroy();
    const second = await server.exchange(1);
    expect(second.request.headers['last-event-id']).toBe('41');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(TypeError);
    second.response.end('id: 42\ndata: after\n\n');
    await done;
    expect(received).toEqual(['before', 'after']);
    expect(windowFetch).not.toHaveBeenCalled();
  });

  it('keeps eight running streams off the renderer connection pool', async () => {
    const controllers = Array.from({ length: 8 }, () => new AbortController());
    const streams = controllers.map((controller, index) =>
      sseTransport({
        url: `/runs/run-${index}/stream?after_sequence=0`,
        method: 'GET',
        signal: controller.signal,
        onmessage: vi.fn(),
      })
    );
    await eventually(() => server.subscriberCount() === 8);
    const started = Date.now();
    await expect(subscriberCountFromBrain()).resolves.toBe(8);
    expect(Date.now() - started).toBeLessThan(2000);
    // The only request that used the renderer's fetch is the status check.
    expect(windowFetch).toHaveBeenCalledOnce();
    expect(relay.activeStreamCount()).toBe(8);

    controllers.forEach((controller) => controller.abort());
    await Promise.all(streams);
    await eventually(() => server.subscriberCount() === 0);
    expect(relay.activeStreamCount()).toBe(0);
  });

  it('closes relayed streams when the renderer document goes away', async () => {
    void sseTransport({
      url: '/runs/run-1/stream?after_sequence=0',
      method: 'GET',
      onmessage: vi.fn(),
      onerror: () => {
        throw new Error('stop');
      },
    }).catch(() => undefined);
    const exchange = await server.exchange(0);
    renderer.emit('did-navigate');
    await exchange.disconnected;
    expect(server.subscriberCount()).toBe(0);
  });
});
