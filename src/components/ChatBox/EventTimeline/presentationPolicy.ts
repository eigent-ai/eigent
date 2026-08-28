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
import { sortTimelineNodes } from '@/lib/projector/chat/presentation';
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

function subagentInvocationGroupKey(node: ActivityNode): string {
  return JSON.stringify([
    node.projectId,
    node.runId,
    node.toolCallId || node.eventId,
  ]);
}

function subagentIdentityKeys(node: ActivityNode): string[] {
  return [
    node.subagentTaskId
      ? JSON.stringify([
          node.projectId,
          node.runId,
          'task',
          node.subagentTaskId,
        ])
      : '',
    node.subagentAgentId
      ? JSON.stringify([
          node.projectId,
          node.runId,
          'agent',
          node.subagentAgentId,
        ])
      : '',
  ].filter(Boolean);
}

function mergeSubagentLifecycleReceipt(
  anchor: ActivityNode,
  receipt: ActivityNode
): ActivityNode {
  const anchorTerminal =
    anchor.subagentStatus !== undefined &&
    TERMINAL_ACTIVITY_STATUSES.has(anchor.subagentStatus);
  const receiptActive =
    receipt.subagentStatus === 'pending' ||
    receipt.subagentStatus === 'running';
  const subagentStatus =
    anchorTerminal && receiptActive
      ? anchor.subagentStatus
      : (receipt.subagentStatus ?? anchor.subagentStatus);

  return {
    ...anchor,
    subagentStatus,
    subagentAgentId: receipt.subagentAgentId ?? anchor.subagentAgentId,
    subagentTaskId: receipt.subagentTaskId ?? anchor.subagentTaskId,
    detail: receipt.detail ?? anchor.detail,
    output: receipt.output ?? anchor.output,
  };
}

/**
 * Apply explicitly correlated child-status receipts to the original delegated
 * agent invocation. The creation event remains the chronological anchor; a
 * later `agent_get_task_output` call may still render as its own real tool call.
 * Opaque task/agent IDs are scoped to one Project/Run and never inferred from
 * titles.
 */
function presentSubagentInvocationLifecycles(
  nodes: readonly ChatProjectionNode[]
): readonly ChatProjectionNode[] {
  const invocationNodesByGroup = new Map<string, ActivityNode[]>();
  for (const node of nodes) {
    if (node.kind !== 'activity' || node.subagentInvocation !== true) continue;
    const key = subagentInvocationGroupKey(node);
    invocationNodesByGroup.set(key, [
      ...(invocationNodesByGroup.get(key) || []),
      node,
    ]);
  }
  if (invocationNodesByGroup.size === 0) return nodes;

  const anchorByGroup = new Map<string, ActivityNode>();
  const groupByIdentity = new Map<string, string | null>();
  for (const [group, invocationNodes] of invocationNodesByGroup) {
    const anchor = [...invocationNodes]
      .reverse()
      .find((node) => subagentIdentityKeys(node).length > 0);
    if (!anchor) continue;
    anchorByGroup.set(group, anchor);
    const identities = new Set(invocationNodes.flatMap(subagentIdentityKeys));
    for (const identity of identities) {
      const existing = groupByIdentity.get(identity);
      groupByIdentity.set(
        identity,
        existing === undefined || existing === group ? group : null
      );
    }
  }
  if (anchorByGroup.size === 0) return nodes;

  const presentedByAnchorEventId = new Map<string, ActivityNode>();
  for (const receipt of nodes) {
    if (
      receipt.kind !== 'activity' ||
      receipt.subagentInvocation === true ||
      receipt.subagentStatus === undefined
    ) {
      continue;
    }
    const candidateGroups = new Set(
      subagentIdentityKeys(receipt)
        .map((identity) => groupByIdentity.get(identity))
        .filter((group): group is string => Boolean(group))
    );
    if (candidateGroups.size !== 1) continue;
    const group = candidateGroups.values().next().value;
    if (!group) continue;
    const anchor = anchorByGroup.get(group);
    if (!anchor) continue;
    const current = presentedByAnchorEventId.get(anchor.eventId) ?? anchor;
    presentedByAnchorEventId.set(
      anchor.eventId,
      mergeSubagentLifecycleReceipt(current, receipt)
    );
  }

  const terminalRunKeys = new Set(
    nodes.flatMap((node) =>
      node.kind === 'run_status' &&
      ['completed', 'failed', 'cancelled', 'interrupted'].includes(node.status)
        ? [JSON.stringify([node.projectId, node.runId])]
        : []
    )
  );
  for (const anchor of anchorByGroup.values()) {
    const current = presentedByAnchorEventId.get(anchor.eventId) ?? anchor;
    if (
      terminalRunKeys.has(JSON.stringify([anchor.projectId, anchor.runId])) &&
      (current.subagentStatus === 'pending' ||
        current.subagentStatus === 'running')
    ) {
      presentedByAnchorEventId.set(anchor.eventId, {
        ...current,
        subagentStatus: 'outcome_unknown',
      });
    }
  }

  if (presentedByAnchorEventId.size === 0) return nodes;
  return nodes.map(
    (node) => presentedByAnchorEventId.get(node.eventId) ?? node
  );
}

