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

import type { ChatStore, VanillaChatStore } from '@/store/chatStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useEffect, useMemo, useReducer } from 'react';

export interface ProjectSessionRun {
  chatId: string;
  chatStore: VanillaChatStore;
  task: ChatStore['tasks'][string];
  taskId: string;
  createdAt: number;
  updatedAt: number;
  isCurrent: boolean;
}

export interface ProjectSessionOverview {
  currentRun: ProjectSessionRun | null;
  historicalRuns: ProjectSessionRun[];
  runs: ProjectSessionRun[];
}

function persistedEventTime(event: AgentMessage): number | null {
  if (typeof event.timestamp === 'number' && Number.isFinite(event.timestamp)) {
    return event.timestamp < 1_000_000_000_000
      ? event.timestamp * 1000
      : event.timestamp;
  }
  if (event.created_at) {
    const parsed = Date.parse(event.created_at);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function taskUpdatedAt(task: ChatStore['tasks'][string]): number {
  const createdAt = task.createdAt || 0;
  let updatedAt = createdAt;

  if (task.taskTime > 0) updatedAt = Math.max(updatedAt, task.taskTime);
  if (createdAt > 0 && task.elapsed > 0) {
    updatedAt = Math.max(updatedAt, createdAt + task.elapsed);
  }
  for (const agent of task.taskAssigning ?? []) {
    for (const event of agent.log ?? []) {
      updatedAt = Math.max(updatedAt, persistedEventTime(event) ?? 0);
    }
  }

  return updatedAt;
}

/**
 * Project-level view of every run. Unlike `useSelectedProjectTurn`, this hook
 * is deliberately independent from chat scroll position and TurnTabs.
 */
export function useProjectSessionOverview(
  projectId: string | null | undefined
): ProjectSessionOverview {
  const projectStore = useProjectRuntimeStore();
  const [, refresh] = useReducer((value: number) => value + 1, 0);

  const stores = useMemo(
    () => (projectId ? projectStore.getAllChatStores(projectId) : []),
    [projectId, projectStore]
  );

  useEffect(() => {
    const unsubscribers = stores.map(({ chatStore }) =>
      chatStore.subscribe(refresh)
    );
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [stores]);

  const activeStore = projectId
    ? projectStore.getActiveChatStore(projectId)
    : null;
  const activeTaskId = activeStore?.getState().activeTaskId ?? null;
  const seen = new Set<string>();
  const runs: ProjectSessionRun[] = [];

  for (const { chatId, chatStore } of stores) {
    const state = chatStore.getState();
    for (const [taskId, task] of Object.entries(state.tasks)) {
      if (seen.has(taskId)) continue;
      const hasProjectContent =
        task.messages.some((message) => message.role === 'user') ||
        task.taskInfo.length > 0 ||
        task.taskRunning.length > 0 ||
        task.taskAssigning.length > 0;
      const isActiveTask = chatStore === activeStore && taskId === activeTaskId;
      if (!hasProjectContent && !isActiveTask) continue;
      seen.add(taskId);
      const createdAt = task.createdAt || 0;
      runs.push({
        chatId,
        chatStore,
        task,
        taskId,
        createdAt,
        updatedAt: taskUpdatedAt(task),
        isCurrent: isActiveTask,
      });
    }
  }

  runs.sort((a, b) => b.createdAt - a.createdAt || b.updatedAt - a.updatedAt);
  const currentRun =
    runs.find((run) => run.isCurrent) ?? (runs.length > 0 ? runs[0]! : null);
  const normalizedRuns = runs.map((run) => ({
    ...run,
    isCurrent: run.taskId === currentRun?.taskId,
  }));

  return {
    currentRun:
      normalizedRuns.find((run) => run.isCurrent) ?? currentRun ?? null,
    historicalRuns: normalizedRuns.filter((run) => !run.isCurrent),
    runs: normalizedRuns,
  };
}
