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

import { createHost } from '@/host/createHost';
import {
  isBrainStreamRelayRoute,
  validateBrainStreamRelayRequest,
  type BrainStreamRelayOpenResult,
  type BrainStreamRelayReadResult,
  type BrainStreamRelayRequest,
  type BrainStreamRelayTarget,
} from '@/shared/brainStreamRelay';

/**
 * Renderer half of the Brain event stream relay (src/shared/brainStreamRelay.ts).
 * It produces a `fetch`-compatible function whose Response is assembled from
 * what the main process relays, so fetch-event-source and every caller see
 * the same status, headers, body, abort and error behavior as `window.fetch`.
 */

export type StreamFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export interface BrainStreamRelayBridge {
  brainStreamRelayTarget(): Promise<BrainStreamRelayTarget | null>;
  brainStreamRelayOpen(
    request: BrainStreamRelayRequest
  ): Promise<BrainStreamRelayOpenResult>;
  brainStreamRelayRead(streamId: string): Promise<BrainStreamRelayReadResult>;
  brainStreamRelayCancel(streamId: string): Promise<boolean>;
}

// Statuses whose Response must not carry a body.
const NULL_BODY_STATUSES = new Set([204, 205, 304]);
const REASON_PHRASE = /^[\t\x20-\x7e\x80-\xff]*$/;
const LANGUAGE_TAG = /^[A-Za-z0-9-]{1,35}$/;

// Responses assembled from relayed streams, which hold none of the renderer's
// per-host connections.
const relayedResponses = new WeakSet<Response>();

/** Whether a Response was delivered by the main-process relay. */
export function isRelayedEventStreamResponse(response: Response): boolean {
  return relayedResponses.has(response);
}

export function getBrainStreamRelayBridge(): BrainStreamRelayBridge | null {
  const api = createHost().electronAPI;
  if (
    !api ||
    typeof api.brainStreamRelayTarget !== 'function' ||
    typeof api.brainStreamRelayOpen !== 'function' ||
    typeof api.brainStreamRelayRead !== 'function' ||
    typeof api.brainStreamRelayCancel !== 'function'
  ) {
    return null;
  }
  return api as BrainStreamRelayBridge;
}

function isRelayRoute(url: string, method: string): boolean {
  try {
    return isBrainStreamRelayRoute(method.toUpperCase(), new URL(url));
  } catch {
    return false;
  }
}

/**
 * Choose the fetch for one event stream. In Electron, Brain event streams go
 * through the main process so they never occupy the renderer's six
 * connections per host. Other requests, other origins (such as a configured
 * remote endpoint) and non-Electron builds use `fallback` unchanged.
 */
export async function resolveEventStreamFetch(
  url: string,
  method: string,
  fallback: StreamFetch
): Promise<StreamFetch> {
  const bridge = getBrainStreamRelayBridge();
  if (!bridge || !isRelayRoute(url, method)) return fallback;
  let target: BrainStreamRelayTarget | null;
  try {
    target = await bridge.brainStreamRelayTarget();
  } catch {
    return fallback;
  }
  const origins = Array.isArray(target?.origins)
    ? target.origins.filter(
        (origin): origin is string => typeof origin === 'string'
      )
    : [];
  if (origins.length === 0) return fallback;
  return createBrainStreamRelayFetch(bridge, origins, fallback);
}

/**
 * A fetch that relays requests the main process accepts and hands everything
 * else to `fallback` before anything is sent to main.
 */
export function createBrainStreamRelayFetch(
  bridge: BrainStreamRelayBridge,
  origins: readonly string[],
  fallback: StreamFetch
): StreamFetch {
  return (input, init) => {
    const request = toRelayRequest(input, init, origins);
    if (!request) return fallback(input, init);
    return relayFetch(bridge, request, init?.signal ?? null, () =>
      fallback(input, init)
    );
  };
}

function createStreamId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  );
}

/** The Accept-Language value Chromium would have added to the request. */
function navigatorAcceptLanguage(): string | null {
  const languages =
    typeof navigator === 'undefined' ? [] : (navigator.languages ?? []);
  const tags = languages
    .filter((tag) => typeof tag === 'string' && LANGUAGE_TAG.test(tag))
    .slice(0, 10);
  if (tags.length === 0) return null;
  return tags
    .map((tag, index) =>
      index === 0
        ? tag
        : `${tag};q=${Math.max(0.1, 1 - index * 0.1).toFixed(1)}`
    )
    .join(',');
}

function toRelayRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  origins: readonly string[]
): BrainStreamRelayRequest | null {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : null;
  const body = init?.body ?? undefined;
  if (url === null || (body !== undefined && typeof body !== 'string')) {
    return null;
  }
  const headers: Record<string, string> = {};
  try {
    new Headers(init?.headers).forEach((value, name) => {
      headers[name] = value;
    });
  } catch {
    return null;
  }
  if (headers['accept-language'] === undefined) {
    const acceptLanguage = navigatorAcceptLanguage();
    if (acceptLanguage) headers['accept-language'] = acceptLanguage;
  }
  const validation = validateBrainStreamRelayRequest(
    {
      streamId: createStreamId(),
      url,
      method: (init?.method ?? 'GET').toUpperCase(),
      headers,
      body,
    },
    origins
  );
  return validation.ok ? validation.request : null;
}

