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
import { projectHumanControlEvents } from '@/lib/projector/control';
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

type ProjectRunsResponse = {
  project_id?: unknown;
  runs?: unknown;
  has_more?: unknown;
};

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
  elapsedMs: number | null;
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

function hasPendingHumanControl(
  projectId: string,
  events: readonly CanonicalProjectEvent[]
): boolean {
  const control = projectHumanControlEvents(projectId, events);
  return control.orderedInteractionIds.some((interactionId) => {
    const interaction = control.interactionById[interactionId];
    return (
      interaction?.status === 'requested' &&
      (interaction.requestEventType === 'interaction.requested' ||
        interaction.requestEventType === 'approval.requested')
    );
  });
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
      item.total_attempt_elapsed_ms !== undefined &&
      item.total_attempt_elapsed_ms !== null &&
      (typeof item.total_attempt_elapsed_ms !== 'number' ||
        !Number.isInteger(item.total_attempt_elapsed_ms) ||
        item.total_attempt_elapsed_ms < 0)
    ) {
      invalidResponse(
        'Project Run listing contained an invalid total attempt elapsed time'
      );
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
      elapsedMs:
        typeof item.total_attempt_elapsed_ms === 'number'
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
  const retainedEvents: CanonicalProjectEvent[] = [];
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
      retainedEvents.push({ ...event, raw: null });
      if (retainedEvents.length > input.retainLimit) {
        retainedEvents.shift();
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
      input.events.push(...retainedEvents);
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
    >
  > & { signal?: AbortSignal }
): Promise<{
  snapshot: ProjectSnapshotInput;
  budget: HydrationBudget;
  runCount: number;
}> {
  throwIfAborted(options.signal);
  const response = (await fetchGet(
    '/runs',
    { project_id: projectId, limit: options.maxRuns },
    undefined,
    { signal: options.signal }
  )) as ProjectRunsResponse;
  throwIfAborted(options.signal);

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
  const truncatedRunIds = new Set<string>();
  const truncationRecoveryTargets = new Map<string, number>();

  // A pending HumanInteraction is a user obligation, so waiting Runs get the
  // bounded tail budget before background/completed Runs. Preserve at least
  // one slot for every later waiting Run when the configured bound permits it.
  const prioritizedRuns = [
    ...runs.filter((run) => run.status === 'waiting_for_user'),
    ...runs.filter((run) => run.status !== 'waiting_for_user'),
  ];

  for (let index = 0; index < prioritizedRuns.length; index += 1) {
    const run = prioritizedRuns[index];
    const remainingEvents = options.maxEvents - budget.events;
    if (remainingEvents <= 0) {
      // The descriptor version is not proof that this frontend reconstructed
      // the omitted journal. Advancing to it would silently swallow later live
      // events, including a HumanInteraction resolution whose request is gone.
      runSequences.set(run.runId, 0);
      if (run.version > 0) {
        eventsTruncated = true;
        truncatedRunIds.add(run.runId);
        truncationRecoveryTargets.set(run.runId, run.version);
      }
      continue;
    }
    const laterWaitingRuns = prioritizedRuns
      .slice(index + 1)
      .filter(
        (candidate) =>
          candidate.status === 'waiting_for_user' && candidate.version > 0
      ).length;
    const retainLimit =
      run.status === 'waiting_for_user'
        ? Math.max(1, remainingEvents - laterWaitingRuns)
        : remainingEvents;
    // RunJournal increments `version` and event `sequence` atomically for each
    // append. Starting near the current version gives a bounded newest tail
    // without reading/projecting an arbitrarily long historical prefix.
    const afterSequence = Math.max(0, run.version - retainLimit);
    if (afterSequence > 0) {
      eventsTruncated = true;
      truncatedRunIds.add(run.runId);
    }

    if (run.status === 'waiting_for_user' && afterSequence > 0) {
      // A newest-tail request cannot prove that an older unresolved request was
      // not omitted. Do not spend the shared hydration budget fetching a tail
      // that must be discarded; the stream owner replays this Run from zero in
      // its bounded recovery lane before any live SSE may attach.
      runSequences.set(run.runId, 0);
      truncationRecoveryTargets.set(run.runId, run.version);
      continue;
    }

    const retainedStart = events.length;
    const replay = await readRunEvents(run, {
      ...options,
      projectId,
      budget,
      seenEventIds,
      events,
      afterSequence,
      retainLimit,
      // A single response page of concurrent appends can extend beyond the
      // descriptor version. Validate and ring-retain that bounded race window.
      maxScannedEvents: options.maxEvents + options.eventPageSize,
    });
    if (replay.lastSequence < run.version) {
      invalidResponse('Run event replay ended before the listed Run version');
    }
    if (replay.truncated) {
      eventsTruncated = true;
      truncatedRunIds.add(run.runId);
    }

    if (
      run.status === 'waiting_for_user' &&
      (truncatedRunIds.has(run.runId) ||
        !hasPendingHumanControl(projectId, events.slice(retainedStart)))
    ) {
      // A partial waiting journal cannot prove it contains every unresolved
      // request. Drop the unproven tail and leave a zero watermark; the
      // per-Run truncation marker drives the safe no-control UI, while a later
      // live sequence forces bounded resync instead of vanishing.
      const droppedEventCount = events.length - retainedStart;
      events.splice(retainedStart, droppedEventCount);
      budget.events -= droppedEventCount;
      runSequences.set(run.runId, 0);
      eventsTruncated = true;
      truncatedRunIds.add(run.runId);
      if (replay.lastSequence > 0) {
        truncationRecoveryTargets.set(run.runId, replay.lastSequence);
      }
      continue;
    }
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
        ...(run.elapsedMs !== null
          ? { total_attempt_elapsed_ms: run.elapsedMs }
          : {}),
        ...(truncatedRunIds.has(run.runId) ? { events_truncated: true } : {}),
        ...(truncationRecoveryTargets.has(run.runId)
          ? {
              truncation_recovery_target: truncationRecoveryTargets.get(
                run.runId
              ),
            }
          : {}),
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
