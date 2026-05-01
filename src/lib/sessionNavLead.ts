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
  TaskStatus,
  type TaskStatusType,
} from '@/types/constants';
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
  const bottom = getBottomBoxStateForTask(task);
  const hitlSignal =
    bottom === 'confirm' ||
    task.hasWaitComfirm ||
    wf.some((s) => s === TaskStatus.WAITING);
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

  const spec = SESSION_NAV_LEAD_BY_KIND[kind];
  return {
    kind,
    Icon: spec.Icon,
    iconClassName: spec.iconClassName,
    spin: Boolean(
      spec.spin && task.status === ChatTaskStatus.RUNNING && kind === 'running'
    ),
  };
}
