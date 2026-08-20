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

export * from './adapters';
export * from './decode';
export * from './effects';
export * from './importers';
export * from './normalize';
export * from './reduce';
export * from './selectors';
export * from './types';

import { deriveLiveEffects } from './effects';
import { normalizeEvent } from './normalize';
import { createProjectViewState, reduceProjectView } from './reduce';
import type {
  ProjectSnapshotInput,
  ProjectViewState,
  ProjectedRun,
  ProjectorEffect,
  ProjectorMode,
} from './types';

const SNAPSHOT_RUN_STATUSES = new Set<ProjectedRun['status']>([
  'pending',
  'running',
  'waiting_for_user',
  'cancelling',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);

function snapshotRunStatus(value: string): ProjectedRun['status'] {
  return SNAPSHOT_RUN_STATUSES.has(value as ProjectedRun['status'])
    ? (value as ProjectedRun['status'])
    : 'unknown';
}

function snapshotRunVersion(
  aggregate: NonNullable<ProjectSnapshotInput['runs']>[number]
): number | null {
  const value = aggregate.run_version ?? aggregate.version;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function snapshotRunOrigin(value: unknown): ProjectedRun['origin'] {
  return value === 'local' || value === 'cloud_restore' || value === 'remote'
    ? value
    : null;
}

function authoritativeSnapshotRunOrigin(
  aggregate: NonNullable<ProjectSnapshotInput['runs']>[number],
  recent: ProjectedRun | undefined
): ProjectedRun['origin'] {
  return Object.prototype.hasOwnProperty.call(aggregate, 'origin')
    ? snapshotRunOrigin(aggregate.origin)
    : snapshotRunOrigin(recent?.origin);
}

export function projectRawEvents(
  projectId: string,
  rawEvents: unknown[],
  mode: ProjectorMode,
  initial?: ProjectViewState
): { state: ProjectViewState; effects: ProjectorEffect[] } {
  let state = initial || createProjectViewState(projectId, mode);
  const effects: ProjectorEffect[] = [];
  for (const raw of rawEvents) {
    const event =
      raw && typeof raw === 'object' && 'eventId' in raw && 'runSequence' in raw
        ? (raw as import('./types').CanonicalProjectEvent)
        : normalizeEvent(raw);
    const previous = state;
    state = reduceProjectView(state, event);
    effects.push(...deriveLiveEffects(previous, state, event, mode));
  }
  return { state, effects };
}

export function projectSnapshot(
  snapshot: ProjectSnapshotInput,
  previous?: ProjectViewState | null
): ProjectViewState {
  const projected = projectRawEvents(
    snapshot.project_id,
    snapshot.recent_events,
    'rehydrate'
  ).state;
  const artifactProjection = projectRawEvents(
    snapshot.project_id,
    (snapshot.artifact_events || []).map((raw) => ({
      ...normalizeEvent(raw),
      cloudCursor: null,
      source: 'chat_step_v1' as const,
    })),
    'rehydrate'
  ).state;
  const runs = { ...projected.runs };
  const aggregateOriginAuthorities = new Set<string>();
  for (const aggregate of snapshot.runs || []) {
    if (Object.prototype.hasOwnProperty.call(aggregate, 'origin')) {
      aggregateOriginAuthorities.add(aggregate.run_id);
    }
    const recent = runs[aggregate.run_id];
    const aggregateRunVersion = snapshotRunVersion(aggregate);
    // GET /runs is read before the event pages. If the Run changes while the
    // pages are loading, replay is the newer status authority; otherwise the
    // older aggregate could overwrite a terminal or decision event.
    const replayIsAtLeastAsFresh = Boolean(
      recent &&
      aggregateRunVersion !== null &&
      recent.runVersion >= aggregateRunVersion
    );
    runs[aggregate.run_id] = {
      runId: aggregate.run_id,
      status: replayIsAtLeastAsFresh
        ? recent!.status
        : snapshotRunStatus(aggregate.status),
      lastSequence: Math.max(
        recent?.lastSequence || 0,
        aggregate.expected_next_run_sequence - 1
      ),
      runVersion: Math.max(recent?.runVersion || 0, aggregateRunVersion || 0),
      updatedAt: replayIsAtLeastAsFresh
        ? recent!.updatedAt
        : aggregate.updated_at,
      origin: authoritativeSnapshotRunOrigin(aggregate, recent),
      resumeBlockedReason:
        aggregate.resume_blocked_reason ?? recent?.resumeBlockedReason ?? null,
    };
  }
  const mergeExistingState =
    previous !== null &&
    previous !== undefined &&
    previous.projectId === snapshot.project_id;
  if (mergeExistingState) {
    for (const [runId, existing] of Object.entries(previous.runs)) {
      const snapshotRun = runs[runId];
      if (
        !snapshotRun ||
        existing.lastSequence > snapshotRun.lastSequence ||
        (existing.lastSequence === snapshotRun.lastSequence &&
          existing.updatedAt > snapshotRun.updatedAt)
      ) {
        runs[runId] = snapshotRun
          ? {
              ...existing,
              // Snapshot Run aggregates are the provenance authority even when
              // buffered live delivery is newer for status/sequence purposes.
              origin: aggregateOriginAuthorities.has(runId)
                ? snapshotRun.origin
                : (existing.origin ?? snapshotRun.origin ?? null),
            }
          : existing;
      }
    }
  }
  const legacySteps = mergeExistingState
    ? [...projected.legacySteps, ...previous.legacySteps]
    : [...projected.legacySteps];
  if (mergeExistingState) {
    for (let index = legacySteps.length - 1; index >= 0; index -= 1) {
      const step = legacySteps[index];
      if (
        legacySteps.findIndex(
          (existing) =>
            existing.projectId === step.projectId &&
            existing.taskId === step.taskId &&
            String(existing.stepId) === String(step.stepId)
        ) !== index
      ) {
        legacySteps.splice(index, 1);
      }
    }
    legacySteps.sort((left, right) => {
      if (
        left.taskId === right.taskId &&
        left.source === 'canonical' &&
        right.source === 'canonical' &&
        left.runSequence !== right.runSequence
      ) {
        return left.runSequence - right.runSequence;
      }
      if (
        left.timestamp !== null &&
        right.timestamp !== null &&
        left.timestamp !== right.timestamp
      ) {
        return left.timestamp - right.timestamp;
      }
      if (left.cloudCursor !== null && right.cloudCursor !== null) {
        return left.cloudCursor - right.cloudCursor;
      }
      return 0;
    });
  }
  const unknownEvents = mergeExistingState
    ? [
        ...projected.unknownEvents,
        ...previous.unknownEvents.filter(
          (event) =>
            !projected.unknownEvents.some(
              (existing) => existing.eventId === event.eventId
            )
        ),
      ].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    : projected.unknownEvents;
  const snapshotCoversResync =
    !mergeExistingState ||
    !previous.needsResync ||
    previous.resyncTargetCursor === null ||
    snapshot.current_cursor >= previous.resyncTargetCursor;
  return {
    ...projected,
    seenEventIds: mergeExistingState
      ? { ...previous.seenEventIds, ...projected.seenEventIds }
      : projected.seenEventIds,
    currentCursor: Math.max(
      snapshot.current_cursor,
      mergeExistingState ? previous.currentCursor : 0
    ),
    eventsTruncated: Boolean(snapshot.events_truncated),
    needsResync: snapshotCoversResync ? false : previous.needsResync,
    resyncReason: snapshotCoversResync ? null : previous.resyncReason,
    resyncTargetCursor: snapshotCoversResync
      ? null
      : previous.resyncTargetCursor,
    runs,
    artifactsByRun: mergeExistingState
      ? {
          ...(previous.artifactsByRun || {}),
          ...projected.artifactsByRun,
          ...artifactProjection.artifactsByRun,
        }
      : {
          ...projected.artifactsByRun,
          ...artifactProjection.artifactsByRun,
        },
    legacySteps,
    unknownEvents,
  };
}
