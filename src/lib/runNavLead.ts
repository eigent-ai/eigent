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
 * Run list leading icon: resolves one visual state from the chat `Task`.
 *
 * Layers involved (do not conflate):
 * - **ChatTaskStatus** — `Task.status` (Run-level: running / pause / pending / finished).
 * - **TaskStatus** — workforce rows in `taskInfo` / `taskRunning` (subtask-level).
 * - **Derived UI** — `getBottomBoxStateForTask` / `getTaskListShelfTone` in `taskLifecycleUi.ts`
 *   (e.g. splitting is a decomposition phase, not a raw `ChatTaskStatus` value).
 */

import { getAnsweredAskInteractionIds } from '@/lib/humanInteractionMessages';
import {
  getBottomBoxStateForTask,
  getTaskListShelfTone,
  isTaskListRowHardFailure,
} from '@/lib/taskLifecycleUi';
import type { ChatStore } from '@/store/chatStore';
import {
  AgentStep,
  ChatTaskStatus,
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
  LoaderCircle,
  MessageCircle,
} from 'lucide-react';

export type RunNavLeadKind =
  | 'error'
  | 'warning'
  | 'hitl'
  | 'blocked'
  | 'splitting'
  | 'running'
  | 'finished'
  | 'idle';

export type RunNavLeadPresentation = {
  kind: RunNavLeadKind;
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
const RUN_NAV_LEAD_BY_KIND: Record<
  RunNavLeadKind,
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
    Icon: AlertTriangle,
    iconClassName: '!text-ds-icon-warning-default-default',
  },
  blocked: {
    Icon: AlertTriangle,
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
  kind: RunNavLeadKind,
  spin = false
): RunNavLeadPresentation {
  const spec = RUN_NAV_LEAD_BY_KIND[kind];
  return {
    kind,
    Icon: spec.Icon,
    iconClassName: spec.iconClassName,
    spin: spin && kind === 'running' ? spec.spin : undefined,
  };
}

export const RUN_NAV_IDLE_LEAD: RunNavLeadPresentation =
  presentationForKind('idle');

/** Map authoritative server history status to the final sidebar icon (no replay). */
export function getRunNavLeadFromHistoryTask(
  task: Pick<HistoryTask, 'status' | 'summary'>
): RunNavLeadPresentation {
  const summary = task.summary?.trim() ?? '';
  if (summary.startsWith(STOPPED_BY_USER_SUMMARY_PREFIX)) {
    return RUN_NAV_IDLE_LEAD;
  }
  if (task.status === HISTORY_TASK_STATUS_DONE) {
    return presentationForKind('finished');
  }
  // ONGOING (1) means the backend never finalized the status (e.g. app closed
  // mid-run). We cannot confirm the task is actually running without a full
  // replay, so we resolve to idle rather than a perpetual animated spinner.
  // Genuinely-live tasks get their spinner from the chat-store subscription.
  return RUN_NAV_IDLE_LEAD;
}

/** Best-effort lead for a grouped history project before runtime hydration. */
export function getWorkSessionNavLeadFromHistoryProject(
  project: Pick<
    ProjectGroup,
    'tasks' | 'total_ongoing_tasks' | 'total_completed_tasks'
  >
): RunNavLeadPresentation {
  const latestTask = project.tasks?.[0];
  if (latestTask) {
    return getRunNavLeadFromHistoryTask(latestTask);
  }
  if (project.total_ongoing_tasks > 0) {
    return RUN_NAV_IDLE_LEAD;
  }
  if (project.total_completed_tasks > 0) {
    return presentationForKind('finished');
  }
  return RUN_NAV_IDLE_LEAD;
}

/**
 * Sidebar project rows: prefer cached/history lead while hydrating; otherwise live task state.
 */
export function resolveWorkSessionNavLeadPresentation(options: {
  activeTask?: TaskRow;
  cachedLead?: RunNavLeadPresentation;
  isHistoryLoading?: boolean;
  isAchieved?: boolean;
}): RunNavLeadPresentation {
  const { activeTask, cachedLead, isHistoryLoading, isAchieved } = options;
  if (isAchieved) {
    return RUN_NAV_IDLE_LEAD;
  }
  if (isHistoryLoading && cachedLead) {
    return cachedLead;
  }
  if (activeTask && !isHistoryLoading) {
    return getRunNavLeadPresentation(activeTask);
  }
  if (cachedLead) {
    return cachedLead;
  }
  return RUN_NAV_IDLE_LEAD;
}

function isShareOrFinishedWithoutLiveWait(task: TaskRow): boolean {
  if (task.type === 'share') return true;
  if (task.durableRunStatus === 'waiting_for_user') return false;
  return task.type === 'replay' || task.status === ChatTaskStatus.FINISHED;
}

function hasUnresolvedAskMessage(task: TaskRow): boolean {
  const messages = Array.isArray(task.messages) ? task.messages : [];
  const resolved = new Set(task.resolvedInteractionIds ?? []);
  const answered = getAnsweredAskInteractionIds(messages);
  return messages.some((message) => {
    if (message.step !== AgentStep.ASK) return false;
    const interactionId = message.interaction?.interaction_id;
    if (!interactionId) return false;
    return !resolved.has(interactionId) && !answered.has(interactionId);
  });
}

/**
 * Any composer/timeline pause that needs a person: Human Toolkit, approval,
 * question, form, plan confirm, or a durable `waiting_for_user` Run.
 */
function isAwaitingHumanInput(task: TaskRow): boolean {
  if (isShareOrFinishedWithoutLiveWait(task)) return false;
  // The answer was submitted and the Run has already resumed locally. Legacy
  // ASK fields are cleared only after durable reconciliation, so they must not
  // hold the sidebar Alert icon during that network interval.
  if (task.isPending && task.durableRunStatus === 'running') return false;
  if (task.activeAsk) return true;
  if (task.durableRunStatus === 'waiting_for_user') return true;
  if (task.hasWaitComfirm) return true;
  if (getBottomBoxStateForTask(task) === 'confirm') return true;
  if ((task.askList?.length ?? 0) > 0) return true;
  return hasUnresolvedAskMessage(task);
}

/**
 * Priority: error → warning → hitl → blocked → splitting → running → finished → idle.
 */
export function getRunNavLeadPresentation(
  task: TaskRow
): RunNavLeadPresentation {
  const wf = workforceStatuses(task);
  const errorSignal =
    isTaskListRowHardFailure(task) || wf.some((s) => s === TaskStatus.FAILED);
  const warningSignal = Boolean(task.isContextExceeded) && !errorSignal;
  // Human-in-the-loop covers every input-required pause in the chat timeline.
  // A workforce subtask in WAITING means "assigned, not yet started" — a normal
  // running-phase state — so it must NOT replace the spinner with an Alert.
  const hitlSignal = isAwaitingHumanInput(task);
  const blockedSignal = wf.some((s) => s === TaskStatus.BLOCKED);
  const shelf = getTaskListShelfTone(task);

  let kind: RunNavLeadKind;

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
