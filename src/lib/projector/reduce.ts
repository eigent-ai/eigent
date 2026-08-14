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

import type {
  CanonicalProjectEvent,
  ProjectedArtifact,
  ProjectedRun,
  ProjectorMode,
  ProjectViewState,
} from './types';

const RUN_STATUS_BY_EVENT: Record<string, ProjectedRun['status']> = {
  'run.attempt_created': 'running',
  'run.attempt_started': 'running',
  'run.completed': 'completed',
  'run.failed': 'failed',
  'run.deadline_reached': 'failed',
  'run.cancelled': 'cancelled',
  'run.interrupted': 'interrupted',
  'runtime.interrupted': 'interrupted',
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)])
    );
  }
  return value;
}

function sameAskData(left: unknown, right: unknown): boolean {
  return (
    JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right))
  );
}

const CROSS_LANE_MATCH_WINDOW_SECONDS = 120;

function findEquivalentCrossLaneStep(
  state: ProjectViewState,
  event: CanonicalProjectEvent,
  data: unknown
): number {
  if (!event.legacyStep) return -1;
  const eventIsCanonical = event.source === 'canonical';
  const eventTimestamp = Date.parse(event.createdAt) / 1000;
  if (!Number.isFinite(eventTimestamp)) return -1;

  for (let index = state.legacySteps.length - 1; index >= 0; index -= 1) {
    const step = state.legacySteps[index];
    if (
      step.projectId !== event.projectId ||
      step.taskId !== event.runId ||
      step.step !== event.legacyStep ||
      (step.source === 'canonical') === eventIsCanonical ||
      (step.crossLaneEventIds?.length || 0) > 0 ||
      step.timestamp === null ||
      Math.abs(step.timestamp - eventTimestamp) >
        CROSS_LANE_MATCH_WINDOW_SECONDS ||
      !sameAskData(step.data, data)
    ) {
      continue;
    }
    return index;
  }
  return -1;
}

function hasEquivalentOpenAsk(
  state: ProjectViewState,
  event: CanonicalProjectEvent,
  data: unknown
): boolean {
  for (let index = state.legacySteps.length - 1; index >= 0; index -= 1) {
    const step = state.legacySteps[index];
    if (step.projectId !== event.projectId || step.taskId !== event.runId) {
      continue;
    }
    if (step.step === 'end' || step.step === 'human_reply') {
      return false;
    }
    if (step.step === 'ask' && sameAskData(step.data, data)) {
      return true;
    }
  }
  return false;
}

export function createProjectViewState(
  projectId: string,
  mode: ProjectorMode
): ProjectViewState {
  return {
    projectId,
    mode,
    seenEventIds: {},
    currentCursor: 0,
    eventsTruncated: false,
    lastSyncedAt: null,
    needsResync: false,
    resyncReason: null,
    resyncTargetCursor: null,
    runs: {},
    artifactsByRun: {},
    legacySteps: [],
    unknownEvents: [],
  };
}

