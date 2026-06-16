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

import ShinyText from '@/components/ui/ShinyText/ShinyText';
import { agentMap, type WorkflowAgentType } from '@/components/WorkFlow/agents';
import { MarkDown } from '@/components/WorkFlow/MarkDown';
import { cn } from '@/lib/utils';
import type { VanillaChatStore } from '@/store/chatStore';
import {
  AgentStep,
  ChatTaskStatus,
  type ChatTaskStatusType,
  SessionMode,
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
import { formatSplittingElapsed } from './TokenUtils';

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

type TaggedLog = {
  entry: AgentMessage;
  agentId: string;
  agentType: string;
  agentName: string;
};

function mergeTaggedAgentLogs(taskAssigning: Agent[] | undefined): TaggedLog[] {
  if (!taskAssigning?.length) return [];
  return taskAssigning.flatMap((a) =>
    (a.log ?? []).map((entry) => ({
      entry,
      agentId: a.agent_id,
      agentType: a.type,
      agentName: agentMap[a.type as WorkflowAgentType]?.name ?? a.name,
    }))
  );
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
  return `${toolkitName} · ${titleCaseMethod(method)}`;
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

type ToolItem = {
  kind: 'tool';
  id: string;
  rowTitle: string;
  toolkitName: string;
  method: string;
  /** Concatenated input + output (markdown-rendered when expanded). */
  detail: string;
  status: 'running' | 'done';
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

export type TimelineItem = ToolItem | MessageItem;

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
      p.items.push({
        kind: 'tool',
        id: `t-prep-${idx}`,
        rowTitle: `${tag.agentName} · ${name}`,
        toolkitName: name,
        method,
        detail: rawMsg,
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
      it.detail = [it.detail, rawMsg].filter(Boolean).join('\n\n').trim();
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
      const cur = cursor.current;
      if (cur && cur.agentId === tag.agentId) cur.status = 'done';
      continue;
    }

    if (entry.step === AgentStep.NOTICE) {
      const text = normalizeToolkitMessage(
        entry.data?.notice ?? entry.data?.message
      ).trim();
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
      if (looksLikeNarration(rawMsg)) {
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
        detail: rawMsg,
        status: 'running',
      });
      continue;
    }

    if (entry.step === AgentStep.DEACTIVATE_TOOLKIT) {
      const cur = cursor.current;
      if (!cur) continue;
      const name = (entry.data?.toolkit_name ?? '').trim();
      const method = (entry.data?.method_name ?? '').trim();
      const msg = normalizeToolkitMessage(entry.data?.message).trim();
      const pk = pairKey(name, method);

      // Match the most recent running tool of the same toolkit/method.
      for (let j = cur.items.length - 1; j >= 0; j--) {
        const it = cur.items[j]!;
        if (it.kind !== 'tool') continue;
        if (it.status !== 'running') continue;
        if (it.toolkitName !== name || it.method !== method) continue;
        it.status = 'done';
        it.detail = [it.detail, msg].filter(Boolean).join('\n\n').trim();
        break;
      }

      // Settle the sibling narration message (if any) that paired with this
      // tool — turns off the shimmer once the tool is done.
      for (let j = cur.items.length - 1; j >= 0; j--) {
        const it = cur.items[j]!;
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
 * grouped list: preparation blocks pass through, and all action blocks
 * for the same `agentId` are merged into a single `AgentGroup`.
 *
 * Groups are ordered by first appearance (the position of the agent's
 * earliest block in the original array).
 *
 * Exported for unit tests.
 */
export function groupBlocksByAgent(blocks: AgentBlock[]): GroupedEntry[] {
  const result: GroupedEntry[] = [];
  const groupMap = new Map<string, AgentGroup>();

  for (const block of blocks) {
    if (block.kind === 'preparation') {
      result.push(block);
      continue;
    }

    const existing = groupMap.get(block.agentId);
    if (existing) {
      existing.items.push(...block.items);
      if (block.status === 'running') {
        existing.status = 'running';
      }
    } else {
      const group: AgentGroup = {
        kind: 'agent-group',
        id: `group-${block.agentId}`,
        agentId: block.agentId,
        agentType: block.agentType,
        agentName: block.agentName,
        items: [...block.items],
        status: block.status,
        doneToolCount: 0,
        totalToolCount: 0,
      };
      groupMap.set(block.agentId, group);
      result.push(group);
    }
  }

  for (const group of groupMap.values()) {
    const tools = group.items.filter((i): i is ToolItem => i.kind === 'tool');
    group.totalToolCount = tools.length;
    group.doneToolCount = tools.filter((t) => t.status === 'done').length;
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
      return `${t.status}|${t.taskTime}|${t.elapsed}|${logDigest}`;
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
  const groups = groupBlocksByAgent(blocks);
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
  detail,
  status,
}: {
  rowTitle: string;
  detail: string;
  status: 'running' | 'done';
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-w-0 flex w-full flex-col items-start">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="group min-w-0 gap-1 px-0 py-0.5 inline-flex max-w-full items-center self-start text-left transition-opacity hover:opacity-80"
      >
        {status === 'running' ? (
          <ShinyText
            text={rowTitle}
            speed={2.5}
            className="min-w-0 !text-label-sm font-normal text-ds-text-neutral-subtle-default shrink overflow-hidden text-ellipsis whitespace-nowrap"
          />
        ) : (
          <span className="min-w-0 !text-label-sm font-normal text-ds-text-neutral-subtle-default shrink overflow-hidden text-ellipsis whitespace-nowrap">
            {rowTitle}
          </span>
        )}
        <ChevronRight
          size={16}
          aria-hidden
          className={cn(
            'text-ds-icon-neutral-subtle-default shrink-0 transition-[opacity,transform] duration-200',
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
            className="min-w-0 w-full overflow-hidden"
          >
            {detail ? (
              <div className="mt-1 rounded-md bg-ds-bg-neutral-muted-default p-2 w-full opacity-60">
                <MarkDown
                  content={detail}
                  enableTypewriter={false}
                  pTextSize="text-label-xs text-ds-text-neutral-default-default"
                />
              </div>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
});
ToolDetailRow.displayName = 'ToolDetailRow';

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
      ? 'text-ds-text-neutral-subtle-default'
      : 'text-ds-text-neutral-default-default';
  return (
    <div className="min-w-0 w-full">
      {running ? (
        <ShinyText
          text={display}
          speed={2.5}
          className={cn(
            '!text-label-sm font-normal break-words whitespace-pre-wrap',
            colorClass
          )}
        />
      ) : (
        <span
          className={cn(
            'm-0 !text-label-sm font-medium break-words whitespace-pre-wrap',
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

const AgentBlockRow = memo(function AgentBlockRow({
  block,
  taskRunning,
  open,
  onToggle,
}: {
  block: AgentBlock;
  taskRunning: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const { agentLabel, detail } = getBlockHeaderParts(block);

  // While this block is the active, currently-running step, the whole header
  // — agent name · toolkit · action — shimmers as one ShinyText so the
  // gradient sweeps across all three as a continuous "running" indicator.
  // (ShinyText needs `color: transparent`, so no text-color class here.)
  const headerRunning = taskRunning && block.status === 'running';
  const headerText = detail ? `${agentLabel} · ${detail}` : agentLabel;

  return (
    <div className="min-w-0 flex w-full flex-col">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="my-1 min-w-0 gap-2 px-0 py-1 flex w-fit max-w-full items-center text-left transition-opacity hover:opacity-80"
      >
        <span className="min-w-0 gap-1.5 inline-flex max-w-full items-baseline truncate">
          {headerRunning ? (
            <ShinyText
              text={headerText}
              speed={2.5}
              className="!text-label-sm font-normal truncate"
            />
          ) : (
            <>
              <span className="text-label-sm font-normal text-ds-text-neutral-muted-default">
                {agentLabel}
              </span>
              {detail ? (
                <>
                  <span className="text-label-sm text-ds-text-neutral-subtle-default">
                    ·
                  </span>
                  <span className="text-label-sm font-normal text-ds-text-neutral-subtle-default truncate">
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
            className="text-ds-icon-neutral-subtle-default shrink-0"
          />
        ) : (
          <ChevronRight
            size={16}
            aria-hidden
            className="text-ds-icon-neutral-subtle-default shrink-0"
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
            <div className="gap-2 py-1 flex flex-col">
              {block.items.map((item) =>
                item.kind === 'message' ? (
                  <InlineMessageRow
                    key={item.id}
                    text={item.text}
                    source={item.source}
                    running={item.running && taskRunning}
                  />
                ) : (
                  <ToolDetailRow
                    key={item.id}
                    rowTitle={item.rowTitle}
                    detail={item.detail}
                    status={
                      taskRunning &&
                      block.status === 'running' &&
                      item.status === 'running'
                        ? 'running'
                        : 'done'
                    }
                  />
                )
              )}
              {block.items.length === 0 &&
                taskRunning &&
                block.status === 'running' && (
                  <p className="m-0 !text-label-sm text-ds-text-neutral-subtle-default italic">
                    Waiting for tool calls…
                  </p>
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
  <Bot size={16} className="text-ds-text-neutral-default-default" />
);

const AgentGroupRow = memo(function AgentGroupRow({
  group,
  taskRunning,
  open,
  onToggle,
  isSingleAgent,
}: {
  group: AgentGroup;
  taskRunning: boolean;
  open: boolean;
  onToggle: () => void;
  isSingleAgent: boolean;
}) {
  const { agentLabel, progressLabel, latestToolTitle, latestToolRunning } =
    getGroupHeaderParts(group);

  const headerRunning = taskRunning && group.status === 'running';
  const agentDisplay = agentMap[group.agentType as WorkflowAgentType];
  const icon = isSingleAgent
    ? DEFAULT_BOT_ICON
    : (agentDisplay?.icon ?? DEFAULT_BOT_ICON);

  const headerParts: string[] = [agentLabel];
  if (progressLabel) headerParts.push(`(${progressLabel})`);
  if (latestToolTitle) headerParts.push(`· ${latestToolTitle}`);
  const headerText = headerParts.join(' ');

  return (
    <div className="min-w-0 flex w-full flex-col">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="my-1 min-w-0 gap-2 px-0 py-1 flex w-fit max-w-full items-center text-left transition-opacity hover:opacity-80"
      >
        {icon ? (
          <span className="flex shrink-0 items-center">{icon}</span>
        ) : null}

        <span className="min-w-0 gap-1.5 inline-flex max-w-full items-baseline truncate">
          {headerRunning ? (
            <ShinyText
              text={headerText}
              speed={2.5}
              className="!text-label-sm font-normal truncate"
            />
          ) : (
            <>
              <span className="text-label-sm font-normal text-ds-text-neutral-muted-default">
                {agentLabel}
              </span>
              {progressLabel ? (
                <span className="text-label-sm text-ds-text-neutral-subtle-default">
                  ({progressLabel})
                </span>
              ) : null}
              {latestToolTitle ? (
                <>
                  <span className="text-label-sm text-ds-text-neutral-subtle-default">
                    ·
                  </span>
                  <span className="text-label-sm font-normal text-ds-text-neutral-subtle-default truncate">
                    {latestToolTitle}
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
            className="text-ds-icon-neutral-subtle-default shrink-0"
          />
        ) : (
          <ChevronRight
            size={16}
            aria-hidden
            className="text-ds-icon-neutral-subtle-default shrink-0"
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
            <div className="gap-2 py-1 pl-6 flex flex-col">
              {group.items.map((item) =>
                item.kind === 'message' ? (
                  <InlineMessageRow
                    key={item.id}
                    text={item.text}
                    source={item.source}
                    running={item.running && taskRunning}
                  />
                ) : (
                  <ToolDetailRow
                    key={item.id}
                    rowTitle={item.rowTitle}
                    detail={item.detail}
                    status={
                      taskRunning &&
                      group.status === 'running' &&
                      item.status === 'running'
                        ? 'running'
                        : 'done'
                    }
                  />
                )
              )}
              {group.items.length === 0 &&
                taskRunning &&
                group.status === 'running' && (
                  <p className="m-0 !text-label-sm text-ds-text-neutral-subtle-default italic">
                    Waiting for tool calls…
                  </p>
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

export function TaskWorkLogAccordion({
  chatStore,
  taskId,
  className,
}: TaskWorkLogAccordionProps) {
  const { t: _t } = useTranslation();
  const snapshot = useTaskWorkStoreSnapshot(chatStore, taskId);
  const { task, groups } = useTaskWorkLogData(chatStore, taskId, snapshot);
  const status = task?.status;
  const elapsedMs = useWorkLogElapsedMs(chatStore, taskId, snapshot);
  const taskRunning = status === ChatTaskStatus.RUNNING;
  const isSingleAgent = task?.sessionMode === SessionMode.SINGLE_AGENT;

  // Normalize status with task-level context — once the task stops,
  // every entry (and any running message/tool) is done regardless of whether
  // DEACTIVATE_AGENT / DEACTIVATE_TOOLKIT actually arrived.
  const effectiveGroups = useMemo(() => {
    if (taskRunning) return groups;
    return groups.map((entry): GroupedEntry => {
      const settledItems = entry.items.map((it) =>
        it.kind === 'tool'
          ? { ...it, status: 'done' as const }
          : { ...it, running: false }
      );
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
    <div className={cn('my-2 min-w-0 flex w-full flex-col', className)}>
      <button
        type="button"
        aria-expanded={outerOpen}
        onClick={() => setOuterOpen((v) => !v)}
        className="min-w-0 gap-1 px-0 py-2 flex w-full items-center justify-start text-left"
      >
        <span className="text-body-sm font-medium text-ds-text-neutral-muted-default">
          {status === ChatTaskStatus.RUNNING ||
          status === ChatTaskStatus.PAUSE ? (
            <Trans
              i18nKey="chat.working-on-tasks-for"
              values={{ time: timeLabel }}
              components={{
                elapsed: (
                  <span className="text-ds-text-neutral-subtle-default tabular-nums" />
                ),
              }}
            />
          ) : (
            <Trans
              i18nKey="chat.worked-for"
              values={{ time: timeLabel }}
              components={{
                elapsed: (
                  <span className="text-ds-text-neutral-subtle-default tabular-nums" />
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
            className="text-ds-icon-neutral-muted-default shrink-0"
          />
        ) : (
          <ChevronRight
            size={16}
            strokeWidth={2}
            aria-hidden
            className="text-ds-icon-neutral-muted-default shrink-0"
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
            <div className="min-w-0 gap-1 pb-1 flex flex-col">
              {effectiveGroups.map((entry) =>
                entry.kind === 'agent-group' ? (
                  <AgentGroupRow
                    key={entry.id}
                    group={entry}
                    taskRunning={taskRunning}
                    open={isOpen(entry)}
                    onToggle={() => toggle(entry.id)}
                    isSingleAgent={isSingleAgent}
                  />
                ) : (
                  <AgentBlockRow
                    key={entry.id}
                    block={entry}
                    taskRunning={taskRunning}
                    open={isOpen(entry)}
                    onToggle={() => toggle(entry.id)}
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
