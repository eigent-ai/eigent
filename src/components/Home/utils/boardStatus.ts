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

import {
  getSessionNavLeadFromHistoryTask,
  getSessionNavLeadPresentation,
  HISTORY_TASK_STATUS_ONGOING,
  type SessionNavLeadKind,
} from '@/lib/sessionNavLead';
import type { ChatStore } from '@/store/chatStore';
import { ExecutionStatus, type Trigger } from '@/types';
import type { HistoryTask, ProjectGroup } from '@/types/history';

export type HomeBoardColumn = 'default' | 'running' | 'awaiting_review';

export type HomeHubRuntimeStatus = 'running' | 'success' | 'error';

const SESSION_NAV_KIND_PRIORITY: Record<SessionNavLeadKind, number> = {
  error: 8,
  warning: 7,
  hitl: 6,
  blocked: 5,
  splitting: 4,
  running: 3,
  finished: 2,
  idle: 1,
};

function leadKindToRuntimeStatus(
  kind: SessionNavLeadKind
): HomeHubRuntimeStatus | null {
  switch (kind) {
    case 'running':
    case 'splitting':
      return 'running';
    case 'finished':
      return 'success';
    case 'error':
    case 'warning':
    case 'hitl':
    case 'blocked':
      return 'error';
    case 'idle':
    default:
      return null;
  }
}

function pickHighestPriorityLeadKind(
  kinds: SessionNavLeadKind[]
): SessionNavLeadKind {
  return kinds.reduce(
    (best, kind) =>
      SESSION_NAV_KIND_PRIORITY[kind] > SESSION_NAV_KIND_PRIORITY[best]
        ? kind
        : best,
    'idle'
  );
}

export function getProjectCardRuntimeStatus(
  project: ProjectGroup,
  chatTasks?: ChatTasksMap
): HomeHubRuntimeStatus | null {
  const kinds: SessionNavLeadKind[] = [];

  for (const task of project.tasks ?? []) {
    const liveTask = resolveLiveTask(task.task_id, chatTasks);
    kinds.push(
      liveTask
        ? getSessionNavLeadPresentation(liveTask).kind
        : getSessionNavLeadFromHistoryTask(task).kind
    );
  }

  if (kinds.length > 0) {
    const status = leadKindToRuntimeStatus(pickHighestPriorityLeadKind(kinds));
    if (status) return status;
  }

  if (project.total_ongoing_tasks > 0) {
    return 'running';
  }

  if (
    project.task_count > 0 &&
    project.total_completed_tasks === project.task_count
  ) {
    return 'success';
  }

  return null;
}

export const HOME_BOARD_COLUMNS: HomeBoardColumn[] = [
  'default',
  'running',
  'awaiting_review',
];

type LiveTask = ChatStore['tasks'][string];
type ChatTasksMap = ChatStore['tasks'];

function isLiveTaskAwaitingReview(task: LiveTask): boolean {
  const kind = getSessionNavLeadPresentation(task).kind;
  return kind === 'hitl' || kind === 'blocked';
}

function isLiveTaskRunning(task: LiveTask): boolean {
  return getSessionNavLeadPresentation(task).kind === 'running';
}

function resolveLiveTask(taskId: string | undefined, chatTasks?: ChatTasksMap) {
  if (!taskId || !chatTasks) return undefined;
  return chatTasks[taskId];
}

export function getTaskBoardColumn(
  task: HistoryTask,
  chatTasks?: ChatTasksMap
): HomeBoardColumn {
  const liveTask = resolveLiveTask(task.task_id, chatTasks);
  if (liveTask) {
    if (isLiveTaskAwaitingReview(liveTask)) return 'awaiting_review';
    if (isLiveTaskRunning(liveTask)) return 'running';
    return 'default';
  }

  if (task.status === HISTORY_TASK_STATUS_ONGOING) {
    return 'running';
  }

  return 'default';
}

export function getProjectBoardColumn(
  project: ProjectGroup,
  chatTasks?: ChatTasksMap
): HomeBoardColumn {
  for (const task of project.tasks) {
    const liveTask = resolveLiveTask(task.task_id, chatTasks);
    if (liveTask && isLiveTaskAwaitingReview(liveTask)) {
      return 'awaiting_review';
    }
  }

  for (const task of project.tasks) {
    const liveTask = resolveLiveTask(task.task_id, chatTasks);
    if (liveTask && isLiveTaskRunning(liveTask)) {
      return 'running';
    }
  }

  if (project.total_ongoing_tasks > 0) {
    return 'running';
  }

  if (
    project.tasks.some((task) => task.status === HISTORY_TASK_STATUS_ONGOING)
  ) {
    return 'running';
  }

  return 'default';
}

export function getTriggerBoardColumn(trigger: Trigger): HomeBoardColumn {
  const status = trigger.last_execution_status?.toLowerCase();
  if (status === ExecutionStatus.Pending) {
    return 'awaiting_review';
  }
  if (status === ExecutionStatus.Running) {
    return 'running';
  }
  return 'default';
}

export function getSpaceBoardColumn(
  spaceProjects: ProjectGroup[],
  spaceTriggers: Trigger[],
  chatTasks?: ChatTasksMap
): HomeBoardColumn {
  if (
    spaceProjects.some(
      (project) =>
        getProjectBoardColumn(project, chatTasks) === 'awaiting_review'
    ) ||
    spaceTriggers.some(
      (trigger) => getTriggerBoardColumn(trigger) === 'awaiting_review'
    )
  ) {
    return 'awaiting_review';
  }

  if (
    spaceProjects.some(
      (project) => getProjectBoardColumn(project, chatTasks) === 'running'
    ) ||
    spaceTriggers.some(
      (trigger) => getTriggerBoardColumn(trigger) === 'running'
    )
  ) {
    return 'running';
  }

  return 'default';
}

export function groupByBoardColumn<T>(
  items: T[],
  getColumn: (item: T) => HomeBoardColumn
): Record<HomeBoardColumn, T[]> {
  const grouped: Record<HomeBoardColumn, T[]> = {
    default: [],
    running: [],
    awaiting_review: [],
  };

  for (const item of items) {
    grouped[getColumn(item)].push(item);
  }

  return grouped;
}
