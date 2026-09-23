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

import { isUserMessageReplyToAsk } from '@/lib/humanInteractionMessages';
import {
  composeTimelineRuns,
  reconcileTimelineRuns,
} from '@/lib/projector/chat/presentation';
import type { ProjectEventStoreSnapshot } from '@/store/projectEventStore';
import { AgentStep } from '@/types/constants';

export interface SessionAutomationSource {
  taskPrompt: string;
  resultContent: string;
}

/** Use the same completed Run boundary as the event-native Timeline. */
export function selectEventAutomationSource(
  snapshot: ProjectEventStoreSnapshot | null,
  projectId: string
): SessionAutomationSource | null {
  if (!snapshot || snapshot.view.projectId !== projectId) return null;

  const runs = reconcileTimelineRuns(
    composeTimelineRuns(snapshot.chat.nodes),
    snapshot.view.runs
  );
  const latestCompleted = runs.findLast(
    (run) =>
      run.status === 'completed' &&
      run.userQuery?.content.trim() &&
      run.finalAssistantResponse?.content.trim()
  );

  return latestCompleted
    ? {
        taskPrompt: latestCompleted.userQuery!.content,
        resultContent: latestCompleted.finalAssistantResponse!.content,
      }
    : null;
}

/** Legacy Sessions can have completed messages before their event history loads. */
export function selectLegacyAutomationSource(
  chatStates: readonly { tasks: Record<string, { messages: Message[] }> }[]
): SessionAutomationSource | null {
  for (let storeIndex = chatStates.length - 1; storeIndex >= 0; storeIndex--) {
    const tasks = Object.values(chatStates[storeIndex].tasks);
    for (let taskIndex = tasks.length - 1; taskIndex >= 0; taskIndex--) {
      const messages = tasks[taskIndex].messages;
      for (let index = messages.length - 1; index >= 0; index--) {
        const final = messages[index];
        if (
          final.role !== 'agent' ||
          final.step !== AgentStep.END ||
          !final.content.trim()
        ) {
          continue;
        }
        for (let queryIndex = index - 1; queryIndex >= 0; queryIndex--) {
          const query = messages[queryIndex];
          if (
            query.role === 'user' &&
            query.content.trim() &&
            !isUserMessageReplyToAsk(messages, query.id)
          ) {
            return { taskPrompt: query.content, resultContent: final.content };
          }
        }
      }
    }
  }
  return null;
}
