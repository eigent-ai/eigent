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

import { fetchGet, sseTransport, type SSETransportOptions } from '@/api/http';
import {
  normalizeLocalRunEvent,
  type CanonicalProjectEvent,
} from '@/lib/projector';
import type { ProjectedRun } from '@/lib/projector/types';
import {
  getProjectEventStore,
  type ProjectEventStore,
  type ProjectEventStoreSnapshot,
} from '@/store/projectEventStore';

const DEFAULT_MAX_LIVE_RUN_STREAMS = 4;
const DEFAULT_RECONNECT_DELAY_MS = 1_000;
const API_MAX_RECOVERY_PAGE_SIZE = 5_000;
const DEFAULT_RECOVERY_PAGE_SIZE = 100;
const DEFAULT_MAX_RECOVERY_PAGES = 200;
const DEFAULT_MAX_RECOVERY_EVENTS = 10_000;
const DEFAULT_MAX_RECOVERY_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_RECOVERY_EVENT_BYTES = 256 * 1024;

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

type EventRecoveryFetch = (
  url: string,
  params?: Record<string, number>,
  headers?: Record<string, string> | undefined,
  options?: { signal?: AbortSignal }
) => Promise<unknown>;

type LiveRunStream = {
  controller: AbortController;
  cursor: number;
  runId: string;
  stopRequested: boolean;
};

type RecoverySession = {
  controller: AbortController;
  currentRunId: string | null;
  incarnation: number;
};

type RecoveryPage = {
  bytes: number;
  events: CanonicalProjectEvent[];
  hasMore: boolean;
  nextSequence: number;
};

type RecoveryResult = 'complete' | 'failed' | 'stopped';

