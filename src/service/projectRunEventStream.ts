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

import { sseTransport, type SSETransportOptions } from '@/api/http';
import { normalizeLocalRunEvent } from '@/lib/projector';
import type { ProjectedRun } from '@/lib/projector/types';
import { runEventIngressRegistry } from '@/lib/runEvents';
import {
  getProjectEventStore,
  type ProjectEventStore,
  type ProjectEventStoreSnapshot,
} from '@/store/projectEventStore';

const DEFAULT_MAX_LIVE_RUN_STREAMS = 4;
const DEFAULT_RECONNECT_DELAY_MS = 1_000;
/**
 * Ceiling for exponential reconnect backoff. Without it, an endpoint that is
 * permanently unavailable (backend down, Run deleted server-side) produced one
 * request per second per stream forever.
 */
const MAX_RECONNECT_DELAY_MS = 30_000;

const LIVE_RUN_STATUSES = new Set<ProjectedRun['status']>([
  'pending',
  'running',
  'waiting_for_user',
  'cancelling',
]);

const LIVE_RUN_STATUS_PRIORITY: Partial<
  Record<ProjectedRun['status'], number>
> = {
  waiting_for_user: 0,
  cancelling: 1,
  running: 2,
  pending: 3,
};

const TERMINAL_RUN_EVENT_TYPES = new Set([
  'run.completed',
  'run.failed',
  'run.deadline_reached',
  'run.cancelled',
  'run.interrupted',
  'runtime.interrupted',
]);

type EventStreamTransport = (options: SSETransportOptions) => Promise<void>;

type LiveRunStream = {
  controller: AbortController;
  cursor: number;
  runId: string;
  stopRequested: boolean;
};

export type ProjectRunEventStreamOwnerOptions = {
  projectId: string;
  store?: ProjectEventStore;
  transport?: EventStreamTransport;
  maxStreams?: number;
  reconnectDelayMs?: number;
};

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

function nonNegativeNumber(
  value: number | undefined,
  fallback: number
): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function validTimestamp(value: unknown): boolean {
  return (
    (typeof value === 'number' && Number.isFinite(value)) ||
    (typeof value === 'string' && !Number.isNaN(Date.parse(value)))
  );
}

function isValidRunEventEnvelope(value: unknown, runId: string): boolean {
  const event = record(value);
  if (!event) return false;
  return (
    typeof event.event_id === 'string' &&
    event.event_id.length > 0 &&
    event.run_id === runId &&
    typeof event.sequence === 'number' &&
    Number.isInteger(event.sequence) &&
    event.sequence > 0 &&
    typeof event.run_version === 'number' &&
    Number.isInteger(event.run_version) &&
    event.run_version > 0 &&
    typeof event.event_type === 'string' &&
    event.event_type.length > 0 &&
    record(event.payload) !== null &&
    (event.legacy_step === undefined ||
      event.legacy_step === null ||
      typeof event.legacy_step === 'string') &&
    validTimestamp(event.created_at)
  );
}

function updatedAtMillis(run: ProjectedRun): number {
  const value = Date.parse(run.updatedAt);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Only locally executable, currently active Runs may own a canonical live
 * companion. Cloud replicas and resume-blocked Runs remain display-only.
 */
export function isCanonicalLiveRunEligible(run: ProjectedRun): boolean {
  return (
    run.origin === 'local' &&
    run.resumeBlockedReason === null &&
    LIVE_RUN_STATUSES.has(run.status)
  );
}

/** Select a deterministic bounded set so one Project cannot open unbounded SSEs. */
export function selectCanonicalLiveRuns(
  snapshot: ProjectEventStoreSnapshot,
  maxStreams = DEFAULT_MAX_LIVE_RUN_STREAMS
): ProjectedRun[] {
  if (
    !snapshot.hasHydratedSnapshot ||
    snapshot.overflowed ||
    snapshot.view.needsResync
  ) {
    return [];
  }
  const limit = positiveInteger(maxStreams, DEFAULT_MAX_LIVE_RUN_STREAMS);
  return Object.values(snapshot.view.runs)
    .filter(isCanonicalLiveRunEligible)
    .sort((left, right) => {
      const byPriority =
        (LIVE_RUN_STATUS_PRIORITY[left.status] ?? Number.MAX_SAFE_INTEGER) -
        (LIVE_RUN_STATUS_PRIORITY[right.status] ?? Number.MAX_SAFE_INTEGER);
      if (byPriority !== 0) return byPriority;
      const byUpdatedAt = updatedAtMillis(right) - updatedAtMillis(left);
      if (byUpdatedAt !== 0) return byUpdatedAt;
      if (left.lastSequence !== right.lastSequence) {
        return right.lastSequence - left.lastSequence;
      }
      return left.runId.localeCompare(right.runId);
    })
    .slice(0, limit);
}

function waitForReconnect(signal: AbortSignal, delayMs: number): Promise<void> {
  if (signal.aborted || delayMs === 0) return Promise.resolve();
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (timer) clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    timer = setTimeout(finish, delayMs);
    signal.addEventListener('abort', finish, { once: true });
  });
}

