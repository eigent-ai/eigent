export * from './decode';
export * from './effects';
export * from './importers';
export * from './normalize';
export * from './reduce';
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
  snapshot: ProjectSnapshotInput
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
  return {
    ...projected,
    currentCursor: snapshot.current_cursor,
    needsResync: false,
    resyncReason: null,
    runs,
  };
}