export type ProjectRunEventStreamOwnerOptions = {
  projectId: string;
  store?: ProjectEventStore;
  transport?: EventStreamTransport;
  maxStreams?: number;
  reconnectDelayMs?: number;
  /** Test/host seam; production uses the shared authenticated GET helper. */
  recoveryFetch?: EventRecoveryFetch;
  recoveryPageSize?: number;
  maxRecoveryPages?: number;
  maxRecoveryEvents?: number;
  maxRecoveryBytes?: number;
  maxRecoveryEventBytes?: number;
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

function estimateJsonBytes(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === 'string'
      ? serialized.length * 2
      : Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
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

function hasPendingTruncationRecovery(run: ProjectedRun): boolean {
  const target = run.truncationRecoveryTarget;
  return Boolean(
    run.eventsTruncated === true &&
    typeof target === 'number' &&
    Number.isInteger(target) &&
    target > run.lastSequence
  );
}

function canOwnRunTransport(snapshot: ProjectEventStoreSnapshot): boolean {
  return (
    snapshot.hasHydratedSnapshot &&
    !snapshot.overflowed &&
    !snapshot.view.needsResync
  );
}

function compareRecoveryRuns(left: ProjectedRun, right: ProjectedRun): number {
  const byPriority =
    (LIVE_RUN_STATUS_PRIORITY[left.status] ?? Number.MAX_SAFE_INTEGER) -
    (LIVE_RUN_STATUS_PRIORITY[right.status] ?? Number.MAX_SAFE_INTEGER);
  if (byPriority !== 0) return byPriority;
  const byUpdatedAt = updatedAtMillis(right) - updatedAtMillis(left);
  if (byUpdatedAt !== 0) return byUpdatedAt;
  return left.runId.localeCompare(right.runId);
}

function selectTruncationRecoveryRuns(
  snapshot: ProjectEventStoreSnapshot
): ProjectedRun[] {
  if (!canOwnRunTransport(snapshot)) return [];
  return Object.values(snapshot.view.runs)
    .filter(hasPendingTruncationRecovery)
    .sort(compareRecoveryRuns);
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
  if (!canOwnRunTransport(snapshot)) {
    return [];
  }
  const limit = positiveInteger(maxStreams, DEFAULT_MAX_LIVE_RUN_STREAMS);
  return Object.values(snapshot.view.runs)
    .filter(
      (run) =>
        isCanonicalLiveRunEligible(run) && !hasPendingTruncationRecovery(run)
    )
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

function parseRecoveryPage(
  value: unknown,
  projectId: string,
  runId: string,
  cursor: number,
  pageSize: number,
  maxEventBytes: number
): RecoveryPage {
  const response = record(value);
  if (!response) throw new Error('Run recovery returned an invalid response');
  if (response.run_id !== undefined && response.run_id !== runId) {
    throw new Error('Run recovery returned a different Run');
  }
  if (!Array.isArray(response.events)) {
    throw new Error('Run recovery did not return an events array');
  }
  if (response.events.length > pageSize) {
    throw new Error('Run recovery exceeded the requested page size');
  }
  if (typeof response.has_more !== 'boolean') {
    throw new Error('Run recovery returned an invalid has_more value');
  }

  const events: CanonicalProjectEvent[] = [];
  const eventIds = new Set<string>();
  let bytes = 0;
  let expectedSequence = cursor + 1;
  for (const rawEvent of response.events) {
    if (!isValidRunEventEnvelope(rawEvent, runId)) {
      throw new Error('Run recovery contained an invalid event envelope');
    }
    const eventBytes = estimateJsonBytes(rawEvent);
    if (eventBytes > maxEventBytes) {
      throw new Error('Run recovery event exceeded its byte bound');
    }
    const event = normalizeLocalRunEvent(rawEvent, projectId);
    if (
      event.projectId !== projectId ||
      event.runId !== runId ||
      event.runSequence !== expectedSequence ||
      eventIds.has(event.eventId)
    ) {
      throw new Error('Run recovery page was not contiguous and unique');
    }
    expectedSequence += 1;
    eventIds.add(event.eventId);
    bytes += eventBytes;
    events.push({ ...event, raw: null });
  }

  const nextSequence = response.next_sequence;
  const expectedNextSequence = events.at(-1)?.runSequence ?? cursor;
  if (
    typeof nextSequence !== 'number' ||
    !Number.isInteger(nextSequence) ||
    nextSequence !== expectedNextSequence
  ) {
    throw new Error('Run recovery returned an invalid next_sequence');
  }
  if (response.has_more && events.length === 0) {
    throw new Error('Run recovery cursor did not advance');
  }

  return {
    bytes,
    events,
    hasMore: response.has_more,
    nextSequence,
  };
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
  private readonly recoveryFetch: EventRecoveryFetch;
  private readonly maxStreams: number;
  private readonly reconnectDelayMs: number;
  private readonly recoveryPageSize: number;
  private readonly maxRecoveryPages: number;
  private readonly maxRecoveryEvents: number;
  private readonly maxRecoveryBytes: number;
  private readonly maxRecoveryEventBytes: number;
  private readonly streams = new Map<string, LiveRunStream>();
  private readonly failedRecoveries = new Set<string>();
  private recovery: RecoverySession | null = null;
  private observedIncarnation: number;
  private disposed = false;

  constructor({
    projectId,
    store = getProjectEventStore(projectId),
    transport = sseTransport,
    maxStreams,
    reconnectDelayMs,
    recoveryFetch = fetchGet,
    recoveryPageSize,
    maxRecoveryPages,
    maxRecoveryEvents,
    maxRecoveryBytes,
    maxRecoveryEventBytes,
  }: ProjectRunEventStreamOwnerOptions) {
    if (!projectId || store.projectId !== projectId) {
      throw new Error('Canonical Run stream owner requires one Project scope');
    }
    this.projectId = projectId;
    this.store = store;
    this.transport = transport;
    this.recoveryFetch = recoveryFetch;
    this.maxStreams = positiveInteger(maxStreams, DEFAULT_MAX_LIVE_RUN_STREAMS);
    this.reconnectDelayMs = nonNegativeNumber(
      reconnectDelayMs,
      DEFAULT_RECONNECT_DELAY_MS
    );
    this.recoveryPageSize = Math.min(
      positiveInteger(recoveryPageSize, DEFAULT_RECOVERY_PAGE_SIZE),
      API_MAX_RECOVERY_PAGE_SIZE
    );
    this.maxRecoveryPages = positiveInteger(
      maxRecoveryPages,
      DEFAULT_MAX_RECOVERY_PAGES
    );
    this.maxRecoveryEvents = positiveInteger(
      maxRecoveryEvents,
      DEFAULT_MAX_RECOVERY_EVENTS
    );
    this.maxRecoveryBytes = positiveInteger(
      maxRecoveryBytes,
      DEFAULT_MAX_RECOVERY_BYTES
    );
    this.maxRecoveryEventBytes = positiveInteger(
      maxRecoveryEventBytes,
      DEFAULT_MAX_RECOVERY_EVENT_BYTES
    );
    this.observedIncarnation = store.getSnapshot().incarnation;
  }

  /** Reconcile stream ownership from the caller's current store snapshot. */
  updateSnapshot(snapshot: ProjectEventStoreSnapshot): void {
    if (this.disposed) return;
    const currentSnapshot = this.store.getSnapshot();
    if (
      snapshot.view.projectId !== this.projectId ||
      snapshot.incarnation !== currentSnapshot.incarnation
    ) {
      this.stopAll();
      this.stopRecovery();
      return;
    }

    if (snapshot.incarnation !== this.observedIncarnation) {
      this.observedIncarnation = snapshot.incarnation;
      this.failedRecoveries.clear();
      this.stopRecovery();
    }

    if (!canOwnRunTransport(snapshot)) {
      this.stopAll();
      this.stopRecovery();
      return;
    }

    const eligibleRuns = selectCanonicalLiveRuns(
      snapshot,
      this.maxStreams
    ).filter((run) => run.runId !== this.recovery?.currentRunId);
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

    this.ensureRecovery(snapshot);
  }

  getActiveRunIds(): string[] {
    return [...this.streams.keys()];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopAll();
    this.stopRecovery();
  }

  private recoveryKey(
    incarnation: number,
    runId: string,
    target: number
  ): string {
    return `${incarnation}:${runId}:${target}`;
  }

  private ensureRecovery(snapshot: ProjectEventStoreSnapshot): void {
    if (this.disposed || !canOwnRunTransport(snapshot)) return;
    if (this.recovery) {
      if (this.recovery.incarnation !== snapshot.incarnation) {
        this.stopRecovery();
      } else {
        return;
      }
    }

    const hasRecoverableTarget = selectTruncationRecoveryRuns(snapshot).some(
      (run) =>
        !this.failedRecoveries.has(
          this.recoveryKey(
            snapshot.incarnation,
            run.runId,
            run.truncationRecoveryTarget!
          )
        )
    );
    if (!hasRecoverableTarget) return;

    const recovery: RecoverySession = {
      controller: new AbortController(),
      currentRunId: null,
      incarnation: snapshot.incarnation,
    };
    this.recovery = recovery;
    void this.consumeRecovery(recovery).finally(() => {
      if (this.recovery !== recovery) return;
      this.recovery = null;
      if (!this.disposed) this.updateSnapshot(this.store.getSnapshot());
    });
  }

  private async consumeRecovery(recovery: RecoverySession): Promise<void> {
    while (this.isRecoveryActive(recovery)) {
      const snapshot = this.store.getSnapshot();
      const run = selectTruncationRecoveryRuns(snapshot).find(
        (candidate) =>
          !this.failedRecoveries.has(
            this.recoveryKey(
              recovery.incarnation,
              candidate.runId,
              candidate.truncationRecoveryTarget!
            )
          )
      );
      if (!run) return;

      const target = run.truncationRecoveryTarget!;
      recovery.currentRunId = run.runId;
      const result = await this.recoverRun(recovery, run.runId, target);
      recovery.currentRunId = null;

      if (result === 'stopped') return;
      if (result === 'failed') {
        this.failedRecoveries.add(
          this.recoveryKey(recovery.incarnation, run.runId, target)
        );
      }
    }
  }

  private async recoverRun(
    recovery: RecoverySession,
    runId: string,
    target: number
  ): Promise<RecoveryResult> {
    let pages = 0;
    let eventCount = 0;
    let byteCount = 0;

    while (true) {
      if (!this.isRecoveryActive(recovery)) return 'stopped';

      // Drain live work from other Runs before reserving room for the next
      // bounded replay page. A recovery page is never allowed to accumulate
      // behind another page in the shared store queue.
      this.store.flushAll();
      if (!this.isRecoveryActive(recovery)) return 'stopped';

      const beforeFetch = this.currentRecoveryRun(recovery, runId, target);
      if (!beforeFetch) return 'complete';
      const cursor = beforeFetch.lastSequence;
      if (cursor >= target) return 'complete';
      if (pages >= this.maxRecoveryPages) return 'failed';
      pages += 1;

      let response: unknown;
      try {
        response = await this.recoveryFetch(
          `/runs/${encodeURIComponent(runId)}/events`,
          { after_sequence: cursor, limit: this.recoveryPageSize },
          undefined,
          { signal: recovery.controller.signal }
        );
      } catch {
        return this.isRecoveryActive(recovery) ? 'failed' : 'stopped';
      }
      if (!this.isRecoveryActive(recovery)) return 'stopped';

      let page: RecoveryPage;
      try {
        page = parseRecoveryPage(
          response,
          this.projectId,
          runId,
          cursor,
          this.recoveryPageSize,
          this.maxRecoveryEventBytes
        );
      } catch {
        return 'failed';
      }

      eventCount += page.events.length;
      byteCount += page.bytes;
      if (
        eventCount > this.maxRecoveryEvents ||
        byteCount > this.maxRecoveryBytes
      ) {
        return 'failed';
      }

      const beforeEnqueue = this.currentRecoveryRun(recovery, runId, target);
      if (!beforeEnqueue) return 'complete';
      if (beforeEnqueue.lastSequence !== cursor) {
        // Another authoritative reconciliation advanced this Run while the GET
        // was in flight. Discard the stale page and restart from that watermark.
        continue;
      }
      if (page.events.length === 0) return 'failed';

      if (!this.store.enqueue(page.events)) {
        return this.isRecoveryActive(recovery) ? 'failed' : 'stopped';
      }
      this.store.flushAll();
      if (!this.isRecoveryActive(recovery)) return 'stopped';

      const afterEnqueue = this.store.getSnapshot().view.runs[runId];
      if (!afterEnqueue || afterEnqueue.lastSequence < page.nextSequence) {
        return 'failed';
      }
      if (!hasPendingTruncationRecovery(afterEnqueue)) return 'complete';
      if (afterEnqueue.truncationRecoveryTarget !== target) return 'complete';
      if (!page.hasMore) return 'failed';
    }
  }

  private currentRecoveryRun(
    recovery: RecoverySession,
    runId: string,
    target: number
  ): ProjectedRun | null {
    if (!this.isRecoveryActive(recovery)) return null;
    const run = this.store.getSnapshot().view.runs[runId];
    return run &&
      hasPendingTruncationRecovery(run) &&
      run.truncationRecoveryTarget === target
      ? run
      : null;
  }

  private isRecoveryActive(recovery: RecoverySession): boolean {
    if (
      this.disposed ||
      this.recovery !== recovery ||
      recovery.controller.signal.aborted
    ) {
      return false;
    }
    const snapshot = this.store.getSnapshot();
    return (
      snapshot.incarnation === recovery.incarnation &&
      snapshot.view.projectId === this.projectId &&
      canOwnRunTransport(snapshot)
    );
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
    while (
      !this.disposed &&
      !stream.controller.signal.aborted &&
      !stream.stopRequested &&
      this.streams.get(stream.runId) === stream
    ) {
      const url = `/runs/${encodeURIComponent(stream.runId)}/stream?after_sequence=${stream.cursor}`;
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
      await waitForReconnect(stream.controller.signal, this.reconnectDelayMs);
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

  private stopRecovery(): void {
    const recovery = this.recovery;
    if (!recovery) return;
    this.recovery = null;
    recovery.currentRunId = null;
    recovery.controller.abort();
  }
}

export type { EventRecoveryFetch, EventStreamTransport };