/**
 * Temporary canonical companion to the legacy `/chat` execution stream.
 *
 * It owns no UI state. Canonical Run events enter the shared bounded store,
 * where cross-lane IDs/sequences deduplicate them against legacy ChatSteps.
 * The companion can be removed once execution itself uses the Run stream.
 */
export class ProjectRunEventStreamOwner {
  readonly projectId: string;

  private readonly store: ProjectEventStore;
  private readonly transport: EventStreamTransport;
  private readonly maxStreams: number;
  private readonly reconnectDelayMs: number;
  private readonly streams = new Map<string, LiveRunStream>();
  private disposed = false;

  constructor({
    projectId,
    store = getProjectEventStore(projectId),
    transport = sseTransport,
    maxStreams,
    reconnectDelayMs,
  }: ProjectRunEventStreamOwnerOptions) {
    if (!projectId || store.projectId !== projectId) {
      throw new Error('Canonical Run stream owner requires one Project scope');
    }
    this.projectId = projectId;
    this.store = store;
    this.transport = transport;
    this.maxStreams = positiveInteger(maxStreams, DEFAULT_MAX_LIVE_RUN_STREAMS);
    this.reconnectDelayMs = nonNegativeNumber(
      reconnectDelayMs,
      DEFAULT_RECONNECT_DELAY_MS
    );
  }

  /** Reconcile stream ownership from the caller's current store snapshot. */
  updateSnapshot(snapshot: ProjectEventStoreSnapshot): void {
    if (this.disposed) return;
    if (snapshot.view.projectId !== this.projectId) {
      this.stopAll();
      return;
    }

    // The primary RunEventIngressRegistry already owns the live stream for
    // Runs started by this desktop process and now forwards those envelopes to
    // ProjectEventStore. Keep this companion only for hydrated local Runs that
    // have no primary owner, otherwise one Run opens two identical SSEs.
    const eligibleRuns = selectCanonicalLiveRuns(
      snapshot,
      this.maxStreams
    ).filter((run) => !runEventIngressRegistry.has(run.runId));
    const eligibleIds = new Set(eligibleRuns.map((run) => run.runId));

    for (const [runId, stream] of this.streams) {
      if (!eligibleIds.has(runId)) this.stopStream(runId, stream);
    }

    for (const run of eligibleRuns) {
      const existing = this.streams.get(run.runId);
      if (existing) {
        existing.cursor = Math.max(existing.cursor, run.lastSequence);
        continue;
      }
      this.startStream(run.runId, run.lastSequence);
    }
  }

  getActiveRunIds(): string[] {
    return [...this.streams.keys()];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopAll();
  }

  private startStream(runId: string, cursor: number): void {
    if (this.disposed || this.streams.has(runId)) return;
    const stream: LiveRunStream = {
      controller: new AbortController(),
      cursor: Math.max(0, cursor),
      runId,
      stopRequested: false,
    };
    this.streams.set(runId, stream);
    void this.consumeStream(stream).finally(() => {
      if (this.streams.get(runId) === stream) this.streams.delete(runId);
    });
  }

