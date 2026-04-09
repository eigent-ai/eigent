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

import Folder from '@/components/Folder';
import { TaskState, type TaskStateType } from '@/components/TaskState';
import Terminal from '@/components/Terminal';
import { TaskLogPanelContent } from '@/components/WorkFlow/TaskLogPanelContent';
import { getAgentToolkitLabels } from '@/components/WorkFlow/agentToolkitLabels';
import { agentMap, type WorkflowAgentType } from '@/components/WorkFlow/agents';
import { HoverScrollText } from '@/components/ui/HoverScrollText';
import ShinyText from '@/components/ui/ShinyText/ShinyText';
import { Button } from '@/components/ui/button';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { getToolkitIcon } from '@/lib/toolkitIcons';
import { cn } from '@/lib/utils';
import {
  AgentStatusValue,
  ChatTaskStatus,
  TaskStatus,
} from '@/types/constants';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDown,
  ChevronLeft,
  Circle,
  CircleCheckBig,
  CircleSlash,
  CircleSlash2,
  LoaderCircle,
  TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

function getTaskIdDisplay(taskId: string): string {
  const list = taskId.split('.');
  let idStr = '';
  list.shift();
  list.forEach((i: string, index: number) => {
    idStr += Number(i) + (index === list.length - 1 ? '' : '.');
  });
  return idStr;
}

/** Enter: ease-out (settles gently). Exit: ease-in (picks up speed off-screen). */
const SLIDE_EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];
const SLIDE_EASE_IN: [number, number, number, number] = [0.4, 0, 0.2, 1];

const foldedTaskLogPanelVariants = {
  initial: { x: '100%' },
  animate: {
    x: 0,
    transition: { duration: 0.45, ease: SLIDE_EASE_OUT },
  },
  exit: {
    x: '100%',
    transition: { duration: 0.36, ease: SLIDE_EASE_IN },
  },
};

const foldedTaskLogContentVariants = {
  initial: { opacity: 0, x: -12 },
  animate: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.35, ease: SLIDE_EASE_OUT },
  },
  exit: {
    opacity: 0,
    x: -8,
    transition: { duration: 0.22, ease: SLIDE_EASE_IN },
  },
};

