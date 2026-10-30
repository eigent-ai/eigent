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

/**
 * Contract for relaying long-lived Brain event streams through the Electron
 * main process.
 *
 * Chromium allows six concurrent HTTP/1.1 connections per host. Every running
 * Run keeps event streams open, so a few parallel Runs can occupy the whole
 * renderer pool and stall every other Brain request. The main process issues
 * these streams with Node instead, which has no per-host limit.
 *
 * The relay is deliberately narrow: it only forwards the event stream routes
 * that `sseTransport` opens, only to the Brain origin that the main process
 * started itself. The renderer checks the same rules before it sends anything
 * to main, and main checks them again.
 */

export const BRAIN_STREAM_RELAY_TARGET_CHANNEL =
  'brain-stream-relay:target' as const;
export const BRAIN_STREAM_RELAY_OPEN_CHANNEL =
  'brain-stream-relay:open' as const;
export const BRAIN_STREAM_RELAY_READ_CHANNEL =
  'brain-stream-relay:read' as const;
export const BRAIN_STREAM_RELAY_CANCEL_CHANNEL =
  'brain-stream-relay:cancel' as const;

/** Set to `1` or `true` to send event streams through `window.fetch` again. */
export const BRAIN_STREAM_RELAY_DISABLE_ENV = 'EIGENT_DISABLE_STREAM_RELAY';

export type BrainStreamRelayMethod = 'GET' | 'POST';

/** Origins that may be relayed; `null` means the relay is not available. */
export interface BrainStreamRelayTarget {
  origins: string[];
}

export interface BrainStreamRelayRequest {
  /** Renderer-chosen id, so the request can be cancelled before headers. */
  streamId: string;
  url: string;
  method: BrainStreamRelayMethod;
  /** Lower-case header names. */
  headers: Record<string, string>;
  body?: string;
}

/**
 * Failures:
 * - `declined`: main sent nothing upstream; the renderer may use its own fetch.
 * - `unavailable`: no Brain is running right now (for example while it
 *   restarts); this reads like a refused connection, so callers retry.
 * - `network` / `closed`: the request failed or was closed after it was sent.
 */
export type BrainStreamRelayOpenResult =
  | {
      ok: true;
      status: number;
      statusText: string;
      /** Raw header pairs in upstream order, without `set-cookie`. */
      headers: Array<[string, string]>;
    }
  | { ok: false; reason: 'declined' | 'unavailable' | 'network' | 'closed' };

export type BrainStreamRelayReadResult =
  | { type: 'data'; chunk: Uint8Array }
  | { type: 'end' }
  | { type: 'error'; reason: 'network' | 'closed' };

export const BRAIN_STREAM_RELAY_LIMITS = {
  maxUrlLength: 4096,
  maxRunIdSegmentLength: 256,
  maxHeaderCount: 32,
  maxHeaderValueLength: 8192,
  /** UTF-16 code units; at most 12 MiB once encoded as UTF-8. */
  maxBodyLength: 4 * 1024 * 1024,
} as const;

/** Request headers that `sseTransport` and fetch-event-source produce. */
export const BRAIN_STREAM_RELAY_REQUEST_HEADERS: ReadonlySet<string> = new Set([
  'accept',
  'accept-language',
  'authorization',
  'content-type',
  'last-event-id',
  'x-channel',
  'x-eigent-local-capability',
  'x-session-id',
  'x-user-id',
]);

export type BrainStreamRelayRejection =
  | 'shape'
  | 'stream-id'
  | 'url'
  | 'origin'
  | 'method'
  | 'route'
  | 'headers'
  | 'body';

export type BrainStreamRelayValidation =
  | { ok: true; request: BrainStreamRelayRequest; url: URL }
  | { ok: false; reason: BrainStreamRelayRejection };

