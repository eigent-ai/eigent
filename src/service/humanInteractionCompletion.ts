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

import type { ChatStore } from '@/store/chatStore';
import { useProjectStore } from '@/store/projectStore';
import { AgentStep } from '@/types/constants';

/** Canonical completion advances only the exact active ask, at most once. */
export function completeHumanInteraction(
  state: ChatStore,
  runId: string,
  interactionId: string
) {
  if (state.activeTaskId !== runId) return false;
  const task = state.tasks[runId];
  if (!task) return false;
  if (task.resolvedInteractionIds?.includes(interactionId)) return true;
  const active = task.messages.findLast(
    (message) => message.step === AgentStep.ASK
  );
  const advances = active?.interaction?.interaction_id === interactionId;
  const remaining = task.askList.filter(
    (message) => message.interaction?.interaction_id !== interactionId
  );
  state.markHumanInteractionResolved(runId, interactionId);
  if (!advances) return true;
  const [next, ...queue] = remaining;
  state.setActiveAskList(runId, queue);
  state.setActiveAsk(runId, next?.agent_name || '');
  state.setIsPending(runId, false);
  if (next) state.addMessages(runId, next);
  return true;
}

export function completeProjectHumanInteraction(
  projectId: string,
  runId: string,
  interactionId: string
) {
  const project = useProjectStore.getState();
  if (project.activeProjectId !== projectId) return false;
  const state = project.getActiveChatStore(projectId)?.getState();
  return state ? completeHumanInteraction(state, runId, interactionId) : false;
}
