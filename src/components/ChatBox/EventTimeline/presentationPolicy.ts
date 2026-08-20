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

import type { ChatProjectionNode } from '@/lib/projector/chat';
import {
  chatTimelineDetailLevels,
  type ChatTimelineDetailLevel,
} from '@/types/chatTimeline';

type InteractionNode = Extract<ChatProjectionNode, { kind: 'interaction' }>;
type MessageNode = Extract<ChatProjectionNode, { kind: 'message' }>;
type ActivityNode = Extract<ChatProjectionNode, { kind: 'activity' }>;
type RunStatusNode = Extract<ChatProjectionNode, { kind: 'run_status' }>;
type InteractionResolutionNode =
  InteractionNode | Extract<ChatProjectionNode, { kind: 'message' }>;

interface PresentableInteractionReceipt {
  request: InteractionNode;
  /** Canonical terminal receipt when one exists; otherwise the legacy reply. */
  resolution: InteractionResolutionNode;
  response?: string;
  suppressedResolutionEventIds: ReadonlySet<string>;
}

interface PresentableInteractionRequest {
  request: InteractionNode;
  suppressedRequestEventIds: ReadonlySet<string>;
}

interface ChatTimelinePresentationPolicyContext {
  requestedDetailLevel: ChatTimelineDetailLevel;
}

type ChatTimelinePresentationPolicy = (
  nodes: readonly ChatProjectionNode[],
  context: ChatTimelinePresentationPolicyContext
) => readonly ChatProjectionNode[];

type ChatTimelinePresentationPolicyRegistry = Readonly<
  Partial<Record<ChatTimelineDetailLevel, ChatTimelinePresentationPolicy>>
>;

interface ResolvedChatTimelinePresentation {
  effectiveDetailLevel: ChatTimelineDetailLevel;
  nodes: readonly ChatProjectionNode[];
  requestedDetailLevel: ChatTimelineDetailLevel;
}

/** Trajectory shows every semantic node; density comes from folding, not filtering. */
const trajectoryPresentationPolicy: ChatTimelinePresentationPolicy = (nodes) =>
  nodes;

const IMPORTANT_ACTIVITY_STATUSES = new Set([
  'failed',
  'timed_out',
  'outcome_unknown',
]);

/**
 * Narrative keeps the useful work log while removing migration diagnostics and
 * verbose successful tool payloads. Step-level aggregation happens later, in
 * the segmentation layer; this policy only drops what nothing should render.
 */
const narrativePresentationPolicy: ChatTimelinePresentationPolicy = (nodes) =>
  nodes.flatMap((node): ChatProjectionNode[] => {
    if (node.kind === 'unknown') return [];
    if (
      node.kind === 'run_status' &&
      ['pending', 'running'].includes(node.status)
    ) {
      return [];
    }
    if (
      node.kind === 'activity' &&
      !IMPORTANT_ACTIVITY_STATUSES.has(node.status)
    ) {
      return [{ ...node, detail: undefined }];
    }
    return [node];
  });

const TERMINAL_ACTIVITY_STATUSES = new Set([
  'completed',
  'failed',
  'timed_out',
  'outcome_unknown',
  'cancelled',
]);

function normalizeLifecycleIdentity(value: string | undefined): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function agentLifecycleKey(node: ActivityNode): string | null {
  if (node.activityType !== 'agent') return null;
  const agent =
    normalizeLifecycleIdentity(node.agentId) ||
    normalizeLifecycleIdentity(node.agentName);
  const task = normalizeLifecycleIdentity(node.taskId);
  if (!agent || !task) return null;
  return JSON.stringify([node.runId, agent, task]);
}

function isAgentLifecycleStart(node: ActivityNode): boolean {
  return (
    node.phase === 'requested' ||
    node.phase === 'started' ||
    node.status === 'pending' ||
    node.status === 'running'
  );
}

function isAgentLifecycleTerminal(node: ActivityNode): boolean {
  return TERMINAL_ACTIVITY_STATUSES.has(node.status);
}

