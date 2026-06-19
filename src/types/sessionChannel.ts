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

/**
 * Session Channel data model.
 *
 * Core principle: **exactly one channel per project**, keyed by `projectId`.
 * The channel is the entire conversation log for that project as a single
 * ordered, append-only stream — it captures the full back-and-forth:
 *
 *   [turn-boundary #1] user-message → plan → work-log → agent-message(end)
 *   [turn-boundary #2] user-message → work-log → ask → user-message → agent-message(end)
 *   [turn-boundary #3] user-message → ...
 *
 * A "turn" is one user-query-to-agent-completion exchange within that single
 * channel, grouped by `turnId` (authoritative key, replaces taskId-as-turn) and
 * marked by a `turn-boundary` item. Grouping is a flat filter:
 * `items.filter(i => i.turnId === t)` — no backward-scanning heuristic.
 *
 * This replaces today's "N `chatStore` instances per project, one per turn,
 * joined by `createdAt`" model.
 */

import type { ChatTaskStatusType, SessionModeType } from './constants';
// Work-log timeline payload reuses the existing accordion model verbatim.
import type {
  AgentBlock,
  TimelineItem,
  ToolItem,
  MessageItem as WorkLogMessageItem,
} from '@/components/ChatBox/MessageItem/TaskWorkLogAccordion';

export type { AgentBlock, TimelineItem, ToolItem, WorkLogMessageItem };

/** Every kind of item that can appear in a project's session channel. */
export type ChannelItemKind =
  | 'turn-boundary'
  | 'user-message'
  | 'agent-message'
  | 'plan'
  | 'work-log'
  | 'preparing'
  | 'chain-of-thought'
  | 'error'
  | 'failed'
  | 'file-output'
  | 'ask'
  | 'skip-marker';

/**
 * Fields shared by every channel item.
 * - `turnId` groups items into a turn (authoritative).
 * - `seq` is a monotonically increasing per-channel ordering key.
 */
export interface ChannelItemBase {
  id: string;
  kind: ChannelItemKind;
  turnId: string;
  seq: number;
  createdAt: number;
}

/**
 * Divider that opens a turn. The `TurnTabs` strip is built from these
 * (oldest→newest via the channel's `turnOrder`).
 */
export interface TurnBoundaryItem extends ChannelItemBase {
  kind: 'turn-boundary';
  turnNumber: number;
  source: 'user' | 'trigger';
  /** Present when this turn was launched by a background trigger execution. */
  executionId?: string;
  sessionMode: SessionModeType;
  status: ChatTaskStatusType;
}

export interface UserMessageItem extends ChannelItemBase {
  kind: 'user-message';
  content: string;
  attaches?: File[];
}

/**
 * `variant` selects which agent card the renderer uses:
 * - `notice`    — inline notice text
 * - `answer`    — a plain streamed answer
 * - `end`       — the turn's final answer (with optional output file chips)
 * - `agent-end` — a collapsible per-agent summary result
 */
export interface AgentMessageItem extends ChannelItemBase {
  kind: 'agent-message';
  content: string;
  agentName?: string;
  variant: 'notice' | 'answer' | 'end' | 'agent-end';
  fileList?: FileInfo[];
  /** True while the text is still streaming in (suppressed for replay@0ms). */
  streaming?: boolean;
}

export interface PlanItem extends ChannelItemBase {
  kind: 'plan';
  subTasks: TaskInfo[];
  summaryTask: string;
  confirmed: boolean;
  planDirty: boolean;
  /** Live streamed decomposition text shown before the plan is finalized. */
  streamingDecomposeText: string;
}

/**
 * One execution work-log section. A skip closes the open section
 * (`status: 'done'`) and opens a fresh one with the next `sectionIndex` in the
 * **same** turn (`reopenedBySkip: true`) — no new turn boundary.
 */
export interface WorkLogItem extends ChannelItemBase {
  kind: 'work-log';
  sectionIndex: number;
  blocks: AgentBlock[];
  status: 'running' | 'done';
  reopenedBySkip?: boolean;
}

/**
 * Human-in-the-loop ask. `inputKind` defaults to `'text'`; the other controls
 * are forward-compatible and only activate if the backend `ask` payload already
 * carries `options`/`input_kind`.
 */
export type AskInputKind = 'single' | 'multi' | 'text' | 'confirm';

export interface AskItem extends ChannelItemBase {
  kind: 'ask';
  question: string;
  agent: string;
  inputKind: AskInputKind;
  options?: { value: string; label: string }[];
  answered: boolean;
  answer?: { text?: string; selected?: string[] };
  /** Epoch ms after which the unanswered ask auto-skips (30s window). */
  autoSkipDeadline?: number;
}

export interface SkipMarkerItem extends ChannelItemBase {
  kind: 'skip-marker';
  reason: 'agent' | 'timeout' | 'user-stop';
}

export interface ErrorItem extends ChannelItemBase {
  kind: 'error' | 'failed';
  content: string;
  errorType?: 'budget' | 'context_too_long' | 'generic';
}

export interface FileOutputItem extends ChannelItemBase {
  kind: 'file-output';
  files: FileInfo[];
}

export interface ChainOfThoughtItem extends ChannelItemBase {
  kind: 'chain-of-thought';
  cot: string[];
}

export interface PreparingItem extends ChannelItemBase {
  kind: 'preparing';
}

/** Discriminated union of all channel items (discriminant: `kind`). */
export type ChannelItem =
  | TurnBoundaryItem
  | UserMessageItem
  | AgentMessageItem
  | PlanItem
  | WorkLogItem
  | AskItem
  | SkipMarkerItem
  | ErrorItem
  | FileOutputItem
  | ChainOfThoughtItem
  | PreparingItem;

/** Narrowing helper: maps each `kind` to its concrete item type. */
export type ChannelItemOfKind<K extends ChannelItemKind> = Extract<
  ChannelItem,
  { kind: K }
>;
