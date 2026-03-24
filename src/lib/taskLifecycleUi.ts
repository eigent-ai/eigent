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

import type { BottomBoxState } from '@/components/ChatBox/BottomBox';
import { ChatTaskStatus, type ChatTaskStatusType } from '@/types/constants';

/** Minimal task shape for bottom-box / sidebar lifecycle (matches chatStore Task fields used). */
export interface TaskLifecycleFields {
  messages: Message[];
  type: string;
  status: ChatTaskStatusType;
  hasWaitComfirm: boolean;
  isTakeControl: boolean;
  taskInfo: { id: string; content: string }[];
}

export function getBottomBoxStateForTask(
  task: TaskLifecycleFields
): BottomBoxState {
  const anyToSubTasksMessage = task.messages.find(
    (m) => m.step === 'to_sub_tasks'
  );
  const toSubTasksMessage = task.messages.find(
    (m) => m.step === 'to_sub_tasks' && !m.isConfirm
  );

  const isSkeletonPhase =
    (task.status !== 'finished' &&
      !anyToSubTasksMessage &&
      !task.hasWaitComfirm &&
      task.messages.length > 0) ||
    (task.isTakeControl && !anyToSubTasksMessage);
  if (isSkeletonPhase) {
    return 'splitting';
  }

  if (
    toSubTasksMessage &&
    !toSubTasksMessage.isConfirm &&
    task.status === 'pending'
  ) {
    return 'confirm';
  }

  if (toSubTasksMessage && !toSubTasksMessage.isConfirm) {
    return 'splitting';
  }

  if (
    task.status === ChatTaskStatus.RUNNING ||
    task.status === ChatTaskStatus.PAUSE
  ) {
    return 'running';
  }

  if (task.status === 'finished' && task.type !== '') {
    return 'finished';
  }

  return 'input';
}

/** Shelf tone for project-style task rows; finished and idle both use `default`. */
export type TaskListShelfTone = 'splitting' | 'running' | 'default';

export function getTaskListShelfTone(
  task: TaskLifecycleFields
): TaskListShelfTone {
  const s = getBottomBoxStateForTask(task);
  if (s === 'running') return 'running';
  if (s === 'splitting' || s === 'confirm') return 'splitting';
  return 'default';
}

export function isWorkforceTask(task: TaskLifecycleFields): boolean {
  const toSubTasks = task.messages.filter((m) => m.step === 'to_sub_tasks');
  const latest = toSubTasks[toSubTasks.length - 1];
  if (latest?.taskType === 2) return true;
  if (task.taskInfo.length > 1) return true;
  return false;
}