function mergeAgentLifecycle(
  start: ActivityNode,
  terminal: ActivityNode
): ActivityNode {
  return {
    ...start,
    status: terminal.status,
    phase: terminal.phase,
    detail: terminal.detail || start.detail,
    output: terminal.output || start.output,
    durationMs: terminal.durationMs ?? start.durationMs,
  };
}

/**
 * Fold one explicitly identifiable agent activation/deactivation lifecycle.
 * Repeated work by the same agent/task is paired FIFO; missing identities or
 * missing terminal receipts stay visible and active instead of being guessed.
 */
function presentAgentActivityLifecycles(
  nodes: readonly ChatProjectionNode[]
): readonly ChatProjectionNode[] {
  const openByIdentity = new Map<string, ActivityNode[]>();
  const terminalByStartEventId = new Map<string, ActivityNode>();
  const suppressedTerminalEventIds = new Set<string>();

  for (const node of nodes) {
    if (node.kind !== 'activity' || node.activityType !== 'agent') continue;
    const key = agentLifecycleKey(node);
    if (!key) continue;

    if (isAgentLifecycleTerminal(node)) {
      const open = openByIdentity.get(key);
      const start = open?.shift();
      if (open?.length === 0) openByIdentity.delete(key);
      if (!start) continue;
      terminalByStartEventId.set(start.eventId, node);
      suppressedTerminalEventIds.add(node.eventId);
      continue;
    }

    if (isAgentLifecycleStart(node)) {
      const open = openByIdentity.get(key);
      if (open) open.push(node);
      else openByIdentity.set(key, [node]);
    }
  }

  if (terminalByStartEventId.size === 0) return nodes;
  return nodes.flatMap((node): ChatProjectionNode[] => {
    if (node.kind !== 'activity' || node.activityType !== 'agent') {
      return [node];
    }
    if (suppressedTerminalEventIds.has(node.eventId)) return [];
    const terminal = terminalByStartEventId.get(node.eventId);
    return terminal ? [mergeAgentLifecycle(node, terminal)] : [node];
  });
}

/** Keep only the latest lifecycle receipt for each Run in the detailed log. */
function presentRunStatusLifecycles(
  nodes: readonly ChatProjectionNode[]
): readonly ChatProjectionNode[] {
  const latestByRunId = new Map<string, RunStatusNode>();
  for (const node of nodes) {
    if (node.kind === 'run_status') latestByRunId.set(node.runId, node);
  }
  if (latestByRunId.size === 0) return nodes;
  return nodes.filter(
    (node) =>
      node.kind !== 'run_status' || latestByRunId.get(node.runId) === node
  );
}

function interactionCorrelationKey(
  node: Pick<InteractionNode, 'interactionId' | 'runId'>
): string | null {
  if (!node.interactionId) return null;
  // JSON tuple encoding avoids delimiter collisions in opaque backend IDs.
  return JSON.stringify([node.runId, node.interactionId]);
}

function isInteractionResolution(
  node: ChatProjectionNode
): node is InteractionResolutionNode {
  return (
    (node.kind === 'interaction' && node.status !== 'requested') ||
    (node.kind === 'message' &&
      node.role === 'user' &&
      node.interactionResponse === true)
  );
}

function resolutionCorrelationKey(
  node: InteractionResolutionNode
): string | null {
  if (!node.interactionId) return null;
  return JSON.stringify([node.runId, node.interactionId]);
}

function safeInteractionResponse(
  request: InteractionNode,
  resolution: InteractionResolutionNode
): string | undefined {
  if (resolution.kind === 'message') {
    return resolution.content.trim() || undefined;
  }

  if (resolution.responseOptionIds?.length) {
    const labelById = new Map(
      (request.options || []).map((option) => [option.id, option.label])
    );
    const labels = resolution.responseOptionIds.map((id) => labelById.get(id));
    // Do not expose an unknown option id or its opaque value. A partial match
    // could misrepresent a multi-select decision, so it also fails closed.
    if (labels.every((label): label is string => Boolean(label))) {
      return labels.join(', ');
    }
  }

  return resolution.response?.trim() || undefined;
}

function isLegacyInteractionRequest(node: InteractionNode): boolean {
  // Canonical migration events may retain `legacyStep: "ask"` as provenance;
  // the event namespace, not that metadata, identifies the shadow lane.
  return node.eventType === 'legacy.ask';
}

