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

import http from 'node:http';
import {
  BRAIN_STREAM_RELAY_CANCEL_CHANNEL,
  BRAIN_STREAM_RELAY_DISABLE_ENV,
  BRAIN_STREAM_RELAY_OPEN_CHANNEL,
  BRAIN_STREAM_RELAY_READ_CHANNEL,
  BRAIN_STREAM_RELAY_TARGET_CHANNEL,
  brainStreamRelayOrigins,
  validateBrainStreamRelayRequest,
  type BrainStreamRelayOpenResult,
  type BrainStreamRelayReadResult,
  type BrainStreamRelayRequest,
  type BrainStreamRelayTarget,
} from '../../src/shared/brainStreamRelay';

/**
 * Relays Brain event streams (see src/shared/brainStreamRelay.ts) from the
 * main process. Main reads ahead into a bounded buffer per stream, like the
 * browser's own network buffer, and the renderer pulls everything buffered
 * with each read. When the buffer is full, main stops reading the socket and
 * TCP pushes back on the Brain.
 */

const DEFAULT_UNREAD_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_STREAMS_PER_SENDER = 64;
const DEFAULT_READ_AHEAD_BYTES = 1024 * 1024;
const MAX_REMEMBERED_CANCELLATIONS = 128;
// Browsers never expose these to page scripts.
const HIDDEN_RESPONSE_HEADERS = new Set(['set-cookie', 'set-cookie2']);
const SENDER_TEARDOWN_EVENTS = ['did-navigate', 'render-process-gone'] as const;

/** The parts of a WebContents the relay uses. */
export interface BrainStreamRelaySender {
  readonly id: number;
  isDestroyed(): boolean;
  on(event: string, listener: (...args: any[]) => void): unknown;
  removeListener(event: string, listener: (...args: any[]) => void): unknown;
}

export interface BrainStreamRelayEvent {
  sender: BrainStreamRelaySender;
  senderFrame?: unknown;
}

interface IpcMainHandlers {
  handle(
    channel: string,
    listener: (event: any, ...args: any[]) => unknown
  ): void;
  removeHandler(channel: string): void;
}

export interface BrainStreamRelayOptions {
  ipcMain: IpcMainHandlers;
  /** Port of the Brain process this app started and still runs, or null. */
  getManagedBackendPort: () => number | null;
  /** Whether the IPC event comes from the main renderer's top-level frame. */
  isTrustedSender: (event: BrainStreamRelayEvent) => boolean;
  enabled?: boolean;
  /** Close a stream when its renderer has not asked for data for this long. */
  unreadTimeoutMs?: number;
  maxStreamsPerSender?: number;
  /** Bytes buffered per stream before main stops reading its socket. */
  readAheadBytes?: number;
  /** Address the Brain listens on. uvicorn binds 127.0.0.1 by default. */
  connectHost?: string;
  /** Receives short diagnostics only: never URLs, headers or bodies. */
  log?: { warn: (message: string) => void };
}

export interface BrainStreamRelay {
  activeStreamCount(senderId?: number): number;
  closeSender(senderId: number): void;
  closeAll(): void;
  dispose(): void;
}

interface RelayStream {
  readonly key: string;
  readonly sender: BrainStreamRelaySender;
  readonly request: http.ClientRequest;
  response: http.IncomingMessage | null;
  /** Body bytes received but not yet read by the renderer. */
  buffered: Buffer[];
  bufferedBytes: number;
  /** The upstream body ended normally, or failed. */
  upstream: 'open' | 'ended' | 'failed';
  settleOpen: ((result: BrainStreamRelayOpenResult) => void) | null;
  settleRead: ((result: BrainStreamRelayReadResult) => void) | null;
  unreadTimer: ReturnType<typeof setTimeout> | null;
  closed: boolean;
}

const DECLINED: BrainStreamRelayOpenResult = { ok: false, reason: 'declined' };
const UNAVAILABLE: BrainStreamRelayOpenResult = {
  ok: false,
  reason: 'unavailable',
};

export function isBrainStreamRelayDisabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  const value = env[BRAIN_STREAM_RELAY_DISABLE_ENV]?.trim().toLowerCase();
  return value === '1' || value === 'true';
}

