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

import type { ProjectedRun } from './types';

export type DurableRunSummaryInput = {
  run_id: string;
  project_id: string;
  status: string;
  version?: number;
  updated_at: number | string;
  origin?: 'local' | 'cloud_restore' | 'remote';
  resume_blocked_reason?: string | null;
  total_attempt_elapsed_ms?: number | null;
  latest_attempt?: {
    attempt_number: number;
    status: string;
    resume_request_id?: string;
  } | null;
};

export const TERMINAL_RUN_STATUSES = new Set<ProjectedRun['status']>([
  'completed',
  'failed',
  'cancelled',
]);

const RUN_STATUSES = new Set<ProjectedRun['status']>([
  'pending',
  'running',
  'waiting_for_user',
  'cancelling',
  'interrupted',
  ...TERMINAL_RUN_STATUSES,
]);

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
  return {
    ...existing,
    runId: summary.run_id,
    status,
    lastSequence: existing?.lastSequence ?? 0,
    runVersion: version ?? 0,
    updatedAt: new Date(timestamp).toISOString(),
    origin: summary.origin ?? existing?.origin ?? null,
    resumeBlockedReason:
      summary.resume_blocked_reason === undefined
        ? (existing?.resumeBlockedReason ?? null)
        : summary.resume_blocked_reason,
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
    totalAttemptElapsedMs:
      typeof elapsed === 'number' && Number.isFinite(elapsed) && elapsed >= 0
        ? elapsed
        : null,
    totalAttemptElapsedAt:
      typeof elapsed === 'number' && Number.isFinite(elapsed) && elapsed >= 0
        ? receivedAt
        : null,
  };
}
