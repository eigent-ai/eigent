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

import type {
  ChatInteractionNode,
  ChatMessageNode,
  ChatProjectionNode,
} from '@/lib/projector/chat';
import { safeInteractionResponse } from './presentationPolicy';

function interactionKey(node: ChatInteractionNode | ChatMessageNode): string {
  return JSON.stringify([node.projectId, node.runId, node.interactionId]);
}

/**
 * Retain unlinked or conflicting legacy replies as evidence in Runs with a
 * canonical response. Only explicit identity permits folding a matching
 * mirror: neither text, agent, order nor time establishes that identity.
 */
export function partitionLegacyReplyEvidence(
  nodes: readonly ChatProjectionNode[]
): { nodes: readonly ChatProjectionNode[]; evidence: ChatMessageNode[] } {
  const resolutions = new Map<string, ChatInteractionNode[]>();
  const requests = new Map<string, ChatInteractionNode>();
  for (const node of nodes) {
    if (node.kind !== 'interaction' || !node.interactionId) continue;
    const key = interactionKey(node);
    if (node.eventType === 'interaction.requested') requests.set(key, node);
    if (
      node.eventType === 'interaction.resolved' &&
      node.status === 'responded'
    ) {
      resolutions.set(key, [...(resolutions.get(key) ?? []), node]);
    }
  }
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
      (!node.interactionId || resolutions.has(interactionKey(node)))
    ) {
      if (node.interactionId) {
        const key = interactionKey(node);
        const canonical = resolutions.get(key)!;
        const responses = canonical.map((resolution) =>
          safeInteractionResponse(requests.get(key) ?? resolution, resolution)
        );
        // Preserve the existing request-anchored fallback for a canonical
        // receipt with no display text. The receipt policy checks whether
        // its explicit legacy mirrors agree before using their text.
        if (
          requests.has(key) &&
          responses.every((response) => response === undefined)
        )
          return true;
        // Explicit identity proves the pair, even if an earlier page holds
        // the request. Compare only safe projected responses after that
        // proof. A conflict or unavailable option label remains evidence.
        if (
          responses.every(
            (response) =>
              response !== undefined && response === node.content.trim()
          )
        )
          return false;
      } else if (
        !canonicalRuns.has(JSON.stringify([node.projectId, node.runId]))
      ) {
        return true;
      }
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
