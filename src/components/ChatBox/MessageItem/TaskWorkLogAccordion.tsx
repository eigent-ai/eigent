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
import { AgentStep, ChatTaskStatus } from '@/types/constants';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronRight } from 'lucide-react';
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
const MARKDOWN_DEFER_THRESHOLD = 1200;
const MARKDOWN_DEFER_MS = 180;

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
function getTaskElapsedMs(task: { taskTime: number; elapsed: number }): number {
  if (task.taskTime !== 0) {
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

function truncateText(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function formatToolSummary(
  toolkitName: string,
  method: string,
  preview: string
): string {
  const p = preview.trim();
  const head = `${toolkitName} · ${titleCaseMethod(method)}`;
  return p ? `${head} — ${truncateText(p, 100)}` : head;
}

function toolRowTitle(toolkitName: string, method: string): string {
  return `${toolkitName} · ${titleCaseMethod(method)}`;
}

type ToolSegment = {
  id: string;
  rowTitle: string;
  toolkitName: string;
  method: string;
  summary: string;
  detail: string;
  status: 'running' | 'done';
};

/**
 * One "action" — a bounded unit of agent work delimited by either an
 * `ACTIVATE_AGENT` message (reasoning for the next tool burst) or an
 * agent-id change in the chronological log.
 */
export type ActionGroup = {
  id: string;
  agentId: string;
  agentType: string;
  agentName: string;
  /** The reasoning text from ACTIVATE_AGENT, if one bounded this group. */
  reasoning: string | null;
  /** `NOTICE` messages collected while this group was active. */
  notices: string[];
  /** Tool invocations that fired while this group was active. */
  tools: ToolSegment[];
  /**
   * `running` until either a newer group starts, the agent emits
   * `DEACTIVATE_AGENT`, or the overall task leaves RUNNING. The component
   * re-derives final status with the task-level context.
   */
  status: 'running' | 'done';
  /**
   * `preparation` is the synthetic group that collapses the workforce's
   * leading `register agent` toolkit calls into one "Preparing agents" row.
   * Everything else is `action`.
   */
  kind: 'preparation' | 'action';
};

const PREPARATION_GROUP_ID = 'g-prep';
const PREPARATION_GROUP_LABEL = 'Preparing agents';

function isRegisterAgentEvent(entry: AgentMessage): boolean {
  if (
    entry.step !== AgentStep.ACTIVATE_TOOLKIT &&
    entry.step !== AgentStep.DEACTIVATE_TOOLKIT
  ) {
    return false;
  }
  return (
    (entry.data?.method_name ?? '').trim().toLowerCase() === 'register agent'
  );
}

/**
 * Exported for unit tests. Folds a tagged, chronological log into
 * `ActionGroup[]`, pairing DEACTIVATE_TOOLKIT with the most recent matching
 * running tool inside the active group.
 */
export function buildActionGroups(tagged: TaggedLog[]): ActionGroup[] {
  const groups: ActionGroup[] = [];
  const cursor: { current: ActionGroup | null } = { current: null };
  let prep: ActionGroup | null = null;

  // The workforce factory wires up agents via `register agent` toolkit calls.
  // Those calls can appear as a leading burst *and* sprinkled in mid-run
  // whenever a new specialist (e.g. a multi-modal agent) is lazily registered
  // after another agent has already started acting. We always route them to
  // a single synthetic "Preparing agents" group pinned at the top so the
  // currently-active agent's action group is not interrupted by registration
  // noise.
  const ensurePrep = (): ActionGroup => {
    if (!prep) {
      prep = {
        id: PREPARATION_GROUP_ID,
        agentId: '__prep__',
        agentType: '__prep__',
        agentName: PREPARATION_GROUP_LABEL,
        reasoning: null,
        notices: [],
        tools: [],
        status: 'running',
        kind: 'preparation',
      };
      groups.unshift(prep);
    }
    return prep;
  };

  const appendRegisterEvent = (tag: TaggedLog, idx: number) => {
    const p = ensurePrep();
    const entry = tag.entry;
    const name = (entry.data?.toolkit_name ?? '').trim() || 'Tool';
    const method = (entry.data?.method_name ?? '').trim();
    const rawMsg = normalizeToolkitMessage(entry.data?.message).trim();

    if (entry.step === AgentStep.ACTIVATE_TOOLKIT) {
      p.tools.push({
        id: `t-prep-${idx}`,
        rowTitle: `${tag.agentName} · ${name}`,
        toolkitName: name,
        method,
        summary: formatToolSummary(name, method, rawMsg),
        detail: rawMsg,
        status: 'running',
      });
      return;
    }

    for (let j = p.tools.length - 1; j >= 0; j--) {
      const s = p.tools[j]!;
      if (s.status !== 'running') continue;
      if (s.toolkitName !== name || s.method !== method) continue;
      s.status = 'done';
      s.detail = [s.detail, rawMsg].filter(Boolean).join('\n\n').trim();
      s.summary = formatToolSummary(name, method, s.detail);
      break;
    }
  };

  const startNew = (tag: TaggedLog, reasoning: string | null): ActionGroup => {
    const g: ActionGroup = {
      id: `g-${groups.length}-${tag.agentId}`,
      agentId: tag.agentId,
      agentType: tag.agentType,
      agentName: tag.agentName,
      reasoning,
      notices: [],
      tools: [],
      status: 'running',
      kind: 'action',
    };
    groups.push(g);
    cursor.current = g;
    return g;
  };

  const ensureGroupForAgent = (tag: TaggedLog): ActionGroup => {
    const c = cursor.current;
    if (!c || c.kind === 'preparation' || c.agentId !== tag.agentId) {
      return startNew(tag, null);
    }
    return c;
  };

  for (let i = 0; i < tagged.length; i++) {
    const tag = tagged[i]!;
    const { entry } = tag;

    if (isRegisterAgentEvent(entry)) {
      appendRegisterEvent(tag, i);
      continue;
    }

    if (entry.step === AgentStep.ACTIVATE_AGENT) {
      const text = normalizeToolkitMessage(entry.data?.message).trim();
      startNew(tag, text || null);
      continue;
    }

    if (entry.step === AgentStep.DEACTIVATE_AGENT) {
      const cur = cursor.current;
      if (cur && cur.agentId === tag.agentId) cur.status = 'done';
      continue;
    }

    if (entry.step === AgentStep.ACTIVATE_TOOLKIT) {
      const name = (entry.data?.toolkit_name ?? '').trim() || 'Tool';
      const method = (entry.data?.method_name ?? '').trim();
      const rawMsg = normalizeToolkitMessage(entry.data?.message).trim();

      if (name.toLowerCase() === 'notice') {
        if (rawMsg) ensureGroupForAgent(tag).notices.push(rawMsg);
        continue;
      }

      if (!method && !rawMsg) continue;

      const g = ensureGroupForAgent(tag);
      g.tools.push({
        id: `t-${i}`,
        rowTitle: toolRowTitle(name, method),
        toolkitName: name,
        method,
        summary: formatToolSummary(name, method, rawMsg),
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

      for (let j = cur.tools.length - 1; j >= 0; j--) {
        const s = cur.tools[j]!;
        if (s.status !== 'running') continue;
        if (s.toolkitName !== name || s.method !== method) continue;
        s.status = 'done';
        s.detail = [s.detail, msg].filter(Boolean).join('\n\n').trim();
        s.summary = formatToolSummary(name, method, s.detail);
        break;
      }
    }
  }

  // A non-last group is always done (a newer group started). The last group
  // inherits the most recent explicit transition; component-level logic may
  // still force all groups to 'done' when the task leaves RUNNING.
  for (let i = 0; i < groups.length - 1; i++) {
    groups[i]!.status = 'done';
  }

  return groups;
}

/** Title shown on a group header. Prefers reasoning; falls back to the latest tool. */
export function getGroupTitle(group: ActionGroup): string {
  if (group.reasoning) return group.reasoning;
  const last = group.tools[group.tools.length - 1];
  if (last) return last.rowTitle;
  return 'Thinking…';
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
    return { task: undefined, groups: [] as ActionGroup[] };
  }
  const t = chatStore.getState().tasks[taskId];
  const tagged = mergeTaggedAgentLogs(t?.taskAssigning);
  const groups = buildActionGroups(tagged);
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
  const [renderMarkdown, setRenderMarkdown] = useState(false);

  useEffect(() => {
    if (!open) {
      setRenderMarkdown(false);
      return;
    }

    if (detail.length <= MARKDOWN_DEFER_THRESHOLD) {
      setRenderMarkdown(true);
      return;
    }

    const timer = window.setTimeout(
      () => setRenderMarkdown(true),
      MARKDOWN_DEFER_MS
    );
    return () => window.clearTimeout(timer);
  }, [open, detail]);

  return (
    <div className="min-w-0 flex w-full flex-col items-start">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="group min-w-0 gap-1 py-0.5 inline-flex max-w-full items-center self-start text-left transition-opacity hover:opacity-80"
      >
        {status === 'running' ? (
          <ShinyText
            text={rowTitle}
            speed={2.5}
            className="!text-label-xs font-medium min-w-0 text-ds-text-neutral-subtle-default shrink overflow-hidden text-ellipsis whitespace-nowrap"
          />
        ) : (
          <span className="!text-label-xs font-medium min-w-0 text-ds-text-neutral-subtle-default shrink overflow-hidden text-ellipsis whitespace-nowrap">
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
            className="min-w-0 mt-1 w-full overflow-hidden"
          >
            {detail ? (
              <div className="p-2 bg-ds-bg-neutral-muted-default rounded-md w-full opacity-60">
                {renderMarkdown ? (
                  <MarkDown
                    content={detail}
                    enableTypewriter={false}
                    pTextSize="text-label-xs text-ds-text-neutral-default-default"
                  />
                ) : (
                  <p className="text-label-xs text-ds-text-neutral-default-default m-0">
                    Rendering details...
                  </p>
                )}
              </div>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
});
ToolDetailRow.displayName = 'ToolDetailRow';

const ActionGroupRow = memo(function ActionGroupRow({
  group,
  isLastRunning,
  taskRunning,
  open,
  onToggle,
}: {
  group: ActionGroup;
  isLastRunning: boolean;
  taskRunning: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const running = group.status === 'running' || isLastRunning;
  const lastTool = group.tools[group.tools.length - 1];
  const isPrep = group.kind === 'preparation';

  return (
    <div className="min-w-0 flex w-full flex-col">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="min-w-0 gap-2 py-1 my-1 flex w-fit max-w-full items-center text-left transition-opacity hover:opacity-80"
      >
        <span className="text-label-sm font-normal min-w-0 max-w-full truncate">
          {running ? (
            <ShinyText
              text={group.agentName}
              speed={2.5}
              className="text-label-sm font-normal text-ds-text-neutral-muted-default"
            />
          ) : (
            <span className="text-ds-text-neutral-muted-default">
              {group.agentName}
            </span>
          )}
          {isPrep ? (
            group.tools.length > 0 ? (
              <span className="text-ds-text-neutral-subtle-default">
                {' · '}
                {group.tools.length}
                {' Registered'}
              </span>
            ) : null
          ) : lastTool ? (
            <>
              <span className="text-ds-text-neutral-subtle-default">
                {' · '}
                {lastTool.toolkitName}
              </span>
              {lastTool.method ? (
                <span className="text-ds-text-neutral-subtle-default">
                  {' · '}
                  {titleCaseMethod(lastTool.method)}
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-ds-text-neutral-subtle-default">
              {' · Thinking…'}
            </span>
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
            <div className="py-1 gap-2 flex flex-col">
              {group.reasoning ? (
                <p className="text-label-sm text-ds-text-neutral-subtle-default break-words whitespace-pre-wrap">
                  {group.reasoning}
                </p>
              ) : null}
              {group.notices.map((notice, i) => (
                <p
                  key={`n-${i}`}
                  className="text-label-sm text-ds-text-neutral-subtle-default break-words whitespace-pre-wrap"
                >
                  {notice}
                </p>
              ))}
              {group.tools.map((tool) => (
                <ToolDetailRow
                  key={tool.id}
                  rowTitle={tool.rowTitle}
                  detail={tool.detail}
                  status={
                    taskRunning &&
                    group.status === 'running' &&
                    tool.status === 'running'
                      ? 'running'
                      : 'done'
                  }
                />
              ))}
              {group.tools.length === 0 && running && !group.reasoning && (
                <p className="text-label-sm text-ds-text-neutral-subtle-default italic">
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
ActionGroupRow.displayName = 'ActionGroupRow';

/**
 * Per-group open state with user override.
 * - Default: a running group is open; a done group is closed.
 * - User clicks set an override for the current phase only. When a group
 *   transitions running → done, its override is cleared so auto-fold wins
 *   unless the user toggles again after the transition.
 */
function useGroupOpenState(
  groups: ActionGroup[],
  taskRunning: boolean
): { isOpen: (group: ActionGroup) => boolean; toggle: (id: string) => void } {
  // key → open flag. Key is `${id}:${phase}` so each phase owns its override.
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const prevStatusRef = useRef<Map<string, 'running' | 'done'>>(new Map());

  useEffect(() => {
    const prev = prevStatusRef.current;
    const next = new Map<string, 'running' | 'done'>();
    for (const g of groups) next.set(g.id, g.status);
    prevStatusRef.current = next;

    // Drop overrides whose group disappeared, plus running-phase overrides
    // for any group that just flipped to done.
    setOverrides((current) => {
      if (current.size === 0) return current;
      const live = new Set(groups.map((g) => g.id));
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
      // No-op branch: also track that prev tracked running transitioning away.
      void prev;
      return changed ? updated : current;
    });
  }, [groups]);

  const phaseKey = (group: ActionGroup) => `${group.id}:${group.status}`;

  const isOpen = useCallback(
    (group: ActionGroup) => {
      const override = overrides.get(phaseKey(group));
      if (override !== undefined) return override;
      return group.status === 'running' && taskRunning;
    },
    [overrides, taskRunning]
  );

  const toggle = useCallback(
    (id: string) => {
      setOverrides((prev) => {
        const group = groups.find((g) => g.id === id);
        if (!group) return prev;
        const key = `${group.id}:${group.status}`;
        const currentlyOpen = prev.has(key)
          ? (prev.get(key) as boolean)
          : group.status === 'running' && taskRunning;
        const next = new Map(prev);
        next.set(key, !currentlyOpen);
        return next;
      });
    },
    [groups, taskRunning]
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

  // Normalize group status with task-level context — once the task stops,
  // every group is done regardless of whether DEACTIVATE_AGENT arrived.
  const effectiveGroups = useMemo(() => {
    if (taskRunning) return groups;
    return groups.map((g) =>
      g.status === 'done' ? g : { ...g, status: 'done' as const }
    );
  }, [groups, taskRunning]);

  const { isOpen, toggle } = useGroupOpenState(effectiveGroups, taskRunning);

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
    <div className={cn('min-w-0 my-2 flex w-full flex-col', className)}>
      <button
        type="button"
        aria-expanded={outerOpen}
        onClick={() => setOuterOpen((v) => !v)}
        className="gap-1 py-2 min-w-0 flex w-full items-center justify-start text-left"
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
            <div className="gap-1 pb-1 min-w-0 flex flex-col">
              {effectiveGroups.map((group, i) => {
                const isLastRunning =
                  taskRunning &&
                  i === effectiveGroups.length - 1 &&
                  group.status === 'running';
                return (
                  <ActionGroupRow
                    key={group.id}
                    group={group}
                    isLastRunning={isLastRunning}
                    taskRunning={taskRunning}
                    open={isOpen(group)}
                    onToggle={() => toggle(group.id)}
                  />
                );
              })}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