function taskLifecycleKey(node: ActivityNode): string | null {
  if (node.activityType !== 'task') return null;
  if (
    node.semantic &&
    (node.semantic.kind !== 'subtask' || node.semantic.subject.type !== 'task')
  ) {
    return null;
  }
  if (node.semanticKind && node.semanticKind !== 'subtask') return null;

  const identities = [
    node.semantic?.subject.type === 'task' ? node.semantic.subject.id : '',
    node.activityId || '',
    node.taskId || '',
  ].filter((identity) => Boolean(identity.trim()));
  const uniqueIdentities = new Set(identities);
  if (uniqueIdentities.size !== 1) return null;

  // Task IDs are opaque producer-owned identities. Preserve their exact value
  // and scope them to the Project/Run instead of normalizing display text.
  return JSON.stringify([
    node.projectId,
    node.runId,
    uniqueIdentities.values().next().value,
  ]);
}

function mergeTaskLifecycle(
  anchor: ActivityNode,
  latest: ActivityNode
): ActivityNode {
  return {
    ...anchor,
    // The earliest receipt remains the presentation anchor. Only projected
    // lifecycle/display fields advance as newer compatible receipts arrive.
    ...(latest.semantic ? { semantic: latest.semantic } : {}),
    status: latest.status,
    phase: latest.phase ?? anchor.phase,
    title: latest.title,
    detail: latest.detail ?? anchor.detail,
    input: latest.input ?? anchor.input,
    output: latest.output ?? anchor.output,
    durationMs: latest.durationMs ?? anchor.durationMs,
    agentId: latest.agentId ?? anchor.agentId,
    agentName: latest.agentName ?? anchor.agentName,
    taskId: latest.taskId ?? anchor.taskId,
    stepId: latest.stepId ?? anchor.stepId,
    activityId: latest.activityId ?? anchor.activityId,
    semanticKind: latest.semanticKind ?? anchor.semanticKind,
    semanticCompleteness:
      latest.semanticCompleteness ?? anchor.semanticCompleteness,
  };
}

/**
 * Fold projected task/subtask lifecycle receipts by one explicit stable task
 * identity. The immutable source ledger remains unchanged; presentation keeps
 * the earliest event/order and applies only the latest compatible lifecycle
 * fields. Missing or contradictory identities remain separate rows.
 */
function presentTaskActivityLifecycles(
  nodes: readonly ChatProjectionNode[]
): readonly ChatProjectionNode[] {
  const anchorByIdentity = new Map<string, ActivityNode>();
  const presentedByAnchorEventId = new Map<string, ActivityNode>();
  const suppressedEventIds = new Set<string>();

  for (const node of nodes) {
    if (node.kind !== 'activity' || node.activityType !== 'task') continue;
    const key = taskLifecycleKey(node);
    if (!key) continue;

    const anchor = anchorByIdentity.get(key);
    if (!anchor) {
      anchorByIdentity.set(key, node);
      continue;
    }

    const current = presentedByAnchorEventId.get(anchor.eventId) ?? anchor;
    presentedByAnchorEventId.set(
      anchor.eventId,
      mergeTaskLifecycle(current, node)
    );
    suppressedEventIds.add(node.eventId);
  }

  if (presentedByAnchorEventId.size === 0) return nodes;
  return nodes.flatMap((node): ChatProjectionNode[] => {
    if (suppressedEventIds.has(node.eventId)) return [];
    return [presentedByAnchorEventId.get(node.eventId) ?? node];
  });
}

/** Keep only the latest lifecycle receipt for each Run in the detailed log. */
function presentRunStatusLifecycles(
  nodes: readonly ChatProjectionNode[]
): readonly ChatProjectionNode[] {
  const latestByRunId = new Map<string, RunStatusNode>();
  const latestStartedAtByRunId = new Map<string, string>();
  for (const node of nodes) {
    if (node.kind !== 'run_status') continue;
    latestByRunId.set(node.runId, node);
    if (node.status === 'running' && node.createdAt) {
      latestStartedAtByRunId.set(node.runId, node.createdAt);
    } else if (node.startedAt) {
      latestStartedAtByRunId.set(node.runId, node.startedAt);
    }
  }
  if (latestByRunId.size === 0) return nodes;
  return nodes.flatMap((node): ChatProjectionNode[] => {
    if (node.kind !== 'run_status') return [node];
    if (latestByRunId.get(node.runId) !== node) return [];
    const startedAt = node.startedAt ?? latestStartedAtByRunId.get(node.runId);
    return startedAt ? [{ ...node, startedAt }] : [node];
  });
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
  // the event namespace, not that metadata, identifies the shadow lane. The
  // whole `legacy.` namespace belongs to that lane, not just `legacy.ask`: a
  // durable replay names the step (`legacy.ask`), while a live `/chat` frame
  // carries no `event_type` at all and normalizes to `legacy.step`. Matching
  // only the named form put the live mirror in the canonical bucket, where it
  // was signature-compared against the typed request it mirrors and the
  // mismatch suppressed the whole fold.
  return node.eventType.startsWith('legacy.');
}

