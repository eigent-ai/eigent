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
/** Prevent one busy RunJournal list read from pinning Session hydration. */
const DEFAULT_RUN_LIST_TIMEOUT_MS = 5_000;

type RunEventsResponse = {
  run_id?: unknown;
  next_sequence?: unknown;
  has_more?: unknown;
  events?: unknown;
};

type RunDescriptor = {
  runId: string;
  status: string;
  version: number;
  updatedAt: string;
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
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? Math.min(value, maximum)
    : fallback;
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  return new DOMException('Project event hydration was aborted', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
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

function validTimestamp(value: unknown): boolean {
  return (
    (typeof value === 'number' && Number.isFinite(value)) ||
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
      !Number.isInteger(item.version) ||
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
  descriptor: RunDescriptor,
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
    if (input.budget.pages >= input.maxEventPages) {
      limitExceeded(
        `Project event hydration exceeded ${input.maxEventPages} pages`
      );
    }
    input.budget.pages += 1;

    const response = (await fetchGet(
      `/runs/${encodeURIComponent(descriptor.runId)}/events`,
      { after_sequence: cursor, limit: input.eventPageSize },
      undefined,
      { signal: input.signal }
    )) as RunEventsResponse;
    throwIfAborted(input.signal);

    if (response.run_id !== undefined && response.run_id !== descriptor.runId) {
      invalidResponse('Run event replay returned a different Run');
    }
    if (!Array.isArray(response.events)) {
      invalidResponse('Run event replay did not return an events array');
    }
    if (response.events.length > input.eventPageSize) {
      invalidResponse('Run event replay exceeded the requested page size');
    }
    if (typeof response.has_more !== 'boolean') {
      invalidResponse('Run event replay returned an invalid has_more value');
    }

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
        !Number.isInteger(envelope.sequence) ||
        envelope.sequence < 1
      ) {
        invalidResponse('Run event replay contained an invalid sequence');
      }
      if (
        typeof envelope.run_version !== 'number' ||
        !Number.isInteger(envelope.run_version) ||
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
      if (input.budget.bytes + bytes > input.maxBytes) {
        limitExceeded(
          `Project event hydration exceeded the ${input.maxBytes}-byte bound`
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
      !Number.isInteger(nextSequence) ||
      nextSequence !== lastSequence
    ) {
      invalidResponse('Run event replay returned an invalid next_sequence');
    }
    if (response.has_more !== true) {
      // Unroll the ring back into ascending sequence order before publishing.
      input.events.push(
        ...retainedEvents.slice(retainStart),
        ...retainedEvents.slice(0, retainStart)
      );
      input.budget.events += retainedEvents.length;
      return { lastSequence, truncated };
    }
    if (response.events.length === 0 || nextSequence <= cursor) {
      invalidResponse('Run event replay cursor did not advance');
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
    >
  > & { signal?: AbortSignal }
): Promise<{
  snapshot: ProjectSnapshotInput;
  budget: HydrationBudget;
  runCount: number;
}> {
  throwIfAborted(options.signal);
  const response = await fetchProjectRunsWithDeadline(
    projectId,
    options.maxRuns,
    options.runListTimeoutMs,
    options.signal
  );
  throwIfAborted(options.signal);
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

  for (const run of runs) {
    const remainingEvents = options.maxEvents - budget.events;
    if (remainingEvents <= 0) {
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
      retainLimit: remainingEvents,
      // A single response page of concurrent appends can extend beyond the
      // descriptor version. Validate and ring-retain that bounded race window.
      maxScannedEvents: options.maxEvents + options.eventPageSize,
    });
    if (replay.lastSequence < run.version) {
      invalidResponse('Run event replay ended before the listed Run version');
    }
    if (replay.truncated) eventsTruncated = true;
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
        run_version: run.version,
        origin: run.origin,
        resume_blocked_reason: run.resumeBlockedReason,
      })),
      recent_events: events,
      events_truncated: eventsTruncated,
    },
    budget,
    runCount: runs.length,
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
  const maxEvents = boundedInteger(maxEventsInput, DEFAULT_MAX_EVENTS);
  const maxBytes = boundedInteger(maxBytesInput, DEFAULT_MAX_BYTES);
  const maxEventBytes = Math.min(
    boundedInteger(maxEventBytesInput, DEFAULT_MAX_EVENT_BYTES),
    maxBytes
  );
  const runListTimeoutMs = boundedInteger(
    runListTimeoutMsInput,
    DEFAULT_RUN_LIST_TIMEOUT_MS
  );

  const replacement = store.beginSnapshotReplacement();
  if (!replacement) {
    throw new ProjectEventStoreHydrationError(
      'A Project snapshot rebuild is already in progress',
      'replacement_busy'
    );
  }

  const cancelReplacement = () => store.cancelSnapshotReplacement(replacement);
  signal?.addEventListener('abort', cancelReplacement, { once: true });
  try {
    const loaded = await loadProjectSnapshot(projectId, {
      signal,
      maxRuns,
      eventPageSize,
      maxEventPages,
      maxEvents,
      maxBytes,
      maxEventBytes,
      runListTimeoutMs,
    });
    throwIfAborted(signal);
    if (!store.commitSnapshotReplacement(replacement, loaded.snapshot)) {
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
      eventsTruncated: Boolean(loaded.snapshot.events_truncated),
    };
  } catch (error) {
    store.cancelSnapshotReplacement(replacement);
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancelReplacement);
  }
}