/**
 * Prefer the durable canonical request while tolerating one explicitly
 * correlated legacy ASK emitted by the migration dual-write lane. More than
 * one request in either lane is ambiguous and remains fully visible.
 */
function selectPresentableRequest(
  requests: readonly InteractionNode[]
): PresentableInteractionRequest | null {
  const canonical = requests.filter(
    (request) => !isLegacyInteractionRequest(request)
  );
  const legacyMirrors = requests.filter(isLegacyInteractionRequest);
  if (canonical.length > 1 || legacyMirrors.length > 1) return null;

  const request = canonical[0] ?? legacyMirrors[0];
  if (!request) return null;
  return {
    request,
    suppressedRequestEventIds: new Set(
      canonical[0] && legacyMirrors[0] ? [legacyMirrors[0].eventId] : []
    ),
  };
}

/**
 * Resolve the temporary canonical/legacy dual-write shape without weakening
 * interaction correlation. One canonical terminal receipt is authoritative;
 * one explicitly correlated legacy HUMAN_REPLY may mirror it. Any duplicate
 * lane or disagreement remains unmerged so contradictory history stays
 * visible instead of being silently selected by arrival order.
 */
function selectPresentableResolution(
  request: InteractionNode,
  resolutions: readonly InteractionResolutionNode[]
): Omit<PresentableInteractionReceipt, 'request'> | null {
  const canonical = resolutions.filter(
    (resolution): resolution is InteractionNode =>
      resolution.kind === 'interaction'
  );
  const legacyMirrors = resolutions.filter(
    (
      resolution
    ): resolution is Extract<ChatProjectionNode, { kind: 'message' }> =>
      resolution.kind === 'message'
  );

  if (canonical.length > 1 || legacyMirrors.length > 1) return null;

  const canonicalResolution = canonical[0];
  const legacyMirror = legacyMirrors[0];
  if (canonicalResolution && legacyMirror) {
    // A user reply cannot safely mirror cancellation or expiration.
    if (canonicalResolution.status !== 'responded') return null;
    const canonicalResponse = safeInteractionResponse(
      request,
      canonicalResolution
    );
    const legacyResponse = safeInteractionResponse(request, legacyMirror);
    if (
      canonicalResponse !== undefined &&
      canonicalResponse !== legacyResponse
    ) {
      return null;
    }
    return {
      resolution: canonicalResolution,
      response: canonicalResponse ?? legacyResponse,
      suppressedResolutionEventIds: new Set([
        canonicalResolution.eventId,
        legacyMirror.eventId,
      ]),
    };
  }

  const resolution = canonicalResolution ?? legacyMirror;
  if (!resolution) return null;
  return {
    resolution,
    response: safeInteractionResponse(request, resolution),
    suppressedResolutionEventIds: new Set([resolution.eventId]),
  };
}

/**
 * Collapse one explicitly correlated request/resolution receipt for display.
 *
 * The source projection remains an immutable event ledger. This function
 * returns a copied request node keyed by the request event and suppresses only
 * its unambiguous matching receipt(s). Missing IDs, cross-Run IDs, ambiguous
 * duplicates, and conflicting dual-write answers remain separate Timeline
 * rows instead of being guessed from adjacency or arrival order.
 */