function responseHeaderPairs(rawHeaders: string[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    if (HIDDEN_RESPONSE_HEADERS.has(name.toLowerCase())) continue;
    pairs.push([name, rawHeaders[index + 1]]);
  }
  return pairs;
}

/**
 * Socket chunks can be views into a larger pooled buffer, and IPC serializes
 * a view's whole backing store. Copy into an exact-size array so only this
 * stream's bytes leave main.
 */
function takeBuffered(stream: RelayStream): Uint8Array {
  const bytes = new Uint8Array(stream.bufferedBytes);
  let offset = 0;
  for (const chunk of stream.buffered) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  stream.buffered = [];
  stream.bufferedBytes = 0;
  return bytes;
}

export function registerBrainStreamRelay(
  options: BrainStreamRelayOptions
): BrainStreamRelay {
  const { ipcMain, getManagedBackendPort, isTrustedSender, log } = options;
  const enabled = options.enabled ?? true;
  const unreadTimeoutMs = options.unreadTimeoutMs ?? DEFAULT_UNREAD_TIMEOUT_MS;
  const maxStreamsPerSender =
    options.maxStreamsPerSender ?? DEFAULT_MAX_STREAMS_PER_SENDER;
  const readAheadBytes = options.readAheadBytes ?? DEFAULT_READ_AHEAD_BYTES;
  const connectHost = options.connectHost ?? '127.0.0.1';
  // One socket per stream that closes with it, so closing a stream always
  // disconnects its Brain subscriber. This agent has no per-host limit.
  const agent = new http.Agent({ keepAlive: false });
  const streams = new Map<string, RelayStream>();
  const watchedSenders = new Map<number, () => void>();
  const cancelledBeforeOpen = new Set<string>();

  const streamKey = (senderId: number, streamId: string) =>
    `${senderId}:${streamId}`;

  function assertTrustedSender(event: BrainStreamRelayEvent): void {
    if (!isTrustedSender(event)) {
      throw new Error('Stream relay is restricted to the main renderer');
    }
  }

  function allowedOrigins(): string[] {
    if (!enabled) return [];
    const port = getManagedBackendPort();
    return port === null ? [] : brainStreamRelayOrigins(port);
  }

  function clearUnreadTimer(stream: RelayStream): void {
    if (stream.unreadTimer) clearTimeout(stream.unreadTimer);
    stream.unreadTimer = null;
  }

  function armUnreadTimer(stream: RelayStream): void {
    clearUnreadTimer(stream);
    stream.unreadTimer = setTimeout(() => {
      log?.warn('[StreamRelay] Closed a stream that was no longer read');
      closeStream(stream, 'closed');
    }, unreadTimeoutMs);
    stream.unreadTimer.unref?.();
  }

  /** Abandon the upstream request; the Brain sees the socket close. */
  function closeStream(stream: RelayStream, reason: 'network' | 'closed') {
    if (stream.closed) return;
    stream.closed = true;
    streams.delete(stream.key);
    clearUnreadTimer(stream);
    const settleOpen = stream.settleOpen;
    const settleRead = stream.settleRead;
    stream.settleOpen = null;
    stream.settleRead = null;
    stream.buffered = [];
    stream.bufferedBytes = 0;
    settleOpen?.({ ok: false, reason });
    settleRead?.({ type: 'error', reason });
    stream.request.destroy();
    stream.response?.destroy();
  }

  /** The upstream body ended normally; its socket is already closing. */
  function finishStream(stream: RelayStream): void {
    stream.closed = true;
    streams.delete(stream.key);
    clearUnreadTimer(stream);
  }

  /**
   * Answer a pending renderer read: buffered bytes first, in order, then the
   * end of the body or its failure.
   */
  function deliver(stream: RelayStream): void {
    const settleRead = stream.settleRead;
    if (stream.closed || !settleRead) return;
    if (stream.bufferedBytes > 0) {
      stream.settleRead = null;
      settleRead({ type: 'data', chunk: takeBuffered(stream) });
      if (stream.upstream === 'open') stream.response?.resume();
      armUnreadTimer(stream);
      return;
    }
    if (stream.upstream === 'ended') {
      stream.settleRead = null;
      finishStream(stream);
      settleRead({ type: 'end' });
      return;
    }
    if (stream.upstream === 'failed') closeStream(stream, 'network');
  }

  /** The body failed after its head; bytes already received still go first. */
  function failUpstream(stream: RelayStream): void {
    if (stream.upstream !== 'open') return;
    stream.upstream = 'failed';
    deliver(stream);
  }

  function closeSender(senderId: number): void {
    for (const stream of [...streams.values()]) {
      if (stream.sender.id === senderId) closeStream(stream, 'closed');
    }
  }

  function unwatchSender(senderId: number): void {
    watchedSenders.get(senderId)?.();
    watchedSenders.delete(senderId);
  }

  /** Close a renderer's streams when its document goes away. */
  function watchSender(sender: BrainStreamRelaySender): void {
    if (watchedSenders.has(sender.id)) return;
    const closeAllForSender = () => closeSender(sender.id);
    const onDestroyed = () => {
      closeAllForSender();
      unwatchSender(sender.id);
    };
    for (const event of SENDER_TEARDOWN_EVENTS) {
      sender.on(event, closeAllForSender);
    }
    sender.on('destroyed', onDestroyed);
    watchedSenders.set(sender.id, () => {
      for (const event of SENDER_TEARDOWN_EVENTS) {
        sender.removeListener(event, closeAllForSender);
      }
      sender.removeListener('destroyed', onDestroyed);
    });
  }

  function countFor(senderId: number): number {
    let count = 0;
    for (const stream of streams.values()) {
      if (stream.sender.id === senderId) count += 1;
    }
    return count;
  }

  function rememberCancellation(key: string): void {
    cancelledBeforeOpen.add(key);
    if (cancelledBeforeOpen.size > MAX_REMEMBERED_CANCELLATIONS) {
      const oldest = cancelledBeforeOpen.values().next().value;
      if (oldest !== undefined) cancelledBeforeOpen.delete(oldest);
    }
  }

  function startStream(
    sender: BrainStreamRelaySender,
    key: string,
    request: BrainStreamRelayRequest,
    url: URL
  ): Promise<BrainStreamRelayOpenResult> {
    const body =
      request.body === undefined
        ? undefined
        : Buffer.from(request.body, 'utf8');
    const headers: http.OutgoingHttpHeaders = {
      ...request.headers,
      host: url.host,
      // Node does not decode bodies; ask for the bytes as they are.
      'accept-encoding': 'identity',
    };
    if (request.method === 'POST') {
      headers['content-length'] = body?.byteLength ?? 0;
    }

    let upstream: http.ClientRequest;
    try {
      upstream = http.request({
        host: connectHost,
        port: Number(url.port),
        method: request.method,
        path: `${url.pathname}${url.search}`,
        headers,
        agent,
      });
    } catch {
      return Promise.resolve(DECLINED);
    }

    return new Promise((resolve) => {
      const stream: RelayStream = {
        key,
        sender,
        request: upstream,
        response: null,
        buffered: [],
        bufferedBytes: 0,
        upstream: 'open',
        settleOpen: resolve,
        settleRead: null,
        unreadTimer: null,
        closed: false,
      };
      streams.set(key, stream);

      upstream.on('response', (response) => {
        const fail = () => failUpstream(stream);
        response.on('error', fail);
        if (stream.closed) {
          response.destroy();
          return;
        }
        stream.response = response;
        response.on('data', (chunk: Buffer) => {
          if (stream.closed) return;
          stream.buffered.push(chunk);
          stream.bufferedBytes += chunk.byteLength;
          if (stream.bufferedBytes >= readAheadBytes) response.pause();
          deliver(stream);
        });
        response.on('end', () => {
          if (stream.upstream !== 'open') return;
          stream.upstream = 'ended';
          deliver(stream);
        });
        // A body cut short (socket closed before its end) is a failure.
        response.on('close', fail);
        const settleOpen = stream.settleOpen;
        stream.settleOpen = null;
        settleOpen?.({
          ok: true,
          status: response.statusCode ?? 0,
          statusText: response.statusMessage ?? '',
          headers: responseHeaderPairs(response.rawHeaders),
        });
        armUnreadTimer(stream);
      });
      upstream.on('error', () => {
        if (stream.response) failUpstream(stream);
        else closeStream(stream, 'network');
      });
      upstream.end(body);
    });
  }

  async function open(
    event: BrainStreamRelayEvent,
    value: unknown
  ): Promise<BrainStreamRelayOpenResult> {
    assertTrustedSender(event);
    if (!enabled) return DECLINED;
    const port = getManagedBackendPort();
    // No Brain is running (it may be restarting): like a refused connection.
    if (port === null) return UNAVAILABLE;
    const sender = event.sender;
    const validation = validateBrainStreamRelayRequest(
      value,
      brainStreamRelayOrigins(port)
    );
    if (!validation.ok) {
      log?.warn(`[StreamRelay] Declined a stream: ${validation.reason}`);
      return DECLINED;
    }
    const { request, url } = validation;
    const key = streamKey(sender.id, request.streamId);
    if (cancelledBeforeOpen.delete(key)) {
      return { ok: false, reason: 'closed' };
    }
    if (streams.has(key) || sender.isDestroyed()) return DECLINED;
    if (countFor(sender.id) >= maxStreamsPerSender) {
      log?.warn('[StreamRelay] Declined a stream: too many open streams');
      return DECLINED;
    }
    watchSender(sender);
    return startStream(sender, key, request, url);
  }

  async function read(
    event: BrainStreamRelayEvent,
    streamId: unknown
  ): Promise<BrainStreamRelayReadResult> {
    assertTrustedSender(event);
    const stream =
      typeof streamId === 'string'
        ? streams.get(streamKey(event.sender.id, streamId))
        : undefined;
    // Reads are strictly sequential: the renderer asks again only after the
    // previous chunk arrived.
    if (!stream?.response || stream.settleRead) {
      return { type: 'error', reason: 'closed' };
    }
    clearUnreadTimer(stream);
    return new Promise((resolve) => {
      stream.settleRead = resolve;
      deliver(stream);
    });
  }

  function cancel(event: BrainStreamRelayEvent, streamId: unknown): boolean {
    assertTrustedSender(event);
    if (typeof streamId !== 'string') return false;
    const key = streamKey(event.sender.id, streamId);
    const stream = streams.get(key);
    if (!stream) {
      // Cancellation may overtake an open that has not been handled yet.
      rememberCancellation(key);
      return false;
    }
    closeStream(stream, 'closed');
    return true;
  }

  function target(event: BrainStreamRelayEvent): BrainStreamRelayTarget | null {
    assertTrustedSender(event);
    const origins = allowedOrigins();
    return origins.length > 0 ? { origins } : null;
  }

  ipcMain.handle(BRAIN_STREAM_RELAY_TARGET_CHANNEL, target);
  ipcMain.handle(BRAIN_STREAM_RELAY_OPEN_CHANNEL, open);
  ipcMain.handle(BRAIN_STREAM_RELAY_READ_CHANNEL, read);
  ipcMain.handle(BRAIN_STREAM_RELAY_CANCEL_CHANNEL, cancel);

  function closeAll(): void {
    for (const stream of [...streams.values()]) closeStream(stream, 'closed');
  }

  return {
    activeStreamCount(senderId?: number): number {
      return senderId === undefined ? streams.size : countFor(senderId);
    },
    closeSender,
    closeAll,
    dispose(): void {
      for (const channel of [
        BRAIN_STREAM_RELAY_TARGET_CHANNEL,
        BRAIN_STREAM_RELAY_OPEN_CHANNEL,
        BRAIN_STREAM_RELAY_READ_CHANNEL,
        BRAIN_STREAM_RELAY_CANCEL_CHANNEL,
      ]) {
        ipcMain.removeHandler(channel);
      }
      closeAll();
      for (const senderId of [...watchedSenders.keys()]) {
        unwatchSender(senderId);
      }
      cancelledBeforeOpen.clear();
      agent.destroy();
    },
  };
}
