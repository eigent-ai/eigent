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
  ChatActivityStatus,
  ChatProjectionNode,
} from '@/lib/projector/chat';

type TimelineNodeRow = {
  rowKind: 'node';
  id: string;
  node: ChatProjectionNode;
};

export type PresentedToolCall = {
  id: string;
  nodes: readonly ChatActivityNode[];
  presentedNode: ChatActivityNode;
};

export type RepeatedToolCallGroupRow = {
  rowKind: 'repeated-tool-calls';
  id: string;
  agentId?: string;
  agentName?: string;
  methodName: string;
  runId: string;
  toolkitName: string;
  calls: readonly PresentedToolCall[];
  status: ChatActivityStatus;
};

export type ChatTimelineDisplayRow = TimelineNodeRow | RepeatedToolCallGroupRow;

type MutableToolCall = {
  id: string;
  nodes: ChatActivityNode[];
};

type ToolIdentity = {
  key: string;
  methodName: string;
  toolkitName: string;
};

const ACTIVE_TOOL_STATUSES = new Set<ChatActivityStatus>([
  'pending',
  'running',
]);

const TERMINAL_TOOL_STATUSES = new Set<ChatActivityStatus>([
  'completed',
  'failed',
  'timed_out',
  'outcome_unknown',
  'cancelled',
]);

function normalizeIdentity(value: string | undefined): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function toolIdentity(node: ChatProjectionNode): ToolIdentity | null {
  if (node.kind !== 'activity' || node.activityType !== 'tool') return null;

  const toolkitName = node.toolkitName?.trim() || 'Tool';
  const methodName =
    node.methodName?.trim() || node.toolName?.trim() || node.title.trim();
  if (!methodName) return null;

  const agentIdentity =
    normalizeIdentity(node.agentId) || normalizeIdentity(node.agentName);
  return {
    key: JSON.stringify([
      node.runId,
      agentIdentity,
      normalizeIdentity(toolkitName),
      normalizeIdentity(methodName),
    ]),
    toolkitName,
    methodName,
  };
}

function uniqueDetails(nodes: readonly ChatActivityNode[]): string | undefined {
  const details = nodes
    .map((node) => node.detail?.trim())
    .filter((detail): detail is string => Boolean(detail));
  const unique = [...new Set(details)];
  return unique.length ? unique.join('\n\n') : undefined;
}

function callStatus(nodes: readonly ChatActivityNode[]): ChatActivityStatus {
  return nodes.at(-1)?.status || 'unknown';
}

function presentToolCall(call: MutableToolCall): PresentedToolCall {
  const first = call.nodes[0]!;
  const last = call.nodes.at(-1)!;
  return {
    id: call.id,
    nodes: call.nodes,
    presentedNode: {
      ...first,
      eventType: last.eventType,
      status: callStatus(call.nodes),
      title: last.title || first.title,
      detail: uniqueDetails(call.nodes),
      toolCallId: last.toolCallId || first.toolCallId,
    },
  };
}

/**
 * Fold one uninterrupted toolkit/method segment into logical invocations.
 * Explicit backend call IDs are authoritative. Older transports fall back to
 * FIFO lifecycle pairing so repeated start/terminal frames count as calls,
 * not as twice as many timeline rows.
 */
function buildToolCalls(
  nodes: readonly ChatActivityNode[]
): PresentedToolCall[] {
  const calls: MutableToolCall[] = [];
  const byCallId = new Map<string, MutableToolCall>();
  const anonymousOpen: MutableToolCall[] = [];

  const createCall = (node: ChatActivityNode): MutableToolCall => {
    const call = { id: `tool-call:${node.id}`, nodes: [node] };
    calls.push(call);
    return call;
  };

  for (const node of nodes) {
    if (node.toolCallId) {
      const existing = byCallId.get(node.toolCallId);
      if (existing) {
        existing.nodes.push(node);
      } else {
        byCallId.set(node.toolCallId, createCall(node));
      }
      continue;
    }

    if (ACTIVE_TOOL_STATUSES.has(node.status)) {
      anonymousOpen.push(createCall(node));
      continue;
    }

    if (TERMINAL_TOOL_STATUSES.has(node.status) && anonymousOpen.length > 0) {
      anonymousOpen.shift()!.nodes.push(node);
      continue;
    }

    createCall(node);
  }

  return calls.map(presentToolCall);
}

function aggregateStatus(
  calls: readonly PresentedToolCall[]
): ChatActivityStatus {
  const statuses = calls.map((call) => call.presentedNode.status);
  if (statuses.includes('outcome_unknown')) return 'outcome_unknown';
  if (statuses.includes('failed')) return 'failed';
  if (statuses.includes('timed_out')) return 'timed_out';
  if (statuses.includes('running')) return 'running';
  if (statuses.includes('pending')) return 'pending';
  if (statuses.every((status) => status === 'completed')) return 'completed';
  if (statuses.every((status) => status === 'cancelled')) return 'cancelled';
  if (statuses.includes('completed')) return 'completed';
  if (statuses.includes('cancelled')) return 'cancelled';
  return 'unknown';
}

/**
 * Produce presentation-only rows without modifying the semantic event ledger.
 * Only consecutive identical calls are grouped; any different node preserves
 * chronology by ending the current segment.
 */
export function groupRepeatedToolCalls(
  nodes: readonly ChatProjectionNode[]
): ChatTimelineDisplayRow[] {
  const rows: ChatTimelineDisplayRow[] = [];

  for (let index = 0; index < nodes.length;) {
    const node = nodes[index]!;
    const identity = toolIdentity(node);
    if (!identity || node.kind !== 'activity') {
      rows.push({ rowKind: 'node', id: node.id, node });
      index += 1;
      continue;
    }

    const segment: ChatActivityNode[] = [node];
    let cursor = index + 1;
    while (cursor < nodes.length) {
      const candidate = nodes[cursor]!;
      const candidateIdentity = toolIdentity(candidate);
      if (
        !candidateIdentity ||
        candidateIdentity.key !== identity.key ||
        candidate.kind !== 'activity'
      ) {
        break;
      }
      segment.push(candidate);
      cursor += 1;
    }

    const calls = buildToolCalls(segment);
    if (calls.length === 1) {
      const presentedNode = calls[0]!.presentedNode;
      rows.push({ rowKind: 'node', id: presentedNode.id, node: presentedNode });
    } else {
      rows.push({
        rowKind: 'repeated-tool-calls',
        id: `tool-call-group:${calls[0]!.id}`,
        runId: node.runId,
        agentId: node.agentId,
        agentName: node.agentName,
        toolkitName: identity.toolkitName,
        methodName: identity.methodName,
        calls,
        status: aggregateStatus(calls),
      });
    }
    index = cursor;
  }

  return rows;
}