function interactionRequestSignature(node: InteractionNode): string {
  return JSON.stringify([
    node.interactionType,
    node.prompt || '',
    node.agentName || '',
    (node.options || []).map((option) => [
      option.id,
      option.label,
      option.description || '',
    ]),
  ]);
}

function equivalentInteractionRequests(
  requests: readonly InteractionNode[]
): InteractionNode | null {
  const request = requests[0];
  if (!request) return null;
  const signature = interactionRequestSignature(request);
  return requests.every(
    (candidate) => interactionRequestSignature(candidate) === signature
  )
    ? request
    : null;
}

/**
 * Prefer the durable canonical request while folding any number of exact
 * at-least-once mirrors from the canonical or legacy live lanes. Conflicting
 * copies remain fully visible instead of being guessed from arrival order.
 */
function selectPresentableRequest(
  requests: readonly InteractionNode[]
): PresentableInteractionRequest | null {
  const canonical = requests.filter(
    (request) => !isLegacyInteractionRequest(request)
  );
  const legacyMirrors = requests.filter(isLegacyInteractionRequest);
  const canonicalRequest = equivalentInteractionRequests(canonical);
  const legacyRequest = equivalentInteractionRequests(legacyMirrors);
  if (
    (canonical.length > 0 && !canonicalRequest) ||
    (legacyMirrors.length > 0 && !legacyRequest)
  ) {
    return null;
  }

  const request = canonicalRequest ?? legacyRequest;
  if (!request) return null;
  return {
    request,
    suppressedRequestEventIds: new Set(
      requests
        .filter((candidate) => candidate.eventId !== request.eventId)
        .map((candidate) => candidate.eventId)
    ),
  };
}

function interactionResolutionSignature(
  request: InteractionNode,
  resolution: InteractionResolutionNode
): string {
  return JSON.stringify([
    resolution.kind,
    resolution.kind === 'interaction' ? resolution.status : resolution.role,
    safeInteractionResponse(request, resolution) || '',
  ]);
}

function equivalentInteractionResolutions<
  Resolution extends InteractionResolutionNode,
>(
  request: InteractionNode,
  resolutions: readonly Resolution[]
): Resolution | null {
  const resolution = resolutions[0];
  if (!resolution) return null;
  const signature = interactionResolutionSignature(request, resolution);
  return resolutions.every(
    (candidate) =>
      interactionResolutionSignature(request, candidate) === signature
  )
    ? resolution
    : null;
}

/**
 * Resolve canonical/legacy response mirrors without weakening interaction
 * correlation. One canonical terminal receipt is authoritative; exact
 * at-least-once copies fold into it. Conflicting copies remain unmerged so
 * contradictory history stays visible instead of being selected by arrival.
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

  const canonicalResolution = equivalentInteractionResolutions(
    request,
    canonical
  );
  const legacyMirror = equivalentInteractionResolutions(request, legacyMirrors);
  if (
    (canonical.length > 0 && !canonicalResolution) ||
    (legacyMirrors.length > 0 && !legacyMirror)
  ) {
    return null;
  }
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
      suppressedResolutionEventIds: new Set(
        resolutions.map((resolution) => resolution.eventId)
      ),
    };
  }

  const resolution = canonicalResolution ?? legacyMirror;
  if (!resolution) return null;
  return {
    resolution,
    response: safeInteractionResponse(request, resolution),
    suppressedResolutionEventIds: new Set(
      resolutions.map((candidate) => candidate.eventId)
    ),
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
  const chronologicalNodes = sortTimelineNodes(nodes);
  return presentRunStatusLifecycles(
    presentTaskActivityLifecycles(
      presentAgentActivityLifecycles(
        presentSubagentInvocationLifecycles(
          presentHumanInteractionReceipts(
            presentTypedMessageLifecycles(
              presentLegacyTranscriptFallbacks(chronologicalNodes)
            )
          )
        )
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
  presentSubagentInvocationLifecycles,
  presentTaskActivityLifecycles,
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
