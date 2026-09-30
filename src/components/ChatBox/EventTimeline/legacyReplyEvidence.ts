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

import type { ChatMessageNode, ChatProjectionNode } from '@/lib/projector/chat';

/**
 * Old replies have no provable link to a canonical interaction. In a Run with
 * a canonical response, retain every unlinked reply as evidence instead of
 * treating it as another conversation input. This is a display policy, not
 * deduplication: neither text, agent, order nor time establishes identity.
 */
export function partitionLegacyReplyEvidence(
  nodes: readonly ChatProjectionNode[]
): { nodes: readonly ChatProjectionNode[]; evidence: ChatMessageNode[] } {
  const canonicalRuns = new Set(
    nodes.flatMap((node) =>
      node.kind === 'interaction' &&
      node.eventType === 'interaction.resolved' &&
      Boolean(node.interactionId) &&
      node.status === 'responded'
        ? [JSON.stringify([node.projectId, node.runId])]
        : []
    )
  );
  const evidence: ChatMessageNode[] = [];
  const conversation = nodes.filter((node) => {
    if (
      node.kind === 'message' &&
      node.role === 'user' &&
      (node.eventType === 'legacy.human_reply' ||
        (node.eventType.startsWith('legacy.') &&
          node.legacyStep === 'human_reply')) &&
      !node.interactionId &&
      canonicalRuns.has(JSON.stringify([node.projectId, node.runId]))
    ) {
      evidence.push(node);
      return false;
    }
    return true;
  });
  return { nodes: conversation, evidence };
}

/** The compatibility renderer owns one Run's messages at a time. */
export function partitionLegacyMessageEvidence(messages: readonly Message[]): {
  messages: readonly Message[];
  evidence: Message[];
} {
  const hasCanonicalResponse = messages.some(
    (message) =>
      message.role === 'user' &&
      Boolean(message.interactionResponseTo) &&
      message.interactionResponseSource === 'canonical'
  );
  const evidence: Message[] = [];
  const conversation = messages.filter((message) => {
    if (
      hasCanonicalResponse &&
      message.interactionResponseSource === 'legacy' &&
      !message.interactionResponseTo
    ) {
      evidence.push(message);
      return false;
    }
    return true;
  });
  return { messages: conversation, evidence };
}
