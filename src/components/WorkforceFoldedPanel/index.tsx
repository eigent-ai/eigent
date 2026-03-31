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

import { AddWorker } from '@/components/AddWorker';
import { Button } from '@/components/ui/button';
import { HoverScrollText } from '@/components/ui/HoverScrollText';
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { TooltipSimple } from '@/components/ui/tooltip';
import { agentMap, type WorkflowAgentType } from '@/components/WorkFlow/agents';
import { getAgentToolkitLabels } from '@/components/WorkFlow/agentToolkitLabels';
import { BASE_WORKFLOW_AGENTS } from '@/components/WorkFlow/baseWorkers';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { cn } from '@/lib/utils';
import { useAuthStore, useWorkerList } from '@/store/authStore';
import { TaskStatus } from '@/types/constants';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bird,
  Bot,
  CodeXml,
  Ellipsis,
  FileText,
  Globe,
  Image,
  Trash2,
} from 'lucide-react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { WorkforceFoldedAgentDetailPane } from './AgentDetailPane';

const FOLDED_LAYOUT_TRANSITION = {
  duration: 0.28,
  ease: [0.4, 0, 0.2, 1] as const,
};

const EMPTY_TASK_ASSIGNING: Agent[] = [];

/** After this long without pointer/scroll activity on the folded panel, resume auto-following the working agent. */
const FOLDED_MANUAL_IDLE_RESUME_MS = 5 * 60 * 1000;

/** True once any assigned sub-task has left waiting/empty (execution has begun or finished a unit of work). */
function hasAgentTaskExecutionStarted(agents: Agent[]): boolean {
  return agents.some((agent) =>
    (agent.tasks ?? []).some((t) => {
      const s = t.status;
      if (!s || s === TaskStatus.WAITING) return false;
      return true;
    })
  );
}

/**
 * Prefer the last agent in list order that has an actively running (or blocked) sub-task — "latest" in rail order.
 * Falls back to any agent with in-flight work (same sense as TaskState "ongoing"), then null.
 */
function pickLatestWorkingAgentId(agents: Agent[]): string | null {
  const isRunningOrBlocked = (s: TaskInfo['status']) =>
    s === TaskStatus.RUNNING || s === TaskStatus.BLOCKED;

  for (let i = agents.length - 1; i >= 0; i--) {
    const a = agents[i];
    if ((a.tasks ?? []).some((t) => isRunningOrBlocked(t.status))) {
      return a.agent_id;
    }
  }
  for (let i = agents.length - 1; i >= 0; i--) {
    const a = agents[i];
    const hasOngoing = (a.tasks ?? []).some((t) => {
      if (t.reAssignTo) return false;
      const s = t.status;
      return (
        !!s &&
        s !== TaskStatus.FAILED &&
        s !== TaskStatus.COMPLETED &&
        s !== TaskStatus.SKIPPED &&
        s !== TaskStatus.WAITING
      );
    });
    if (hasOngoing) return a.agent_id;
  }
  return null;
}

