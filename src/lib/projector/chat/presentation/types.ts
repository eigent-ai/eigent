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
  ChatActivityType,
  ChatArtifactNode,
  ChatInteractionNode,
  ChatMessageNode,
  ChatNoticeSeverity,
  ChatPlanNode,
  ChatProjectionNode,
  ChatRunStatus,
  ChatRunStatusNode,
} from '../types';

/**
 * Stable presentation categories selected by the projection. React maps these
 * values to components and icons; it must not infer intent from visible copy.
 */
export type TimelineActionKind =
  | 'search'
  | 'inspect'
  | 'edit'
  | 'write'
  | 'command'
  | 'plan'
  | 'message'
  | 'browse'
  | 'subagent'
  | 'generic';

/** A correlated result/progress notice attached to one logical invocation. */
export interface TimelineToolNotice {
  eventId: string;
  title?: string;
  content: string;
  severity: ChatNoticeSeverity;
}

export interface TimelineElapsedAnchor {
  /** Attempt time already measured by the authoritative Run aggregate. */
  accumulatedMs: number;
  /** Add wall-clock time after this instant while the Run remains active. */
  anchoredAt: string | null;
}

/** Stable timing metadata shared by all three Timeline presentations. */
export interface TimelineRunTimestamps {
  createdAt: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  endedAt: string | null;
  /** Present only after both a start and terminal timestamp are known. */
  durationMs: number | null;
  /** Canonical attempt aggregate, when the RunJournal supplied one. */
  totalAttemptElapsedMs: number | null;
  /** Baseline for a live timer; null until authoritative reconciliation. */
  elapsedAnchor: TimelineElapsedAnchor | null;
}

/**
 * One semantic tool invocation. Multiple lifecycle receipts are paired only
 * when the transport supplies the same explicit `toolCallId`.
 */
export interface TimelineToolInvocation {
  id: string;
  runId: string;
  activityType: Extract<ChatActivityType, 'tool' | 'terminal'>;
  toolCallId?: string;
  nodes: readonly ChatActivityNode[];
  firstNodeId: string;
  lastNodeId: string;
  runSequence: number;
  title: string;
  actionKind: TimelineActionKind;
  status: ChatActivityStatus;
  phase: ChatActivityPhase;
  /** Semantic, presentation-safe values. Raw transport payloads are absent. */
  input?: string;
  output?: string;
  detail?: string;
  durationMs?: number;
  startedAt: string | null;
  endedAt: string | null;
  agentId?: string;
  agentName?: string;
  taskId?: string;
  stepId?: string;
  toolkitName?: string;
  methodName?: string;
  toolName?: string;
  /** Projection-owned delegated-agent classification; renderers must not infer it. */
  subagentInvocation?: boolean;
  subagentType?: string;
  subagentName?: string;
  subagentStatus?: ChatActivityStatus;
  subagentAgentId?: string;
  subagentTaskId?: string;
  agentProvider?: string;
  agentModel?: string;
  /** Narrative annotation correlated by an explicit backend toolCallId. */
  notice?: TimelineToolNotice;
}

export interface TimelineNodeTraceRow {
  kind: 'node';
  id: string;
  runSequence: number;
  node: ChatProjectionNode;
}

export interface TimelineToolTraceRow {
  kind: 'tool';
  id: string;
  runSequence: number;
  invocation: TimelineToolInvocation;
}

/** Ordered source for the Detailed renderer; tool lifecycles occupy one row. */
export type TimelineTraceRow = TimelineNodeTraceRow | TimelineToolTraceRow;

export interface TimelineRunSummary {
  /** Logical invocations, not lifecycle receipt count. */
  toolCallCount: number;
  /** Unique assistant messages, folded by explicit message identity. */
  agentMessageCount: number;
  /** Unique file/artifact identities, not artifact lifecycle receipt count. */
  artifactCount: number;
  /** Unique human interactions, folded by explicit interaction identity. */
  interactionCount: number;
}

/**
 * Transport-independent Run model consumed by Normal, Detailed, and
 * Summarised Timeline renderers.
 */
export interface TimelineRunView {
  id: string;
  projectId: string;
  runId: string;
  /** All semantic nodes in deterministic Run order. */
  nodes: readonly ChatProjectionNode[];
  userQuery: ChatMessageNode | null;
  plans: readonly ChatPlanNode[];
  traceRows: readonly TimelineTraceRow[];
  finalAssistantResponse: ChatMessageNode | null;
  artifacts: readonly ChatArtifactNode[];
  interactions: readonly ChatInteractionNode[];
  runStatus: ChatRunStatusNode | null;
  status: ChatRunStatus;
  timestamps: TimelineRunTimestamps;
  summary: TimelineRunSummary;
}