  private async consumeStream(stream: LiveRunStream): Promise<void> {
    let consecutiveFailures = 0;
    while (
      !this.disposed &&
      !stream.controller.signal.aborted &&
      !stream.stopRequested &&
      this.streams.get(stream.runId) === stream
    ) {
      const url = `/runs/${encodeURIComponent(stream.runId)}/stream?after_sequence=${stream.cursor}`;
      const cursorBeforeAttempt = stream.cursor;
      try {
        await this.transport({
          url,
          method: 'GET',
          openWhenHidden: true,
          signal: stream.controller.signal,
          onopen: (response) => {
            const contentType = response.headers.get('content-type') || '';
            if (!response.ok || !contentType.startsWith('text/event-stream')) {
              throw new Error('Canonical Run stream was unavailable');
            }
          },
          onmessage: (message) => this.handleMessage(stream, message),
          onerror: (error) => {
            throw error instanceof Error
              ? error
              : new Error('Canonical Run stream failed');
          },
        });
      } catch (error) {
        if (
          import.meta.env.DEV &&
          !stream.controller.signal.aborted &&
          !stream.stopRequested
        ) {
          console.warn('[ProjectRunEventStream] Reconnecting Run stream', {
            projectId: this.projectId,
            runId: stream.runId,
            reason: error instanceof Error ? error.name : 'unknown',
          });
        }
      }

      if (
        this.disposed ||
        stream.controller.signal.aborted ||
        stream.stopRequested ||
        this.streams.get(stream.runId) !== stream
      ) {
        break;
      }
      // Any forward progress means the connection is healthy, so reset the
      // backoff; only repeated no-progress attempts are throttled.
      consecutiveFailures =
        stream.cursor > cursorBeforeAttempt ? 0 : consecutiveFailures + 1;
      await waitForReconnect(
        stream.controller.signal,
        Math.min(
          this.reconnectDelayMs * 2 ** Math.max(0, consecutiveFailures - 1),
          MAX_RECONNECT_DELAY_MS
        )
      );
    }
  }

  private handleMessage(
    stream: LiveRunStream,
    message: { event: string; data: string }
  ): void {
    if (message.event !== 'run_event') return;

    try {
      const raw = JSON.parse(message.data) as unknown;
      if (!isValidRunEventEnvelope(raw, stream.runId)) {
        throw new Error('Invalid canonical Run event envelope');
      }
      const event = normalizeLocalRunEvent(raw, this.projectId);

      // A human-control POST is followed by an authoritative replay that can
      // project the resolution (and immediately-following work) before this
      // companion stream observes the same sequence. React has not
      // necessarily delivered that newer snapshot through updateSnapshot yet,
      // so refresh the connection-local cursor directly from the shared store.
      // Without this, the first post-reply tool event looks like a sequence gap
      // and the stream stops, leaving the rest of the Run invisible.
      const projectedSequence =
        this.store.getSnapshot().view.runs[stream.runId]?.lastSequence ?? 0;
      stream.cursor = Math.max(stream.cursor, projectedSequence);
      if (event.runSequence <= stream.cursor) return;

      const expectedSequence = stream.cursor + 1;
      const accepted = this.store.enqueue({ ...event, raw: null });
      if (!accepted) {
        stream.stopRequested = true;
        stream.controller.abort();
        return;
      }
      if (event.runSequence !== expectedSequence) {
        // The queued event makes ProjectEventStore enter its normal gap/resync
        // path. Do not reconnect past the missing durable sequence.
        stream.stopRequested = true;
        stream.controller.abort();
        return;
      }

      stream.cursor = event.runSequence;
      if (
        TERMINAL_RUN_EVENT_TYPES.has(event.eventType) ||
        event.legacyStep === 'end'
      ) {
        stream.stopRequested = true;
        stream.controller.abort();
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('[ProjectRunEventStream] Ignored malformed run_event', {
          projectId: this.projectId,
          runId: stream.runId,
          reason: error instanceof Error ? error.name : 'unknown',
        });
      }
    }
  }

  private stopStream(runId: string, stream: LiveRunStream): void {
    if (this.streams.get(runId) !== stream) return;
    this.streams.delete(runId);
    stream.stopRequested = true;
    stream.controller.abort();
  }

  private stopAll(): void {
    for (const [runId, stream] of this.streams) {
      this.stopStream(runId, stream);
    }
  }
}

export type { EventStreamTransport };
