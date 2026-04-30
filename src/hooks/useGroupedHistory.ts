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

import { proxyFetchGet } from '@/api/http';
import { queryClient, queryKeys } from '@/lib/queryClient';
import type { HistoryTask, ProjectGroup } from '@/types/history';
import { useQuery, useQueryClient } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Pure fetcher — no setState callbacks, just returns data
// ---------------------------------------------------------------------------

interface FlatHistoryTask {
  id: number | string;
  task_id: string;
  project_id: string;
  project_name?: string;
  question?: string;
  tokens?: number;
  status?: number;
  created_at?: string;
  [key: string]: unknown;
}

function groupTasksByProject(items: FlatHistoryTask[]): ProjectGroup[] {
  const map = new Map<string, ProjectGroup>();

  for (const task of items) {
    const pid = task.project_id;
    if (!map.has(pid)) {
      map.set(pid, {
        project_id: pid,
        project_name: task.project_name || `Project ${pid}`,
        total_tokens: 0,
        task_count: 0,
        total_triggers: 0,
        latest_task_date: task.created_at || new Date().toISOString(),
        tasks: [],
        total_completed_tasks: 0,
        total_ongoing_tasks: 0,
        average_tokens_per_task: 0,
        last_prompt: task.question || '',
      });
    }
    const p = map.get(pid)!;
    p.tasks.push(task as unknown as HistoryTask);
    p.task_count++;
    p.total_tokens += task.tokens || 0;
    if (task.status === 2) p.total_completed_tasks++;
    else if (task.status === 1) p.total_ongoing_tasks++;
    if (task.created_at && task.created_at > p.latest_task_date) {
      p.latest_task_date = task.created_at;
    }
  }

  for (const p of map.values()) {
    p.average_tokens_per_task =
      p.task_count > 0 ? Math.round(p.total_tokens / p.task_count) : 0;
    p.tasks.sort(
      (a, b) =>
        new Date(b.created_at || 0).getTime() -
        new Date(a.created_at || 0).getTime()
    );
  }

  return Array.from(map.values()).sort(
    (a, b) =>
      new Date(b.latest_task_date).getTime() -
      new Date(a.latest_task_date).getTime()
  );
}

export async function fetchGroupedHistoryData(): Promise<ProjectGroup[]> {
  try {
    const res = await proxyFetchGet(
      '/api/v1/chat/histories/grouped?include_tasks=true'
    );
    if (res?.projects) return res.projects;
  } catch {
    // fall through to legacy
  }
  const flat = await proxyFetchGet('/api/v1/chat/histories');
  return groupTasksByProject((flat?.items ?? []) as FlatHistoryTask[]);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useGroupedHistory() {
  const client = useQueryClient();
  const key = queryKeys.history.grouped();

  const query = useQuery<ProjectGroup[]>({
    queryKey: key,
    queryFn: fetchGroupedHistoryData,
  });

  /** Force a fresh fetch (e.g. after a mutation). */
  const invalidate = () =>
    client.invalidateQueries({ queryKey: queryKeys.history.grouped() });

  /**
   * Optimistically update the cached project list without re-fetching.
   * Mutations (delete, rename) call this so the UI updates instantly.
   */
  const updateProjects = (
    updater: (prev: ProjectGroup[]) => ProjectGroup[]
  ) => {
    client.setQueryData<ProjectGroup[]>(key, (prev) =>
      prev ? updater(prev) : prev
    );
  };

  return {
    projects: query.data ?? [],
    isLoading: query.isLoading, // true only on the very first fetch — never on revisit
    isError: query.isError,
    error: query.error,
    invalidate,
    updateProjects,
  };
}

// ---------------------------------------------------------------------------
// Imperative helper — lets non-hook code (e.g. post-delete callbacks) update
// the shared cache without needing the hook in scope.
// ---------------------------------------------------------------------------
export function updateGroupedHistoryCache(
  updater: (prev: ProjectGroup[]) => ProjectGroup[]
) {
  queryClient.setQueryData<ProjectGroup[]>(
    queryKeys.history.grouped(),
    (prev) => (prev ? updater(prev) : prev)
  );
}