function presentHumanInteractionReceipts(
  nodes: readonly ChatProjectionNode[]
): readonly ChatProjectionNode[] {
  const requestsByKey = new Map<string, InteractionNode[]>();
  const resolutionsByKey = new Map<string, InteractionResolutionNode[]>();

  for (const node of nodes) {
    if (node.kind === 'interaction' && node.status === 'requested') {
      const key = interactionCorrelationKey(node);
      if (!key) continue;
      requestsByKey.set(key, [...(requestsByKey.get(key) || []), node]);
      continue;
    }
    if (isInteractionResolution(node)) {
      const key = resolutionCorrelationKey(node);
      if (!key) continue;
      resolutionsByKey.set(key, [...(resolutionsByKey.get(key) || []), node]);
    }
  }

  const presentableRequests = new Map<string, PresentableInteractionRequest>();
  const correlated = new Map<
    string,
    PresentableInteractionReceipt & PresentableInteractionRequest
  >();
  for (const [key, requests] of requestsByKey) {
    const selectedRequest = selectPresentableRequest(requests);
    if (!selectedRequest) continue;
    presentableRequests.set(key, selectedRequest);
    const selected = selectPresentableResolution(
      selectedRequest.request,
      resolutionsByKey.get(key) || []
    );
    if (selected) correlated.set(key, { ...selectedRequest, ...selected });
  }
  if (presentableRequests.size === 0) return nodes;

  return nodes.flatMap((node): ChatProjectionNode[] => {
    if (node.kind === 'interaction' && node.status === 'requested') {
      const key = interactionCorrelationKey(node);
      const selectedRequest = key ? presentableRequests.get(key) : undefined;
      if (selectedRequest?.suppressedRequestEventIds.has(node.eventId)) {
        return [];
      }
      const pair = key ? correlated.get(key) : undefined;
      if (
        !pair ||
        pair.request.eventId !== node.eventId ||
        selectedRequest?.request.eventId !== node.eventId
      ) {
        return [node];
      }
      return [
        {
          ...node,
          status:
            pair.resolution.kind === 'interaction'
              ? pair.resolution.status
              : 'responded',
          response: pair.response,
          requestEventId: node.eventId,
          resolutionEventId: pair.resolution.eventId,
        },
      ];
    }

    if (isInteractionResolution(node)) {
      const key = resolutionCorrelationKey(node);
      const pair = key ? correlated.get(key) : undefined;
      if (pair?.suppressedResolutionEventIds.has(node.eventId)) return [];
    }
    return [node];
  });
}

/** Prefer canonical transcript events while preserving legacy-only history. */
function presentLegacyTranscriptFallbacks(
  nodes: readonly ChatProjectionNode[]
): readonly ChatProjectionNode[] {
  const canonicalUserRuns = new Set(
    nodes
      .filter(
        (node): node is MessageNode =>
          node.kind === 'message' && node.eventType === 'user.message'
      )
      .map((node) => node.runId)
  );
  const canonicalAssistantRuns = new Set(
    nodes
      .filter(
        (node): node is MessageNode =>
          node.kind === 'message' && node.eventType === 'assistant.final'
      )
      .map((node) => node.runId)
  );

  return nodes.filter(
    (node) =>
      !(
        node.kind === 'message' &&
        ((node.eventType === 'legacy.confirmed' &&
          canonicalUserRuns.has(node.runId)) ||
          (node.eventType === 'legacy.end' &&
            canonicalAssistantRuns.has(node.runId)))
      )
  );
}

function typedMessageLifecycleKey(node: MessageNode): string | null {
  if (
    !node.messageId ||
    !['message.created', 'message.delta', 'message.completed'].includes(
      node.eventType
    )
  ) {
    return null;
  }
  return JSON.stringify([node.runId, node.messageId]);
}

/**
 * Fold typed message receipts by the backend-provided message identity.
 * Missing-identity created/delta receipts stay in the immutable source ledger
 * but are hidden until a completed semantic message is available.
 */
function presentTypedMessageLifecycles(
  nodes: readonly ChatProjectionNode[]
): readonly ChatProjectionNode[] {
  const messagesByKey = new Map<string, MessageNode[]>();
  for (const node of nodes) {
    if (node.kind !== 'message') continue;
    const key = typedMessageLifecycleKey(node);
    if (!key) continue;
    messagesByKey.set(key, [...(messagesByKey.get(key) || []), node]);
  }

  const presentedByEventId = new Map<string, MessageNode>();
  const suppressedEventIds = new Set<string>();
  for (const messages of messagesByKey.values()) {
    const first = messages[0];
    if (!first) continue;
    const completed = messages
      .filter((message) => message.eventType === 'message.completed')
      .at(-1);
    const accumulatedContent = messages
      .filter((message) => message.eventType !== 'message.completed')
      .map((message) => message.content)
      .join('');
    presentedByEventId.set(first.eventId, {
      ...first,
      eventType: completed?.eventType ?? first.eventType,
      role: completed?.role ?? first.role,
      content: completed?.content || accumulatedContent,
      status: completed ? 'complete' : 'streaming',
    });
    for (const message of messages.slice(1)) {
      suppressedEventIds.add(message.eventId);
    }
  }

  return nodes.flatMap((node): ChatProjectionNode[] => {
    if (node.kind !== 'message') return [node];
    const presented = presentedByEventId.get(node.eventId);
    if (presented) return [presented];
    if (suppressedEventIds.has(node.eventId)) return [];
    if (
      !node.messageId &&
      ['message.created', 'message.delta'].includes(node.eventType)
    ) {
      return [];
    }
    return [node];
  });
}

