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

import { Badge } from '@/components/ui/badge';
import ShinyText from '@/components/ui/ShinyText/ShinyText';
import { agentMap, type WorkflowAgentType } from '@/components/WorkFlow/agents';
import { cn } from '@/lib/utils';
import type {
  DurableRunDisplayStatus,
  VanillaChatStore,
} from '@/store/chatStore';
import {
  AgentStep,
  ChatTaskStatus,
  type ChatTaskStatusType,
  SessionMode,
  TaskStatus,
} from '@/types/constants';
import { AnimatePresence, motion } from 'framer-motion';
import { Bot, ChevronDown, ChevronRight } from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { HumanInteractionCard } from './HumanInteractionCard';
import { formatSplittingElapsed } from './TokenUtils';
import { ToolInputOutputDetails } from './ToolInputOutputDetails';

const CONTENT_EASE: [number, number, number, number] = [0.32, 0.72, 0, 1];
const HEIGHT_MOTION = {
  height: { duration: 0.22, ease: CONTENT_EASE },
  opacity: { duration: 0.16, ease: CONTENT_EASE },
} as const;
const TOOL_INLINE_PREVIEW_MAX = 200;

function normalizeToolkitMessage(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Matches `getFormattedTaskTime` / task timer fields on the chat task. */
function getTaskElapsedMs(task: {
  status: ChatTaskStatusType;
  taskTime: number;
  elapsed: number;
}): number {
  if (task.status === ChatTaskStatus.RUNNING && task.taskTime !== 0) {
    return Math.max(0, Date.now() - task.taskTime + task.elapsed);
  }
  return Math.max(0, task.elapsed);
}

export function getTaskRunDisplayStatus(task: {
  durableRunStatus?: DurableRunDisplayStatus;
  messages?: Array<{ step?: string; content?: string }>;
}): DurableRunDisplayStatus | undefined {
  // Old cloud replicas can still say "interrupted" even though their legacy
  // event stream contains a concrete error. The visible event is stronger
  // evidence for presentation than that compatibility status projection.
  const hasRecordedError = task.messages?.some(
    (message) =>
      message.step === AgentStep.ERROR ||
      (typeof message.content === 'string' &&
        message.content.trimStart().startsWith('❌ **Error**'))
  );
  return hasRecordedError ? 'failed' : task.durableRunStatus;
}

export function terminalWorkLogI18nKey(
  status: DurableRunDisplayStatus | undefined
): string {
  if (status === 'failed') return 'chat.failed-after';
  if (status === 'interrupted') return 'chat.interrupted-after';
  if (status === 'cancelled' || status === 'stopped') {
    return 'chat.stopped-after';
  }
  return 'chat.worked-for';
}

type TaggedLog = {
  entry: AgentMessage;
  agentId: string;
  agentType: string;
  agentName: string;
};

/**
 * Legacy state stores one log array per agent. New events carry a Run-scoped
 * receive sequence, so a workforce timeline can reconstruct the original
 * cross-agent order instead of rendering the arrays agent-by-agent.
 *
 * Histories created before sequence stamping are intentionally left in their
 * original stable order. We also keep mixed histories stable: without a
 * sequence for every row there is no trustworthy relative order to infer.
 */
export function mergeTaggedAgentLogs(
  taskAssigning: Agent[] | undefined
): TaggedLog[] {
  if (!taskAssigning?.length) return [];
  const tagged = taskAssigning.flatMap((a) =>
    (a.log ?? []).map((entry) => ({
      entry,
      agentId: a.agent_id,
      agentType: a.type,
      agentName: agentMap[a.type as WorkflowAgentType]?.name ?? a.name,
    }))
  );

  const hasCompleteTimeline = tagged.every(
    ({ entry }) =>
      typeof entry.timelineSequence === 'number' &&
      Number.isInteger(entry.timelineSequence) &&
      entry.timelineSequence > 0
  );
  if (!hasCompleteTimeline) return tagged;

  return tagged
    .map((value, stableIndex) => ({ value, stableIndex }))
    .sort(
      (left, right) =>
        left.value.entry.timelineSequence! -
          right.value.entry.timelineSequence! ||
        left.stableIndex - right.stableIndex
    )
    .map(({ value }) => value);
}

/**
 * The single agent drives its work through a todo list (TODO_STATE). The
 * in-progress todo's `active_form` (e.g. "Searching Google for relevant
 * papers") is plumbed into that task's `content` in the store. Surface it as
 * the live header label so the user sees what the agent is doing *right now*
 * instead of a static "CAMEL Agent" tag.
 *
 * Falls back to the most recently completed step so the label never flashes
 * empty between todos or after the run finishes.
 */
export function getSingleAgentActiveForm(
  task: { taskAssigning?: Agent[] } | undefined
): string {
  const single = task?.taskAssigning?.find((a) => a.type === 'single_agent');
  const tasks = single?.tasks ?? [];
  const running = tasks.find((tk) => tk.status === TaskStatus.RUNNING);
  if (running?.content?.trim()) return running.content.trim();
  for (let i = tasks.length - 1; i >= 0; i--) {
    const tk = tasks[i]!;
    if (tk.status === TaskStatus.COMPLETED && tk.content?.trim()) {
      return tk.content.trim();
    }
  }
  return '';
}

function titleCaseMethod(method: string): string {
  if (!method) return '';
  return method.charAt(0).toUpperCase() + method.slice(1);
}

/** Uppercase the first character of agent narration so rows read cleanly. */
function capitalizeFirst(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function truncateText(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function toolRowTitle(toolkitName: string, method: string): string {
  const normalizedToolkit = normalizedToolIdentity(toolkitName);
  const normalizedMethod = normalizedToolIdentity(method);
  const visibleMethod =
    normalizedToolkit === 'searchtoolkit' &&
    normalizedMethod.startsWith('search')
      ? 'Search'
      : titleCaseMethod(method);
  return `${toolkitName} · ${visibleMethod}`;
}

function searchProviderLabel(
  toolkitName: string,
  method: string
): string | null {
  if (normalizedToolIdentity(toolkitName) !== 'searchtoolkit') return null;
  const normalizedMethod = normalizedToolIdentity(method);
  if (normalizedMethod.includes('querit')) return 'Querit';
  if (normalizedMethod.includes('google')) return 'Google';
  return null;
}

/**
 * Heuristic: does this toolkit message read as agent narration ("Cloning
 * session …", "Found 12 results.") rather than a kwargs-style payload
 * (`url='https://x'`, `{"q": "…"}`) we'd only want hidden inside the fold?
 *
 * Narration is shown inline above the tool row so the user always sees what
 * the agent is doing, even with the tool fold collapsed. Payloads stay folded.
 */
function looksLikeNarration(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  if (s.length < 12) return false;
  const head = s.slice(0, 1);
  if (head === '{' || head === '[' || head === '<') return false;
  if (/^https?:\/\//i.test(s)) return false;
  // kwargs-ish: leading `key=` or `key='`
  if (/^[a-z_][\w]*\s*=/i.test(s)) return false;
  // Multi-word, alpha-leading, ends in punctuation or is a long sentence.
  if (!/[a-zA-Z]/.test(s)) return false;
  const wordCount = s.split(/\s+/).length;
  if (wordCount < 3) return false;
  return true;
}

export type ToolItem = {
  kind: 'tool';
  id: string;
  rowTitle: string;
  toolkitName: string;
  method: string;
  /** Concatenated input + output (markdown-rendered when expanded). */
  detail: string;
  /** The tool call request/arguments (from ACTIVATE_TOOLKIT). */
  input: string;
  /** The tool call response/result (from DEACTIVATE_TOOLKIT). */
  output: string;
  status: 'running' | 'done';
  /** Human question/answer owned by this Human Toolkit call. */
  humanInput?: HumanInputItem;
};

type MessageItem = {
  kind: 'message';
  id: string;
  text: string;
  source: 'reasoning' | 'notice' | 'toolkit_message';
  /**
   * `running` is true while the agent action that emitted this narration is
   * still in flight (e.g. the matching tool hasn't deactivated yet). Used to
   * shimmer the inline text and to drive the live status row.
   */
  running: boolean;
  /** Stable handle so DEACTIVATE_TOOLKIT can flip the sibling narration off. */
  pairKey: string | null;
};

/**
 * A human-control receipt embedded at the point where execution paused.
 * BottomBox owns the live controls, while the matching Human Toolkit detail
 * owns the question/answer context and folds after the response is recorded.
 */
export type HumanInputItem = {
  kind: 'human-input';
  id: string;
  question: string;
  response: string | null;
  interaction?: NonNullable<Message['interaction']>;
};

export type TimelineItem = ToolItem | MessageItem | HumanInputItem;

export type RepeatedToolItem = {
  kind: 'repeated-tool';
  id: string;
  rowTitle: string;
  toolkitName: string;
  method: string;
  calls: readonly ToolItem[];
  status: 'running' | 'done';
};

export type WorkLogDisplayItem = TimelineItem | RepeatedToolItem;

function normalizedToolIdentity(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function repeatedToolKey(item: ToolItem): string | null {
  // A Human Toolkit call owns an interaction receipt and must remain an
  // individual accordion so that question/answer history stays attached.
  if (item.humanInput) return null;
  const toolkit = normalizedToolIdentity(item.toolkitName);
  const rawMethod = normalizedToolIdentity(item.method);
  const method =
    toolkit === 'searchtoolkit' && rawMethod.startsWith('search')
      ? 'search'
      : rawMethod;
  return toolkit && method ? JSON.stringify([toolkit, method]) : null;
}

/**
 * Collapse only consecutive identical toolkit/method rows for presentation.
 * Messages and tools that own human-input receipts are hard chronology
 * boundaries, and the source work-log items remain unchanged.
 */
export function groupConsecutiveToolItems(
  items: readonly TimelineItem[]
): WorkLogDisplayItem[] {
  const grouped: WorkLogDisplayItem[] = [];

  for (let index = 0; index < items.length;) {
    const item = items[index]!;
    if (item.kind !== 'tool') {
      grouped.push(item);
      index += 1;
      continue;
    }

    const identity = repeatedToolKey(item);
    if (!identity) {
      grouped.push(item);
      index += 1;
      continue;
    }

    const calls: ToolItem[] = [item];
    let cursor = index + 1;
    while (cursor < items.length) {
      const candidate = items[cursor]!;
      if (
        candidate.kind !== 'tool' ||
        repeatedToolKey(candidate) !== identity
      ) {
        break;
      }
      calls.push(candidate);
      cursor += 1;
    }

    if (calls.length === 1) {
      grouped.push(item);
    } else {
      grouped.push({
        kind: 'repeated-tool',
        id: `repeated-tool:${item.id}`,
        rowTitle: item.rowTitle,
        toolkitName: item.toolkitName,
        method: item.method,
        calls,
        status: calls.some((call) => call.status === 'running')
          ? 'running'
          : 'done',
      });
    }
    index = cursor;
  }

  return grouped;
}

/**
 * One agent's slice of work — a chronological list of inline messages
 * (reasoning, notices, toolkit narration) and tool rows. Renders flat: the
 * only foldable element inside is each tool's input/output detail.
 */
export type AgentBlock = {
  id: string;
  agentId: string;
  agentType: string;
  agentName: string;
  items: TimelineItem[];
  status: 'running' | 'done';
  /**
   * `preparation` is the synthetic block that collapses the workforce's
   * leading/lazy `register agent` toolkit calls into one "Preparing agents"
   * row. Everything else is `action`.
   */
  kind: 'preparation' | 'action';
};

/**
 * All action blocks for the same agent merged into a single collapsible
 * group. Items from every constituent block are concatenated in their
 * original chronological order.
 */
export type AgentGroup = {
  kind: 'agent-group';
  id: string;
  agentId: string;
  agentType: string;
  agentName: string;
  items: TimelineItem[];
  status: 'running' | 'done';
  doneToolCount: number;
  totalToolCount: number;
};

/** Union for the grouped render list. */
export type GroupedEntry = AgentGroup | AgentBlock;

const PREPARATION_BLOCK_ID = 'b-prep';
const PREPARATION_BLOCK_LABEL = 'Preparing agents';
const PREPARATION_BLOCK_LABEL_SINGLE = 'Preparing agent';

function isHumanAskTool(toolkitName: string, method: string): boolean {
  const normalizedToolkit = toolkitName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  const normalizedMethod = method
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return (
    normalizedToolkit === 'humantoolkit' &&
    normalizedMethod === 'askhumanviagui'
  );
}

function pairKey(toolkit: string, method: string): string {
  return `${toolkit}::${method}`;
}

/**
 * Toolkit calls that should always land in the synthetic "Preparing agents"
 * block at the top — agent registration and per-agent browser session
 * cloning, both of which are workforce setup, not part of the agent's own
 * action timeline.
 *
 * `clone for new session` is `HybridBrowserToolkit.clone_for_new_session`
 * (the listener replaces underscores with spaces, see
 * `app/utils/listen/toolkit_listen.py`).
 */
const PREPARATION_METHODS: ReadonlySet<string> = new Set([
  'register agent',
  'clone for new session',
]);

function isPreparationEvent(entry: AgentMessage): boolean {
  if (
    entry.step !== AgentStep.ACTIVATE_TOOLKIT &&
    entry.step !== AgentStep.DEACTIVATE_TOOLKIT
  ) {
    return false;
  }
  const method = (entry.data?.method_name ?? '').trim().toLowerCase();
  return PREPARATION_METHODS.has(method);
}

/**
 * Exported for unit tests. Folds a tagged, chronological log into
 * `AgentBlock[]`, preserving the wall-clock order of messages and tools
 * inside each block.
 */
export function buildAgentBlocks(
  tagged: TaggedLog[],
  isSingleAgent = false
): AgentBlock[] {
  const blocks: AgentBlock[] = [];
  const cursor: { current: AgentBlock | null } = { current: null };
  let prep: AgentBlock | null = null;
  const prepLabel = isSingleAgent
    ? PREPARATION_BLOCK_LABEL_SINGLE
    : PREPARATION_BLOCK_LABEL;

  // The workforce factory wires up agents via `register agent` toolkit calls.
  // Those calls can appear as a leading burst *and* sprinkled in mid-run
  // whenever a new specialist is lazily registered after another agent has
  // already started acting. We always route them to a single synthetic
  // "Preparing agents" block pinned at the top so the currently-active
  // agent's timeline is not interrupted by registration noise.
  const ensurePrep = (): AgentBlock => {
    if (!prep) {
      prep = {
        id: PREPARATION_BLOCK_ID,
        agentId: '__prep__',
        agentType: '__prep__',
        agentName: prepLabel,
        items: [],
        status: 'running',
        kind: 'preparation',
      };
      blocks.unshift(prep);
    }
    return prep;
  };

  const appendPreparationEvent = (tag: TaggedLog, idx: number) => {
    const p = ensurePrep();
    const entry = tag.entry;
    const name = (entry.data?.toolkit_name ?? '').trim() || 'Tool';
    const method = (entry.data?.method_name ?? '').trim();
    const rawMsg = normalizeToolkitMessage(entry.data?.message).trim();

    if (entry.step === AgentStep.ACTIVATE_TOOLKIT) {
      const hideHumanControlDetail = isHumanAskTool(name, method);
      p.items.push({
        kind: 'tool',
        id: `t-prep-${idx}`,
        rowTitle: `${tag.agentName} · ${name}`,
        toolkitName: name,
        method,
        detail: hideHumanControlDetail ? '' : rawMsg,
        input: hideHumanControlDetail ? '' : rawMsg,
        output: '',
        status: 'running',
      });
      return;
    }

    for (let j = p.items.length - 1; j >= 0; j--) {
      const it = p.items[j]!;
      if (it.kind !== 'tool') continue;
      if (it.status !== 'running') continue;
      if (it.toolkitName !== name || it.method !== method) continue;
      it.status = 'done';
      if (!isHumanAskTool(it.toolkitName, it.method)) {
        it.output = [it.output, rawMsg].filter(Boolean).join('\n\n').trim();
        it.detail = [it.detail, rawMsg].filter(Boolean).join('\n\n').trim();
      }
      break;
    }
  };

  const startNew = (tag: TaggedLog): AgentBlock => {
    const b: AgentBlock = {
      id: `b-${blocks.length}-${tag.agentId}`,
      agentId: tag.agentId,
      agentType: tag.agentType,
      agentName: tag.agentName,
      items: [],
      status: 'running',
      kind: 'action',
    };
    blocks.push(b);
    cursor.current = b;
    return b;
  };

  const ensureBlockForAgent = (tag: TaggedLog): AgentBlock => {
    const c = cursor.current;
    if (!c || c.kind === 'preparation' || c.agentId !== tag.agentId) {
      return startNew(tag);
    }
    return c;
  };

  const findLatestActionBlockForAgent = (
    agentId: string
  ): AgentBlock | null => {
    for (let i = blocks.length - 1; i >= 0; i--) {
      const block = blocks[i]!;
      if (block.kind === 'action' && block.agentId === agentId) return block;
    }
    return null;
  };

  for (let i = 0; i < tagged.length; i++) {
    const tag = tagged[i]!;
    const { entry } = tag;

    if (isPreparationEvent(entry)) {
      appendPreparationEvent(tag, i);
      continue;
    }

    if (entry.step === AgentStep.ACTIVATE_AGENT) {
      const text = normalizeToolkitMessage(entry.data?.message).trim();
      const b = startNew(tag);
      if (text) {
        b.items.push({
          kind: 'message',
          id: `m-${i}`,
          text,
          source: 'reasoning',
          running: false,
          pairKey: null,
        });
      }
      continue;
    }

    if (entry.step === AgentStep.DEACTIVATE_AGENT) {
      const latest = findLatestActionBlockForAgent(tag.agentId);
      if (latest) latest.status = 'done';
      continue;
    }

    if (entry.step === AgentStep.NOTICE) {
      const title = normalizeToolkitMessage(
        entry.data?.title ?? entry.data?.message_title
      ).trim();
      const description = normalizeToolkitMessage(
        entry.data?.notice ??
          entry.data?.message_description ??
          entry.data?.message
      ).trim();
      const text =
        title && description
          ? `${title} · ${description}`
          : title || description;
      if (!text) continue;
      ensureBlockForAgent(tag).items.push({
        kind: 'message',
        id: `m-${i}`,
        text,
        source: 'notice',
        running: false,
        pairKey: null,
      });
      continue;
    }

    if (entry.step === AgentStep.ACTIVATE_TOOLKIT) {
      const name = (entry.data?.toolkit_name ?? '').trim() || 'Tool';
      const method = (entry.data?.method_name ?? '').trim();
      const rawMsg = normalizeToolkitMessage(entry.data?.message).trim();
      const hideHumanControlDetail = isHumanAskTool(name, method);

      // Backend sometimes emits "notice" through the toolkit channel.
      if (name.toLowerCase() === 'notice') {
        if (rawMsg) {
          ensureBlockForAgent(tag).items.push({
            kind: 'message',
            id: `m-${i}`,
            text: rawMsg,
            source: 'notice',
            running: false,
            pairKey: null,
          });
        }
        continue;
      }

      if (!method && !rawMsg) continue;

      const b = ensureBlockForAgent(tag);
      const pk = pairKey(name, method);

      // Show narration above the tool row so the user always sees what the
      // agent is doing, even with the fold closed. Payload-shaped messages
      // stay inside the fold to avoid clutter.
      if (!hideHumanControlDetail && looksLikeNarration(rawMsg)) {
        b.items.push({
          kind: 'message',
          id: `m-${i}-narr`,
          text: rawMsg,
          source: 'toolkit_message',
          running: true,
          pairKey: pk,
        });
      }

      b.items.push({
        kind: 'tool',
        id: `t-${i}`,
        rowTitle: toolRowTitle(name, method),
        toolkitName: name,
        method,
        detail: hideHumanControlDetail ? '' : rawMsg,
        input: hideHumanControlDetail ? '' : rawMsg,
        output: '',
        status: 'running',
      });
      continue;
    }

    if (entry.step === AgentStep.DEACTIVATE_TOOLKIT) {
      const name = (entry.data?.toolkit_name ?? '').trim();
      const method = (entry.data?.method_name ?? '').trim();
      const msg = normalizeToolkitMessage(entry.data?.message).trim();
      const pk = pairKey(name, method);
      let matchedBlock: AgentBlock | null = null;

      // Another agent may have become current before this response arrives.
      // Search the originating agent's blocks, newest first, so the response
      // still settles the exact prior tool and its sibling narration.
      for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex--) {
        const block = blocks[blockIndex]!;
        if (block.kind !== 'action' || block.agentId !== tag.agentId) continue;
        for (
          let itemIndex = block.items.length - 1;
          itemIndex >= 0;
          itemIndex--
        ) {
          const item = block.items[itemIndex]!;
          if (item.kind !== 'tool') continue;
          if (item.status !== 'running') continue;
          if (item.toolkitName !== name || item.method !== method) continue;
          item.status = 'done';
          if (!isHumanAskTool(item.toolkitName, item.method)) {
            item.output = [item.output, msg]
              .filter(Boolean)
              .join('\n\n')
              .trim();
            item.detail = [item.detail, msg]
              .filter(Boolean)
              .join('\n\n')
              .trim();
          }
          matchedBlock = block;
          break;
        }
        if (matchedBlock) break;
      }

      // Settle the sibling narration message (if any) that paired with this
      // tool — turns off the shimmer once the tool is done.
      for (
        let j = (matchedBlock?.items.length ?? 0) - 1;
        matchedBlock && j >= 0;
        j--
      ) {
        const it = matchedBlock.items[j]!;
        if (it.kind !== 'message') continue;
        if (it.pairKey !== pk) continue;
        if (!it.running) continue;
        it.running = false;
        break;
      }
    }
  }

  // A non-last block is always done (a newer block started). The last block
  // inherits the most recent explicit transition; component-level logic may
  // still force all blocks to 'done' when the task leaves RUNNING.
  for (let i = 0; i < blocks.length - 1; i++) {
    blocks[i]!.status = 'done';
  }

  return blocks;
}

/**
 * Post-processes the flat `AgentBlock[]` from `buildAgentBlocks` into a
 * grouped list. Preparation stays pinned first. Multi-agent action blocks
 * merge only while contiguous, preserving a chronological A / B / A shape;
 * single-agent mode can still fold every action block into one group.
 *
 * Exported for unit tests.
 */
export function groupBlocksByAgent(
  blocks: AgentBlock[],
  isSingleAgent = false
): GroupedEntry[] {
  const result: GroupedEntry[] = blocks.filter(
    (block) => block.kind === 'preparation'
  );
  const groupMap = new Map<string, AgentGroup>();

  for (const block of blocks) {
    if (block.kind === 'preparation') continue;

    const last = result[result.length - 1];
    const existing = isSingleAgent
      ? groupMap.get(block.agentId)
      : last?.kind === 'agent-group' && last.agentId === block.agentId
        ? last
        : undefined;
    if (existing) {
      existing.items.push(...block.items);
      if (block.status === 'running') {
        existing.status = 'running';
      }
    } else {
      const group: AgentGroup = {
        kind: 'agent-group',
        id: isSingleAgent ? `group-${block.agentId}` : `group-${block.id}`,
        agentId: block.agentId,
        agentType: block.agentType,
        agentName: block.agentName,
        items: [...block.items],
        status: block.status,
        doneToolCount: 0,
        totalToolCount: 0,
      };
      if (isSingleAgent) groupMap.set(block.agentId, group);
      result.push(group);
    }
  }

  for (const entry of result) {
    if (entry.kind !== 'agent-group') continue;
    const group = entry;
    const tools = group.items.filter((i): i is ToolItem => i.kind === 'tool');
    group.totalToolCount = tools.length;
    group.doneToolCount = tools.filter((t) => t.status === 'done').length;
  }

  return result;
}

type HumanControlMessage = Pick<
  Message,
  | 'id'
  | 'role'
  | 'content'
  | 'step'
  | 'agent_name'
  | 'interaction'
  | 'interactionResponseTo'
>;

function normalizedAgentIdentity(value: unknown): string {
  return typeof value === 'string'
    ? value.toLowerCase().replace(/[^a-z0-9]/g, '')
    : '';
}

function isAgentMatch(entry: GroupedEntry, requestedBy: string): boolean {
  if (!requestedBy) return true;
  const type = normalizedAgentIdentity(entry.agentType);
  const name = normalizedAgentIdentity(entry.agentName);
  return (
    type === requestedBy ||
    name === requestedBy ||
    type.includes(requestedBy) ||
    requestedBy.includes(type)
  );
}

function safeHumanResponse(
  ask: HumanControlMessage,
  response: HumanControlMessage | undefined
): string | null {
  if (!response?.content?.trim()) return null;
  const interactionType = ask.interaction?.interaction_type;
  if (interactionType === 'form' || interactionType === 'credential_binding') {
    return 'Response submitted';
  }
  return response.content.trim() === 'skip'
    ? 'Skipped'
    : response.content.trim();
}

/**
 * Place each ASK receipt directly after the Human Toolkit call that caused
 * it. Explicit interaction ids are authoritative; old ASK frames without an
 * id use only the immediately-adjacent user row, never a nearby normal turn.
 *
 * Exported for focused ordering tests.
 */
export function injectHumanInputReceipts(
  entries: GroupedEntry[],
  messages: HumanControlMessage[]
): GroupedEntry[] {
  const asks = messages
    .map((message, index) => ({ message, index }))
    .filter(
      ({ message }) =>
        message.step === AgentStep.ASK &&
        message.interaction?.interaction_type !== 'approval'
    );
  if (!asks.length) return entries;

  const result = entries.map((entry) => ({
    ...entry,
    items: [...entry.items],
  })) as GroupedEntry[];
  const unusedHumanTools: Array<{
    entryIndex: number;
    itemIndex: number;
  }> = [];

  result.forEach((entry, entryIndex) => {
    entry.items.forEach((item, itemIndex) => {
      if (
        item.kind === 'tool' &&
        isHumanAskTool(item.toolkitName, item.method)
      ) {
        unusedHumanTools.push({ entryIndex, itemIndex });
      }
    });
  });

  for (const { message: ask, index: askIndex } of asks) {
    const interactionId = ask.interaction?.interaction_id;
    const explicitlyCorrelated = interactionId
      ? messages.find(
          (candidate, candidateIndex) =>
            candidateIndex > askIndex &&
            candidate.role === 'user' &&
            candidate.interactionResponseTo === interactionId
        )
      : undefined;
    const adjacent = messages[askIndex + 1];
    const adjacentReply =
      adjacent?.role === 'user' &&
      (!adjacent.interactionResponseTo ||
        adjacent.interactionResponseTo === interactionId)
        ? adjacent
        : undefined;
    const response = explicitlyCorrelated || adjacentReply;
    const requestedBy = normalizedAgentIdentity(
      ask.agent_name || ask.interaction?.agent
    );

    let toolIndex = unusedHumanTools.findIndex(({ entryIndex }) =>
      isAgentMatch(result[entryIndex]!, requestedBy)
    );
    if (toolIndex === -1) toolIndex = unusedHumanTools.length ? 0 : -1;

    const receipt: HumanInputItem = {
      kind: 'human-input',
      id: `human-input:${ask.id}`,
      question: ask.interaction?.question?.trim() || ask.content.trim(),
      response: safeHumanResponse(ask, response),
      interaction: ask.interaction,
    };

    if (toolIndex !== -1) {
      const [{ entryIndex, itemIndex }] = unusedHumanTools.splice(toolIndex, 1);
      const tool = result[entryIndex]!.items[itemIndex];
      if (tool?.kind === 'tool') {
        result[entryIndex]!.items[itemIndex] = {
          ...tool,
          humanInput: receipt,
        };
      }
      continue;
    }

    // Compatibility fallback for old histories where toolkit logs were
    // filtered out: retain the receipt in the matching agent's work log.
    let fallbackIndex = result.findIndex((entry) =>
      isAgentMatch(entry, requestedBy)
    );
    if (fallbackIndex === -1 && result.length === 0) {
      result.push({
        kind: 'agent-group',
        id: `group-human-input:${ask.id}`,
        agentId: ask.agent_name || ask.interaction?.agent || 'agent',
        agentType: ask.agent_name || ask.interaction?.agent || 'agent',
        agentName: ask.agent_name || ask.interaction?.agent || 'Agent',
        items: [],
        status: 'running',
        doneToolCount: 0,
        totalToolCount: 0,
      });
      fallbackIndex = 0;
    }
    result[
      fallbackIndex === -1 ? result.length - 1 : fallbackIndex
    ]!.items.push(receipt);
  }

  return result;
}

type BlockHeaderParts = {
  /** Static agent label, e.g. "Browser Agent" or "Preparing agents". */
  agentLabel: string;
  /**
   * The right-hand subtitle that tracks the latest tool/state for this
   * block. `null` when there's nothing to show (e.g. an empty action block
   * that already finished, or a preparation block with no register events
   * yet).
   */
  detail: string | null;
  /** Whether `detail` should render with the running shimmer. */
  detailRunning: boolean;
};

/**
 * Splits a block's collapsed-header into agent label + dynamically-tracking
 * detail. The detail is the latest tool's `Toolkit · Method` for action
 * blocks, "Thinking…" while a running block has no tool yet, or
 * "N Registered" for the preparation block.
 *
 * Exported for testing — callers should not assume the precise wording.
 */
export function getBlockHeaderParts(block: AgentBlock): BlockHeaderParts {
  if (block.kind === 'preparation') {
    const toolCount = block.items.filter((i) => i.kind === 'tool').length;
    return {
      agentLabel: block.agentName,
      detail: toolCount > 0 ? `${toolCount} Registered` : null,
      detailRunning: false,
    };
  }

  let latestTool: ToolItem | null = null;
  for (let i = block.items.length - 1; i >= 0; i--) {
    const item = block.items[i]!;
    if (item.kind === 'tool') {
      latestTool = item;
      break;
    }
  }

  if (!latestTool) {
    return {
      agentLabel: block.agentName,
      detail: block.status === 'running' ? 'Thinking…' : null,
      detailRunning: block.status === 'running',
    };
  }

  return {
    agentLabel: block.agentName,
    detail: toolRowTitle(latestTool.toolkitName, latestTool.method),
    detailRunning:
      latestTool.status === 'running' && block.status === 'running',
  };
}

/**
 * Cheap digest of the task slice that affects this accordion, so any chat store
 * mutation re-renders without relying on `updateCount` (rarely bumped).
 */
function useTaskWorkStoreSnapshot(
  chatStore: VanillaChatStore,
  taskId: string | null
) {
  return useSyncExternalStore(
    (cb) => chatStore.subscribe(cb),
    () => {
      if (!taskId) return '';
      const t = chatStore.getState().tasks[taskId];
      if (!t) return '';
      const logDigest = (t.taskAssigning ?? [])
        .map((a) => {
          const log = a.log ?? [];
          const last = log[log.length - 1];
          const msg = last?.data?.message;
          const msgLen =
            typeof msg === 'string'
              ? msg.length
              : msg != null
                ? JSON.stringify(msg).length
                : 0;
          return `${log.length}:${last?.step ?? ''}:${msgLen}:${last?.data?.toolkit_name ?? ''}:${last?.data?.method_name ?? ''}`;
        })
        .join('>');
      // Single-agent header tracks the live in-progress todo `active_form`
      // (carried on each task's `content`). Fold the running/last-completed
      // step into the digest so the header re-renders as todos advance.
      const activeFormDigest = getSingleAgentActiveForm(t);
      const humanInputDigest = (t.messages ?? [])
        .filter(
          (message) => message.step === AgentStep.ASK || message.role === 'user'
        )
        .map(
          (message) =>
            `${message.id}:${message.step ?? ''}:${message.interaction?.interaction_id ?? ''}:${message.interactionResponseTo ?? ''}:${message.content}`
        )
        .join('>');
      return `${t.status}|${t.durableRunStatus ?? ''}|${t.taskTime}|${t.elapsed}|${logDigest}|${activeFormDigest}|${humanInputDigest}`;
    },
    () => ''
  );
}

function useTaskWorkLogData(
  chatStore: VanillaChatStore,
  taskId: string | null,
  _snapshot: string
) {
  void _snapshot;
  if (!taskId) {
    return { task: undefined, groups: [] as GroupedEntry[] };
  }
  const t = chatStore.getState().tasks[taskId];
  const tagged = mergeTaggedAgentLogs(t?.taskAssigning);
  const isSingleAgent = t?.sessionMode === SessionMode.SINGLE_AGENT;
  const blocks = buildAgentBlocks(tagged, isSingleAgent);
  const groups = injectHumanInputReceipts(
    groupBlocksByAgent(blocks, isSingleAgent),
    t?.messages ?? []
  );
  return { task: t, groups };
}

function useWorkLogElapsedMs(
  chatStore: VanillaChatStore,
  taskId: string | null,
  snapshot: string
): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = taskId ? chatStore.getState().tasks[taskId] : null;
    if (t?.status !== ChatTaskStatus.RUNNING) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [chatStore, taskId, snapshot]);

  void now;
  if (!taskId) return 0;
  const t = chatStore.getState().tasks[taskId];
  if (!t) return 0;
  return getTaskElapsedMs(t);
}

const ToolDetailRow = memo(function ToolDetailRow({
  rowTitle,
  providerLabel,
  input,
  output,
  status,
  humanInputPending = false,
  humanInputReceipt,
}: {
  rowTitle: string;
  providerLabel?: string | null;
  input: string;
  output: string;
  status: 'running' | 'done';
  humanInputPending?: boolean;
  humanInputReceipt?: React.ReactNode;
}) {
  const [open, setOpen] = useState(humanInputPending);
  const wasHumanInputPending = useRef(humanInputPending);

  useEffect(() => {
    if (humanInputPending) {
      setOpen(true);
    } else if (wasHumanInputPending.current) {
      setOpen(false);
    }
    wasHumanInputPending.current = humanInputPending;
  }, [humanInputPending]);

  return (
    <div className="flex w-full min-w-0 flex-col items-start">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="group inline-flex max-w-full min-w-0 items-center gap-1 self-start px-0 py-0.5 text-left transition-opacity hover:opacity-80"
      >
        {status === 'running' ? (
          <ShinyText
            text={rowTitle}
            speed={2.5}
            className="min-w-0 shrink overflow-hidden !text-ds-text-base font-normal text-ellipsis whitespace-nowrap text-ds-ink-subtle-default"
          />
        ) : (
          <span className="min-w-0 shrink overflow-hidden !text-ds-text-base font-normal text-ellipsis whitespace-nowrap text-ds-ink-subtle-default">
            {rowTitle}
          </span>
        )}
        <ChevronRight
          size={16}
          aria-hidden
          className={cn(
            'shrink-0 text-ds-ink-subtle-default transition-[opacity,transform] duration-200',
            open
              ? 'rotate-90 opacity-100'
              : 'rotate-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'
          )}
        />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="tool-detail"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={HEIGHT_MOTION}
            className="w-full min-w-0 overflow-hidden"
          >
            {providerLabel ? (
              <Badge
                className="mt-ds-4"
                size="xs"
                variant="secondary"
                tone="neutral"
                data-search-provider={providerLabel.toLowerCase()}
              >
                {providerLabel}
              </Badge>
            ) : null}
            <ToolInputOutputDetails
              className="mt-1"
              input={input}
              output={output}
            >
              {humanInputReceipt}
            </ToolInputOutputDetails>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
});
ToolDetailRow.displayName = 'ToolDetailRow';

const RepeatedToolDetailRow = memo(function RepeatedToolDetailRow({
  item,
  active,
}: {
  item: RepeatedToolItem;
  active: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rowTitle = t('chat.repeated-tool-events', {
    tool: item.rowTitle,
    count: item.calls.length,
  });
  const running = active && item.status === 'running';

  return (
    <div
      className="flex w-full min-w-0 flex-col items-start"
      data-repeated-tool-group
      data-repeated-tool-count={item.calls.length}
      data-toolkit={item.toolkitName}
      data-method={item.method}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="group inline-flex max-w-full min-w-0 items-center gap-1 self-start px-0 py-0.5 text-left transition-opacity hover:opacity-80"
      >
        {running ? (
          <ShinyText
            text={rowTitle}
            speed={2.5}
            className="min-w-0 shrink overflow-hidden !text-ds-text-base font-normal text-ellipsis whitespace-nowrap text-ds-ink-subtle-default"
          />
        ) : (
          <span className="min-w-0 shrink overflow-hidden !text-ds-text-base font-normal text-ellipsis whitespace-nowrap text-ds-ink-subtle-default">
            {rowTitle}
          </span>
        )}
        <ChevronRight
          size={16}
          aria-hidden
          className={cn(
            'shrink-0 text-ds-ink-subtle-default transition-[opacity,transform] duration-200',
            open
              ? 'rotate-90 opacity-100'
              : 'rotate-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="repeated-tool-calls"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={HEIGHT_MOTION}
            className="w-full min-w-0 overflow-hidden"
          >
            <div className="flex w-full min-w-0 flex-col gap-1">
              {item.calls.map((call) => (
                <ToolDetailRow
                  key={call.id}
                  rowTitle={call.rowTitle}
                  providerLabel={searchProviderLabel(
                    call.toolkitName,
                    call.method
                  )}
                  input={call.input}
                  output={call.output}
                  status={
                    active && call.status === 'running' ? 'running' : 'done'
                  }
                />
              ))}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
});
RepeatedToolDetailRow.displayName = 'RepeatedToolDetailRow';

const InlineMessageRow = memo(function InlineMessageRow({
  text,
  source,
  running,
}: {
  text: string;
  source: MessageItem['source'];
  running: boolean;
}) {
  const display = capitalizeFirst(
    source === 'toolkit_message'
      ? truncateText(text, TOOL_INLINE_PREVIEW_MAX)
      : text
  );
  // Reasoning is the agent's primary narration ("open DuckDuckGo to search
  // for…"); render at default text intensity. Notices and toolkit-message
  // narration stay subtle so the eye stays on tool titles + reasoning.
  const colorClass =
    source === 'reasoning'
      ? 'text-ds-ink-default-default'
      : 'text-ds-ink-subtle-default';
  return (
    <div className="w-full min-w-0">
      {running ? (
        <ShinyText
          text={display}
          speed={2.5}
          className={cn(
            '!text-ds-text-base !font-normal break-words whitespace-pre-wrap',
            colorClass
          )}
        />
      ) : (
        <span
          className={cn(
            'm-0 !text-ds-text-base !font-normal break-words whitespace-pre-wrap',
            colorClass
          )}
        >
          {display}
        </span>
      )}
    </div>
  );
});
InlineMessageRow.displayName = 'InlineMessageRow';

const HumanInputReceiptRow = memo(function HumanInputReceiptRow({
  item,
  readOnly,
  onResolved,
}: {
  item: HumanInputItem;
  readOnly: boolean;
  onResolved: (item: HumanInputItem, response?: string) => void;
}) {
  const { t } = useTranslation();
  if (
    item.interaction &&
    item.interaction.interaction_type !== 'question' &&
    !item.response
  ) {
    return (
      <HumanInteractionCard
        interaction={item.interaction}
        readOnly={readOnly}
        timelineReceipt
        onResolved={(response) => onResolved(item, response)}
      />
    );
  }

  const labelClassName =
    'block !text-ds-text-meta font-medium uppercase tracking-wide text-ds-ink-subtle-default';
  const valueClassName =
    'block whitespace-pre-wrap break-words !text-ds-text-meta font-normal text-ds-ink-default-default';

  return (
    <div
      data-human-input-receipt
      className="w-full rounded-md bg-ds-neutral-muted-default p-2 opacity-60"
    >
      <span className={labelClassName}>
        {t('chat.input-required', { defaultValue: 'Input required' })}
      </span>
      {item.question ? (
        <div className="mt-2" data-human-input-question>
          <span className={labelClassName}>
            {t('chat.question', { defaultValue: 'Question' })}
          </span>
          <span className={cn('mt-1', valueClassName)}>{item.question}</span>
        </div>
      ) : null}
      {item.response ? (
        <div className="mt-2" data-human-input-response>
          <span className={labelClassName}>
            {t('chat.answer', { defaultValue: 'Answer' })}
          </span>
          <span className={cn('mt-1', valueClassName)}>{item.response}</span>
        </div>
      ) : null}
    </div>
  );
});
HumanInputReceiptRow.displayName = 'HumanInputReceiptRow';

const AgentBlockRow = memo(function AgentBlockRow({
  block,
  taskRunning,
  open,
  onToggle,
  humanInputReadOnly,
  onHumanInputResolved,
}: {
  block: AgentBlock;
  taskRunning: boolean;
  open: boolean;
  onToggle: () => void;
  humanInputReadOnly: boolean;
  onHumanInputResolved: (item: HumanInputItem, response?: string) => void;
}) {
  const { t } = useTranslation();
  const { agentLabel, detail } = getBlockHeaderParts(block);

  // While this block is the active, currently-running step, the whole header
  // — agent name · toolkit · action — shimmers as one ShinyText so the
  // gradient sweeps across all three as a continuous "running" indicator.
  // (ShinyText needs `color: transparent`, so no text-color class here.)
  const headerRunning = taskRunning && block.status === 'running';
  const headerText = detail ? `${agentLabel} · ${detail}` : agentLabel;

  return (
    <div className="flex w-full min-w-0 flex-col">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="my-1 flex w-fit max-w-full min-w-0 items-center gap-2 px-0 py-1 text-left transition-opacity hover:opacity-80"
      >
        <span className="inline-flex max-w-full min-w-0 items-baseline gap-1.5 truncate">
          {headerRunning ? (
            <ShinyText
              text={headerText}
              speed={2.5}
              className="truncate !text-ds-text-base font-normal"
            />
          ) : (
            <>
              <span className="text-ds-text-base font-normal text-ds-ink-muted-default">
                {agentLabel}
              </span>
              {detail ? (
                <>
                  <span className="text-ds-text-base text-ds-ink-subtle-default">
                    ·
                  </span>
                  <span className="truncate text-ds-text-base font-normal text-ds-ink-subtle-default">
                    {detail}
                  </span>
                </>
              ) : null}
            </>
          )}
        </span>
        {open ? (
          <ChevronDown
            size={16}
            aria-hidden
            className="shrink-0 text-ds-ink-subtle-default"
          />
        ) : (
          <ChevronRight
            size={16}
            aria-hidden
            className="shrink-0 text-ds-ink-subtle-default"
          />
        )}
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="block-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={HEIGHT_MOTION}
            className="min-w-0 overflow-hidden"
          >
            <div className="flex flex-col gap-2 py-1">
              {block.items.map((item) =>
                item.kind === 'message' ? (
                  <InlineMessageRow
                    key={item.id}
                    text={item.text}
                    source={item.source}
                    running={item.running && taskRunning}
                  />
                ) : item.kind === 'human-input' ? (
                  <HumanInputReceiptRow
                    key={item.id}
                    item={item}
                    readOnly={humanInputReadOnly}
                    onResolved={onHumanInputResolved}
                  />
                ) : (
                  <ToolDetailRow
                    key={item.id}
                    rowTitle={item.rowTitle}
                    providerLabel={searchProviderLabel(
                      item.toolkitName,
                      item.method
                    )}
                    input={item.input}
                    output={item.output}
                    status={
                      taskRunning &&
                      block.status === 'running' &&
                      item.status === 'running'
                        ? 'running'
                        : 'done'
                    }
                    humanInputPending={Boolean(
                      item.humanInput && !item.humanInput.response
                    )}
                    humanInputReceipt={
                      item.humanInput ? (
                        <HumanInputReceiptRow
                          item={item.humanInput}
                          readOnly={humanInputReadOnly}
                          onResolved={onHumanInputResolved}
                        />
                      ) : undefined
                    }
                  />
                )
              )}
              {block.items.length === 0 &&
                taskRunning &&
                block.status === 'running' && (
                  <span className="block !text-ds-text-base font-normal text-ds-ink-subtle-default italic">
                    {t('chat.waiting-for-tool-calls', {
                      defaultValue: 'Waiting for tool calls…',
                    })}
                  </span>
                )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
});
AgentBlockRow.displayName = 'AgentBlockRow';

type GroupHeaderParts = {
  agentLabel: string;
  progressLabel: string;
  latestToolTitle: string | null;
  latestToolRunning: boolean;
};

function getGroupHeaderParts(group: AgentGroup): GroupHeaderParts {
  const { doneToolCount, totalToolCount, items, status } = group;

  let latestTool: ToolItem | null = null;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.kind === 'tool') {
      latestTool = item as ToolItem;
      break;
    }
  }

  const progressLabel =
    totalToolCount > 0
      ? `${doneToolCount}/${totalToolCount} done`
      : status === 'running'
        ? 'Thinking…'
        : '';

  return {
    agentLabel: group.agentName,
    progressLabel,
    latestToolTitle: latestTool
      ? toolRowTitle(latestTool.toolkitName, latestTool.method)
      : status === 'running' && totalToolCount === 0
        ? null
        : null,
    latestToolRunning:
      !!latestTool && latestTool.status === 'running' && status === 'running',
  };
}

const DEFAULT_BOT_ICON = (
  <Bot size={16} className="text-ds-ink-default-default" />
);

const AgentGroupRow = memo(function AgentGroupRow({
  group,
  taskRunning,
  open,
  onToggle,
  isSingleAgent,
  singleAgentActiveForm,
  humanInputReadOnly,
  onHumanInputResolved,
}: {
  group: AgentGroup;
  taskRunning: boolean;
  open: boolean;
  onToggle: () => void;
  isSingleAgent: boolean;
  singleAgentActiveForm: string;
  humanInputReadOnly: boolean;
  onHumanInputResolved: (item: HumanInputItem, response?: string) => void;
}) {
  const { t } = useTranslation();
  const { agentLabel, progressLabel, latestToolTitle } =
    getGroupHeaderParts(group);

  const headerRunning = taskRunning && group.status === 'running';
  const agentDisplay = agentMap[group.agentType as WorkflowAgentType];
  const icon = isSingleAgent
    ? DEFAULT_BOT_ICON
    : (agentDisplay?.icon ?? DEFAULT_BOT_ICON);
  const useSingleAgentLiveHeader =
    isSingleAgent && group.agentType === 'single_agent';
  const displayItems = useMemo(
    () => groupConsecutiveToolItems(group.items),
    [group.items]
  );

  // Single agent: surface the live in-progress `active_form` in place of the
  // static "CAMEL Agent" label. Fall back to the static label only when no
  // step description is available (never expected while running).
  const singleAgentLabel =
    useSingleAgentLiveHeader && singleAgentActiveForm
      ? singleAgentActiveForm
      : agentLabel;

  const headerParts: string[] = [agentLabel];
  if (progressLabel) headerParts.push(`(${progressLabel})`);
  if (latestToolTitle) headerParts.push(`· ${latestToolTitle}`);
  const headerText = headerParts.join(' ');

  return (
    <div className="flex w-full min-w-0 flex-col">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={cn(
          'my-1 flex w-fit max-w-full min-w-0 gap-2 px-0 py-1 text-left transition-opacity hover:opacity-80',
          useSingleAgentLiveHeader ? 'items-start' : 'items-center'
        )}
      >
        {icon ? (
          // my-0.5 centers the 16px icon within the 20px label-sm line so a
          // single-line header reads as icon/text center-aligned, while a
          // wrapped header keeps the icon pinned to the first line (items-start).
          <span
            className={cn(
              'flex shrink-0 items-center',
              useSingleAgentLiveHeader ? 'my-0.5' : ''
            )}
          >
            {icon}
          </span>
        ) : null}

        {useSingleAgentLiveHeader ? (
          <span className="block max-w-full min-w-0">
            {/* Cross-fade/slide whenever the in-progress step changes so the
                header animates from one `active_form` to the next. Wraps onto
                multiple lines instead of truncating. */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={singleAgentLabel}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.24, ease: CONTENT_EASE }}
                className="block min-w-0 break-words whitespace-normal"
              >
                {headerRunning ? (
                  <ShinyText
                    text={singleAgentLabel}
                    speed={2.5}
                    className="!block !text-ds-text-base font-normal break-words whitespace-normal"
                  />
                ) : (
                  <span className="block text-ds-text-base font-normal break-words whitespace-normal text-ds-ink-muted-default">
                    {singleAgentLabel}
                  </span>
                )}
              </motion.span>
            </AnimatePresence>
          </span>
        ) : (
          <span className="inline-flex max-w-full min-w-0 items-baseline gap-1.5 truncate">
            {headerRunning ? (
              <ShinyText
                text={headerText}
                speed={2.5}
                className="truncate !text-ds-text-base font-normal"
              />
            ) : (
              <>
                <span className="text-ds-text-base font-normal text-ds-ink-muted-default">
                  {agentLabel}
                </span>
                {progressLabel ? (
                  <span className="text-ds-text-base text-ds-ink-subtle-default">
                    ({progressLabel})
                  </span>
                ) : null}
                {latestToolTitle ? (
                  <>
                    <span className="text-ds-text-base text-ds-ink-subtle-default">
                      ·
                    </span>
                    <span className="truncate text-ds-text-base font-normal text-ds-ink-subtle-default">
                      {latestToolTitle}
                    </span>
                  </>
                ) : null}
              </>
            )}
          </span>
        )}

        {open ? (
          <ChevronDown
            size={16}
            aria-hidden
            className={cn(
              'shrink-0 text-ds-ink-subtle-default',
              useSingleAgentLiveHeader ? 'my-0.5' : ''
            )}
          />
        ) : (
          <ChevronRight
            size={16}
            aria-hidden
            className={cn(
              'shrink-0 text-ds-ink-subtle-default',
              useSingleAgentLiveHeader ? 'my-0.5' : ''
            )}
          />
        )}
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="group-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={HEIGHT_MOTION}
            className="min-w-0 overflow-hidden"
          >
            <div className="flex flex-col gap-2 py-1 pl-6">
              {displayItems.map((item) =>
                item.kind === 'message' ? (
                  <InlineMessageRow
                    key={item.id}
                    text={item.text}
                    source={item.source}
                    running={item.running && taskRunning}
                  />
                ) : item.kind === 'human-input' ? (
                  <HumanInputReceiptRow
                    key={item.id}
                    item={item}
                    readOnly={humanInputReadOnly}
                    onResolved={onHumanInputResolved}
                  />
                ) : item.kind === 'repeated-tool' ? (
                  <RepeatedToolDetailRow
                    key={item.id}
                    item={item}
                    active={taskRunning && group.status === 'running'}
                  />
                ) : (
                  <ToolDetailRow
                    key={item.id}
                    rowTitle={item.rowTitle}
                    providerLabel={searchProviderLabel(
                      item.toolkitName,
                      item.method
                    )}
                    input={item.input}
                    output={item.output}
                    status={
                      taskRunning &&
                      group.status === 'running' &&
                      item.status === 'running'
                        ? 'running'
                        : 'done'
                    }
                    humanInputPending={Boolean(
                      item.humanInput && !item.humanInput.response
                    )}
                    humanInputReceipt={
                      item.humanInput ? (
                        <HumanInputReceiptRow
                          item={item.humanInput}
                          readOnly={humanInputReadOnly}
                          onResolved={onHumanInputResolved}
                        />
                      ) : undefined
                    }
                  />
                )
              )}
              {group.items.length === 0 &&
                taskRunning &&
                group.status === 'running' && (
                  <span className="block !text-ds-text-base font-normal text-ds-ink-subtle-default italic">
                    {t('chat.waiting-for-tool-calls', {
                      defaultValue: 'Waiting for tool calls…',
                    })}
                  </span>
                )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
});
AgentGroupRow.displayName = 'AgentGroupRow';

/**
 * Per-entry open state with user override.
 * - Default: running agent groups are open (so the live timeline is visible),
 *   finished groups and preparation blocks are closed.
 * - User clicks set an override for the current phase only. When an entry
 *   transitions running → done, its override is cleared so the auto-default
 *   wins again unless the user toggles after the transition.
 */
function useGroupOpenState(entries: GroupedEntry[]): {
  isOpen: (entry: GroupedEntry) => boolean;
  toggle: (id: string) => void;
} {
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const prevStatusRef = useRef<Map<string, 'running' | 'done'>>(new Map());

  useEffect(() => {
    const prev = prevStatusRef.current;
    const next = new Map<string, 'running' | 'done'>();
    for (const e of entries) next.set(e.id, e.status);
    prevStatusRef.current = next;

    setOverrides((current) => {
      if (current.size === 0) return current;
      const live = new Set(entries.map((e) => e.id));
      let changed = false;
      const updated = new Map(current);
      for (const key of current.keys()) {
        const [id, phase] = key.split(':') as [string, 'running' | 'done'];
        if (!live.has(id)) {
          updated.delete(key);
          changed = true;
          continue;
        }
        if (phase === 'running' && next.get(id) === 'done') {
          updated.delete(key);
          changed = true;
        }
      }
      void prev;
      return changed ? updated : current;
    });
  }, [entries]);

  const phaseKey = (entry: GroupedEntry) => `${entry.id}:${entry.status}`;

  const isOpen = useCallback(
    (entry: GroupedEntry) => {
      const override = overrides.get(phaseKey(entry));
      if (override !== undefined) return override;
      // Auto: open running agent groups; closed for preparation and done.
      return entry.kind === 'agent-group' && entry.status === 'running';
    },
    [overrides]
  );

  const toggle = useCallback(
    (id: string) => {
      setOverrides((prev) => {
        const entry = entries.find((e) => e.id === id);
        if (!entry) return prev;
        const key = `${entry.id}:${entry.status}`;
        const auto = entry.kind === 'agent-group' && entry.status === 'running';
        const currentlyOpen = prev.has(key) ? (prev.get(key) as boolean) : auto;
        const next = new Map(prev);
        next.set(key, !currentlyOpen);
        return next;
      });
    },
    [entries]
  );

  return { isOpen, toggle };
}

export interface TaskWorkLogAccordionProps {
  chatStore: VanillaChatStore;
  taskId: string | null;
  className?: string;
}

/** Bottom-only separator for the outer “Working on tasks for …” trigger. */
export const WORK_LOG_SUMMARY_TRIGGER_BORDER_CLASS =
  'border-x-0 border-b border-t-0 border-solid border-ds-hairline-subtle-default';

export function TaskWorkLogAccordion({
  chatStore,
  taskId,
  className,
}: TaskWorkLogAccordionProps) {
  const { t: _t } = useTranslation();
  const snapshot = useTaskWorkStoreSnapshot(chatStore, taskId);
  const { task, groups } = useTaskWorkLogData(chatStore, taskId, snapshot);
  const status = task?.status;
  const runDisplayStatus = task ? getTaskRunDisplayStatus(task) : undefined;
  const elapsedMs = useWorkLogElapsedMs(chatStore, taskId, snapshot);
  const taskRunning = status === ChatTaskStatus.RUNNING;
  const isSingleAgent = task?.sessionMode === SessionMode.SINGLE_AGENT;
  const singleAgentActiveForm = isSingleAgent
    ? getSingleAgentActiveForm(task)
    : '';
  const humanInputReadOnly =
    task?.type === 'replay' ||
    task?.type === 'share' ||
    task?.status === ChatTaskStatus.FINISHED;
  const onHumanInputResolved = useCallback(
    (item: HumanInputItem, response?: string) => {
      if (!taskId || !item.interaction) return;
      const state = chatStore.getState();
      const current = state.tasks[taskId];
      if (!current) return;
      const responseId = `interaction-response:${item.interaction.interaction_id}`;
      if (
        response &&
        !current.messages.some((candidate) => candidate.id === responseId)
      ) {
        state.addMessages(taskId, {
          id: responseId,
          role: 'user',
          content: response,
          attaches: [],
          interactionResponseTo: item.interaction.interaction_id,
        });
      }
      const [nextAsk, ...remainingAsks] = current.askList;
      state.setActiveAskList(taskId, remainingAsks);
      state.setActiveAsk(taskId, nextAsk?.agent_name || '');
      state.setIsPending(taskId, false);
      if (nextAsk) state.addMessages(taskId, nextAsk);
    },
    [chatStore, taskId]
  );

  // Normalize status with task-level context — once the task stops,
  // every entry (and any running message/tool) is done regardless of whether
  // DEACTIVATE_AGENT / DEACTIVATE_TOOLKIT actually arrived.
  const effectiveGroups = useMemo(() => {
    if (taskRunning) return groups;
    return groups.map((entry): GroupedEntry => {
      const settledItems = entry.items.map((it) => {
        if (it.kind === 'tool') return { ...it, status: 'done' as const };
        if (it.kind === 'message') return { ...it, running: false };
        return it;
      });
      if (entry.kind === 'agent-group') {
        return {
          ...entry,
          status: 'done' as const,
          items: settledItems,
          doneToolCount: entry.totalToolCount,
        };
      }
      return {
        ...entry,
        status: 'done' as const,
        items: settledItems,
      };
    });
  }, [groups, taskRunning]);

  const { isOpen, toggle } = useGroupOpenState(effectiveGroups);

  const [outerOpen, setOuterOpen] = useState(() => taskRunning);

  useEffect(() => {
    if (status === ChatTaskStatus.FINISHED) {
      setOuterOpen(false);
    } else if (status === ChatTaskStatus.RUNNING) {
      setOuterOpen(true);
    }
  }, [status]);

  if (!taskId || !task) return null;

  const allowed =
    status === ChatTaskStatus.RUNNING ||
    status === ChatTaskStatus.FINISHED ||
    status === ChatTaskStatus.PAUSE;

  if (!allowed) return null;
  if (!taskRunning && effectiveGroups.length === 0) return null;

  const timeLabel = formatSplittingElapsed(elapsedMs);

  return (
    <div className={cn('flex w-full min-w-0 flex-col', className)}>
      <button
        type="button"
        aria-expanded={outerOpen}
        onClick={() => setOuterOpen((v) => !v)}
        className={cn(
          'flex w-full min-w-0 items-center justify-start gap-1 px-0 py-2 text-left',
          WORK_LOG_SUMMARY_TRIGGER_BORDER_CLASS
        )}
      >
        <span className="text-ds-text-base font-medium text-ds-ink-muted-default">
          {status === ChatTaskStatus.RUNNING ||
          status === ChatTaskStatus.PAUSE ? (
            <Trans
              i18nKey="chat.working-on-tasks-for"
              values={{ time: timeLabel }}
              components={{
                elapsed: (
                  <span className="text-ds-ink-subtle-default tabular-nums" />
                ),
              }}
            />
          ) : (
            <Trans
              i18nKey={terminalWorkLogI18nKey(runDisplayStatus)}
              values={{ time: timeLabel }}
              components={{
                elapsed: (
                  <span className="text-ds-ink-subtle-default tabular-nums" />
                ),
              }}
            />
          )}
        </span>
        {outerOpen ? (
          <ChevronDown
            size={16}
            strokeWidth={2}
            aria-hidden
            className="shrink-0 text-ds-ink-muted-default"
          />
        ) : (
          <ChevronRight
            size={16}
            strokeWidth={2}
            aria-hidden
            className="shrink-0 text-ds-ink-muted-default"
          />
        )}
      </button>

      <AnimatePresence initial={false}>
        {outerOpen ? (
          <motion.div
            key="work-log-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={HEIGHT_MOTION}
            className="overflow-hidden"
          >
            <div className="flex min-w-0 flex-col gap-1 pb-1">
              {effectiveGroups.map((entry) =>
                entry.kind === 'agent-group' ? (
                  <AgentGroupRow
                    key={entry.id}
                    group={entry}
                    taskRunning={taskRunning}
                    open={isOpen(entry)}
                    onToggle={() => toggle(entry.id)}
                    isSingleAgent={isSingleAgent}
                    singleAgentActiveForm={singleAgentActiveForm}
                    humanInputReadOnly={humanInputReadOnly}
                    onHumanInputResolved={onHumanInputResolved}
                  />
                ) : (
                  <AgentBlockRow
                    key={entry.id}
                    block={entry}
                    taskRunning={taskRunning}
                    open={isOpen(entry)}
                    onToggle={() => toggle(entry.id)}
                    humanInputReadOnly={humanInputReadOnly}
                    onHumanInputResolved={onHumanInputResolved}
                  />
                )
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
