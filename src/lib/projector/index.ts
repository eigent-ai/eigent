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
import {
  createProjectViewState,
  mergeLegacyMirrorSteps,
  reduceProjectedRun,
  reduceProjectView,
} from './reduce';
import { TERMINAL_RUN_STATUSES } from './runSummary';
import type {
  CanonicalProjectEvent,
  ProjectedRun,
  ProjectorEffect,
  ProjectorMode,
  ProjectSnapshotInput,
  ProjectViewState,
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
  const snapshotEvents = snapshot.recent_events.map((raw) =>
    raw && typeof raw === 'object' && 'eventId' in raw && 'runSequence' in raw
      ? (raw as CanonicalProjectEvent)
      : normalizeEvent(raw)
  );
  const projected = projectRawEvents(
    snapshot.project_id,
    snapshotEvents,
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
  const aggregateRunVersions = new Map<string, number>();
  const acceptedRunEvents = new Map<string, CanonicalProjectEvent[]>();
  for (const event of snapshotEvents) {
    if (
      event.source === 'canonical' &&
      event.projectId === snapshot.project_id &&
      projected.seenEventIds[event.eventId]
    ) {
      const events = acceptedRunEvents.get(event.runId) ?? [];
      events.push(event);
      acceptedRunEvents.set(event.runId, events);
    }
  }
  for (const aggregate of snapshot.runs || []) {
    if (Object.prototype.hasOwnProperty.call(aggregate, 'origin')) {
      aggregateOriginAuthorities.add(aggregate.run_id);
    }
    const recent = runs[aggregate.run_id];
    const aggregateRunVersion = snapshotRunVersion(aggregate);
    if (aggregateRunVersion !== null)
      aggregateRunVersions.set(aggregate.run_id, aggregateRunVersion);
    const status = snapshotRunStatus(aggregate.status);
    const previousRun =
      previous?.projectId === snapshot.project_id
        ? previous.runs[aggregate.run_id]
        : undefined;
    // Start with the aggregate's explicit state. An observation-only tail's
    // default running projection is not evidence of a lifecycle transition.
    let run: ProjectedRun = {
      runId: aggregate.run_id,
      status,
      lastSequence: Math.max(
        recent?.lastSequence || 0,
        aggregate.expected_next_run_sequence - 1
      ),
      runVersion: aggregateRunVersion ?? recent?.runVersion ?? 0,
      updatedAt: aggregate.updated_at,
      origin: authoritativeSnapshotRunOrigin(aggregate, recent),
      resumeBlockedReason:
        aggregate.resume_blocked_reason ?? recent?.resumeBlockedReason ?? null,
      totalAttemptElapsedMs:
        typeof aggregate.total_attempt_elapsed_ms === 'number' &&
        Number.isFinite(aggregate.total_attempt_elapsed_ms) &&
        aggregate.total_attempt_elapsed_ms >= 0
          ? aggregate.total_attempt_elapsed_ms
          : null,
      ...(typeof aggregate.totalAttemptElapsedAt === 'string' &&
      Number.isFinite(Date.parse(aggregate.totalAttemptElapsedAt))
        ? { totalAttemptElapsedAt: aggregate.totalAttemptElapsedAt }
        : {}),
      ...(TERMINAL_RUN_STATUSES.has(status) && previousRun?.status === status
        ? { latestAttempt: previousRun.latestAttempt }
        : {}),
    };
    if (aggregateRunVersion !== null) {
      let throughSequence: number | null = null;
      for (const event of acceptedRunEvents.get(aggregate.run_id) ?? []) {
        if (
          event.runVersion < aggregateRunVersion ||
          (run.origin && event.origin && run.origin !== event.origin)
        )
          continue;
        // Project from unknown only to recognize explicit state receipts using
        // the live reducer's existing event and continued-attempt rules.
        const explicitStatus = reduceProjectedRun(
          {
            runId: event.runId,
            status: 'unknown',
            runVersion: 0,
            lastSequence: 0,
            updatedAt: event.createdAt,
          },
          event
        ).status;
        const next = reduceProjectedRun(run, event);
        if (
          event.runVersion === aggregateRunVersion ||
          explicitStatus !== 'unknown' ||
          (throughSequence !== null &&
            event.runSequence === throughSequence + 1) ||
          TERMINAL_RUN_STATUSES.has(run.status)
        ) {
          run = { ...next, origin: run.origin };
          throughSequence = event.runSequence;
        } else {
          // A gap can hide recovery. Keep the last proven state/version so a
          // later GET can settle it, while invalidating stale active elapsed.
          run = {
            ...run,
            totalAttemptElapsedMs: next.totalAttemptElapsedMs,
            totalAttemptElapsedAt: next.totalAttemptElapsedAt,
          };
          throughSequence = null;
        }
      }
    }
    runs[aggregate.run_id] = run;
  }
  const mergeExistingState =
    previous !== null &&
    previous !== undefined &&
    previous.projectId === snapshot.project_id;
  if (mergeExistingState) {
    const checkpointRuns = { ...previous.runs };
    for (const event of snapshotEvents) {
      const checkpoint = checkpointRuns[event.runId];
      if (
        checkpoint &&
        event.source === 'canonical' &&
        projected.seenEventIds[event.eventId] &&
        (aggregateRunVersions.get(event.runId) ?? 0) <= checkpoint.runVersion &&
        event.runSequence > checkpoint.lastSequence &&
        (event.runSequence === checkpoint.lastSequence + 1 ||
          TERMINAL_RUN_STATUSES.has(checkpoint.status)) &&
        !(
          checkpoint.origin &&
          event.origin &&
          checkpoint.origin !== event.origin
        )
      ) {
        // A newer aggregate supersedes the retained checkpoint. Resumable
        // states need a continuous prefix, since a tail can omit recovery.
        // Final Runs cannot resume; keep their status/elapsed facts across
        // post-terminal observation tails, as the live reducer does.
        checkpointRuns[event.runId] = reduceProjectedRun(checkpoint, event);
      }
    }
    for (const [runId, existing] of Object.entries(checkpointRuns)) {
      const snapshotRun = runs[runId];
      const existingElapsedAt = Date.parse(
        existing.totalAttemptElapsedAt ?? ''
      );
      const snapshotElapsedAt = Date.parse(
        snapshotRun?.totalAttemptElapsedAt ?? ''
      );
      // A status GET can lead the event cursor. Compare execution versions
      // before cursor/time, and retain the fresher same-version elapsed read.
      if (
        !snapshotRun ||
        existing.runVersion > snapshotRun.runVersion ||
        (existing.runVersion === snapshotRun.runVersion &&
          ((existing.status !== 'unknown' &&
            existing.status !== snapshotRun.status) ||
            existing.lastSequence > snapshotRun.lastSequence ||
            (existing.lastSequence === snapshotRun.lastSequence &&
              existing.updatedAt > snapshotRun.updatedAt) ||
            (existing.totalAttemptElapsedMs != null &&
              Number.isFinite(existingElapsedAt) &&
              (!Number.isFinite(snapshotElapsedAt) ||
                existingElapsedAt > snapshotElapsedAt))))
      ) {
        runs[runId] = snapshotRun
          ? {
              ...existing,
              lastSequence: Math.max(
                existing.lastSequence,
                snapshotRun.lastSequence
              ),
              // Snapshot Run aggregates are the provenance authority even when
              // buffered live delivery is newer for status/sequence purposes.
              origin: aggregateOriginAuthorities.has(runId)
                ? snapshotRun.origin
                : (existing.origin ?? snapshotRun.origin ?? null),
            }
          : existing;
      } else if (existing.lastSequence > snapshotRun.lastSequence) {
        // A newer aggregate is not permission to rewind observed event history.
        runs[runId] = { ...snapshotRun, lastSequence: existing.lastSequence };
      }
    }
  }
  const legacySteps = mergeExistingState
    ? mergeLegacyMirrorSteps(previous.legacySteps, projected.legacySteps)
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
  const artifactsByRun: ProjectViewState['artifactsByRun'] = {};
  const artifactManifestsByRun: NonNullable<
    ProjectViewState['artifactManifestsByRun']
  > = {};
  for (const source of [
    mergeExistingState ? previous : null,
    projected,
    artifactProjection,
  ]) {
    if (!source) continue;
    for (const [runId, artifacts] of Object.entries(
      source.artifactsByRun || {}
    )) {
      const manifest = source.artifactManifestsByRun?.[runId];
      const existing = artifactManifestsByRun[runId];
      const sourceRunSequence = source.runs[runId]?.lastSequence ?? 0;
      const previousRunSequence = previous?.runs[runId]?.lastSequence ?? 0;
      const newerRunClearsFreeze = Boolean(
        existing?.frozenAfterInterruption &&
        manifest &&
        !manifest.frozenAfterInterruption &&
        ['pending', 'running'].includes(source.runs[runId]?.status || '') &&
        sourceRunSequence > previousRunSequence
      );
      if (
        existing &&
        (!manifest ||
          existing.runSequence > manifest.runSequence ||
          (existing.runSequence === manifest.runSequence &&
            existing.frozenAfterInterruption &&
            !manifest.frozenAfterInterruption &&
            !newerRunClearsFreeze) ||
          (existing.runSequence === manifest.runSequence &&
            existing.frozenAfterInterruption !== undefined &&
            manifest.frozenAfterInterruption === undefined))
      )
        continue;
      const previousById = new Map(
        (artifactsByRun[runId] || []).map((artifact) => [
          artifact.artifactId,
          artifact,
        ])
      );
      artifactsByRun[runId] = artifacts.map((artifact) => ({
        ...artifact,
        assetRef:
          artifact.assetRef ?? previousById.get(artifact.artifactId)?.assetRef,
      }));
      if (manifest) artifactManifestsByRun[runId] = manifest;
    }
  }
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
    artifactsByRun,
    artifactManifestsByRun,
    legacySteps,
    unknownEvents,
  };
}
