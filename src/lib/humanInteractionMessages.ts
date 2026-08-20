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

import { AgentStep } from '@/types/constants';

/** Match both typed replies and the adjacent legacy cache representation. */
export function isUserMessageReplyToAsk(
  messages: readonly Message[],
  userMessageId: string
): boolean {
  const userMessageIndex = messages.findIndex(
    (message) => message.id === userMessageId
  );
  if (userMessageIndex <= 0) return false;

  const userMessage = messages[userMessageIndex];
  const previousMessage = messages[userMessageIndex - 1];
  if (
    userMessage?.role !== 'user' ||
    previousMessage?.role !== 'agent' ||
    previousMessage.step !== AgentStep.ASK
  ) {
    return false;
  }

  const askInteractionId = previousMessage.interaction?.interaction_id;
  return userMessage.interactionResponseTo
    ? Boolean(
        askInteractionId &&
        askInteractionId === userMessage.interactionResponseTo
      )
    : true;
}

/** Interaction IDs answered by explicit correlation or direct adjacency. */
export function getAnsweredAskInteractionIds(
  messages: readonly Message[]
): Set<string> {
  const answered = new Set<string>();
  messages.forEach((message, index) => {
    if (message.interactionResponseTo) {
      answered.add(message.interactionResponseTo);
      return;
    }
    if (message.role !== 'user' || index === 0) return;
    const previousMessage = messages[index - 1];
    const interactionId = previousMessage?.interaction?.interaction_id;
    if (
      previousMessage?.role === 'agent' &&
      previousMessage.step === AgentStep.ASK &&
      interactionId
    ) {
      answered.add(interactionId);
    }
  });
  return answered;
}
