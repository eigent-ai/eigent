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

import { generateUniqueId } from '@/lib';
import { AgentStep, ChatTaskStatus } from '@/types/constants';

type ChatStoreLike = {
  addMessages: (
    taskId: string,
    message: {
      id: string;
      role: 'agent';
      content: string;
      step: string;
      isConfirm: boolean;
    }
  ) => void;
  setHasWaitComfirm: (taskId: string, value: boolean) => void;
  setIsPending: (taskId: string, value: boolean) => void;
  setStatus: (taskId: string, status: string) => void;
};

export function getWebMockAgentResponse(question: string): string {
  const trimmed = question.trim() || 'your request';

  return `Here is a mock agent response to **"${trimmed}"**.

I've reviewed your request and prepared a sample result:

1. **Summary** — Key points gathered from your prompt
2. **Recommendation** — Suggested next actions in Eigent Dispatch
3. **Note** — This is demo data for UI preview`;
}

export function injectWebMockAgentReply(
  chatStore: ChatStoreLike,
  taskId: string,
  question: string,
  delayMs = 700
): void {
  chatStore.setIsPending(taskId, true);
  chatStore.setStatus(taskId, ChatTaskStatus.RUNNING);

  window.setTimeout(() => {
    chatStore.addMessages(taskId, {
      id: generateUniqueId(),
      role: 'agent',
      content: getWebMockAgentResponse(question),
      step: AgentStep.WAIT_CONFIRM,
      isConfirm: false,
    });
    chatStore.setIsPending(taskId, false);
    chatStore.setHasWaitComfirm(taskId, true);
    chatStore.setStatus(taskId, ChatTaskStatus.FINISHED);
  }, delayMs);
}