export function AgentDetailPane({
  agent,
  onTakeManualFollowControl,
}: {
  agent: Agent;
  /** Fires when user clicks task filter tabs (take control from auto-follow in folded workforce). */
  onTakeManualFollowControl?: () => void;
}) {
  const { chatStore } = useChatStoreAdapter();
  const [selectedState, setSelectedState] = useState<TaskStateType>('all');
  const [filterTasks, setFilterTasks] = useState<NonNullable<Agent['tasks']>>(
    []
  );
  const [toolkitHovered, setToolkitHovered] = useState(false);
  /** Task accordion: collapsed = 1 header row + 2-line clamped title; expanded = full title + extras. */
  const [expandedTaskIds, setExpandedTaskIds] = useState<
    Record<string, boolean>
  >({});
  const [detailTask, setDetailTask] = useState<TaskInfo | null>(null);

  useEffect(() => {
    const tasks = agent?.tasks || [];
    if (selectedState === 'all') {
      setFilterTasks(tasks);
      return;
    }
    setFilterTasks(
      tasks.filter((task) => {
        switch (selectedState) {
          case 'done':
            return task.status === TaskStatus.COMPLETED && !task.reAssignTo;
          case 'reassigned':
            return !!task.reAssignTo;
          case 'ongoing':
            return (
              task.status !== TaskStatus.FAILED &&
              task.status !== TaskStatus.COMPLETED &&
              task.status !== TaskStatus.SKIPPED &&
              task.status !== TaskStatus.WAITING &&
              task.status !== TaskStatus.EMPTY &&
              !task.reAssignTo
            );
          case 'pending':
            return (
              (task.status === TaskStatus.SKIPPED ||
                task.status === TaskStatus.WAITING ||
                task.status === TaskStatus.EMPTY) &&
              !task.reAssignTo
            );
          case 'failed':
            return task.status === TaskStatus.FAILED;
          default:
            return false;
        }
      })
    );
  }, [selectedState, agent?.tasks]);

  useEffect(() => {
    setSelectedState('all');
    setExpandedTaskIds({});
    setDetailTask(null);
  }, [agent.agent_id]);

  const activeTaskId = chatStore?.activeTaskId as string | undefined;

  const toolkitLabels = getAgentToolkitLabels(agent);
  const toolkitLine = toolkitLabels.join('  ');
  const wfType = agent.type as WorkflowAgentType;
  const preset = agentMap[wfType];

  const browserImages = (agent.activeWebviewIds || [])
    .filter((img) => img?.img)
    .slice(0, 4);
  const browserImageGridClass =
    browserImages.length === 1
      ? 'grid-cols-1 grid-rows-1'
      : browserImages.length === 2
        ? 'grid-cols-2 grid-rows-1'
        : 'grid-cols-2 grid-rows-2';
  const browserPlaceholderCount =
    browserImages.length >= 3 ? Math.max(0, 4 - browserImages.length) : 0;

  const terminalTasks = (agent?.tasks || [])
    .filter((task) => task.terminal && task.terminal.length > 0)
    .slice(0, 4);
  const terminalGridClass =
    terminalTasks.length === 1
      ? 'grid-cols-1 grid-rows-1'
      : terminalTasks.length === 2
        ? 'grid-cols-2 grid-rows-1'
        : 'grid-cols-2 grid-rows-2';
  const terminalPlaceholderCount =
    terminalTasks.length >= 3 ? Math.max(0, 4 - terminalTasks.length) : 0;

  const focusAgent = useCallback(() => {
    if (!chatStore?.activeTaskId) return;
    chatStore.setActiveWorkspace(chatStore.activeTaskId, agent.agent_id);
    window.electronAPI?.hideAllWebview?.();
  }, [chatStore, agent.agent_id]);

  if (!chatStore) {
    return null;
  }

  return (
    <div className="min-h-0 min-w-0 bg-surface-tertiary rounded-xl flex h-full w-full flex-col overflow-hidden">
      <div
        className={cn(
          'bg-surface-tertiary top-0 min-h-0 min-w-0 pb-2 pt-2 w-full max-w-full shrink-0'
        )}
      >
        <div
          className={cn(
            'min-w-0 text-base px-3 font-bold leading-relaxed',
            preset?.textColor ?? 'text-text-primary'
          )}
        >
          {preset?.name ?? agent.name}
        </div>
        <div
          className="mt-sm min-h-4 min-w-0 px-3 w-full max-w-full"
          onPointerEnter={() => setToolkitHovered(true)}
          onPointerLeave={() => setToolkitHovered(false)}
        >
          <HoverScrollText
            text={toolkitLine}
            active={toolkitHovered}
            className="text-xs font-normal leading-tight text-text-label"
            innerClassName="text-xs font-normal leading-tight text-text-label"
          />
        </div>
        {agent.tasks && agent.tasks.length > 0 && (
          <div className="gap-1 border-task-border-default px-3 py-sm flex flex-col items-start justify-between border-0 border-b border-solid">
            <div className="flex w-full flex-1 justify-start">
              <TaskState
                all={agent.tasks?.length || 0}
                done={
                  agent.tasks?.filter(
                    (task) =>
                      task.status === TaskStatus.COMPLETED && !task.reAssignTo
                  ).length || 0
                }
                reAssignTo={
                  agent.tasks?.filter((task) => task.reAssignTo)?.length || 0
                }
                progress={
                  agent.tasks?.filter(
                    (task) =>
                      task.status !== TaskStatus.FAILED &&
                      task.status !== TaskStatus.COMPLETED &&
                      task.status !== TaskStatus.SKIPPED &&
                      task.status !== TaskStatus.WAITING &&
                      task.status !== TaskStatus.EMPTY &&
                      !task.reAssignTo
                  ).length || 0
                }
                skipped={
                  agent.tasks?.filter(
                    (task) =>
                      (task.status === TaskStatus.SKIPPED ||
                        task.status === TaskStatus.WAITING ||
                        task.status === TaskStatus.EMPTY) &&
                      !task.reAssignTo
                  ).length || 0
                }
                failed={
                  agent.tasks?.filter(
                    (task) => task.status === TaskStatus.FAILED
                  ).length || 0
                }
                selectedState={selectedState}
                onStateChange={(state) => {
                  onTakeManualFollowControl?.();
                  setSelectedState(state);
                }}
                clickable={true}
              />
            </div>
          </div>
        )}
      </div>

      {/* Content: agent summary + task list; task log slides in from the right */}
      <div className="min-h-0 relative flex-1 overflow-hidden">
        <div
          className="scrollbar scrollbar-always-visible min-h-0 h-full overflow-y-auto"
          onWheel={(e) => e.stopPropagation()}
        >
          <div
            className="pl-3 mb-2 mt-1 max-h-[180px] w-full"
            onClick={focusAgent}
          >
            {browserImages.length > 0 && (
              <div
                className={`gap-1 grid h-[180px] w-full overflow-hidden ${browserImageGridClass}`}
              >
                {browserImages.map((img, index) => (
                  <div
                    key={`${img.img}-${index}`}
                    className="rounded-lg relative h-full w-full overflow-hidden"
                  >
                    <img
                      className="left-0 top-0 absolute h-[250%] w-[250%] origin-top-left scale-[0.4] object-cover"
                      src={img.img}
                      alt={agent.type}
                    />
                  </div>
                ))}
                {Array.from({ length: browserPlaceholderCount }).map(
                  (_, index) => (
                    <div
                      key={`browser-placeholder-${index}`}
                      className="rounded-sm bg-surface-primary h-full w-full"
                    />
                  )
                )}
              </div>
            )}
            {agent.type === 'document_agent' &&
              agent.tasks &&
              agent.tasks.length > 0 && (
                <div className="rounded-sm relative h-[180px] w-full overflow-hidden">
                  <div className="left-0 top-0 absolute h-[500px] w-[900px] origin-top-left scale-[0.36]">
                    <Folder data={agent} />
                  </div>
                </div>
              )}

            {agent.type === 'developer_agent' && terminalTasks.length > 0 && (
              <div
                className={`gap-1 grid h-[180px] w-full overflow-hidden ${terminalGridClass}`}
              >
                {terminalTasks.map((task) => (
                  <div
                    key={task.id}
                    className="rounded-lg relative h-full w-full overflow-hidden object-cover"
                  >
                    <div className="left-0 top-0 absolute h-[250%] w-[250%] origin-top-left scale-[0.4]">
                      <Terminal content={task.terminal} />
                    </div>
                  </div>
                ))}
                {Array.from({ length: terminalPlaceholderCount }).map(
                  (_, index) => (
                    <div
                      key={`terminal-placeholder-${index}`}
                      className="rounded-lg bg-surface-primary h-full w-full"
                    />
                  )
                )}
              </div>
            )}
          </div>

          <div className="gap-2 pl-3 pb-3 flex flex-col">
            {agent.tasks &&
              filterTasks.map((task) => {
                const lastActiveToolkit = task.toolkits
                  ?.filter(
                    (tool: { toolkitName?: string }) =>
                      tool.toolkitName !== 'notice'
                  )
                  .at(-1);
                const isExpanded = Boolean(expandedTaskIds[task.id]);

                return (
                  <div
                    key={`folded-task-${task.id}-${task.failure_count}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setDetailTask(task)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setDetailTask(task);
                      }
                    }}
                    className={cn(
                      'rounded-xl px-sm py-sm gap-1 flex cursor-pointer flex-col border border-solid transition-all duration-300',
                      task.reAssignTo
                        ? 'bg-task-fill-warning'
                        : task.status === TaskStatus.COMPLETED
                          ? 'bg-task-fill-success'
                          : task.status === TaskStatus.FAILED
                            ? 'bg-task-fill-error'
                            : task.status === TaskStatus.RUNNING
                              ? 'bg-task-fill-running'
                              : task.status === TaskStatus.BLOCKED
                                ? 'bg-task-fill-warning'
                                : 'bg-task-fill-running',
                      task.status === TaskStatus.COMPLETED
                        ? 'hover:border-task-border-focus-success'
                        : task.status === TaskStatus.FAILED
                          ? 'hover:border-task-border-focus-error'
                          : task.status === TaskStatus.RUNNING
                            ? 'hover:border-border-primary'
                            : task.status === TaskStatus.BLOCKED
                              ? 'hover:border-task-border-focus-warning'
                              : 'hover:border-task-border-focus',
                      'border-transparent'
                    )}
                  >
                    <div className="gap-2 flex w-full items-center justify-between">
                      <div className="min-w-0 gap-x-2 gap-y-0.5 flex items-center">
                        <div className="h-4 flex shrink-0 items-center justify-center">
                          {task.reAssignTo ? (
                            <CircleSlash2
                              size={16}
                              className="text-icon-warning"
                            />
                          ) : (
                            <>
                              {task.status === TaskStatus.RUNNING && (
                                <LoaderCircle
                                  size={16}
                                  className={cn(
                                    'text-icon-information',
                                    activeTaskId &&
                                      chatStore.tasks[activeTaskId]?.status ===
                                        ChatTaskStatus.RUNNING &&
                                      'animate-spin'
                                  )}
                                />
                              )}
                              {task.status === TaskStatus.SKIPPED && (
                                <LoaderCircle
                                  size={16}
                                  className="text-icon-secondary"
                                />
                              )}
                              {task.status === TaskStatus.COMPLETED && (
                                <CircleCheckBig
                                  size={16}
                                  className="text-icon-success"
                                />
                              )}
                              {task.status === TaskStatus.FAILED && (
                                <CircleSlash
                                  size={16}
                                  className="text-icon-cuation"
                                />
                              )}
                              {task.status === TaskStatus.BLOCKED && (
                                <TriangleAlert
                                  size={16}
                                  className="text-icon-warning"
                                />
                              )}
                              {(task.status === TaskStatus.EMPTY ||
                                task.status === TaskStatus.WAITING) && (
                                <Circle size={16} className="text-slate-400" />
                              )}
                            </>
                          )}
                        </div>
                        <div className="min-w-0 gap-x-2 gap-y-0.5 flex flex-wrap items-center">
                          <span className="text-xs font-bold leading-13 text-text-body shrink-0">
                            No. {getTaskIdDisplay(task.id)}
                          </span>
                          {task.reAssignTo ? (
                            <div className="rounded-lg bg-tag-fill-document px-1 py-0.5 text-xs font-bold text-text-warning leading-none">
                              Reassigned to {task.reAssignTo}
                            </div>
                          ) : (
                            (task.failure_count ?? 0) > 0 && (
                              <div
                                className={cn(
                                  'rounded-lg px-1 py-0.5 text-xs font-bold leading-none',
                                  task.status === TaskStatus.FAILED
                                    ? 'bg-surface-error-subtle text-text-cuation'
                                    : task.status === TaskStatus.COMPLETED
                                      ? 'text-text-success-default bg-tag-fill-developer'
                                      : 'bg-tag-surface-hover text-text-label'
                                )}
                              >
                                Attempt {task.failure_count}
                              </div>
                            )
                          )}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xxs"
                        buttonContent="icon-only"
                        buttonRadius="lg"
                        className="text-icon-secondary shrink-0 opacity-50"
                        aria-expanded={isExpanded}
                        aria-label={
                          isExpanded ? 'Collapse task details' : 'Expand task'
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedTaskIds((prev) => ({
                            ...prev,
                            [task.id]: !prev[task.id],
                          }));
                        }}
                      >
                        <ChevronDown
                          className={cn(
                            'size-4 transition-transform duration-200',
                            isExpanded && 'rotate-180'
                          )}
                          aria-hidden
                        />
                      </Button>
                    </div>
                    <div
                      className={cn(
                        'mt-0.5 pl-4 min-w-0 w-full max-w-full text-left',
                        task.status === TaskStatus.FAILED
                          ? 'text-text-cuation-default'
                          : task.status === TaskStatus.BLOCKED
                            ? 'text-text-body'
                            : 'text-text-primary'
                      )}
                    >
                      <div
                        className={cn(
                          'text-label-xs font-medium block break-words select-text',
                          !isExpanded && 'line-clamp-2 overflow-hidden',
                          isExpanded && 'whitespace-pre-line'
                        )}
                      >
                        {task.content ?? ''}
                      </div>
                    </div>
                    {task.status === TaskStatus.RUNNING && isExpanded && (
                      <div className="ml-4 mt-0.5 gap-2 flex items-center duration-400">
                        {lastActiveToolkit?.toolkitStatus ===
                          AgentStatusValue.RUNNING && (
                          <div className="min-w-0 gap-sm flex flex-1 items-center justify-start duration-300">
                            {getToolkitIcon(
                              lastActiveToolkit.toolkitName ?? ''
                            )}
                            <div className="min-w-0 pt-1 text-xs leading-17 text-text-primary max-w-full flex-shrink flex-grow-0 overflow-hidden text-ellipsis whitespace-nowrap">
                              <ShinyText
                                text={task.toolkits?.[0]?.toolkitName ?? ''}
                                className="text-xs font-bold leading-17 text-text-primary pointer-events-auto w-full overflow-hidden text-ellipsis whitespace-nowrap select-text"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>

        <AnimatePresence>
          {detailTask && (
            <motion.div
              key="folded-agent-task-log"
              variants={foldedTaskLogPanelVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="inset-0 rounded-br-xl bg-surface-tertiary absolute z-20 flex flex-col overflow-hidden will-change-transform"
            >
              <div className="gap-1 px-2 pb-2 flex shrink-0 items-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="xxs"
                  buttonContent="icon-only"
                  buttonRadius="lg"
                  className="text-icon-secondary shrink-0"
                  aria-label="Back to agent details"
                  onClick={() => setDetailTask(null)}
                >
                  <ChevronLeft className="size-4" aria-hidden />
                </Button>
                <span className="min-w-0 text-label-sm font-bold text-text-primary truncate">
                  No. {getTaskIdDisplay(detailTask.id)}
                </span>
              </div>
              <div
                onWheel={(e) => e.stopPropagation()}
                className="scrollbar scrollbar-always-visible min-h-0 pb-2 pl-3 pr-1 flex-1 overflow-y-auto"
              >
                <AnimatePresence mode="wait">
                  <motion.div
                    key={detailTask.id}
                    variants={foldedTaskLogContentVariants}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    className="gap-sm flex w-full flex-col"
                  >
                    <TaskLogPanelContent
                      selectedTask={detailTask}
                      chatStore={chatStore}
                      isEditMode={false}
                    />
                  </motion.div>
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
