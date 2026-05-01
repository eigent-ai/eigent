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

import { SidePanelAccordionBox } from '@/components/Session/SidePanelAccordionBox';
import ShinyText from '@/components/ui/ShinyText/ShinyText';
import { agentMap, type WorkflowAgentType } from '@/components/WorkFlow/agents';
import { getToolkitIcon } from '@/lib/toolkitIcons';
import { cn } from '@/lib/utils';
import { AgentStatusValue } from '@/types/constants';
import { AnimatePresence, motion } from 'framer-motion';
import { Bird, Bot, CodeXml, FileText, Globe, Image } from 'lucide-react';
import {
  type ReactNode,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';

function hasWork(agent: Agent) {
  return Array.isArray(agent.tasks) && agent.tasks.length > 0;
}

function agentHasAnyToolkitsSeen(agent: Agent): boolean {
  for (const task of agent.tasks ?? []) {
    for (const tk of task.toolkits ?? []) {
      if (tk.toolkitName && tk.toolkitName !== 'notice') return true;
    }
  }
  return false;
}

/**
 * Mirrors `Workspace/index.tsx` ordering: agents with assigned tasks come
 * first, preserving their insertion order within each bucket.
 */
function sortByAssigned(agents: Agent[]): Agent[] {
  return [...agents].sort((a, b) => {
    const aHas = hasWork(a);
    const bHas = hasWork(b);
    if (aHas && !bHas) return -1;
    if (!aHas && bHas) return 1;
    return 0;
  });
}

function getAgentSubIcon(agentType: string): ReactNode {
  const key = agentType as WorkflowAgentType;
  const preset = agentMap[key];
  if (!preset) return null;
  const iconClass = cn('!h-[10px] !w-[10px] shrink-0', preset.textColor);
  switch (key) {
    case 'developer_agent':
      return <CodeXml className={iconClass} />;
    case 'browser_agent':
      return <Globe className={iconClass} />;
    case 'document_agent':
      return <FileText className={iconClass} />;
    case 'multi_modal_agent':
      return <Image className={iconClass} />;
    case 'social_media_agent':
      return <Bird className={iconClass} />;
    default:
      return null;
  }
}

function AgentLeadingIcon({ agentType }: { agentType: string }) {
  const subIcon = getAgentSubIcon(agentType);
  return (
    <div className="h-6 w-6 text-ds-text-neutral-muted-default bg-ds-bg-neutral-subtle-default rounded-md relative inline-flex shrink-0 items-center justify-center self-center">
      <Bot className="h-5 w-5" strokeWidth={2} aria-hidden />
      {subIcon != null && (
        <span className="-right-0.5 -top-0.5 absolute inline-flex items-center justify-center [&_svg]:shrink-0">
          {subIcon}
        </span>
      )}
    </div>
  );
}

/**
 * Minimum on-screen time for any toolkit that went RUNNING, so fast tools
 * (e.g. Screenshot, Search) remain observable even when they flip to
 * COMPLETED within a few milliseconds.
 */
export const TOOLKIT_MIN_DISPLAY_MS = 1500;

/** How long each toolkit stays focused before rotating to the next. */
export const TOOLKIT_ROTATION_MS = 2000;

type ToolkitEntry = {
  /** Unique per activation — from `toolkitId` in the store. */
  id: string;
  name: string;
  firstSeenAt: number;
  /** Epoch ms when the entry should be dropped; `null` while RUNNING. */
  expireAt: number | null;
};

type ToolkitState = {
  entries: Map<string, ToolkitEntry>;
  timers: Map<string, ReturnType<typeof setTimeout>>;
  /** Ids that have already been shown and evicted — never re-add. */
  retired: Set<string>;
};

function readToolkitEvents(
  agent: Pick<Agent, 'tasks'> | undefined
): Array<{ id: string; name: string; status: string | undefined }> {
  const out: Array<{ id: string; name: string; status: string | undefined }> =
    [];
  for (const task of agent?.tasks ?? []) {
    for (const tk of task.toolkits ?? []) {
      if (!tk.toolkitName || tk.toolkitName === 'notice') continue;
      const id = String(
        (tk as { toolkitId?: string }).toolkitId ??
          `${tk.toolkitName}:${tk.toolkitMethods}`
      );
      out.push({ id, name: tk.toolkitName, status: tk.toolkitStatus });
    }
  }
  return out;
}

/**
 * Exported for unit tests. Reconciles a single pass of toolkit events against
 * the component's local `ToolkitState`, arming timers via the injected
 * scheduler when a toolkit flips from RUNNING → anything else.
 *
 * Returns the ordered, deduped toolkit names currently eligible for display.
 */
export function reconcileToolkitState(
  state: ToolkitState,
  events: Array<{ id: string; name: string; status: string | undefined }>,
  opts: {
    now: number;
    minDisplayMs: number;
    schedule: (id: string, delayMs: number) => ReturnType<typeof setTimeout>;
    cancel: (handle: ReturnType<typeof setTimeout>) => void;
  }
): string[] {
  for (const event of events) {
    if (state.retired.has(event.id)) continue;
    let entry = state.entries.get(event.id);
    if (!entry) {
      entry = {
        id: event.id,
        name: event.name,
        firstSeenAt: opts.now,
        expireAt: null,
      };
      state.entries.set(event.id, entry);
    }
    if (event.status === AgentStatusValue.RUNNING) {
      if (entry.expireAt !== null) {
        entry.expireAt = null;
        const t = state.timers.get(event.id);
        if (t) {
          opts.cancel(t);
          state.timers.delete(event.id);
        }
      }
    } else if (entry.expireAt === null) {
      const expireAt = Math.max(
        opts.now,
        entry.firstSeenAt + opts.minDisplayMs
      );
      entry.expireAt = expireAt;
      const delay = Math.max(0, expireAt - opts.now);
      state.timers.set(event.id, opts.schedule(event.id, delay));
    }
  }

  // Collect names — dedupe preserving first-seen order, drop ones whose
  // timers have already fired and removed them.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of state.entries.values()) {
    if (entry.expireAt !== null && entry.expireAt <= opts.now) continue;
    if (!seen.has(entry.name)) {
      seen.add(entry.name);
      out.push(entry.name);
    }
  }
  return out;
}

