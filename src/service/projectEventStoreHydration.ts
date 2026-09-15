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

import { fetchGet } from '@/api/http';
import type {
  CanonicalProjectEvent,
  ProjectSnapshotInput,
} from '@/lib/projector';
import { normalizeLocalRunEvent } from '@/lib/projector';
import {
  fetchProjectRuns,
  type ProjectRunsResponse,
} from '@/service/projectRunsApi';
import {
  getProjectEventStore,
  type ProjectChatHistory,
  type ProjectEventStore,
} from '@/store/projectEventStore';

const API_MAX_RUNS = 100;
const API_MAX_EVENT_PAGE_SIZE = 5_000;

const DEFAULT_MAX_RUNS = API_MAX_RUNS;
const DEFAULT_EVENT_PAGE_SIZE = 500;
const DEFAULT_MAX_EVENT_PAGES = 200;
// Snapshot replacement currently projects synchronously. Hydration uses this
// as a retained newest-tail ceiling rather than rejecting longer Runs.
const DEFAULT_MAX_EVENTS = 2_000;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_EVENT_BYTES = 256 * 1024;
const RESPONSE_ENVELOPE_ALLOWANCE_BYTES = 4 * 1024;
/** Prevent one busy RunJournal list read from pinning Session hydration. */
const DEFAULT_RUN_LIST_TIMEOUT_MS = 5_000;
const DEFAULT_EVENT_PAGE_TIMEOUT_MS = 5_000;

type RunEventsResponse = {
  run_id?: unknown;
  project_id?: unknown;
  after_sequence?: unknown;
  next_sequence?: unknown;
  has_more?: unknown;
  events?: unknown;
};

type RunDescriptor = {
  runId: string;
  status: string;
  version: number;
  updatedAt: string;
  totalAttemptElapsedMs: number | null;
  origin: string | null;
  resumeBlockedReason: string | null;
};

type HydrationBudget = {
  pages: number;
  scannedEvents: number;
  events: number;
  bytes: number;
};

export type ProjectEventStoreHydrationOptions = {
  projectId: string;
  signal?: AbortSignal;
  store?: ProjectEventStore;
  maxRuns?: number;
  eventPageSize?: number;
  maxEventPages?: number;
  maxEvents?: number;
  maxBytes?: number;
  maxEventBytes?: number;
  runListTimeoutMs?: number;
  eventPageTimeoutMs?: number;
};

export type ProjectEventStoreHydrationResult = {
  projectId: string;
  runCount: number;
  eventCount: number;
  pageCount: number;
  byteCount: number;
  eventsTruncated: boolean;
};