/** Chunks cross the context bridge, so do not rely on realm identity. */
function isUint8Array(value: unknown): value is Uint8Array {
  return (
    ArrayBuffer.isView(value) &&
    Object.prototype.toString.call(value) === '[object Uint8Array]'
  );
}

function abortReason(signal: AbortSignal): unknown {
  return (
    signal.reason ??
    new DOMException('The operation was aborted.', 'AbortError')
  );
}

const IPC_FAILED = Symbol('ipc-failed');

/** Resolve with the relayed head, or reject with the abort reason. */
function waitForHead(
  opening: Promise<BrainStreamRelayOpenResult>,
  signal: AbortSignal | null,
  cancel: () => void
): Promise<BrainStreamRelayOpenResult | typeof IPC_FAILED> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cancel();
      reject(abortReason(signal as AbortSignal));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    opening.then(
      (result) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(result);
      },
      () => {
        signal?.removeEventListener('abort', onAbort);
        resolve(IPC_FAILED);
      }
    );
  });
}

async function relayFetch(
  bridge: BrainStreamRelayBridge,
  request: BrainStreamRelayRequest,
  signal: AbortSignal | null,
  fallback: () => Promise<Response>
): Promise<Response> {
  if (signal?.aborted) throw abortReason(signal);
  const cancel = () => {
    bridge.brainStreamRelayCancel(request.streamId).catch(() => undefined);
  };
  let opening: Promise<BrainStreamRelayOpenResult>;
  try {
    // Sent synchronously, right after the caller's delivery guard ran.
    opening = bridge.brainStreamRelayOpen(request);
  } catch {
    return fallback();
  }
  const head = await waitForHead(opening, signal, cancel);
  // Main rejects an IPC call, or declines a request, before it sends
  // anything upstream (for example when too many streams are open), so
  // `window.fetch` can still deliver it.
  if (head === IPC_FAILED) return fallback();
  if (!head.ok) {
    if (head.reason === 'declined') return fallback();
    // Includes `unavailable`: no Brain runs right now, so callers retry.
    throw new TypeError('Failed to fetch');
  }
  if (signal?.aborted) {
    cancel();
    throw abortReason(signal);
  }
  return buildRelayResponse(bridge, request, head, signal, cancel);
}

function buildRelayResponse(
  bridge: BrainStreamRelayBridge,
  request: BrainStreamRelayRequest,
  head: Extract<BrainStreamRelayOpenResult, { ok: true }>,
  signal: AbortSignal | null,
  cancel: () => void
): Response {
  const { status } = head;
  if (!Number.isInteger(status) || status < 200 || status > 599) {
    cancel();
    throw new TypeError('Failed to fetch');
  }
  const headers = new Headers();
  for (const pair of Array.isArray(head.headers) ? head.headers : []) {
    try {
      headers.append(pair[0], pair[1]);
    } catch {
      // Same as the network stack: an unrepresentable header is dropped.
    }
  }
  let body: ReadableStream<Uint8Array> | null = null;
  if (NULL_BODY_STATUSES.has(status)) {
    cancel();
  } else {
    body = createRelayBody(bridge, request.streamId, signal, cancel);
  }
  const response = new Response(body, {
    status,
    statusText: REASON_PHRASE.test(head.statusText) ? head.statusText : '',
    headers,
  });
  Object.defineProperty(response, 'url', {
    value: request.url,
    enumerable: true,
  });
  relayedResponses.add(response);
  return response;
}

/**
 * A pull-based body: every read asks main for the next chunk, so nothing is
 * buffered beyond what the reader consumes.
 */
function createRelayBody(
  bridge: BrainStreamRelayBridge,
  streamId: string,
  signal: AbortSignal | null,
  cancel: () => void
): ReadableStream<Uint8Array> {
  let finished = false;
  let bodyController: ReadableStreamDefaultController<Uint8Array> | null = null;

  function finish(): void {
    finished = true;
    signal?.removeEventListener('abort', onAbort);
  }

  function onAbort(): void {
    if (finished) return;
    finish();
    cancel();
    bodyController?.error(abortReason(signal as AbortSignal));
  }

  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        bodyController = controller;
        signal?.addEventListener('abort', onAbort);
      },
      async pull(controller) {
        let next: BrainStreamRelayReadResult;
        try {
          next = await bridge.brainStreamRelayRead(streamId);
        } catch {
          next = { type: 'error', reason: 'network' };
        }
        if (finished) return;
        if (next.type === 'data' && isUint8Array(next.chunk)) {
          controller.enqueue(next.chunk);
          return;
        }
        finish();
        if (next.type === 'end') {
          controller.close();
          return;
        }
        // A dropped connection reads like one in Chromium's own fetch.
        cancel();
        controller.error(new TypeError('network error'));
      },
      cancel() {
        if (finished) return;
        finish();
        cancel();
      },
    },
    { highWaterMark: 0 }
  );
}