/** Sub icons aligned with `WorkspaceMenu` → `MenuToggleItem` (top-right badge, 10px). */
function getWorkspaceMenuStyleSubIcon(agentType: string): ReactNode {
  const key = agentType as WorkflowAgentType;
  if (!agentMap[key]) return null;
  const textColor = agentMap[key].textColor;
  const iconClass = cn('!h-[10px] !w-[10px] shrink-0', textColor);
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

function FoldedAgentLeadingIcon({ agentType }: { agentType: string }) {
  const subIcon = getWorkspaceMenuStyleSubIcon(agentType);
  return (
    <div className="h-6 w-6 text-text-secondary relative inline-flex shrink-0 items-center justify-center self-center">
      <Bot className="h-6 w-6" strokeWidth={2} aria-hidden />
      {subIcon != null && (
        <span className="-right-1 -top-1 absolute inline-flex items-center justify-center [&_svg]:shrink-0">
          {subIcon}
        </span>
      )}
    </div>
  );
}

function isBaseWorkflowAgent(agent: Agent): boolean {
  return BASE_WORKFLOW_AGENTS.some((b) => b.agent_id === agent.agent_id);
}

function FoldedAgentCard({
  agent,
  isActive,
  dimmed,
  compactMode,
  onSelect,
  showUserAgentOverflow,
  onDeleteUserAgent,
}: {
  agent: Agent;
  isActive: boolean;
  dimmed: boolean;
  compactMode: boolean;
  onSelect: () => void;
  showUserAgentOverflow?: boolean;
  onDeleteUserAgent?: (agentId: string) => void;
}) {
  const [toolkitHovered, setToolkitHovered] = useState(false);
  const toolkitLabels = getAgentToolkitLabels(agent);
  const toolkitLine = toolkitLabels.join('  ');
  const wfType = agent.type as WorkflowAgentType;
  const preset = agentMap[wfType];

  const iconOnly = compactMode;

  const agentLabel = preset?.name ?? agent.name;

  const shellClass = cn(
    'rounded-xl bg-worker-surface-primary focus-within:ring-ring ease-in-out overflow-hidden border border-solid transition-all duration-200 focus-within:ring-2',
    compactMode
      ? cn(
          'border-border-secondary hover:border-worker-border-default',
          isActive && (preset?.borderColor ?? 'border-worker-border-default'),
          !isActive && 'opacity-80'
        )
      : cn(
          'border-transparent hover:border-transparent',
          !isActive && 'opacity-80'
        ),
    iconOnly ? 'inline-flex' : 'group relative w-full min-w-0 max-w-full',
    dimmed && 'border-transparent opacity-30'
  );

  const expandedRow = (
    <div className="gap-md px-3 pb-2 pt-2 min-w-0 flex w-full max-w-full items-center">
      <FoldedAgentLeadingIcon agentType={agent.type} />
      <div className="min-w-0 min-h-0 flex flex-1 flex-col overflow-hidden">
        <div
          className={cn(
            'text-base font-bold leading-relaxed',
            preset?.textColor ?? 'text-text-primary'
          )}
        >
          {preset?.name ?? agent.name}
        </div>
        <div className="mt-0.5 min-h-4 min-w-0 w-full">
          <HoverScrollText
            text={toolkitLine}
            active={toolkitHovered}
            className="text-xs font-normal leading-tight text-text-label"
            innerClassName="text-xs font-normal leading-tight text-text-label"
          />
        </div>
      </div>
    </div>
  );

  const button = iconOnly ? (
    <button
      type="button"
      onClick={onSelect}
      aria-label={agentLabel}
      className={cn(
        shellClass,
        'focus-visible:ring-ring p-2 inline-flex items-center justify-center text-left focus-visible:ring-2 focus-visible:outline-none'
      )}
    >
      <FoldedAgentLeadingIcon agentType={agent.type} />
    </button>
  ) : showUserAgentOverflow ? (
    <div
      className={shellClass}
      onMouseEnter={() => setToolkitHovered(true)}
      onMouseLeave={() => setToolkitHovered(false)}
    >
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'focus-visible:ring-ring min-w-0 flex w-full max-w-full flex-col bg-transparent text-left hover:bg-transparent focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:outline-none',
          'pr-9'
        )}
      >
        {expandedRow}
      </button>
      <div className="right-1 pointer-events-none absolute top-1/2 z-10 -translate-y-1/2 opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              onClick={(e) => e.stopPropagation()}
              variant="ghost"
              size="sm"
              buttonContent="icon-only"
              className="text-text-secondary shrink-0"
              aria-label={`More actions for ${agentLabel}`}
            >
              <Ellipsis className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="border-dropdown-border bg-dropdown-bg p-sm w-[98px] rounded-[12px] border border-solid"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-1">
              <PopoverClose asChild>
                <AddWorker edit workerInfo={agent} />
              </PopoverClose>
              <PopoverClose asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-2 w-full justify-start"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteUserAgent?.(agent.agent_id);
                  }}
                >
                  <Trash2
                    size={16}
                    className="text-icon-primary group-hover:text-icon-cuation"
                  />
                  Delete
                </Button>
              </PopoverClose>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  ) : (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={() => setToolkitHovered(true)}
      onMouseLeave={() => setToolkitHovered(false)}
      className={cn(
        shellClass,
        'focus-visible:ring-ring min-w-0 flex w-full max-w-full flex-col text-left focus-visible:ring-2 focus-visible:outline-none'
      )}
    >
      {expandedRow}
    </button>
  );

  if (iconOnly) {
    return (
      <TooltipSimple
        content={agentLabel}
        side="right"
        sideOffset={8}
        delayDuration={300}
      >
        {button}
      </TooltipSimple>
    );
  }

  return button;
}

