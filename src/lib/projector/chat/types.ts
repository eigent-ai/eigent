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
  CanonicalProjectEvent,
  CanonicalSemanticEnvelope,
  CanonicalSemanticKindV2,
  ProjectedLegacyStep,
} from '../types';

export type ChatProjectionInput = CanonicalProjectEvent | ProjectedLegacyStep;

export type ChatProjectionNodeKind =
  | 'message'
  | 'notice'
  | 'interaction'
  | 'plan'
  | 'step'
  | 'activity'
  | 'artifact'
  | 'run_status'
  | 'unknown';

export type ChatMessageRole = 'user' | 'assistant';
export type ChatMessageStatus = 'streaming' | 'complete';
export type ChatMessagePurpose =
  | 'query'
  | 'narration'
  | 'agent_result'
  | 'final'
  | 'interaction_response'
  | 'unknown';

export interface ChatMessageAttachment {
  fileName: string;
  /** Present only after a trusted local attachment resolver grants reveal. */
  filePath?: string;
  fileId?: string;
  source?: 'local' | 'upload';
}
export type ChatNoticeSeverity = 'info' | 'success' | 'warning' | 'error';
export type ChatInteractionStatus =
  'requested' | 'responded' | 'cancelled' | 'expired';
export type ChatPlanTaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'blocked'
  | 'unknown';
export type ChatActivityType =
  'agent' | 'tool' | 'terminal' | 'task' | 'work_log';
export type ChatActivityStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'outcome_unknown'
  | 'cancelled'
  | 'blocked'
  | 'interrupted'
  | 'unknown';
export type ChatActivityPhase =
  | 'requested'
  | 'started'
  | 'progress'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'blocked'
  | 'resumed'
  | 'interrupted'
  | 'unknown';
export type ChatArtifactOperation =
  'created' | 'updated' | 'deleted' | 'unknown';
export type ChatRunStatus =
  | 'pending'
  | 'running'
  | 'waiting_for_user'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'unknown';

/**
 * Shared, transport-independent metadata for every semantic ChatBox node.
 *
 * Timeline identity is always the immutable source event identity. Stable
 * entity IDs may be used by presentation policies to fold immutable receipts
 * without mutating or replacing the source ledger.
 */
export interface ChatProjectionNodeBase {
  id: string;
  eventId: string;
  projectId: string;
  runId: string;
  createdAt: string | null;
  runSequence: number;
  cloudCursor: number | null;
  eventType: string;
  legacyStep: string | null;
  /** Validated V1/V2 semantics; absent for legacy or invalid envelopes. */
  semantic?: CanonicalSemanticEnvelope;
}

export interface ChatMessageNode extends ChatProjectionNodeBase {
  kind: 'message';
  role: ChatMessageRole;
  content: string;
  status: ChatMessageStatus;
  /** Semantic role used by Run presenters; independent from transport names. */
  purpose?: ChatMessagePurpose;
  /** Explicit display-safe file metadata; typed events never use raw attachments. */
  attachments?: ChatMessageAttachment[];
  /** Stable typed-message identity used only for presentation folding. */
  messageId?: string;
  agentId?: string;
  agentName?: string;
  /**
   * Explicit durable correlation carried by a legacy HUMAN_REPLY receipt.
   * This is display metadata only: `eventId` remains the immutable Timeline
   * identity. Messages without a backend-provided interaction id must never be
   * correlated by adjacency.
   */
  interactionId?: string;
  interactionResponse?: boolean;
  /** Durable review handoffs admitted with this user message. */
  reviewHandoffIds?: string[];
}

export interface ChatNoticeNode extends ChatProjectionNodeBase {
  kind: 'notice';
  severity: ChatNoticeSeverity;
  content: string;
  title?: string;
  purpose?: 'progress' | 'result' | 'decision' | 'status';
  noticeId?: string;
  code?: string;
  /** Stable correlation to the code-owned tool invocation that emitted it. */
  toolCallId?: string;
  /** Authored task Step that produced this notice, when explicit. */
  stepId?: string;
}

export interface ChatInteractionOption {
  id: string;
  label: string;
  description?: string;
}

export interface ChatInteractionNode extends ChatProjectionNodeBase {
  kind: 'interaction';
  /** Explicit backend identity used only to correlate lifecycle receipts. */
  interactionId?: string;
  /** Authored task Step blocked or resumed by this interaction. */
  stepId?: string;
  interactionType: string;
  status: ChatInteractionStatus;
  prompt?: string;
  response?: string;
  /** Safe option identifiers from a decision; opaque option values are omitted. */
  responseOptionIds?: string[];
  /** Presentation-only receipt links; source nodes remain unchanged. */
  requestEventId?: string;
  resolutionEventId?: string;
  agentName?: string;
  options?: ChatInteractionOption[];
}

export interface ChatPlanTask {
  id: string;
  title: string;
  status: ChatPlanTaskStatus;
  agentId?: string;
  agentName?: string;
}

export interface ChatPlanNode extends ChatProjectionNodeBase {
  kind: 'plan';
  status?: 'active' | 'completed';
  title?: string;
  summary?: string;
  tasks: ChatPlanTask[];
}