function presentChatSemanticEntities(
  nodes: readonly ChatProjectionNode[]
): readonly ChatProjectionNode[] {
  return presentRunStatusLifecycles(
    presentAgentActivityLifecycles(
      presentHumanInteractionReceipts(
        presentTypedMessageLifecycles(presentLegacyTranscriptFallbacks(nodes))
      )
    )
  );
}

const defaultChatTimelinePresentationPolicyRegistry = Object.freeze({
  narrative: narrativePresentationPolicy,
  trajectory: trajectoryPresentationPolicy,
}) satisfies ChatTimelinePresentationPolicyRegistry;

/**
 * Adds product-owned timeline presentation policies without coupling them to
 * transport events.
 */
function createChatTimelinePresentationPolicyRegistry(
  overrides: ChatTimelinePresentationPolicyRegistry = {}
): ChatTimelinePresentationPolicyRegistry {
  return Object.freeze({
    ...defaultChatTimelinePresentationPolicyRegistry,
    ...overrides,
  });
}

function applyPresentationPolicy(
  policy: ChatTimelinePresentationPolicy,
  nodes: readonly ChatProjectionNode[],
  requestedDetailLevel: ChatTimelineDetailLevel
): readonly ChatProjectionNode[] | null {
  try {
    const presentedNodes = policy(nodes, { requestedDetailLevel });
    return Array.isArray(presentedNodes)
      ? presentChatSemanticEntities(presentedNodes)
      : null;
  } catch {
    return null;
  }
}

/**
 * Resolves the requested mode. Missing, throwing, or invalid future policies
 * fall back to the unfiltered trajectory presentation, keeping the timeline
 * available instead of taking down the ChatBox.
 */
function resolveChatTimelinePresentation(
  registry: ChatTimelinePresentationPolicyRegistry,
  requestedDetailLevel: ChatTimelineDetailLevel,
  nodes: readonly ChatProjectionNode[]
): ResolvedChatTimelinePresentation {
  const requestedPolicy = registry[requestedDetailLevel];
  if (requestedPolicy) {
    const presentedNodes = applyPresentationPolicy(
      requestedPolicy,
      nodes,
      requestedDetailLevel
    );
    if (presentedNodes) {
      return {
        effectiveDetailLevel: requestedDetailLevel,
        nodes: presentedNodes,
        requestedDetailLevel,
      };
    }
  }

  const fallbackPolicy = registry.trajectory ?? trajectoryPresentationPolicy;
  const fallbackNodes = applyPresentationPolicy(
    fallbackPolicy,
    nodes,
    requestedDetailLevel
  );

  return {
    effectiveDetailLevel: 'trajectory',
    nodes: fallbackNodes ?? nodes,
    requestedDetailLevel,
  };
}

export {
  chatTimelineDetailLevels,
  createChatTimelinePresentationPolicyRegistry,
  defaultChatTimelinePresentationPolicyRegistry,
  presentAgentActivityLifecycles,
  presentChatSemanticEntities,
  presentHumanInteractionReceipts,
  presentLegacyTranscriptFallbacks,
  presentRunStatusLifecycles,
  presentTypedMessageLifecycles,
  resolveChatTimelinePresentation,
};
export type {
  ChatTimelineDetailLevel,
  ChatTimelinePresentationPolicy,
  ChatTimelinePresentationPolicyContext,
  ChatTimelinePresentationPolicyRegistry,
  ResolvedChatTimelinePresentation,
};