/**
 * Narrow-column workforce layout when the workspace chat panel is visible.
 * - `initial`: workforce list before any sub-task has started executing (agents may already exist on the task).
 * - `task-live`: icon rail + detail pane once at least one assigned sub-task is past waiting.
 */
export default function WorkforceFoldedPanel() {
  const { chatStore } = useChatStoreAdapter();
  const workerList = useWorkerList();
  const { setWorkerList } = useAuthStore();
  const [detailAgentId, setDetailAgentId] = useState<string | null>(null);
  /** User chose an agent in the rail; pause auto-follow until idle timeout. */
  const [manualFollowPaused, setManualFollowPaused] = useState(false);
  const idleResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearIdleResumeTimer = useCallback(() => {
    if (idleResumeTimerRef.current) {
      clearTimeout(idleResumeTimerRef.current);
      idleResumeTimerRef.current = null;
    }
  }, []);

  const resetManualIdleResumeTimer = useCallback(() => {
    if (idleResumeTimerRef.current) {
      clearTimeout(idleResumeTimerRef.current);
      idleResumeTimerRef.current = null;
    }
    idleResumeTimerRef.current = setTimeout(() => {
      idleResumeTimerRef.current = null;
      setManualFollowPaused(false);
    }, FOLDED_MANUAL_IDLE_RESUME_MS);
  }, []);

  const onDeleteUserAgent = useCallback(
    (agentId: string) => {
      setWorkerList(workerList.filter((w) => w.agent_id !== agentId));
    },
    [workerList, setWorkerList]
  );

  const activeTaskId = chatStore?.activeTaskId as string | undefined;
  const activeTask = activeTaskId ? chatStore?.tasks[activeTaskId] : undefined;
  const taskAssigning = activeTask?.taskAssigning ?? EMPTY_TASK_ASSIGNING;

  const sortedAgents = useMemo(() => {
    const base = [...BASE_WORKFLOW_AGENTS, ...workerList].filter(
      (worker) => !taskAssigning.find((a) => a.type === worker.type)
    );
    const allAgents = [...taskAssigning, ...base];
    return [...allAgents].sort((a, b) => {
      const aHas = a.tasks && a.tasks.length > 0;
      const bHas = b.tasks && b.tasks.length > 0;
      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;
      return 0;
    });
  }, [taskAssigning, workerList]);

  const isTaskLiveLayout = hasAgentTaskExecutionStarted(taskAssigning);

  useEffect(() => {
    if (!manualFollowPaused || !isTaskLiveLayout) {
      clearIdleResumeTimer();
      return;
    }
    resetManualIdleResumeTimer();
    return clearIdleResumeTimer;
  }, [
    manualFollowPaused,
    isTaskLiveLayout,
    resetManualIdleResumeTimer,
    clearIdleResumeTimer,
  ]);

  const onFoldedPanelEngagement = useCallback(() => {
    if (!manualFollowPaused || !isTaskLiveLayout) return;
    resetManualIdleResumeTimer();
  }, [manualFollowPaused, isTaskLiveLayout, resetManualIdleResumeTimer]);

  const detailAgent = useMemo(
    () =>
      detailAgentId
        ? (sortedAgents.find((a) => a.agent_id === detailAgentId) ?? null)
        : null,
    [detailAgentId, sortedAgents]
  );

  useEffect(() => {
    if (!isTaskLiveLayout) {
      setDetailAgentId(null);
      setManualFollowPaused(false);
      return;
    }
    if (manualFollowPaused) {
      setDetailAgentId((prev) => {
        if (prev && sortedAgents.some((a) => a.agent_id === prev)) return prev;
        return (
          sortedAgents.find((a) => (a.tasks?.length ?? 0) > 0)?.agent_id ??
          sortedAgents[0]?.agent_id ??
          null
        );
      });
      return;
    }

    const workingId = pickLatestWorkingAgentId(sortedAgents);
    const agentFromWorkspace =
      activeTask?.activeWorkspace &&
      sortedAgents.some((a) => a.agent_id === activeTask.activeWorkspace)
        ? activeTask.activeWorkspace
        : null;
    const agentFromActiveAgent =
      activeTask?.activeAgent &&
      sortedAgents.some((a) => a.agent_id === activeTask.activeAgent)
        ? activeTask.activeAgent
        : null;
    const fallback =
      agentFromWorkspace ??
      agentFromActiveAgent ??
      sortedAgents.find((a) => (a.tasks?.length ?? 0) > 0)?.agent_id ??
      sortedAgents[0]?.agent_id ??
      null;
    const resolved = workingId ?? fallback;

    if (!resolved) return;

    setDetailAgentId((prev) => (prev === resolved ? prev : resolved));

    const taskId = chatStore?.activeTaskId;
    if (!taskId || !chatStore) return;
    if (
      activeTask?.activeWorkspace === resolved &&
      activeTask?.activeAgent === resolved
    ) {
      return;
    }
    chatStore.setActiveWorkspace(taskId, resolved);
    chatStore.setActiveAgent(taskId, resolved);
    window.electronAPI?.hideAllWebview?.();
  }, [
    isTaskLiveLayout,
    manualFollowPaused,
    sortedAgents,
    activeTask?.activeAgent,
    activeTask?.activeWorkspace,
    chatStore,
    activeTaskId,
  ]);

  const onSelectAgent = useCallback(
    (agentId: string) => {
      if (!chatStore?.activeTaskId) return;
      chatStore.setActiveWorkspace(chatStore.activeTaskId, agentId);
      chatStore.setActiveAgent(chatStore.activeTaskId, agentId);
      window.electronAPI?.hideAllWebview?.();
    },
    [chatStore]
  );

  if (!chatStore) {
    return null;
  }

  const activeAgentId = activeTask?.activeAgent;

  return (
    <div
      className="bg-surface-secondary min-h-0 min-w-0 flex h-full w-full flex-col"
      data-workforce-folded={isTaskLiveLayout ? 'task-live' : 'initial'}
    >
      <div className="min-h-0 min-w-0 flex flex-1 flex-col overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          {isTaskLiveLayout ? (
            <motion.div
              key="task-live"
              className="min-h-0 min-w-0 flex flex-1 flex-row overflow-hidden"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={FOLDED_LAYOUT_TRANSITION}
              onPointerDownCapture={onFoldedPanelEngagement}
              onWheelCapture={onFoldedPanelEngagement}
            >
              <div className="scrollbar scrollbar-always-visible py-2 pl-2 max-h-full shrink-0 overflow-y-auto">
                <div className="gap-2 flex flex-col items-start">
                  {sortedAgents.map((agent) => (
                    <FoldedAgentCard
                      key={agent.agent_id}
                      agent={agent}
                      isActive={detailAgentId === agent.agent_id}
                      dimmed={
                        isTaskLiveLayout && (agent.tasks?.length ?? 0) === 0
                      }
                      compactMode
                      onSelect={() => {
                        setManualFollowPaused(true);
                        setDetailAgentId(agent.agent_id);
                        onSelectAgent(agent.agent_id);
                      }}
                      showUserAgentOverflow={false}
                    />
                  ))}
                </div>
              </div>
              <div className="bg-surface-secondary min-h-0 min-w-0 flex flex-1 flex-col overflow-hidden">
                {detailAgent ? (
                  <WorkforceFoldedAgentDetailPane
                    agent={detailAgent}
                    onTakeManualFollowControl={() =>
                      setManualFollowPaused(true)
                    }
                  />
                ) : (
                  <div className="text-text-label p-3 text-body-sm">
                    Select an agent
                  </div>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="initial"
              className="scrollbar scrollbar-always-visible min-h-0 min-w-0 pl-2 pb-2 pt-1 flex-1 overflow-x-hidden overflow-y-auto"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={FOLDED_LAYOUT_TRANSITION}
            >
              <div className="gap-2 min-w-0 flex w-full max-w-full flex-col opacity-80">
                {sortedAgents.map((agent) => (
                  <FoldedAgentCard
                    key={agent.agent_id}
                    agent={agent}
                    isActive={activeAgentId === agent.agent_id}
                    dimmed={false}
                    compactMode={false}
                    onSelect={() => onSelectAgent(agent.agent_id)}
                    showUserAgentOverflow={!isBaseWorkflowAgent(agent)}
                    onDeleteUserAgent={onDeleteUserAgent}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
