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

import { getAccountEnvironmentKey } from '@/lib/authEnvironment';
import type { DurableRunSummaryInput } from '@/lib/projector/runSummary';
import { runProjectionStore } from '@/lib/runEvents/projectionStore';
import { fetchProjectRuns } from '@/service/projectRunsApi';
import { getAuthStore } from '@/store/authStore';

/** Read bounded summaries, never replay events or acquire an execution/SSE owner. */
export async function refreshSessionNavStatuses(
  projectIds: readonly string[],
  accountKey: string,
  isCurrent: (projectId: string) => boolean
): Promise<void> {
  const remaining = [...new Set(projectIds)];
  const current = (projectId: string) =>
    getAccountEnvironmentKey(getAuthStore()) === accountKey &&
    isCurrent(projectId);
  await Promise.all(
    Array.from({ length: Math.min(4, remaining.length) }, async () => {
      for (
        let projectId = remaining.shift();
        projectId;
        projectId = remaining.shift()
      ) {
        if (!current(projectId)) continue;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1200);
        try {
          const response = await fetchProjectRuns(
            projectId,
            1,
            controller.signal,
            accountKey
          );
          if (!current(projectId) || response.project_id !== projectId)
            continue;
          const summaries = (response.runs ?? []).filter(
            (run) =>
              run.project_id === projectId &&
              typeof run.run_id === 'string' &&
              typeof run.status === 'string' &&
              (typeof run.updated_at === 'number' ||
                typeof run.updated_at === 'string')
          ) as DurableRunSummaryInput[];
          // mergeRunSummary owns validation and version precedence. A late GET
          // cannot roll back an event that arrived while the list was loading.
          runProjectionStore.upsertRunSummaries(projectId, summaries);
        } catch {
          // Unsupported/offline Brain: keep an honest unknown/last-known icon.
          // The next focus or backend-ready reconciliation can retry.
        } finally {
          clearTimeout(timeout);
        }
      }
    })
  );
}
