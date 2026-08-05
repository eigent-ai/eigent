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
  'running',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);

function snapshotRunStatus(value: string): ProjectedRun['status'] {
  return SNAPSHOT_RUN_STATUSES.has(value as ProjectedRun['status'])
    ? (value as ProjectedRun['status'])
    : 'running';
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
  const runs = { ...projected.runs };
  for (const aggregate of snapshot.runs || []) {
    const recent = runs[aggregate.run_id];
    runs[aggregate.run_id] = {
      runId: aggregate.run_id,
      status: snapshotRunStatus(aggregate.status),
      lastSequence: Math.max(
        recent?.lastSequence || 0,
        aggregate.expected_next_run_sequence - 1
      ),
      runVersion: recent?.runVersion || 0,
      updatedAt: aggregate.updated_at,
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
        runs[runId] = existing;
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
        left.runSequence !== right.runSequence
      ) {
        return left.runSequence - right.runSequence;
      }
      if (left.timestamp !== null && right.timestamp !== null) {
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
    legacySteps,
    unknownEvents,
  };
}