export function completeProjectViewResync(
  state: ProjectViewState,
  authoritativeCursor: number
): ProjectViewState {
  const deltaRecoverable =
    state.resyncReason?.startsWith('cloud_cursor_gap:') ||
    state.resyncReason?.startsWith('run_sequence_gap:');
  if (
    !state.needsResync ||
    !deltaRecoverable ||
    state.currentCursor < authoritativeCursor ||
    (state.resyncTargetCursor !== null &&
      state.currentCursor < state.resyncTargetCursor)
  ) {
    return state;
  }
  return {
    ...state,
    needsResync: false,
    resyncReason: null,
    resyncTargetCursor: null,
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
      resyncTargetCursor: null,
    };
  }

  if (
    event.cloudCursor !== null &&
    event.source === 'canonical' &&
    event.cloudCursor <= state.currentCursor
  ) {
    // A snapshot watermark covers canonical events that precede it even when
    // their individual event IDs were truncated from the snapshot payload.
    return state;
  }

  let gapReason: string | null = null;
  if (
    event.cloudCursor !== null &&
    event.source === 'canonical' &&
    event.cloudCursor > state.currentCursor + 1 &&
    (state.currentCursor > 0 || state.mode === 'live')
  ) {
    gapReason = `cloud_cursor_gap:${state.currentCursor + 1}:${event.cloudCursor}`;
  }
  const previousRun = state.runs[event.runId];
  if (
    event.source === 'canonical' &&
    event.runSequence > (previousRun?.lastSequence || 0) + 1 &&
    (previousRun !== undefined || state.mode === 'live')
  ) {
    gapReason = `run_sequence_gap:${event.runId}:${(previousRun?.lastSequence || 0) + 1}:${event.runSequence}`;
  }
  if (gapReason) {
    // Do not consume the out-of-order event or move the authoritative cursor.
    // Delta replay must see this event again after filling the missing prefix.
    return {
      ...state,
      needsResync: true,
      resyncReason: gapReason,
      resyncTargetCursor: event.cloudCursor,
    };
  }

  const status =
    RUN_STATUS_BY_EVENT[event.eventType] ||
    (event.legacyStep === 'end'
      ? 'completed'
      : previousRun?.status || 'running');
  const run: ProjectedRun = {
    runId: event.runId,
    status,
    // Legacy ChatStep IDs are global database IDs, not Run-local sequences.
    // They must never move the canonical Run gap-detection watermark.
    lastSequence:
      event.source === 'canonical'
        ? Math.max(previousRun?.lastSequence || 0, event.runSequence)
        : previousRun?.lastSequence || 0,
    runVersion:
      event.source === 'canonical'
        ? Math.max(previousRun?.runVersion || 0, event.runVersion)
        : previousRun?.runVersion || 0,
    updatedAt: event.createdAt,
  };
  const legacyStepId =
    (event.payload.__legacy_step_id as number | string | undefined) ||
    event.eventId;
  const legacyData = event.payload.__legacy_data ?? event.payload;
  let artifactsByRun = state.artifactsByRun;
  if (event.eventType === 'artifact.manifest.finalized') {
    const rawArtifacts = Array.isArray(event.payload.artifacts)
      ? event.payload.artifacts
      : [];
    const projectedArtifacts: ProjectedArtifact[] = rawArtifacts.flatMap(
      (raw) => {
        if (!raw || typeof raw !== 'object') return [];
        const value = raw as Record<string, unknown>;
        const relativePath =
          typeof value.relativePath === 'string' ? value.relativePath : '';
        const name =
          typeof value.filename === 'string'
            ? value.filename
            : relativePath.split('/').filter(Boolean).at(-1) || '';
        if (!relativePath || !name) return [];
        return [
          {
            artifactId:
              typeof value.artifact_id === 'string'
                ? value.artifact_id
                : `${event.runId}:${relativePath}`,
            runId: event.runId,
            name,
            relativePath,
            changeType:
              value.changeType === 'generated' ? 'generated' : 'changed',
            size:
              typeof value.size === 'number' && Number.isFinite(value.size)
                ? value.size
                : null,
            modifiedAt:
              typeof value.modifiedAt === 'number' &&
              Number.isFinite(value.modifiedAt)
                ? value.modifiedAt
                : null,
            uploadPolicy:
              typeof value.uploadPolicy === 'string'
                ? value.uploadPolicy
                : null,
            localPathAvailable: value.localPathAvailable === true,
          },
        ];
      }
    );
    artifactsByRun = {
      ...artifactsByRun,
      [event.runId]: projectedArtifacts,
    };
  }
  if (event.eventType === 'artifact.uploaded') {
    const artifactId =
      typeof event.payload.artifact_id === 'string'
        ? event.payload.artifact_id
        : '';
    const rawAsset =
      event.payload.asset_ref && typeof event.payload.asset_ref === 'object'
        ? (event.payload.asset_ref as Record<string, unknown>)
        : null;
    const key = typeof rawAsset?.key === 'string' ? rawAsset.key : '';
    if (artifactId && key) {
      artifactsByRun = {
        ...artifactsByRun,
        [event.runId]: (artifactsByRun[event.runId] || []).map((artifact) =>
          artifact.artifactId === artifactId
            ? {
                ...artifact,
                assetRef: {
                  key,
                  chatFileId:
                    typeof rawAsset?.chat_file_id === 'number'
                      ? rawAsset.chat_file_id
                      : undefined,
                  bucket:
                    typeof rawAsset?.bucket === 'string'
                      ? rawAsset.bucket
                      : undefined,
                  filename:
                    typeof rawAsset?.filename === 'string'
                      ? rawAsset.filename
                      : undefined,
                  size:
                    typeof rawAsset?.size === 'number'
                      ? rawAsset.size
                      : undefined,
                  contentType:
                    typeof rawAsset?.content_type === 'string'
                      ? rawAsset.content_type
                      : undefined,
                },
              }
            : artifact
        ),
      };
    }
  }
  const hasLegacyStepId =
    event.legacyStep !== null &&
    state.legacySteps.some(
      (step) =>
        step.projectId === event.projectId &&
        step.taskId === event.runId &&
        String(step.stepId) === String(legacyStepId)
    );
  const equivalentCrossLaneStep = hasLegacyStepId
    ? -1
    : findEquivalentCrossLaneStep(state, event, legacyData);
  const hasLegacyStep =
    hasLegacyStepId ||
    equivalentCrossLaneStep >= 0 ||
    (event.legacyStep === 'ask' &&
      hasEquivalentOpenAsk(state, event, legacyData));
  let legacySteps = state.legacySteps;
  if (equivalentCrossLaneStep >= 0) {
    legacySteps = state.legacySteps.map((step, index) =>
      index === equivalentCrossLaneStep
        ? {
            ...step,
            crossLaneEventIds: [
              ...(step.crossLaneEventIds || []),
              event.eventId,
            ],
          }
        : step
    );
  } else if (event.legacyStep && !hasLegacyStep) {
    legacySteps = [
      ...state.legacySteps,
      {
        eventId: event.eventId,
        stepId: legacyStepId,
        taskId: event.runId,
        projectId: event.projectId,
        step: event.legacyStep,
        data: legacyData,
        timestamp: Date.parse(event.createdAt) / 1000 || null,
        runSequence: event.runSequence,
        cloudCursor: event.cloudCursor,
        source: event.source,
      },
    ];
  }

  return {
    ...state,
    seenEventIds: { ...state.seenEventIds, [event.eventId]: true },
    currentCursor:
      event.cloudCursor === null
        ? state.currentCursor
        : Math.max(state.currentCursor, event.cloudCursor),
    lastSyncedAt: event.createdAt,
    needsResync: state.needsResync,
    resyncReason: state.resyncReason,
    runs: { ...state.runs, [event.runId]: run },
    artifactsByRun,
    legacySteps,
    unknownEvents:
      event.legacyStep ||
      RUN_STATUS_BY_EVENT[event.eventType] ||
      event.eventType.startsWith('artifact.')
        ? state.unknownEvents
        : [...state.unknownEvents, event],
  };
}
