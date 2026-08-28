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
  ChatActivityNode,
  ChatActivityPhase,
  ChatActivityStatus,
  ChatArtifactNode,
  ChatInteractionNode,
  ChatMessageNode,
  ChatPlanNode,
  ChatProjectionNode,
  ChatRunStatus,
  ChatRunStatusNode,
} from '../types';
import { actionKindForActivities } from './actionKind';
import { compareTimelineNodes, sortTimelineNodes } from './chronology';
import type {
  TimelineRunSummary,
  TimelineRunTimestamps,
  TimelineRunView,
  TimelineToolInvocation,
  TimelineTraceRow,
} from './types';

const TERMINAL_ACTIVITY_STATUSES = new Set<ChatActivityStatus>([
  'completed',
  'failed',
  'timed_out',
  'outcome_unknown',
  'cancelled',
]);

const TERMINAL_RUN_STATUSES = new Set<ChatRunStatus>([
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);

function timestampValue(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstText(
  values: readonly (string | undefined)[]
): string | undefined {
  return values.find((value) => Boolean(value?.trim()));
}

function lastText(values: readonly (string | undefined)[]): string | undefined {
  return [...values].reverse().find((value) => Boolean(value?.trim()));
}

function firstTimestamp(
  nodes: readonly ChatProjectionNode[],
  predicate: (node: ChatProjectionNode) => boolean = () => true
): string | null {
  return (
    nodes.find(
      (node) => predicate(node) && timestampValue(node.createdAt) !== null
    )?.createdAt || null
  );
}

function lastTimestamp(
  nodes: readonly ChatProjectionNode[],
  predicate: (node: ChatProjectionNode) => boolean = () => true
): string | null {
  return (
    [...nodes]
      .reverse()
      .find(
        (node) => predicate(node) && timestampValue(node.createdAt) !== null
      )?.createdAt || null
  );
}

function activityPhase(node: ChatActivityNode): ChatActivityPhase {
  if (node.phase) return node.phase;
  if (node.status === 'pending') return 'requested';
  if (node.status === 'running') return 'started';
  if (node.status === 'completed') return 'completed';
  if (node.status === 'failed' || node.status === 'timed_out') return 'failed';
  if (node.status === 'cancelled') return 'cancelled';
  return 'unknown';
}

function isStartingActivity(node: ChatActivityNode): boolean {
  const phase = activityPhase(node);
  return (
    phase === 'requested' ||
    phase === 'started' ||
    phase === 'progress' ||
    node.status === 'pending' ||
    node.status === 'running'
  );
}

function isTerminalActivity(node: ChatActivityNode): boolean {
  return TERMINAL_ACTIVITY_STATUSES.has(node.status);
}

function explicitInvocationId(node: ChatActivityNode): string {
  return node.toolCallId
    ? `tool-call:${node.runId}:${node.toolCallId}`
    : `tool-event:${node.id}`;
}

function normalizeLegacyIdentity(value: string | undefined): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function legacyToolIdentity(node: ChatActivityNode): string | null {
  if (
    node.activityType !== 'tool' ||
    (node.legacyStep !== 'activate_toolkit' &&
      node.legacyStep !== 'deactivate_toolkit')
  ) {
    return null;
  }
  const toolkit = normalizeLegacyIdentity(node.toolkitName);
  const method = normalizeLegacyIdentity(node.methodName || node.toolName);
  if (!toolkit && !method) return null;
  return JSON.stringify([
    node.runId,
    normalizeLegacyIdentity(node.agentId || node.agentName),
    normalizeLegacyIdentity(node.taskId),
    toolkit,
    method,
  ]);
}

function appendActivityStreamFragment(
  left: string,
  right: string,
  exact: boolean
): string {
  if (exact) return `${left}${right}`;
  if (!left || !right || /\s$/.test(left) || /^\s/.test(right)) {
    return `${left}${right}`;
  }
  const leftBoundary = left.at(-1)!;
  const rightBoundary = right[0]!;
  const cjk = /[\u3400-\u9fff\uf900-\ufaff]/;
  if (
    (cjk.test(leftBoundary) && cjk.test(rightBoundary)) ||
    /^[,.;:!?)}\]]/.test(rightBoundary) ||
    /[(\[{/]$/.test(leftBoundary)
  ) {
    return `${left}${right}`;
  }
  // Older canonical narration receipts normalized fragment whitespace.
  // Restore the most conservative word boundary without coupling the
  // presenter to a model, tokenizer, language, or content domain.
  return `${left} ${right}`;
}

/**
 * Legacy toolkit receipts predate call IDs. Pair their start/terminal frames
 * FIFO within an explicit toolkit/method identity. Canonical events never use
 * this compatibility lane and therefore remain fail-closed without an ID.
 */
function invocationIdsByNode(
  nodes: readonly ChatProjectionNode[]
): Map<string, string> {
  const ids = new Map<string, string>();
  const openLegacyCalls = new Map<string, string[]>();

  for (const node of nodes) {
    if (
      node.kind !== 'activity' ||
      (node.activityType !== 'tool' && node.activityType !== 'terminal')
    ) {
      continue;
    }
    if (node.toolCallId) {
      ids.set(node.id, explicitInvocationId(node));
      continue;
    }

    const identity = legacyToolIdentity(node);
    if (!identity) {
      ids.set(node.id, explicitInvocationId(node));
      continue;
    }
    if (node.legacyStep === 'activate_toolkit') {
      const invocationId = `legacy-tool-call:${node.runId}:${node.id}`;
      const open = openLegacyCalls.get(identity);
      if (open) open.push(invocationId);
      else openLegacyCalls.set(identity, [invocationId]);
      ids.set(node.id, invocationId);
      continue;
    }

    const open = openLegacyCalls.get(identity);
    const invocationId = open?.shift();
    if (open?.length === 0) openLegacyCalls.delete(identity);
    ids.set(node.id, invocationId || explicitInvocationId(node));
  }

  return ids;
}

/**
 * Project one logical tool call using only fields that already crossed the
 * semantic adapter's display-safety boundary. No raw payload fallback exists
 * in this layer.
 */
function composeToolInvocation(
  nodes: readonly ChatActivityNode[]
): TimelineToolInvocation {
  const first = nodes[0]!;
  // Canonical events and legacy SSE receipts can coexist during the migration.
  // When they share a call id, use the canonical display-safe projection for
  // all user-visible fields. Legacy messages may contain raw arguments/results
  // and therefore serve only as a compatibility fallback.
  const typedNodes = nodes.filter(
    (node) => !node.eventType.startsWith('legacy.')
  );
  const semanticNodes = typedNodes.length > 0 ? typedNodes : nodes;
  const semanticFirst = semanticNodes[0]!;
  const semanticLast = semanticNodes.at(-1)!;
  const explicitInput = firstText(semanticNodes.map((node) => node.input));
  const explicitOutput = lastText(semanticNodes.map((node) => node.output));
  const fallbackInput =
    typedNodes.length === 0
      ? firstText(
          semanticNodes.filter(isStartingActivity).map((node) => node.detail)
        )
      : undefined;
  const fallbackOutput =
    typedNodes.length === 0
      ? lastText(
          semanticNodes.filter(isTerminalActivity).map((node) => node.detail)
        )
      : undefined;
  const input = explicitInput || fallbackInput;
  const output = explicitOutput || fallbackOutput;
  const remainingDetail = lastText(
    semanticNodes
      .map((node) => node.detail)
      .filter(
        (detail) =>
          Boolean(detail?.trim()) &&
          detail?.trim() !== input?.trim() &&
          detail?.trim() !== output?.trim()
      )
  );
  const startedAt = firstTimestamp(semanticNodes, (node) =>
    isStartingActivity(node as ChatActivityNode)
  );
  const endedAt = lastTimestamp(semanticNodes, (node) =>
    isTerminalActivity(node as ChatActivityNode)
  );
  const explicitDuration = [...semanticNodes]
    .reverse()
    .map((node) => node.durationMs)
    .find(
      (duration): duration is number =>
        typeof duration === 'number' &&
        Number.isFinite(duration) &&
        duration >= 0
    );
  const derivedDuration =
    timestampValue(startedAt) !== null && timestampValue(endedAt) !== null
      ? Math.max(0, timestampValue(endedAt)! - timestampValue(startedAt)!)
      : undefined;

  return {
    id:
      first.toolCallId !== undefined
        ? explicitInvocationId(first)
        : `tool-event:${first.id}`,
    runId: first.runId,
    activityType: first.activityType === 'terminal' ? 'terminal' : 'tool',
    toolCallId: firstText(nodes.map((node) => node.toolCallId)),
    nodes: semanticNodes,
    firstNodeId: semanticFirst.id,
    lastNodeId: semanticLast.id,
    runSequence: semanticFirst.runSequence,
    title: semanticLast.title || semanticFirst.title,
    actionKind: actionKindForActivities(semanticNodes),
    status: semanticLast.status,
    phase: activityPhase(semanticLast),
    input,
    output,
    detail: remainingDetail,
    durationMs: explicitDuration ?? derivedDuration,
    startedAt,
    endedAt,
    agentId: firstText(semanticNodes.map((node) => node.agentId)),
    agentName: firstText(semanticNodes.map((node) => node.agentName)),
    taskId: firstText(semanticNodes.map((node) => node.taskId)),
    stepId: firstText(semanticNodes.map((node) => node.stepId)),
    toolkitName: firstText(semanticNodes.map((node) => node.toolkitName)),
    methodName: firstText(semanticNodes.map((node) => node.methodName)),
    toolName: firstText(semanticNodes.map((node) => node.toolName)),
    subagentInvocation: semanticNodes.some(
      (node) => node.subagentInvocation === true
    ),
    subagentType: firstText(semanticNodes.map((node) => node.subagentType)),
    subagentName: firstText(semanticNodes.map((node) => node.subagentName)),
    subagentStatus: [...semanticNodes]
      .reverse()
      .map((node) => node.subagentStatus)
      .find((status) => status !== undefined),
    subagentAgentId: firstText(
      semanticNodes.map((node) => node.subagentAgentId)
    ),
    subagentTaskId: firstText(semanticNodes.map((node) => node.subagentTaskId)),
    agentProvider: firstText(semanticNodes.map((node) => node.agentProvider)),
    agentModel: firstText(semanticNodes.map((node) => node.agentModel)),
  };
}

function composeTraceRows(
  nodes: readonly ChatProjectionNode[]
): TimelineTraceRow[] {
  const invocationIdByNode = invocationIdsByNode(nodes);
  const toolNodesByInvocation = new Map<string, ChatActivityNode[]>();
  const noticeByToolCallId = new Map<
    string,
    Extract<ChatProjectionNode, { kind: 'notice' }>
  >();
  for (const node of nodes) {
    if (node.kind === 'notice' && node.toolCallId) {
      noticeByToolCallId.set(node.toolCallId, node);
    }
    if (
      node.kind !== 'activity' ||
      (node.activityType !== 'tool' && node.activityType !== 'terminal')
    ) {
      continue;
    }
    const id = invocationIdByNode.get(node.id)!;
    const lifecycle = toolNodesByInvocation.get(id);
    if (lifecycle) lifecycle.push(node);
    else toolNodesByInvocation.set(id, [node]);
  }

  const emittedToolInvocations = new Set<string>();
  const rows: TimelineTraceRow[] = [];
  let previousActivityStreamKey: string | null = null;

  for (const node of nodes) {
    const currentActivity =
      node.kind === 'activity' && node.activityType === 'work_log'
        ? node
        : null;
    const activityStreamKey =
      currentActivity &&
      (node.semantic?.subject.type === 'activity_stream' ||
        node.legacyStep === 'decompose_text')
        ? `${node.runId}:${currentActivity.activityId || 'legacy-narration'}`
        : null;

    if (activityStreamKey && currentActivity) {
      const previous = rows.at(-1);
      const previousActivity =
        previous?.kind === 'node' &&
        previous.node.kind === 'activity' &&
        previous.node.activityType === 'work_log'
          ? previous.node
          : null;
      if (
        previousActivityStreamKey === activityStreamKey &&
        previous?.kind === 'node' &&
        previousActivity
      ) {
        previous.node = {
          ...previousActivity,
          title: appendActivityStreamFragment(
            previousActivity.title,
            currentActivity.title,
            previousActivity.streamFragmentMode === 'exact' &&
              currentActivity.streamFragmentMode === 'exact'
          ),
          status: currentActivity.status,
          phase: currentActivity.phase,
          detail: currentActivity.detail || previousActivity.detail,
          streamFragmentMode:
            previousActivity.streamFragmentMode === 'exact' &&
            currentActivity.streamFragmentMode === 'exact'
              ? 'exact'
              : 'normalized',
        };
        continue;
      }
      rows.push({
        kind: 'node',
        id: node.id,
        runSequence: node.runSequence,
        node,
      });
      previousActivityStreamKey = activityStreamKey;
      continue;
    }

    previousActivityStreamKey = null;
    if (
      node.kind !== 'activity' ||
      (node.activityType !== 'tool' && node.activityType !== 'terminal')
    ) {
      rows.push({
        kind: 'node',
        id: node.id,
        runSequence: node.runSequence,
        node,
      });
      continue;
    }

    const id = invocationIdByNode.get(node.id)!;
    if (emittedToolInvocations.has(id)) continue;
    emittedToolInvocations.add(id);
    const invocation: TimelineToolInvocation = {
      ...composeToolInvocation(toolNodesByInvocation.get(id)!),
      id,
    };
    const correlatedNotice = invocation.toolCallId
      ? noticeByToolCallId.get(invocation.toolCallId)
      : undefined;
    if (correlatedNotice) {
      invocation.notice = {
        eventId: correlatedNotice.eventId,
        title: correlatedNotice.title,
        content: correlatedNotice.content,
        severity: correlatedNotice.severity,
      };
    }
    rows.push({
      kind: 'tool',
      id: invocation.id,
      runSequence: invocation.runSequence,
      invocation,
    });
  }
  return rows;
}

function latestRunStatus(
  nodes: readonly ChatProjectionNode[]
): ChatRunStatusNode | null {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node?.kind === 'run_status') return node;
  }
  return null;
}