/**
 * Returns the list of toolkit names to display for an agent, honoring a
 * minimum display time so short-lived toolkits (< a few hundred ms) remain
 * observable. Recomputes on every parent render (cheap) because the store
 * mutates `agent.tasks[*].toolkits` in place.
 */
export function useLiveToolkits(
  agent: Agent,
  minDisplayMs: number = TOOLKIT_MIN_DISPLAY_MS
): string[] {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const stateRef = useRef<ToolkitState>({
    entries: new Map(),
    timers: new Map(),
    retired: new Set(),
  });

  const events = readToolkitEvents(agent);
  const names = reconcileToolkitState(stateRef.current, events, {
    // Wall-clock read during render is intentional: the reconcile needs
    // `now` to filter entries whose min-display window has elapsed, and the
    // setTimeout scheduled below forces a re-render exactly when that
    // boundary passes — so the result stays consistent across renders.
    // eslint-disable-next-line react-hooks/purity
    now: Date.now(),
    minDisplayMs,
    schedule: (id, delay) =>
      setTimeout(() => {
        stateRef.current.entries.delete(id);
        stateRef.current.timers.delete(id);
        stateRef.current.retired.add(id);
        bump();
      }, delay),
    cancel: clearTimeout,
  });

  useEffect(() => {
    const state = stateRef.current;
    return () => {
      state.timers.forEach(clearTimeout);
      state.timers.clear();
    };
  }, []);

  return names;
}

/** Single-tag strip that rotates through live toolkits with a roll animation. */
function AgentToolkitTag({ names }: { names: string[] }) {
  const [focusIndex, setFocusIndex] = useState(0);

  useEffect(() => {
    if (names.length <= 1) {
      setFocusIndex(0);
      return;
    }
    const id = window.setInterval(() => {
      setFocusIndex((i) => (i + 1) % names.length);
    }, TOOLKIT_ROTATION_MS);
    return () => window.clearInterval(id);
  }, [names.length]);

  const focused =
    names.length > 0 ? names[Math.min(focusIndex, names.length - 1)] : null;

  return (
    <div className="h-6 min-w-0 inline-flex shrink-0 items-center overflow-hidden">
      <AnimatePresence initial={false} mode="popLayout">
        {focused && (
          <motion.div
            key={focused}
            initial={{ y: -18, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 18, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.2, 0, 0.2, 1] }}
            className={cn(
              'gap-1 px-1.5 py-0.5 rounded-md inline-flex max-w-full items-center opacity-80',
              'bg-ds-bg-neutral-muted-default'
            )}
            data-testid="agent-toolkit-tag"
          >
            <span className="text-ds-text-neutral-default-default [&_svg]:h-4 [&_svg]:w-4 inline-flex shrink-0 items-center">
              {getToolkitIcon(focused, 16, '')}
            </span>
            <ShinyText
              text={focused}
              speed={2.5}
              className="text-label-xs font-medium max-w-[140px] truncate"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AgentRow({ agent }: { agent: Agent }) {
  const display = agentMap[agent.type as WorkflowAgentType];
  const active = hasWork(agent);
  const name = display?.name ?? agent.name;
  const liveToolkits = useLiveToolkits(agent);

  return (
    <div
      className={cn(
        'rounded-lg bg-ds-bg-neutral-subtle-default px-1.5 py-1.5',
        'gap-2 min-w-0 flex items-center',
        !active && 'opacity-50'
      )}
    >
      <AgentLeadingIcon agentType={agent.type} />
      <span
        className={cn(
          'min-w-0 !text-body-sm font-medium text-ds-text-neutral-default-default flex-1 truncate',
          display?.textColor
        )}
      >
        {name}
      </span>
      <AgentToolkitTag names={liveToolkits} />
    </div>
  );
}

function AgentList({ agents }: { agents: Agent[] }) {
  return (
    <motion.ul layout className="gap-2 p-0 m-0 flex list-none flex-col">
      <AnimatePresence initial={false} mode="popLayout">
        {agents.map((agent) => (
          <motion.li
            key={agent.agent_id}
            layout
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <AgentRow agent={agent} />
          </motion.li>
        ))}
      </AnimatePresence>
    </motion.ul>
  );
}

interface AgentPoolSectionProps {
  title: string;
  agents: Agent[];
}

export function AgentPoolSection({ title, agents }: AgentPoolSectionProps) {
  const ordered = useMemo(() => sortByAssigned(agents), [agents]);
  const activeAgents = useMemo(() => ordered.filter(hasWork), [ordered]);
  const toolingAgents = useMemo(
    () => ordered.filter(agentHasAnyToolkitsSeen),
    [ordered]
  );

  const emptyState = (
    <div className="text-ds-text-neutral-subtle-default text-body-sm px-1 py-1">
      No agents yet
    </div>
  );

  return (
    <SidePanelAccordionBox title={title} defaultOpen={false}>
      {({ open }) => {
        if (ordered.length === 0) {
          return open ? emptyState : null;
        }
        if (!open) {
          const collapsed =
            toolingAgents.length > 0 ? toolingAgents : activeAgents;
          return collapsed.length > 0 ? <AgentList agents={collapsed} /> : null;
        }
        return <AgentList agents={ordered} />;
      }}
    </SidePanelAccordionBox>
  );
}
