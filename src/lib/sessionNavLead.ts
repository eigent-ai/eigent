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

/**
 * Session list leading icon: resolves one visual state from the chat `Task`.
 *
 * Layers involved (do not conflate):
 * - **ChatTaskStatus** — `Task.status` (session-level: running / pause / pending / finished).
 * - **TaskStatus** — workforce rows in `taskInfo` / `taskRunning` (subtask-level).
 * - **Derived UI** — `getBottomBoxStateForTask` / `getTaskListShelfTone` in `taskLifecycleUi.ts`
 *   (e.g. splitting is a decomposition phase, not a raw `ChatTaskStatus` value).
 */

import {
  getBottomBoxStateForTask,
  getTaskListShelfTone,
  isTaskListRowHardFailure,
} from '@/lib/taskLifecycleUi';
import type { ChatStore } from '@/store/chatStore';
import {
  ChatTaskStatus,
  SessionMode,
  TaskStatus,
  type TaskStatusType,
} from '@/types/constants';
import type { HistoryTask, ProjectGroup } from '@/types/history';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  CircleCheckBig,
  CircleSlash,
  ClipboardList,
  Hand,
  LoaderCircle,
  MessageCircle,
  TriangleAlert,
} from 'lucide-react';

export type SessionNavLeadKind =
  | 'error'
  | 'warning'
  | 'hitl'
  | 'blocked'
  | 'splitting'
  | 'running'
  | 'finished'
  | 'idle';

export type SessionNavLeadPresentation = {
  kind: SessionNavLeadKind;
  Icon: LucideIcon;
  iconClassName: string;
  spin?: boolean;
};

/** Chat history API: ongoing = 1, done = 2 (see `historyApi.ts`). */
export const HISTORY_TASK_STATUS_ONGOING = 1;
export const HISTORY_TASK_STATUS_DONE = 2;

const STOPPED_BY_USER_SUMMARY_PREFIX = '<summary>Task stopped</summary>';

type TaskRow = ChatStore['tasks'][string];

function workforceStatuses(task: TaskRow): TaskStatusType[] {
  const { taskRunning = [], taskInfo = [] } = task;
  const out: TaskStatusType[] = [];
  for (const row of [...taskRunning, ...taskInfo]) {
    const s = row.status;
    if (s !== undefined && s !== TaskStatus.EMPTY) {
      out.push(s);
    }
  }
  return out;
}

/**
 * `!` required: `@layer base` uses `button .lucide { color: ... }` (higher specificity
 * than a lone `text-ds-icon-*` utility), which otherwise overrides these tokens.
 */
const SESSION_NAV_LEAD_BY_KIND: Record<
  SessionNavLeadKind,
  { Icon: LucideIcon; iconClassName: string; spin?: boolean }
> = {
  error: {
    Icon: CircleSlash,
    iconClassName: '!text-ds-icon-caution-default-default',
  },
  warning: {
    Icon: AlertTriangle,
    iconClassName: '!text-ds-icon-warning-default-default',
  },
  hitl: {
    Icon: Hand,
    iconClassName: '!text-ds-icon-status-splitting-default-default',
  },
  blocked: {
    Icon: TriangleAlert,
    iconClassName: '!text-ds-icon-warning-default-default',
  },
  splitting: {
    Icon: ClipboardList,
    iconClassName: '!text-ds-icon-status-splitting-default-default',
  },
  running: {
    Icon: LoaderCircle,
    iconClassName: '!text-ds-icon-information-default-default',
    spin: true,
  },
  finished: {
    Icon: CircleCheckBig,
    iconClassName: '!text-ds-icon-status-completed-default-default',
  },
  idle: {
    Icon: MessageCircle,
    iconClassName: '!text-ds-icon-neutral-default-default',
  },
};

function presentationForKind(
  kind: SessionNavLeadKind,
  spin = false
): SessionNavLeadPresentation {
  const spec = SESSION_NAV_LEAD_BY_KIND[kind];
  return {
    kind,
    Icon: spec.Icon,
    iconClassName: spec.iconClassName,
    spin: spin && kind === 'running' ? spec.spin : undefined,
  };
}

export const SESSION_NAV_IDLE_LEAD: SessionNavLeadPresentation =
  presentationForKind('idle');

