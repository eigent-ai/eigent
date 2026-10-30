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

import { fetchGet } from '@/api/http';
import {
  ACTIVE_DURABLE_RUN_STATUSES,
  fetchActiveProjectRuns,
  type ProjectRunsResponse,
} from '@/service/projectRunsApi';
import type { CloseExecutionClass } from '@/shared/windowClose';

type CloseRunAssessment = CloseExecutionClass | 'idle';

interface AssessCloseRunStateOptions {
  projectIds: Iterable<string>;
  legacyActive: boolean;
  signal?: AbortSignal;
  fetchRuns?: typeof fetchActiveProjectRuns;
}

const ACTIVE_STATUS_SET = new Set<string>(ACTIVE_DURABLE_RUN_STATUSES);

function responseHasActiveRun(response: ProjectRunsResponse): boolean {
  if (!Array.isArray(response.runs)) {
    throw new Error('Canonical Run registry returned an invalid response');
  }
  return response.runs.some((run) => {
    if (typeof run.status !== 'string') {
      throw new Error('Canonical Run registry returned an invalid status');
    }
    if (!ACTIVE_STATUS_SET.has(run.status)) {
      throw new Error(
        `Canonical Run registry ignored its active-status filter: ${run.status}`
      );
    }
    return true;
  });
}

/**
 * Classify close behavior from the local durable registry plus the temporary
 * legacy SSE lane. A rejected read is intentionally left to the caller so the
 * UI can fail closed instead of claiming that no work is running.
 */
export async function assessCloseRunState({
  projectIds,
  legacyActive,
  signal,
  fetchRuns = fetchActiveProjectRuns,
}: AssessCloseRunStateOptions): Promise<CloseRunAssessment> {
  const uniqueProjectIds = [...new Set(projectIds)].filter(Boolean);
  const responses = await Promise.all(
    uniqueProjectIds.map((projectId) => fetchRuns(projectId, signal))
  );
  const canonicalActive = responses.some(responseHasActiveRun);

  if (canonicalActive && legacyActive) return 'mixed';
  if (canonicalActive) return 'canonical-durable';
  if (legacyActive) return 'legacy-stream';
  return 'idle';
}

export async function fetchActiveLocalExecution(
  signal?: AbortSignal
): Promise<{ active: boolean }> {
  return fetchGet('/runs/active', undefined, undefined, { signal });
}

/** A failed or malformed registry read is unknown; callers must confirm. */
export async function assessGlobalCloseRunState({
  legacyActive,
  signal,
  fetchRuns = fetchActiveLocalExecution,
}: {
  legacyActive: boolean;
  signal?: AbortSignal;
  fetchRuns?: typeof fetchActiveLocalExecution;
}): Promise<CloseRunAssessment> {
  const response = await fetchRuns(signal);
  if (typeof response?.active !== 'boolean') {
    throw new Error('Canonical Run registry returned an invalid response');
  }
  if (response.active && legacyActive) return 'mixed';
  if (response.active) return 'canonical-durable';
  if (legacyActive) return 'legacy-stream';
  return 'idle';
}
