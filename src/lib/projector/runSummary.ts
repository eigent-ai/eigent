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

import { runTerminalReason } from '@/lib/runTerminalReason';
import type { ProjectedRun, ProjectedUnsafeResumeBlocker } from './types';

export type DurableRunSummaryInput = {
  run_id: string;
  project_id: string;
  status: string;
  version?: number;
  updated_at: number | string;
  origin?: 'local' | 'cloud_restore' | 'remote';
  resume_blocked_reason?: string | null;
  terminal_reason?: string | null;
  terminal_detail?: string | null;
  total_attempt_elapsed_ms?: number | null;
  latest_attempt?: {
    attempt_number: number;
    status: string;
    resume_request_id?: string;
  } | null;
  unsafe_resume_blockers?: Array<{
    tool_call_id: string;
    tool_name?: string | null;
    display_title?: string | null;
  }>;
};

export const TERMINAL_RUN_STATUSES = new Set<ProjectedRun['status']>([
  'completed',
  'failed',
  'cancelled',
  'timed_out',
]);

/** Run statuses that carry the cause of their latest stop. */
export function isStoppedRunStatus(status: string): boolean {
  return (
    status === 'interrupted' ||
    (TERMINAL_RUN_STATUSES as ReadonlySet<string>).has(status)
  );
}

/**
 * Replace a Run's user-wait ledger (see `ProjectedRun.userWaitMs`). Empty
 * fields are omitted so Runs that never waited keep their existing shape.
 */
export function withUserWait(
  run: ProjectedRun,
  waitMs: number,
  waitStartedAt: string | null
): ProjectedRun {
  const {
    userWaitMs: _waitMs,
    userWaitStartedAt: _waitStartedAt,
    ...rest
  } = run;
  return {
    ...rest,
    ...(Number.isFinite(waitMs) && waitMs > 0 ? { userWaitMs: waitMs } : {}),
    ...(waitStartedAt && Number.isFinite(Date.parse(waitStartedAt))
      ? { userWaitStartedAt: waitStartedAt }
      : {}),
  };
}

/**
 * Active attempt time of a Run with an elapsed checkpoint at `atMs`, or null
 * without a usable checkpoint. Waits for the user after the checkpoint are
 * left out; the checkpoint itself already leaves out earlier ones.
 */
export function checkpointElapsedMsAt(
  run: ProjectedRun,
  atMs: number
): number | null {
  const checkpointMs = run.totalAttemptElapsedMs;
  const anchorMs = Date.parse(run.totalAttemptElapsedAt ?? '');
  if (
    typeof checkpointMs !== 'number' ||
    !Number.isFinite(checkpointMs) ||
    !Number.isFinite(anchorMs) ||
    !Number.isFinite(atMs)
  ) {
    return null;
  }
  const waitStartedMs = Date.parse(run.userWaitStartedAt ?? '');
  const openWaitMs = Number.isFinite(waitStartedMs)
    ? Math.max(0, atMs - Math.max(waitStartedMs, anchorMs))
    : 0;
  return Math.max(
    0,
    checkpointMs +
      Math.max(0, atMs - anchorMs) -
      (run.userWaitMs ?? 0) -
      openWaitMs
  );
}

const RUN_STATUSES = new Set<ProjectedRun['status']>([
  'pending',
  'running',
  'waiting_for_user',
  'cancelling',
  'interrupted',
  ...TERMINAL_RUN_STATUSES,
]);

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

/** Keep only well-formed blockers from the Brain's derived Run field. */
function unsafeResumeBlockers(value: unknown): ProjectedUnsafeResumeBlocker[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const blocker = item as Record<string, unknown> | null;
    const toolCallId = optionalText(blocker?.tool_call_id);
    return toolCallId
      ? [
          {
            toolCallId,
            toolName: optionalText(blocker?.tool_name),
            displayTitle: optionalText(blocker?.display_title),
          },
        ]
      : [];
  });
}

/** Run aggregates are status checkpoints, never event/history cursors. */
export function mergeRunSummary(
  existing: ProjectedRun | undefined,
  summary: DurableRunSummaryInput,
  receivedAt = new Date().toISOString()
): ProjectedRun | undefined {
  const version = summary.version;
  const status = summary.status as ProjectedRun['status'];
  if (version != null && (!Number.isSafeInteger(version) || version < 0))
    return existing;
  const timestamp =
    typeof summary.updated_at === 'number'
      ? summary.updated_at * (summary.updated_at < 10_000_000_000 ? 1000 : 1)
      : Date.parse(summary.updated_at);
  if (!RUN_STATUSES.has(status) || !Number.isFinite(timestamp)) return existing;
  if (
    existing &&
    (!Number.isSafeInteger(version) ||
      version! < existing.runVersion ||
      (version === existing.runVersion &&
        existing.status !== 'unknown' &&
        status !== existing.status))
  )
    return existing;
  const elapsed = summary.total_attempt_elapsed_ms;
  const elapsedMeasured =
    typeof elapsed === 'number' && Number.isFinite(elapsed) && elapsed >= 0;
  const updatedAt = new Date(timestamp).toISOString();
  const run: ProjectedRun = {
    ...existing,
    runId: summary.run_id,
    status,
    lastSequence: existing?.lastSequence ?? 0,
    runVersion: version ?? 0,
    updatedAt,
    origin: summary.origin ?? existing?.origin ?? null,
    resumeBlockedReason:
      summary.resume_blocked_reason === undefined
        ? (existing?.resumeBlockedReason ?? null)
        : summary.resume_blocked_reason,
    terminalReason:
      summary.terminal_reason === undefined
        ? (existing?.terminalReason ?? null)
        : runTerminalReason(summary.terminal_reason),
    terminalDetail:
      summary.terminal_detail === undefined
        ? (existing?.terminalDetail ?? null)
        : summary.terminal_detail,
    latestAttempt:
      summary.latest_attempt === undefined
        ? existing?.latestAttempt
        : summary.latest_attempt
          ? {
              attemptNumber: summary.latest_attempt.attempt_number,
              status: summary.latest_attempt.status,
              ...(summary.latest_attempt.resume_request_id
                ? { resumeRequestId: summary.latest_attempt.resume_request_id }
                : {}),
            }
          : null,
    totalAttemptElapsedMs: elapsedMeasured ? elapsed : null,
    totalAttemptElapsedAt: elapsedMeasured ? receivedAt : null,
    ...(summary.unsafe_resume_blockers === undefined
      ? {}
      : {
          unsafeResumeBlockers: unsafeResumeBlockers(
            summary.unsafe_resume_blockers
          ),
        }),
  };
  // A measured total already leaves out every wait for the user up to its
  // read, so the timer's wait ledger restarts there.
  if (elapsedMeasured) {
    return withUserWait(
      run,
      0,
      status === 'waiting_for_user' ? receivedAt : null
    );
  }
  return withUserWait(
    run,
    existing?.userWaitMs ?? 0,
    status !== 'waiting_for_user'
      ? null
      : existing?.status === 'waiting_for_user' && existing.userWaitStartedAt
        ? existing.userWaitStartedAt
        : updatedAt
  );
}