const STREAM_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const RUN_STREAM_PATH = /^\/runs\/([^/]+)\/stream$/;
// encodeURIComponent output. Escaped separators and NUL are never relayed.
const RUN_ID_SEGMENT =
  /^(?:[A-Za-z0-9\-_.!~*'()]|%(?!2[Ff]|5[Cc]|00)[0-9A-Fa-f]{2})+$/;
const AFTER_SEQUENCE_QUERY = /^\?after_sequence=\d{1,16}$/;
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9a-z]+$/;
const HEADER_VALUE = /^[\t\x20-\x7e\x80-\xff]*$/;

/** Loopback origins of a Brain that listens on 127.0.0.1:`port`. */
export function brainStreamRelayOrigins(port: number): string[] {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return [];
  return [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
}

/**
 * The only routes `sseTransport` streams from Brain:
 * `POST /chat` and `GET /runs/{run_id}/stream[?after_sequence=N]`.
 */
export function isBrainStreamRelayRoute(method: string, url: URL): boolean {
  if (url.hash !== '') return false;
  if (method === 'POST') {
    return url.pathname === '/chat' && url.search === '';
  }
  if (method === 'GET') {
    const match = RUN_STREAM_PATH.exec(url.pathname);
    if (!match) return false;
    const runId = match[1];
    if (
      runId.length > BRAIN_STREAM_RELAY_LIMITS.maxRunIdSegmentLength ||
      runId === '.' ||
      runId === '..' ||
      !RUN_ID_SEGMENT.test(runId)
    ) {
      return false;
    }
    return url.search === '' || AFTER_SEQUENCE_QUERY.test(url.search);
  }
  return false;
}

function parseHttpUrl(value: unknown): URL | null {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > BRAIN_STREAM_RELAY_LIMITS.maxUrlLength
  ) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' || url.username || url.password) return null;
  return url;
}

function normalizeHeaders(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > BRAIN_STREAM_RELAY_LIMITS.maxHeaderCount) return null;
  const headers: Record<string, string> = {};
  for (const [rawName, rawValue] of entries) {
    const name = rawName.toLowerCase();
    if (
      !HEADER_NAME.test(name) ||
      !BRAIN_STREAM_RELAY_REQUEST_HEADERS.has(name) ||
      Object.prototype.hasOwnProperty.call(headers, name) ||
      typeof rawValue !== 'string' ||
      rawValue.length > BRAIN_STREAM_RELAY_LIMITS.maxHeaderValueLength ||
      !HEADER_VALUE.test(rawValue)
    ) {
      return null;
    }
    headers[name] = rawValue;
  }
  return headers;
}

/**
 * Validate one relay request against the allowed Brain origins. Both the
 * renderer (before it uses the relay) and main (before it opens a socket)
 * call this, so a request is either relayed under these rules or not at all.
 */
export function validateBrainStreamRelayRequest(
  value: unknown,
  allowedOrigins: readonly string[]
): BrainStreamRelayValidation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'shape' };
  }
  const candidate = value as Partial<
    Record<keyof BrainStreamRelayRequest, unknown>
  >;
  if (
    typeof candidate.streamId !== 'string' ||
    !STREAM_ID_PATTERN.test(candidate.streamId)
  ) {
    return { ok: false, reason: 'stream-id' };
  }
  const url = parseHttpUrl(candidate.url);
  if (!url) return { ok: false, reason: 'url' };
  if (!allowedOrigins.includes(url.origin)) {
    return { ok: false, reason: 'origin' };
  }
  const method = candidate.method;
  if (method !== 'GET' && method !== 'POST') {
    return { ok: false, reason: 'method' };
  }
  if (!isBrainStreamRelayRoute(method, url)) {
    return { ok: false, reason: 'route' };
  }
  const headers = normalizeHeaders(candidate.headers);
  if (!headers) return { ok: false, reason: 'headers' };
  const body = candidate.body;
  if (body !== undefined) {
    if (
      method !== 'POST' ||
      typeof body !== 'string' ||
      body.length > BRAIN_STREAM_RELAY_LIMITS.maxBodyLength
    ) {
      return { ok: false, reason: 'body' };
    }
  }
  return {
    ok: true,
    url,
    request: {
      streamId: candidate.streamId,
      url: url.href,
      method,
      headers,
      ...(body === undefined ? {} : { body }),
    },
  };
}