function inferRunStatus(
  traceRows: readonly TimelineTraceRow[],
  interactions: readonly ChatInteractionNode[],
  finalAssistantResponse: ChatMessageNode | null
): ChatRunStatus {
  const latestInteractionByIdentity = new Map<string, ChatInteractionNode>();
  for (const interaction of interactions) {
    latestInteractionByIdentity.set(
      interactionIdentity(interaction),
      interaction
    );
  }
  const hasPendingInteraction = [...latestInteractionByIdentity.values()].some(
    (interaction) => interaction.status === 'requested'
  );
  if (hasPendingInteraction) return 'waiting_for_user';

  if (finalAssistantResponse) return 'completed';

  const activities = traceRows.flatMap((row) => {
    if (row.kind === 'tool') return [row.invocation.status];
    return row.node.kind === 'activity' ? [row.node.status] : [];
  });
  if (
    activities.some((status) => status === 'running' || status === 'pending')
  ) {
    return 'running';
  }
  if (
    activities.some((status) => status === 'failed' || status === 'timed_out')
  ) {
    return 'failed';
  }
  return 'unknown';
}

function composeRunTimestamps(
  nodes: readonly ChatProjectionNode[],
  runStatus: ChatRunStatusNode | null,
  finalAssistantResponse: ChatMessageNode | null
): TimelineRunTimestamps {
  const createdAt = firstTimestamp(nodes);
  const updatedAt = lastTimestamp(nodes);
  const startedAt =
    runStatus?.startedAt ||
    firstTimestamp(
      nodes,
      (node) => node.kind === 'run_status' && node.status === 'running'
    ) ||
    createdAt;
  const endedAt =
    (runStatus && TERMINAL_RUN_STATUSES.has(runStatus.status)
      ? runStatus.createdAt
      : null) ||
    finalAssistantResponse?.createdAt ||
    null;
  const start = timestampValue(startedAt);
  const end = timestampValue(endedAt);

  return {
    createdAt,
    startedAt,
    updatedAt,
    endedAt,
    durationMs:
      start !== null && end !== null ? Math.max(0, end - start) : null,
    totalAttemptElapsedMs: null,
    elapsedAnchor: null,
  };
}

