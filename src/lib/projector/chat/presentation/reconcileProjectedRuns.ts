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

import type { ProjectedRun } from '../../types';
import type { TimelineRunView } from './types';

const ACTIVE_RUN_STATUSES = new Set<ProjectedRun['status']>([
  'pending',
  'running',
  'waiting_for_user',
  'cancelling',
]);

const TERMINAL_RUN_STATUSES = new Set<ProjectedRun['status']>([
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);

function timestampValue(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonNegativeElapsed(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function elapsedBetween(
  startedAt: string | null,
  endedAt: string | null
): number | null {
  const start = timestampValue(startedAt);
  const end = timestampValue(endedAt);
  return start !== null && end !== null ? Math.max(0, end - start) : null;
}

/**
 * Overlay the Projector's Run aggregate onto a node-derived presentation.
 * The ProjectedRun is authoritative for lifecycle state and attempt time;
 * semantic nodes remain authoritative for transcript content and ordering.
 */
export function reconcileTimelineRun(
  run: TimelineRunView,
  projectedRun: ProjectedRun | null | undefined
): TimelineRunView {
  if (!projectedRun || projectedRun.runId !== run.runId) return run;

  const status = projectedRun.status;
  const active = ACTIVE_RUN_STATUSES.has(status);
  const terminal = TERMINAL_RUN_STATUSES.has(status);
  const authoritativeUpdatedAt = projectedRun.updatedAt || null;
  const totalAttemptElapsedMs = nonNegativeElapsed(
    projectedRun.totalAttemptElapsedMs
  );
  const endedAt = active
    ? null
    : terminal
      ? authoritativeUpdatedAt || run.timestamps.endedAt
      : run.timestamps.endedAt;
  const durationMs = active
    ? null
    : (totalAttemptElapsedMs ??
      elapsedBetween(run.timestamps.startedAt, endedAt) ??
      run.timestamps.durationMs);
  const elapsedAnchor = active
    ? {
        accumulatedMs: totalAttemptElapsedMs ?? 0,
        anchoredAt:
          (totalAttemptElapsedMs !== null
            ? authoritativeUpdatedAt
            : run.timestamps.startedAt || run.timestamps.createdAt) || null,
      }
    : {
        accumulatedMs: totalAttemptElapsedMs ?? durationMs ?? 0,
        anchoredAt: null,
      };

  const nodes = run.nodes.map((node) =>
    node.kind === 'run_status' ? { ...node, status } : node
  );
  const traceRows = run.traceRows.map((row) =>
    row.kind === 'node' && row.node.kind === 'run_status'
      ? { ...row, node: { ...row.node, status } }
      : row
  );
  const runStatus = run.runStatus ? { ...run.runStatus, status } : null;

  return {
    ...run,
    status,
    nodes,
    traceRows,
    runStatus,
    timestamps: {
      ...run.timestamps,
      updatedAt: authoritativeUpdatedAt || run.timestamps.updatedAt,
      endedAt,
      durationMs,
      totalAttemptElapsedMs,
      elapsedAnchor,
    },
  };
}

/** Reconcile every composed Run with the matching authoritative aggregate. */
export function reconcileTimelineRuns(
  runs: readonly TimelineRunView[],
  projectedRunsById: Readonly<Record<string, ProjectedRun>> | null | undefined
): TimelineRunView[] {
  if (!projectedRunsById) return [...runs];
  return runs.map((run) =>
    reconcileTimelineRun(run, projectedRunsById[run.runId])
  );
}