export class ProjectEventStoreHydrationError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'invalid_response'
      | 'limit_exceeded'
      | 'cloud_restore_pending'
      | 'replacement_busy'
      | 'replacement_invalidated'
  ) {
    super(message);
    this.name = 'ProjectEventStoreHydrationError';
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? Math.min(value, maximum)
    : fallback;
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error || signal.reason instanceof DOMException)
    return signal.reason;
  return new DOMException('Project event hydration was aborted', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

/** A cancelled owner must settle even if a transport adapter ignores abort. */
function abortableRead<T>(
  request: Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  if (!signal) return request;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    void request.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

// Only an aggregate byte limit is adaptive. Invalid envelopes, individual
// oversize events, gaps, and non-advancing cursors remain hard failures.
class ReplayBatchByteLimit extends Error {}

async function fitReplayBatch<T>(
  maxEvents: number,
  read: (limit: number) => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  let limit = maxEvents;
  while (true) {
    throwIfAborted(signal);
    try {
      return await read(limit);
    } catch (error) {
      if (!(error instanceof ReplayBatchByteLimit)) throw error;
      if (limit <= 1)
        limitExceeded('A replay batch could not fit its byte bound');
      limit = Math.max(1, Math.floor(limit / 2));
      // Retry a smaller contiguous tail. Never consume a cursor or discard
      // receipts just to fit the renderer's per-batch heap budget.
      await abortableRead(
        new Promise<void>((resolve) => setTimeout(resolve, 0)),
        signal
      );
    }
  }
}

async function fetchProjectRunsWithDeadline(
  projectId: string,
  maxRuns: number,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<ProjectRunsResponse> {
  throwIfAborted(signal);
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  if (signal?.aborted) abortFromCaller();
  const deadline = setTimeout(
    () =>
      controller.abort(
        new DOMException(
          'Project Run listing exceeded the hydration deadline',
          'TimeoutError'
        )
      ),
    timeoutMs
  );
  try {
    return await fetchProjectRuns(projectId, maxRuns, controller.signal);
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

async function fetchEventPage(
  runId: string,
  afterSequence: number,
  limit: number,
  signal: AbortSignal | undefined,
  timeoutMs: number
): Promise<RunEventsResponse> {
  throwIfAborted(signal);
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  const deadline = setTimeout(
    () =>
      controller.abort(
        new DOMException(
          'Run event page exceeded the hydration deadline',
          'TimeoutError'
        )
      ),
    timeoutMs
  );
  try {
    return await abortableRead(
      fetchGet(
        `/runs/${encodeURIComponent(runId)}/events`,
        { after_sequence: afterSequence, limit },
        undefined,
        { signal: controller.signal }
      ),
      controller.signal
    );
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener('abort', onAbort);
  }
}

function validTimestamp(value: unknown): boolean {
  return (
    (typeof value === 'number' &&
      Number.isFinite(
        new Date(value < 10_000_000_000 ? value * 1_000 : value).getTime()
      )) ||
    (typeof value === 'string' &&
      value.trim().length > 0 &&
      !Number.isNaN(Date.parse(value)))
  );
}

function isoTimestamp(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(
      value < 10_000_000_000 ? value * 1_000 : value
    ).toISOString();
  }
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  invalidResponse('Project Run listing contained an invalid timestamp');
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

function invalidResponse(message: string): never {
  throw new ProjectEventStoreHydrationError(message, 'invalid_response');
}

function limitExceeded(message: string): never {
  throw new ProjectEventStoreHydrationError(message, 'limit_exceeded');
}

function parseRunDescriptors(
  response: ProjectRunsResponse,
  projectId: string,
  maxRuns: number
): { runs: RunDescriptor[]; eventsTruncated: boolean } {
  if (response.project_id !== undefined && response.project_id !== projectId) {
    invalidResponse('Project Run listing returned a different Project');
  }
  if (!Array.isArray(response.runs)) {
    invalidResponse('Project Run listing did not return a runs array');
  }
  if (response.runs.length > maxRuns) {
    invalidResponse('Project Run listing exceeded the requested bound');
  }

  const seenRunIds = new Set<string>();
  const runs = response.runs.map((raw): RunDescriptor => {
    const item = record(raw);
    const runId = item.run_id;
    if (typeof runId !== 'string' || !runId) {
      invalidResponse('Project Run listing contained an invalid Run id');
    }
    if (seenRunIds.has(runId)) {
      invalidResponse('Project Run listing contained a duplicate Run id');
    }
    seenRunIds.add(runId);
    if (typeof item.status !== 'string' || !item.status.trim()) {
      invalidResponse('Project Run listing contained an invalid status');
    }
    if (
      typeof item.version !== 'number' ||
      !Number.isSafeInteger(item.version) ||
      item.version < 0
    ) {
      invalidResponse('Project Run listing contained an invalid version');
    }
    if (!validTimestamp(item.updated_at)) {
      invalidResponse('Project Run listing contained an invalid updated_at');
    }
    if (
      item.origin !== undefined &&
      (typeof item.origin !== 'string' || !item.origin.trim())
    ) {
      invalidResponse('Project Run listing contained an invalid origin');
    }
    if (
      item.resume_blocked_reason !== undefined &&
      item.resume_blocked_reason !== null &&
      typeof item.resume_blocked_reason !== 'string'
    ) {
      invalidResponse(
        'Project Run listing contained an invalid resume_blocked_reason'
      );
    }
    return {
      runId,
      status: item.status,
      version: item.version,
      updatedAt: isoTimestamp(item.updated_at),
      totalAttemptElapsedMs:
        typeof item.total_attempt_elapsed_ms === 'number' &&
        Number.isFinite(item.total_attempt_elapsed_ms) &&
        item.total_attempt_elapsed_ms >= 0
          ? item.total_attempt_elapsed_ms
          : null,
      // Missing provenance is intentionally unknown. Command owners must only
      // treat the explicit local origin as actionable.
      origin: typeof item.origin === 'string' ? item.origin : null,
      resumeBlockedReason:
        typeof item.resume_blocked_reason === 'string'
          ? item.resume_blocked_reason
          : null,
    };
  });

  // `/runs` currently has a bounded newest-first response without a cursor.
  // Reaching its requested limit is conservatively represented as truncation.
  return {
    runs,
    eventsTruncated:
      response.has_more === true || response.runs.length === maxRuns,
  };
}

async function readRunEvents(
  descriptor: Pick<RunDescriptor, 'runId'>,
  input: {
    projectId: string;
    signal?: AbortSignal;
    eventPageSize: number;
    maxEventPages: number;
    maxEvents: number;
    maxBytes: number;
    maxEventBytes: number;
    maxScannedEvents: number;
    budget: HydrationBudget;
    seenEventIds: Set<string>;
    events: CanonicalProjectEvent[];
    afterSequence: number;
    retainLimit: number;
    /** Stop at a fixed historical boundary even when the Run is still active. */
    throughSequence?: number;
    /** Initial replay may include one page of appends, then leaves delivery to SSE. */
    stopAfterSequence?: number;
    assertCurrent?: () => void;
    eventPageTimeoutMs?: number;
  }
): Promise<{ lastSequence: number; truncated: boolean }> {
  let cursor = input.afterSequence;
  // Ring buffer over the newest `retainLimit` events. `retainStart` is the
  // oldest slot once the buffer is full; it stays 0 while it is still filling.
  // The caller guarantees retainLimit >= 1 (it skips Runs with no remaining
  // budget), so the modulo below is always well defined.
  const retainedEvents: CanonicalProjectEvent[] = [];
  let retainStart = 0;
  let truncated = false;

  while (true) {
    throwIfAborted(input.signal);
    input.assertCurrent?.();
    if (input.budget.pages >= input.maxEventPages) {
      limitExceeded(
        `Project event hydration exceeded ${input.maxEventPages} pages`
      );
    }
    input.budget.pages += 1;

    // The API has a count limit, not a byte-limit parameter. Request at most
    // one batch's worst-case bytes, leaving room for the response envelope
    // (31 events at the default limits).
    const boundedPageSize = Math.min(
      input.eventPageSize,
      Math.max(
        1,
        Math.floor(
          (input.maxBytes - RESPONSE_ENVELOPE_ALLOWANCE_BYTES) /
            input.maxEventBytes
        )
      )
    );
    const pageSize =
      input.throughSequence === undefined
        ? boundedPageSize
        : Math.min(boundedPageSize, input.throughSequence - cursor);
    const response = await fetchEventPage(
      descriptor.runId,
      cursor,
      pageSize,
      input.signal,
      input.eventPageTimeoutMs ?? DEFAULT_EVENT_PAGE_TIMEOUT_MS
    );
    throwIfAborted(input.signal);
    input.assertCurrent?.();

    if (!response || typeof response !== 'object')
      invalidResponse('Run event replay did not return an object');

    if (response.run_id !== undefined && response.run_id !== descriptor.runId) {
      invalidResponse('Run event replay returned a different Run');
    }
    if (
      response.project_id !== undefined &&
      response.project_id !== input.projectId
    )
      invalidResponse('Run event replay returned a different Project');
    if (
      response.after_sequence !== undefined &&
      response.after_sequence !== cursor
    )
      invalidResponse('Run event replay returned a different starting cursor');
    if (!Array.isArray(response.events)) {
      invalidResponse('Run event replay did not return an events array');
    }
    if (response.events.length > pageSize) {
      invalidResponse('Run event replay exceeded the requested page size');
    }
    if (typeof response.has_more !== 'boolean') {
      invalidResponse('Run event replay returned an invalid has_more value');
    }
    if (estimateJsonBytes(response) > input.maxBytes)
      limitExceeded('Run event replay exceeded the response byte bound');

    let expectedSequence = cursor + 1;
    let lastSequence = cursor;
    for (const rawEvent of response.events) {
      const envelope = record(rawEvent);
      if (typeof envelope.event_id !== 'string' || !envelope.event_id) {
        invalidResponse('Run event replay contained an invalid event id');
      }
      if (envelope.run_id !== descriptor.runId) {
        invalidResponse('Run event replay contained an invalid Run id');
      }
      if (
        typeof envelope.sequence !== 'number' ||
        !Number.isSafeInteger(envelope.sequence) ||
        envelope.sequence < 1
      ) {
        invalidResponse('Run event replay contained an invalid sequence');
      }
      if (
        typeof envelope.run_version !== 'number' ||
        !Number.isSafeInteger(envelope.run_version) ||
        envelope.run_version < 1
      ) {
        invalidResponse('Run event replay contained an invalid run_version');
      }
      if (
        typeof envelope.event_type !== 'string' ||
        !envelope.event_type.trim()
      ) {
        invalidResponse('Run event replay contained an invalid event_type');
      }
      if (
        !envelope.payload ||
        typeof envelope.payload !== 'object' ||
        Array.isArray(envelope.payload)
      ) {
        invalidResponse('Run event replay contained an invalid payload');
      }
      if (!validTimestamp(envelope.created_at)) {
        invalidResponse('Run event replay contained an invalid created_at');
      }
      if (
        envelope.legacy_step !== undefined &&
        envelope.legacy_step !== null &&
        typeof envelope.legacy_step !== 'string'
      ) {
        invalidResponse('Run event replay contained an invalid legacy_step');
      }
      const bytes = estimateJsonBytes(rawEvent);
      if (bytes > input.maxEventBytes) {
        limitExceeded(
          `Run event replay exceeded the ${input.maxEventBytes}-byte per-event bound`
        );
      }
      if (input.budget.scannedEvents + 1 > input.maxScannedEvents) {
        limitExceeded(
          `Project event hydration exceeded ${input.maxScannedEvents} scanned events`
        );
      }

      let event: CanonicalProjectEvent;
      try {
        event = normalizeLocalRunEvent(rawEvent, input.projectId);
      } catch {
        invalidResponse('Run event replay contained an invalid event envelope');
      }
      if (event.runId !== descriptor.runId) {
        invalidResponse('Run event replay contained a cross-Run event');
      }
      if (event.projectId !== input.projectId) {
        invalidResponse('Run event replay contained a cross-Project event');
      }
      if (event.runSequence !== expectedSequence) {
        invalidResponse(
          `Run event replay was not contiguous at sequence ${expectedSequence}`
        );
      }
      if (input.seenEventIds.has(event.eventId)) {
        invalidResponse('Run event replay contained a duplicate event id');
      }
      if (input.budget.bytes + bytes > input.maxBytes) {
        throw new ReplayBatchByteLimit();
      }

      expectedSequence += 1;
      lastSequence = event.runSequence;
      input.seenEventIds.add(event.eventId);
      input.budget.scannedEvents += 1;
      input.budget.bytes += bytes;
      // The hydrated projection never needs to retain the transport envelope.
      // Retain the newest tail in a ring so a long Run does not pay a shift()
      // per event once the retain limit is reached.
      if (retainedEvents.length < input.retainLimit) {
        retainedEvents.push({ ...event, raw: null });
      } else {
        retainedEvents[retainStart] = { ...event, raw: null };
        retainStart = (retainStart + 1) % input.retainLimit;
        truncated = true;
      }
    }

    const nextSequence = response.next_sequence;
    if (
      typeof nextSequence !== 'number' ||
      !Number.isSafeInteger(nextSequence) ||
      nextSequence !== lastSequence
    ) {
      invalidResponse('Run event replay returned an invalid next_sequence');
    }
    if (
      response.has_more &&
      (response.events.length === 0 || nextSequence <= cursor)
    ) {
      invalidResponse('Run event replay cursor did not advance');
    }
    if (
      response.has_more !== true ||
      lastSequence === input.throughSequence ||
      (input.stopAfterSequence !== undefined &&
        lastSequence >= input.stopAfterSequence)
    ) {
      if (
        input.throughSequence !== undefined &&
        lastSequence !== input.throughSequence
      ) {
        invalidResponse(
          'Historical replay ended before its requested boundary'
        );
      }
      // Unroll the ring back into ascending sequence order before publishing.
      input.events.push(
        ...retainedEvents.slice(retainStart),
        ...retainedEvents.slice(0, retainStart)
      );
      input.budget.events += retainedEvents.length;
      return { lastSequence, truncated };
    }
    cursor = nextSequence;
  }
}

async function loadProjectSnapshot(
  projectId: string,
  options: Required<
    Pick<
      ProjectEventStoreHydrationOptions,
      | 'maxRuns'
      | 'eventPageSize'
      | 'maxEventPages'
      | 'maxEvents'
      | 'maxBytes'
      | 'maxEventBytes'
      | 'runListTimeoutMs'
      | 'eventPageTimeoutMs'
    >
  > & { signal?: AbortSignal }
): Promise<{
  snapshot: ProjectSnapshotInput;
  budget: HydrationBudget;
  runCount: number;
  history: ProjectChatHistory;
}> {
  throwIfAborted(options.signal);
  const response = await fetchProjectRunsWithDeadline(
    projectId,
    options.maxRuns,
    options.runListTimeoutMs,
    options.signal
  );
  throwIfAborted(options.signal);
  if (!response || typeof response !== 'object')
    invalidResponse('Project Run listing did not return an object');
  if (estimateJsonBytes(response) > options.maxBytes)
    limitExceeded('Project Run listing exceeded the response byte bound');
  if (
    response.cloud_restore_pending === true &&
    Array.isArray(response.runs) &&
    response.runs.length === 0
  ) {
    throw new ProjectEventStoreHydrationError(
      'Cloud Project history is still restoring to the local replica',
      'cloud_restore_pending'
    );
  }

  const parsedRuns = parseRunDescriptors(response, projectId, options.maxRuns);
  // /runs measures active attempts at read time, whereas updated_at is the
  // last journal event. Anchoring to updated_at would count that gap twice.
  const totalAttemptElapsedAt = new Date().toISOString();
  const { runs } = parsedRuns;
  let eventsTruncated = parsedRuns.eventsTruncated;
  const budget: HydrationBudget = {
    pages: 0,
    scannedEvents: 0,
    events: 0,
    bytes: 0,
  };
  const events: CanonicalProjectEvent[] = [];
  const seenEventIds = new Set<string>();
  const runSequences = new Map<string, number>();
  const beforeByRun: Record<string, number> = {};

  for (const run of runs) {
    const remainingEvents = options.maxEvents - budget.events;
    if (remainingEvents <= 0) {
      beforeByRun[run.runId] = run.version;
      runSequences.set(run.runId, run.version);
      if (run.version > 0) eventsTruncated = true;
      continue;
    }
    // RunJournal increments `version` and event `sequence` atomically for each
    // append. Starting near the current version gives a bounded newest tail
    // without reading/projecting an arbitrarily long historical prefix.
    const afterSequence = Math.max(0, run.version - remainingEvents);
    if (afterSequence > 0) eventsTruncated = true;
    const replay = await readRunEvents(run, {
      ...options,
      projectId,
      budget,
      seenEventIds,
      events,
      afterSequence,
      stopAfterSequence: run.version,
      retainLimit: remainingEvents,
      // A single response page of concurrent appends can extend beyond the
      // descriptor version. Validate and ring-retain that bounded race window.
      maxScannedEvents: options.maxEvents + options.eventPageSize,
    });
    if (replay.lastSequence < run.version) {
      invalidResponse('Run event replay ended before the listed Run version');
    }
    if (replay.truncated) eventsTruncated = true;
    const firstRetained = events.find((event) => event.runId === run.runId);
    beforeByRun[run.runId] = Math.max(0, (firstRetained?.runSequence ?? 1) - 1);
    runSequences.set(run.runId, replay.lastSequence);
  }

  events.sort((left, right) => {
    if (left.runId === right.runId) {
      return left.runSequence - right.runSequence;
    }
    const byTime = left.createdAt.localeCompare(right.createdAt);
    if (byTime !== 0) return byTime;
    return left.runId.localeCompare(right.runId);
  });

  return {
    snapshot: {
      project_id: projectId,
      current_cursor: 0,
      runs: runs.map((run) => ({
        run_id: run.runId,
        status: run.status,
        expected_next_run_sequence: (runSequences.get(run.runId) ?? 0) + 1,
        updated_at: run.updatedAt,
        total_attempt_elapsed_ms: run.totalAttemptElapsedMs,
        totalAttemptElapsedAt,
        run_version: run.version,
        origin: run.origin,
        resume_blocked_reason: run.resumeBlockedReason,
      })),
      recent_events: events,
      events_truncated: eventsTruncated,
    },
    budget,
    runCount: runs.length,
    history: { beforeByRun, runsTruncated: parsedRuns.eventsTruncated },
  };
}

/**
 * Rebuild one ProjectEventStore from the existing RunJournal GET APIs. The
 * store generation buffers the already-owned live stream throughout the fetch,
 * so committing the snapshot cannot overwrite events received in flight.
 */
export async function hydrateProjectEventStore({
  projectId,
  signal,
  store = getProjectEventStore(projectId),
  maxRuns: maxRunsInput,
  eventPageSize: eventPageSizeInput,
  maxEventPages: maxEventPagesInput,
  maxEvents: maxEventsInput,
  maxBytes: maxBytesInput,
  maxEventBytes: maxEventBytesInput,
  runListTimeoutMs: runListTimeoutMsInput,
  eventPageTimeoutMs: eventPageTimeoutMsInput,
}: ProjectEventStoreHydrationOptions): Promise<ProjectEventStoreHydrationResult> {
  if (!projectId || store.projectId !== projectId) {
    throw new ProjectEventStoreHydrationError(
      'Project event hydration requires one matching Project scope',
      'invalid_response'
    );
  }
  throwIfAborted(signal);

  const maxRuns = boundedInteger(maxRunsInput, DEFAULT_MAX_RUNS, API_MAX_RUNS);
  const eventPageSize = boundedInteger(
    eventPageSizeInput,
    DEFAULT_EVENT_PAGE_SIZE,
    API_MAX_EVENT_PAGE_SIZE
  );
  const maxEventPages = boundedInteger(
    maxEventPagesInput,
    DEFAULT_MAX_EVENT_PAGES
  );
  const maxEvents = boundedInteger(
    maxEventsInput,
    DEFAULT_MAX_EVENTS,
    DEFAULT_MAX_EVENTS
  );
  const maxBytes = boundedInteger(
    maxBytesInput,
    DEFAULT_MAX_BYTES,
    DEFAULT_MAX_BYTES
  );
  const maxEventBytes = Math.min(
    boundedInteger(
      maxEventBytesInput,
      DEFAULT_MAX_EVENT_BYTES,
      DEFAULT_MAX_EVENT_BYTES
    ),
    maxBytes
  );
  const runListTimeoutMs = boundedInteger(
    runListTimeoutMsInput,
    DEFAULT_RUN_LIST_TIMEOUT_MS
  );
  const eventPageTimeoutMs = boundedInteger(
    eventPageTimeoutMsInput,
    DEFAULT_EVENT_PAGE_TIMEOUT_MS
  );

  const replacement = store.beginSnapshotReplacement();
  if (!replacement) {
    throw new ProjectEventStoreHydrationError(
      'A Project snapshot rebuild is already in progress',
      'replacement_busy'
    );
  }

  const incarnation = store.getIncarnation();
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  if (signal?.aborted) abortFromCaller();
  const unsubscribe = store.subscribe(() => {
    if (store.getIncarnation() !== incarnation) {
      controller.abort(
        new ProjectEventStoreHydrationError(
          'Project event hydration was reset',
          'replacement_invalidated'
        )
      );
    }
  });
  const cancelReplacement = () => store.cancelSnapshotReplacement(replacement);
  controller.signal.addEventListener('abort', cancelReplacement, {
    once: true,
  });
  try {
    const loaded = await fitReplayBatch(
      maxEvents,
      (limit) =>
        loadProjectSnapshot(projectId, {
          signal: controller.signal,
          maxRuns,
          eventPageSize,
          maxEventPages,
          maxEvents: limit,
          maxBytes,
          maxEventBytes,
          runListTimeoutMs,
          eventPageTimeoutMs,
        }),
      controller.signal
    );
    throwIfAborted(controller.signal);
    if (
      !store.commitSnapshotReplacement(
        replacement,
        loaded.snapshot,
        loaded.history
      )
    ) {
      throw new ProjectEventStoreHydrationError(
        'Live delivery exceeded the bounded rebuild buffer; retry with a fresh snapshot',
        'replacement_invalidated'
      );
    }
    return {
      projectId,
      runCount: loaded.runCount,
      eventCount: loaded.budget.events,
      pageCount: loaded.budget.pages,
      byteCount: loaded.budget.bytes,
      eventsTruncated: store.getSnapshot().view.eventsTruncated,
    };
  } catch (error) {
    store.cancelSnapshotReplacement(replacement);
    throw error;
  } finally {
    unsubscribe();
    signal?.removeEventListener('abort', abortFromCaller);
    controller.signal.removeEventListener('abort', cancelReplacement);
  }
}

type OlderHistoryOptions = Pick<
  ProjectEventStoreHydrationOptions,
  | 'projectId'
  | 'signal'
  | 'store'
  | 'maxEvents'
  | 'eventPageSize'
  | 'eventPageTimeoutMs'
>;

/** One display batch, followed by bounded forward control batches at the end. */
export async function loadOlderProjectChatHistory(
  options: OlderHistoryOptions
): Promise<void> {
  const store = options.store ?? getProjectEventStore(options.projectId);
  if (store.projectId !== options.projectId)
    invalidResponse('History requires one matching Project scope');
  throwIfAborted(options.signal);
  let history = store.getSnapshot().history;
  if (!history) return;
  if (Object.values(history.beforeByRun).some((before) => before > 0)) {
    history = await loadOlderChatBatch({ ...options, store });
  }
  if (!history) return;
  const owner = history;
  const assertCurrent = () => {
    throwIfAborted(options.signal);
    if (!store.isChatHistoryCurrent(owner)) {
      throw new ProjectEventStoreHydrationError(
        'History changed during control replay',
        'replacement_invalidated'
      );
    }
  };
  assertCurrent();
  if (Object.values(owner.beforeByRun).some((before) => before > 0)) return;

  // Backward display pages cannot safely merge into compacted controls: a
  // terminal receipt may already have been evicted. Rebuild in durable order,
  // with a fresh count/byte budget and an input/paint yield for every batch.
  while (store.getControlReplayCursor()) {
    assertCurrent();
    await loadControlHistoryBatch({ ...options, store }, assertCurrent);
    assertCurrent();
    await abortableRead(
      new Promise<void>((resolve) => setTimeout(resolve, 0)),
      options.signal
    );
    assertCurrent();
  }
}

async function loadControlHistoryBatch(
  {
    projectId,
    signal,
    store = getProjectEventStore(projectId),
    maxEvents,
    eventPageSize,
    eventPageTimeoutMs,
  }: OlderHistoryOptions,
  assertHistoryCurrent: () => void
): Promise<void> {
  const cursor = store.getControlReplayCursor();
  if (!cursor) return;
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  if (signal?.aborted) abortFromCaller();
  const assertCurrent = () => {
    assertHistoryCurrent();
    if (
      store.getControlReplayCursor() !== cursor ||
      store.getSnapshot().overflowed
    ) {
      throw new ProjectEventStoreHydrationError(
        'Control checkpoint changed during replay',
        'replacement_invalidated'
      );
    }
  };
  const unsubscribe = store.subscribe(() => {
    try {
      assertCurrent();
    } catch (error) {
      controller.abort(error);
    }
  });
  try {
    const loaded = await fitReplayBatch(
      boundedInteger(maxEvents, DEFAULT_MAX_EVENTS, DEFAULT_MAX_EVENTS),
      async (limit) => {
        assertCurrent();
        const budget: HydrationBudget = {
          pages: 0,
          scannedEvents: 0,
          events: 0,
          bytes: 0,
        };
        const events: CanonicalProjectEvent[] = [];
        const seenEventIds = new Set<string>();
        const afterByRun = { ...cursor.afterByRun };
        for (const [runId, target] of Object.entries(cursor.throughByRun)) {
          const remaining = limit - budget.events;
          if (remaining <= 0) break;
          const afterSequence = afterByRun[runId];
          if (afterSequence >= target) continue;
          const throughSequence = Math.min(target, afterSequence + remaining);
          await readRunEvents(
            { runId },
            {
              projectId,
              signal: controller.signal,
              assertCurrent,
              eventPageTimeoutMs: boundedInteger(
                eventPageTimeoutMs,
                DEFAULT_EVENT_PAGE_TIMEOUT_MS
              ),
              eventPageSize: boundedInteger(
                eventPageSize,
                DEFAULT_EVENT_PAGE_SIZE,
                API_MAX_EVENT_PAGE_SIZE
              ),
              maxEventPages: DEFAULT_MAX_EVENT_PAGES,
              maxEvents: limit,
              maxBytes: DEFAULT_MAX_BYTES,
              maxEventBytes: DEFAULT_MAX_EVENT_BYTES,
              maxScannedEvents: limit,
              budget,
              seenEventIds,
              events,
              afterSequence,
              throughSequence,
              retainLimit: remaining,
            }
          );
          afterByRun[runId] = throughSequence;
        }
        return { events, afterByRun };
      },
      controller.signal
    );
    throwIfAborted(controller.signal);
    assertCurrent();
    if (!store.appendControlHistory(cursor, loaded.events, loaded.afterByRun)) {
      throw new ProjectEventStoreHydrationError(
        'Control checkpoint could not be committed',
        'replacement_invalidated'
      );
    }
  } finally {
    unsubscribe();
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

/** Read one bounded older page using existing APIs, without pausing live ingest. */
async function loadOlderChatBatch({
  projectId,
  signal,
  store = getProjectEventStore(projectId),
  maxEvents = DEFAULT_MAX_EVENTS,
  eventPageSize = DEFAULT_EVENT_PAGE_SIZE,
  eventPageTimeoutMs = DEFAULT_EVENT_PAGE_TIMEOUT_MS,
}: OlderHistoryOptions): Promise<ProjectChatHistory | undefined> {
  if (store.projectId !== projectId)
    invalidResponse('History requires one matching Project scope');
  throwIfAborted(signal);
  const previous = store.getSnapshot().history;
  if (!previous) return;
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  if (signal?.aborted) abortFromCaller();
  const assertCurrent = () => {
    if (!store.isChatHistoryCurrent(previous)) {
      throw new ProjectEventStoreHydrationError(
        'History changed during replay; retry against the current snapshot',
        'replacement_invalidated'
      );
    }
  };
  const unsubscribe = store.subscribe(() => {
    if (!store.isChatHistoryCurrent(previous)) {
      controller.abort(
        new ProjectEventStoreHydrationError(
          'History changed during replay',
          'replacement_invalidated'
        )
      );
    }
  });
  const eventLimit = boundedInteger(
    maxEvents,
    DEFAULT_MAX_EVENTS,
    DEFAULT_MAX_EVENTS
  );
  const pageSize = boundedInteger(
    eventPageSize,
    DEFAULT_EVENT_PAGE_SIZE,
    API_MAX_EVENT_PAGE_SIZE
  );
  try {
    assertCurrent();
    const loaded = await fitReplayBatch(
      eventLimit,
      async (limit) => {
        assertCurrent();
        const budget: HydrationBudget = {
          pages: 0,
          scannedEvents: 0,
          events: 0,
          bytes: 0,
        };
        const events: CanonicalProjectEvent[] = [];
        const seenEventIds = new Set<string>();
        const beforeByRun = { ...previous.beforeByRun };
        for (const [runId, throughSequence] of Object.entries(
          previous.beforeByRun
        )) {
          const remaining = limit - budget.events;
          if (remaining <= 0) break;
          if (throughSequence <= 0) continue;
          const afterSequence = Math.max(0, throughSequence - remaining);
          await readRunEvents(
            { runId },
            {
              projectId,
              signal: controller.signal,
              assertCurrent,
              eventPageTimeoutMs: boundedInteger(
                eventPageTimeoutMs,
                DEFAULT_EVENT_PAGE_TIMEOUT_MS
              ),
              eventPageSize: pageSize,
              maxEventPages: DEFAULT_MAX_EVENT_PAGES,
              maxEvents: limit,
              maxBytes: DEFAULT_MAX_BYTES,
              maxEventBytes: DEFAULT_MAX_EVENT_BYTES,
              maxScannedEvents: limit,
              budget,
              seenEventIds,
              events,
              afterSequence,
              throughSequence,
              retainLimit: remaining,
            }
          );
          beforeByRun[runId] = afterSequence;
        }
        return { events, beforeByRun };
      },
      controller.signal
    );
    throwIfAborted(controller.signal);
    const history = { ...previous, beforeByRun: loaded.beforeByRun };
    if (!store.prependChatHistory(loaded.events, previous, history)) {
      throw new ProjectEventStoreHydrationError(
        'History changed during replay; retry against the current snapshot',
        'replacement_invalidated'
      );
    }
    return history;
  } finally {
    unsubscribe();
    signal?.removeEventListener('abort', abortFromCaller);
  }
}
