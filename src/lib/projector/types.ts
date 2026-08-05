export type ProjectorMode = 'live' | 'rehydrate' | 'playback';

export type CanonicalProjectEvent = {
  eventId: string;
  projectId: string;
  runId: string;
  runSequence: number;
  runVersion: number;
  cloudCursor: number | null;
  eventType: string;
  payload: Record<string, unknown>;
  legacyStep: string | null;
  createdAt: string;
  source: 'canonical' | 'chat_step_v1' | 'indexeddb_v1' | 'local_memory_v1';
  raw: unknown;
};

export type ProjectedLegacyStep = {
  eventId: string;
  stepId: number | string;
  taskId: string;
  projectId: string;
  step: string;
  data: unknown;
  timestamp: number | null;
  runSequence: number;
  cloudCursor: number | null;
  source: CanonicalProjectEvent['source'];
};

export type ProjectedRun = {
  runId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  lastSequence: number;
  runVersion: number;
  updatedAt: string;
};

export type ProjectViewState = {
  projectId: string;
  mode: ProjectorMode;
  seenEventIds: Record<string, true>;
  currentCursor: number;
  eventsTruncated: boolean;
  lastSyncedAt: string | null;
  needsResync: boolean;
  resyncReason: string | null;
  resyncTargetCursor: number | null;
  runs: Record<string, ProjectedRun>;
  legacySteps: ProjectedLegacyStep[];
  unknownEvents: CanonicalProjectEvent[];
};

export type ProjectorEffect =
  | { type: 'scroll_to_latest'; eventId: string }
  | { type: 'notify_terminal'; eventId: string; runId: string; status: string }
  | { type: 'request_resync'; reason: string };

export type ProjectSnapshotInput = {
  project_id: string;
  current_cursor: number;
  runs?: Array<{
    run_id: string;
    status: string;
    expected_next_run_sequence: number;
    updated_at: string;
  }>;
  recent_events: unknown[];
  events_truncated?: boolean;
};
