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
 * Shared human-in-the-loop reply submitter.
 *
 * Extracted from the `requiresHumanReply` branch of `ChatBox.handleSend`
 * (index.tsx:730-762) so both the legacy BottomBox path and the new channel
 * `AskRenderer` post replies the same way. NO backend change: it uses the
 * existing `/chat/{projectId}/human-reply` request shape (`{ agent, reply }`)
 * and the existing `askList` queue advance.
 *
 * In shadow mode the live chatStore stays authoritative; updating it here makes
 * the derived session channel re-render automatically via the shadow hook.
 */

import { fetchPost } from '@/api/http';
import { generateUniqueId } from '@/lib';
import type { VanillaChatStore } from '@/store/chatStore';
import type { AskInputKind } from '@/types/sessionChannel';
import { toast } from 'sonner';

/** Map a structured answer to the canonical backend `reply` string. */
export function serializeReply(
  inputKind: AskInputKind,
  answer: { text?: string; selected?: string[] }
): string {
  switch (inputKind) {
    case 'multi':
      return (answer.selected ?? []).join(', ');
    case 'single':
      return answer.selected?.[0] ?? answer.text ?? '';
    case 'confirm':
      return answer.selected?.[0] ?? answer.text ?? '';
    case 'text':
    default:
      return answer.text ?? '';
  }
}

export interface SubmitHumanReplyParams {
  projectId: string;
  chatStore: VanillaChatStore;
  taskId: string;
  /** Already-serialized canonical reply string (see `serializeReply`). */
  reply: string;
  /** What to show in the appended user-message bubble (defaults to `reply`). */
  displayContent?: string;
}

export async function submitHumanReply({
  projectId,
  chatStore,
  taskId,
  reply,
  displayContent,
}: SubmitHumanReplyParams): Promise<void> {
  const state = chatStore.getState();
  const task = state.tasks[taskId];
  if (!task) return;

  const agent = task.activeAsk;

  // Echo the reply as a user message (skip for the auto-skip sentinel).
  if (reply !== 'skip') {
    state.addMessages(taskId, {
      id: generateUniqueId(),
      role: 'user',
      content: displayContent ?? reply,
      attaches: JSON.parse(JSON.stringify(task.attaches ?? [])),
    });
  }

  state.setIsPending(taskId, true);

  try {
    await fetchPost(`/chat/${projectId}/human-reply`, { agent, reply });

    const after = chatStore.getState();
    after.setAttaches(taskId, []);
    const askList = after.tasks[taskId]?.askList ?? [];
    if (askList.length === 0) {
      after.setActiveAsk(taskId, '');
    } else {
      const next = [...askList];
      const head = next.shift();
      after.setActiveAskList(taskId, next);
      after.setActiveAsk(taskId, head?.agent_name || '');
      after.setIsPending(taskId, false);
      if (head) after.addMessages(taskId, head);
    }
  } catch (error) {
    // Preserve the infinite-loop guard: on failure clear the ask + stop pending
    // so we never re-trigger the same reply in a loop.
    const after = chatStore.getState();
    after.setActiveAsk(taskId, '');
    after.setIsPending(taskId, false);
    console.error('[submitHumanReply] failed:', error);
    toast.error('Failed to send your reply. Please try again.', {
      closeButton: true,
    });
  }
}
