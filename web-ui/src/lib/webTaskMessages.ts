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

import { AgentStep, ChatTaskStatus } from '@/types/constants';

type WebTaskMessage = {
  id: string;
  role: 'user' | 'agent';
  content: string;
  step?: string;
  attaches?: File[];
};

type WebTaskSnapshot = {
  status: string;
  isPending?: boolean;
  taskTime: number;
  elapsed: number;
  messages: WebTaskMessage[];
};

const HIDDEN_AGENT_STEPS = new Set<string>([
  AgentStep.TO_SUB_TASKS,
  AgentStep.NOTICE_CARD,
  AgentStep.CONFIRMED,
  AgentStep.NOTICE,
  AgentStep.NEW_TASK_STATE,
]);

export function isDisplayableAgentMessage(message: WebTaskMessage): boolean {
  if (message.role !== 'agent') return false;
  const content = message.content?.trim() ?? '';
  if (!content || content === 'skip') return false;
  if (message.step && HIDDEN_AGENT_STEPS.has(message.step)) return false;
  return true;
}

export function getDisplayableAgentMessages(messages: WebTaskMessage[]) {
  return messages.filter(isDisplayableAgentMessage);
}

export function shouldShowWebTaskLoading(
  task: WebTaskSnapshot | null
): boolean {
  if (!task) return false;
  if (task.status === ChatTaskStatus.FINISHED) return false;

  const isActive =
    task.status === ChatTaskStatus.RUNNING ||
    task.status === ChatTaskStatus.PAUSE ||
    Boolean(task.isPending);

  if (!isActive) return false;

  const lastUserIndex = [...task.messages]
    .map((message, index) => ({ message, index }))
    .reverse()
    .find(({ message }) => message.role === 'user')?.index;

  if (lastUserIndex == null) return task.messages.length === 0;

  const hasAgentReplyAfterLastUser = task.messages
    .slice(lastUserIndex + 1)
    .some(isDisplayableAgentMessage);

  return !hasAgentReplyAfterLastUser;
}

export function getWebTaskElapsedMs(
  task: Pick<WebTaskSnapshot, 'taskTime' | 'elapsed' | 'status' | 'isPending'>,
  nowMs: number
): number {
  const isActive =
    task.status === ChatTaskStatus.RUNNING ||
    task.status === ChatTaskStatus.PAUSE ||
    Boolean(task.isPending);

  if (!isActive || task.taskTime === 0) {
    return Math.max(0, task.elapsed);
  }

  return Math.max(0, task.elapsed + (nowMs - task.taskTime));
}
