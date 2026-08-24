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

export type ProjectorMode = 'live' | 'rehydrate' | 'playback';

export type CanonicalSemanticStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'outcome_unknown'
  | 'cancelled'
  | 'unknown';

export type CanonicalSemanticPhase =
  | 'requested'
  | 'started'
  | 'progress'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'unknown';

export type CanonicalSemanticKind =
  | 'agent'
  | 'agent_turn'
  | 'browser_operation'
  | 'command_execution'
  | 'file_change'
  | 'file_operation'
  | 'git_conflict_resolution'
  | 'git_integration'
  | 'narration'
  | 'plan'
  | 'plan_operation'
  | 'subtask'
  | 'tool_call'
  | 'workspace_writer';

export type CanonicalSemanticSubjectType =
  | 'activity_stream'
  | 'agent'
  | 'agent_turn'
  | 'agent_workspace'
  | 'artifact'
  | 'file'
  | 'plan'
  | 'task'
  | 'tool_call'
  | 'writer_request';

export type CanonicalSemanticActorType = 'agent' | 'system' | 'user';

/** Versioned domain semantics carried by new RunJournal events. */
export interface CanonicalSemanticEnvelopeV1 {
  kind: CanonicalSemanticKind;
  subject: { type: CanonicalSemanticSubjectType; id: string };
  actor?: { type?: CanonicalSemanticActorType; id?: string; name?: string };
  lifecycle: {
    phase: CanonicalSemanticPhase;
    status: CanonicalSemanticStatus;
  };
  correlation?: Record<string, string>;
  completeness: {
    state: 'complete' | 'partial';
    missing_fields: string[];
  };
  provenance?: { source?: string };
}

export type CanonicalSemanticStatusV2 =
  CanonicalSemanticStatus | 'blocked' | 'interrupted';

export type CanonicalSemanticPhaseV2 =
  CanonicalSemanticPhase | 'blocked' | 'resumed' | 'interrupted';

export type CanonicalSemanticKindV2 = CanonicalSemanticKind | 'step';
export type CanonicalSemanticSubjectTypeV2 =
  CanonicalSemanticSubjectType | 'step';

export interface CanonicalSemanticEnvelopeV2 {
  kind: CanonicalSemanticKindV2;
  subject: { type: CanonicalSemanticSubjectTypeV2; id: string };
  actor?: { type?: CanonicalSemanticActorType; id?: string; name?: string };
  lifecycle: {
    phase: CanonicalSemanticPhaseV2;
    status: CanonicalSemanticStatusV2;
  };
  correlation?: Record<string, string>;
  completeness: {
    state: 'complete' | 'partial';
    missing_fields: string[];
  };
  provenance?: { source?: string };
}

export type CanonicalSemanticEnvelope =
  CanonicalSemanticEnvelopeV1 | CanonicalSemanticEnvelopeV2;

export type CanonicalSemanticPayloadV1 = Record<string, unknown> & {
  semantic_schema_version: 1;
  display_schema_version: 1;
  semantic: CanonicalSemanticEnvelopeV1;
};

export type CanonicalSemanticPayloadV2 = Record<string, unknown> & {
  semantic_schema_version: 2;
  display_schema_version: 1;
  semantic: CanonicalSemanticEnvelopeV2;
};

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
  origin?: 'local' | 'cloud_restore' | 'remote';
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
  crossLaneEventIds?: string[];
};

export type ProjectedRun = {
  runId: string;
  status:
    | 'unknown'
    | 'pending'
    | 'running'
    | 'waiting_for_user'
    | 'cancelling'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'interrupted';
  lastSequence: number;
  runVersion: number;
  updatedAt: string;
  origin?: 'local' | 'cloud_restore' | 'remote' | null;
  resumeBlockedReason?: string | null;
  latestAttempt?: {
    attemptNumber: number;
    status: string;
  } | null;
  totalAttemptElapsedMs?: number | null;
};

export type ProjectedArtifact = {
  artifactId: string;
  runId: string;
  name: string;
  relativePath: string;
  changeType: 'generated' | 'changed';
  size: number | null;
  modifiedAt: number | null;
  uploadPolicy: string | null;
  localPathAvailable: boolean;
  assetRef?: {
    chatFileId?: number;
    bucket?: string;
    key: string;
    filename?: string;
    size?: number;
    contentType?: string;
  };
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
  artifactsByRun: Record<string, ProjectedArtifact[]>;
  legacySteps: ProjectedLegacyStep[];
  unknownEvents: CanonicalProjectEvent[];
};

export type ProjectorEffect =
  | { type: 'scroll_to_latest'; eventId: string }
  | { type: 'request_resync'; reason: string };

export type ProjectSnapshotInput = {
  project_id: string;
  current_cursor: number;
  runs?: Array<{
    run_id: string;
    status: string;
    expected_next_run_sequence: number;
    updated_at: string;
    /** RunJournal aggregate version; aliases the latest event run_version. */
    run_version?: number;
    /** Accepted for direct snapshots shaped like the existing GET /runs API. */
    version?: number;
    origin?: string | null;
    resume_blocked_reason?: string | null;
  }>;
  recent_events: unknown[];
  artifact_events?: unknown[];
  events_truncated?: boolean;
};