export type ChatStepStatus =
  | 'pending'
  | 'running'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export interface ChatStepNode extends ChatProjectionNodeBase {
  kind: 'step';
  stepId: string;
  planId?: string;
  planItemId?: string;
  parentStepId?: string;
  title: string;
  summary?: string;
  status: ChatStepStatus;
  phase: ChatActivityPhase;
  ordinal?: number;
  agentId?: string;
  agentName?: string;
  attemptId?: string;
  source: 'authored';
}

export interface ChatActivityNode extends ChatProjectionNodeBase {
  kind: 'activity';
  activityType: ChatActivityType;
  status: ChatActivityStatus;
  /** Lifecycle phase for pairing one invocation without relying on adjacency. */
  phase?: ChatActivityPhase;
  title: string;
  detail?: string;
  /** Redacted, presentation-safe request text. Typed events must opt in. */
  input?: string;
  /** Redacted, presentation-safe response text. Typed events must opt in. */
  output?: string;
  /** Duration supplied by the backend when it is safe and authoritative. */
  durationMs?: number;
  agentId?: string;
  agentName?: string;
  taskId?: string;
  toolkitName?: string;
  methodName?: string;
  /** Backend correlation for one tool invocation when the transport supplies it. */
  toolCallId?: string;
  /** Authored task Step that owns this tool lifecycle, when explicit. */
  stepId?: string;
  /** Typed transports may name a tool without a toolkit/method pair. */
  toolName?: string;
  /** Safe delegated-agent identity projected from a subagent tool request. */
  subagentType?: string;
  /** Safe user-facing name supplied when the delegated agent was created. */
  subagentName?: string;
  /** Exact registered delegation tool, even when no display identity exists. */
  subagentInvocation?: boolean;
  /** Child lifecycle returned by the delegation tool, separate from tool receipt status. */
  subagentStatus?: ChatActivityStatus;
  /** Opaque child correlations used for future explicitly scoped child events. */
  subagentAgentId?: string;
  subagentTaskId?: string;
  /** Provider/model hints used only for delegated-agent presentation. */
  agentProvider?: string;
  agentModel?: string;
  /** Stable subject identity from the versioned semantic envelope. */
  activityId?: string;
  /** Whether adjacent activity-stream titles preserve exact chunk boundaries. */
  streamFragmentMode?: 'exact' | 'normalized';
  /** Domain discriminator such as command_execution or agent_turn. */
  semanticKind?: CanonicalSemanticKindV2;
  /** Whether the producer supplied every required correlation field. */
  semanticCompleteness?: 'complete' | 'partial';
}

export interface ChatArtifactNode extends ChatProjectionNodeBase {
  kind: 'artifact';
  operation: ChatArtifactOperation;
  path: string;
  /** Stable backend-owned identity for one generated artifact. */
  artifactId?: string;
  /** Workspace-scoped identity; never inferred from an absolute local path. */
  relativePath?: string;
  name?: string;
  mimeType?: string;
  agentId?: string;
  taskId?: string;
  /** Authored task Step that produced this artifact, when explicit. */
  stepId?: string;
}

export interface ChatRunStatusNode extends ChatProjectionNodeBase {
  kind: 'run_status';
  status: ChatRunStatus;
  reason?: string;
  /** Latest Attempt start retained when lifecycle rows are collapsed. */
  startedAt?: string;
}

/**
 * A non-rendering-safe fallback for event types the semantic layer does not
 * understand yet. The raw payload is deliberately not exposed to UI code so
 * an unknown event cannot accidentally render secrets or a huge object.
 */
export interface ChatUnknownNode extends ChatProjectionNodeBase {
  kind: 'unknown';
  summary: string;
}

export type ChatProjectionNode =
  | ChatMessageNode
  | ChatNoticeNode
  | ChatInteractionNode
  | ChatPlanNode
  | ChatStepNode
  | ChatActivityNode
  | ChatArtifactNode
  | ChatRunStatusNode
  | ChatUnknownNode;

/**
 * Explicit single-event presentation classification.
 *
 * Every outcome is still recorded in `seenEventIds`; only displayable
 * semantic nodes and genuinely unsupported future events enter the retained
 * Timeline node list.
 */
export type ChatProjectionDecision =
  | { kind: 'display'; node: ChatProjectionNode }
  | { kind: 'receipt'; receiptType: string }
  | { kind: 'hidden'; reason: string }
  | { kind: 'unsupported'; node: ChatUnknownNode };

export interface ChatProjectionState {
  projectId: string;
  nodes: ChatProjectionNode[];
  /** Direct event-ID lookup for retained immutable Timeline nodes. */
  nodeById: Record<string, ChatProjectionNode>;
  /** Event-ID position lookup retained for bounded-store compatibility. */
  nodeIndexById?: Record<string, number>;
  seenEventIds: Record<string, true>;
}

export interface SelectChatNodesOptions {
  runId?: string;
  kinds?: ReadonlySet<ChatProjectionNodeKind>;
  includeUnknown?: boolean;
}