/** Map authoritative server history status to the final sidebar icon (no replay). */
export function getSessionNavLeadFromHistoryTask(
  task: Pick<HistoryTask, 'status' | 'summary'>
): SessionNavLeadPresentation {
  const summary = task.summary?.trim() ?? '';
  if (summary.startsWith(STOPPED_BY_USER_SUMMARY_PREFIX)) {
    return SESSION_NAV_IDLE_LEAD;
  }
  if (task.status === HISTORY_TASK_STATUS_DONE) {
    return presentationForKind('finished');
  }
  // ONGOING (1) means the backend never finalized the status (e.g. app closed
  // mid-run). We cannot confirm the task is actually running without a full
  // replay, so we resolve to idle rather than a perpetual animated spinner.
  // Genuinely-live tasks get their spinner from the chat-store subscription.
  return SESSION_NAV_IDLE_LEAD;
}

/** Best-effort lead for a grouped history project before runtime hydration. */
export function getSessionNavLeadFromHistoryProject(
  project: Pick<
    ProjectGroup,
    'tasks' | 'total_ongoing_tasks' | 'total_completed_tasks'
  >
): SessionNavLeadPresentation {
  const latestTask = project.tasks?.[0];
  if (latestTask) {
    return getSessionNavLeadFromHistoryTask(latestTask);
  }
  if (project.total_ongoing_tasks > 0) {
    return SESSION_NAV_IDLE_LEAD;
  }
  if (project.total_completed_tasks > 0) {
    return presentationForKind('finished');
  }
  return SESSION_NAV_IDLE_LEAD;
}

/**
 * Sidebar project rows: prefer cached/history lead while hydrating; otherwise live task state.
 */
export function resolveProjectNavLeadPresentation(options: {
  activeTask?: TaskRow;
  cachedLead?: SessionNavLeadPresentation;
  isHistoryLoading?: boolean;
  isAchieved?: boolean;
}): SessionNavLeadPresentation {
  const { activeTask, cachedLead, isHistoryLoading, isAchieved } = options;
  if (isAchieved) {
    return SESSION_NAV_IDLE_LEAD;
  }
  if (isHistoryLoading && cachedLead) {
    return cachedLead;
  }
  if (activeTask && !isHistoryLoading) {
    return getSessionNavLeadPresentation(activeTask);
  }
  if (cachedLead) {
    return cachedLead;
  }
  return SESSION_NAV_IDLE_LEAD;
}

/**
 * Priority: error → warning → hitl → blocked → splitting → running → finished → idle.
 */
export function getSessionNavLeadPresentation(
  task: TaskRow
): SessionNavLeadPresentation {
  const wf = workforceStatuses(task);
  const errorSignal =
    isTaskListRowHardFailure(task) || wf.some((s) => s === TaskStatus.FAILED);
  const warningSignal = Boolean(task.isContextExceeded) && !errorSignal;
  // Single agent runs directly — no splitting/confirm step. Its sidebar icon
  // tracks the task status only: chat bubble while preparing, running spinner
  // while executing, check when finished — matching the chat container.
  const isSingleAgent = task.sessionMode === SessionMode.SINGLE_AGENT;
  const bottom = getBottomBoxStateForTask(task);
  // Human-in-the-loop = an unconfirmed plan or an explicit `ask` / `wait_confirm`.
  // A workforce subtask in WAITING means "assigned, not yet started" — a normal
  // running-phase state — so it must NOT surface the Hand icon while running.
  // Single agent has no plan/confirm step, so it never shows the HITL icon.
  const hitlSignal =
    !isSingleAgent && (bottom === 'confirm' || Boolean(task.hasWaitComfirm));
  const blockedSignal = wf.some((s) => s === TaskStatus.BLOCKED);
  const shelf = getTaskListShelfTone(task);

  let kind: SessionNavLeadKind;

  if (errorSignal) {
    kind = 'error';
  } else if (warningSignal) {
    kind = 'warning';
  } else if (hitlSignal) {
    kind = 'hitl';
  } else if (blockedSignal) {
    kind = 'blocked';
  } else if (shelf === 'splitting') {
    kind = 'splitting';
  } else if (
    shelf === 'running' ||
    task.status === ChatTaskStatus.RUNNING ||
    task.status === ChatTaskStatus.PAUSE
  ) {
    kind = 'running';
  } else if (task.status === ChatTaskStatus.FINISHED && task.type !== '') {
    kind = 'finished';
  } else {
    kind = 'idle';
  }

  return presentationForKind(
    kind,
    task.status === ChatTaskStatus.RUNNING && kind === 'running'
  );
}
