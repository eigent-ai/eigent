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

import { fetchPut } from '@/api/http';
import type { ChatStore } from '@/store/chatStore';
import { ChatTaskStatus } from '@/types/constants';

export type TaskControlAction = 'pause' | 'resume';

type TaskControlStore = Pick<
  ChatStore,
  'tasks' | 'setElapsed' | 'setTaskTime' | 'setStatus'
>;

type TaskControlRequest = (
  url: string,
  data: { action: TaskControlAction }
) => Promise<unknown>;

/** Optimistically updates runtime state and rolls it back if Brain rejects. */
export async function takeControlOfTask({
  chatStore,
  action,
  projectId,
  taskId,
  request = fetchPut,
  now = Date.now,
}: {
  chatStore: TaskControlStore | null | undefined;
  action: TaskControlAction;
  /** Project-scoped TaskLock ID used by the runtime control endpoint. */
  projectId: string;
  taskId: string;
  request?: TaskControlRequest;
  now?: () => number;
}) {
  const task = chatStore?.tasks?.[taskId];
  if (!task || !chatStore) return false;

  const previous = {
    status: task.status,
    taskTime: task.taskTime,
    elapsed: task.elapsed,
  };

  if (action === 'pause') {
    chatStore.setElapsed(taskId, task.elapsed + now() - task.taskTime);
    chatStore.setTaskTime(taskId, 0);
    chatStore.setStatus(taskId, ChatTaskStatus.PAUSE);
  } else {
    chatStore.setTaskTime(taskId, now());
    chatStore.setStatus(taskId, ChatTaskStatus.RUNNING);
  }

  try {
    await request(`/task/${encodeURIComponent(projectId)}/take-control`, {
      action,
    });
    return true;
  } catch (error) {
    chatStore.setElapsed(taskId, previous.elapsed);
    chatStore.setTaskTime(taskId, previous.taskTime);
    chatStore.setStatus(taskId, previous.status);
    console.error(`Failed to ${action} task:`, error);
    return false;
  }
}