function uniqueCount(values: readonly string[]): number {
  return new Set(values).size;
}

function artifactIdentity(node: ChatArtifactNode): string {
  return node.artifactId || node.relativePath || node.path || node.eventId;
}

function interactionIdentity(node: ChatInteractionNode): string {
  return node.interactionId || node.eventId;
}

function messageIdentity(node: ChatMessageNode): string {
  return node.messageId || node.eventId;
}

function composeRunSummary(
  traceRows: readonly TimelineTraceRow[],
  nodes: readonly ChatProjectionNode[],
  artifacts: readonly ChatArtifactNode[],
  interactions: readonly ChatInteractionNode[]
): TimelineRunSummary {
  const assistantMessages = nodes.filter(
    (node): node is ChatMessageNode =>
      node.kind === 'message' && node.role === 'assistant'
  );
  return {
    toolCallCount: uniqueCount(
      traceRows.flatMap((row) => (row.kind === 'tool' ? [row.id] : []))
    ),
    agentMessageCount: uniqueCount(assistantMessages.map(messageIdentity)),
    artifactCount: uniqueCount(artifacts.map(artifactIdentity)),
    interactionCount: uniqueCount(interactions.map(interactionIdentity)),
  };
}

function composeOneRun(nodes: readonly ChatProjectionNode[]): TimelineRunView {
  const first = nodes[0]!;
  const userQuery =
    nodes.find(
      (node): node is ChatMessageNode =>
        node.kind === 'message' &&
        node.role === 'user' &&
        node.purpose !== 'interaction_response' &&
        !node.interactionResponse
    ) || null;
  const finalAssistantResponse =
    [...nodes]
      .reverse()
      .find(
        (node): node is ChatMessageNode =>
          node.kind === 'message' &&
          node.role === 'assistant' &&
          node.purpose === 'final'
      ) || null;
  const plans = nodes.filter(
    (node): node is ChatPlanNode => node.kind === 'plan'
  );
  const artifacts = nodes.filter(
    (node): node is ChatArtifactNode => node.kind === 'artifact'
  );
  const interactions = nodes.filter(
    (node): node is ChatInteractionNode => node.kind === 'interaction'
  );
  const runStatus = latestRunStatus(nodes);
  const traceRows = composeTraceRows(nodes);

  return {
    id: `timeline-run:${first.runId}`,
    projectId: first.projectId,
    runId: first.runId,
    nodes,
    userQuery,
    plans,
    traceRows,
    finalAssistantResponse,
    artifacts,
    interactions,
    runStatus,
    status:
      runStatus?.status ||
      inferRunStatus(traceRows, interactions, finalAssistantResponse),
    timestamps: composeRunTimestamps(nodes, runStatus, finalAssistantResponse),
    summary: composeRunSummary(traceRows, nodes, artifacts, interactions),
  };
}

function runOrder(
  left: readonly ChatProjectionNode[],
  right: readonly ChatProjectionNode[]
): number {
  const nodeDifference = compareTimelineNodes(left[0]!, right[0]!);
  if (nodeDifference) return nodeDifference;
  return left[0]!.runId.localeCompare(right[0]!.runId);
}

/** Compose all event-native Runs without mutating the immutable node ledger. */
export function composeTimelineRuns(
  nodes: readonly ChatProjectionNode[]
): TimelineRunView[] {
  const grouped = new Map<string, ChatProjectionNode[]>();
  nodes.forEach((node) => {
    const runNodes = grouped.get(node.runId);
    if (runNodes) runNodes.push(node);
    else grouped.set(node.runId, [node]);
  });

  return [...grouped.values()]
    .map(sortTimelineNodes)
    .sort(runOrder)
    .map(composeOneRun);
}

/** Compose one Run while applying the same deterministic ordering contract. */
export function composeTimelineRun(
  nodes: readonly ChatProjectionNode[],
  runId: string
): TimelineRunView | null {
  return (
    composeTimelineRuns(nodes.filter((node) => node.runId === runId))[0] || null
  );
}
