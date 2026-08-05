import type {
  CanonicalProjectEvent,
  ProjectViewState,
  ProjectedRun,
  ProjectorMode,
} from './types';

const TERMINAL_STATUS: Record<string, ProjectedRun['status']> = {
  'run.completed': 'completed',
  'run.failed': 'failed',
  'run.timed_out': 'failed',
  'run.cancelled': 'cancelled',
  'run.interrupted': 'interrupted',
};

export function createProjectViewState(
  projectId: string,
  mode: ProjectorMode
): ProjectViewState {
  return {
    projectId,
    mode,
    seenEventIds: {},
    currentCursor: 0,
    lastSyncedAt: null,
    needsResync: false,
    resyncReason: null,
    runs: {},
    legacySteps: [],
    unknownEvents: [],
  };
}

export function reduceProjectView(
  state: ProjectViewState,
  event: CanonicalProjectEvent
): ProjectViewState {
  if (state.seenEventIds[event.eventId]) {
    return state;
  }
  if (event.projectId !== state.projectId) {
    return {
      ...state,
      needsResync: true,
      resyncReason: `project_scope_mismatch:${event.projectId}`,
    };
  }

  let needsResync = state.needsResync;
  let resyncReason = state.resyncReason;
  if (
    event.cloudCursor !== null &&
    event.source === 'canonical' &&
    event.cloudCursor > state.currentCursor + 1 &&
    (state.currentCursor > 0 || state.mode === 'live')
  ) {
    needsResync = true;
    resyncReason = `cloud_cursor_gap:${state.currentCursor + 1}:${event.cloudCursor}`;
  }
  const previousRun = state.runs[event.runId];
  if (
    event.source === 'canonical' &&
    event.runSequence > (previousRun?.lastSequence || 0) + 1 &&
    (previousRun !== undefined || state.mode === 'live')
  ) {
    needsResync = true;
    resyncReason = `run_sequence_gap:${event.runId}:${(previousRun?.lastSequence || 0) + 1}:${event.runSequence}`;
  }

  const status =
    TERMINAL_STATUS[event.eventType] ||
    (event.legacyStep === 'end'
      ? 'completed'
      : previousRun?.status || 'running');
  const run: ProjectedRun = {
    runId: event.runId,
    status,
    lastSequence: Math.max(previousRun?.lastSequence || 0, event.runSequence),
    runVersion: Math.max(previousRun?.runVersion || 0, event.runVersion),
    updatedAt: event.createdAt,
  };
  const legacySteps = event.legacyStep
    ? [
        ...state.legacySteps,
        {
          eventId: event.eventId,
          stepId:
            (event.payload.__legacy_step_id as number | string | undefined) ||
            event.eventId,
          taskId: event.runId,
          projectId: event.projectId,
          step: event.legacyStep,
          data: event.payload.__legacy_data ?? event.payload,
          timestamp: Date.parse(event.createdAt) / 1000 || null,
        },
      ]
    : state.legacySteps;

  return {
    ...state,
    seenEventIds: { ...state.seenEventIds, [event.eventId]: true },
    currentCursor:
      event.cloudCursor === null
        ? state.currentCursor
        : Math.max(state.currentCursor, event.cloudCursor),
    lastSyncedAt: event.createdAt,
    needsResync,
    resyncReason,
    runs: { ...state.runs, [event.runId]: run },
    legacySteps,
    unknownEvents:
      event.legacyStep || TERMINAL_STATUS[event.eventType]
        ? state.unknownEvents
        : [...state.unknownEvents, event],
  };
}
