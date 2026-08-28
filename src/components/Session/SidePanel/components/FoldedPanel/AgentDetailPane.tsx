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
import { useHost } from '@/host';
import { getToolkitIcon } from '@/lib/toolkitIcons';
import { cn } from '@/lib/utils';
import {
  AgentStatusValue,
  ChatTaskStatus,
  TaskStatus,
} from '@/types/constants';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
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
import { useTranslation } from 'react-i18next';

function getTaskIdDisplay(taskId: string): string {
  const list = taskId.split('.');
  let idStr = '';
  list.shift();
  list.forEach((i: string, index: number) => {
    idStr += Number(i) + (index === list.length - 1 ? '' : '.');
  });
  return idStr;
}

const PANEL_EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];

const foldedTaskLogPanelVariants = {
  initial: { transform: 'translateX(100%)' },
  animate: {
    transform: 'translateX(0)',
    transition: { duration: 0.24, ease: PANEL_EASE_OUT },
  },
  exit: {
    transform: 'translateX(100%)',
    transition: { duration: 0.18, ease: PANEL_EASE_OUT },
  },
};

const foldedTaskLogContentVariants = {
  initial: { opacity: 0, transform: 'translateX(-12px)' },
  animate: {
    opacity: 1,
    transform: 'translateX(0)',
    transition: { duration: 0.2, ease: PANEL_EASE_OUT },
  },
  exit: {
    opacity: 0,
    transform: 'translateX(-8px)',
    transition: { duration: 0.16, ease: PANEL_EASE_OUT },
  },
};

/** Legacy workforce detail view retained as a SidePanel implementation detail. */
export function AgentDetailPane({
  agent,
  onTakeManualFollowControl,
}: {
  agent: Agent;
  /** Fires when user clicks task filter tabs (take control from auto-follow in folded workforce). */
  onTakeManualFollowControl?: () => void;
}) {
  const { t } = useTranslation();
  const shouldReduceMotion = useReducedMotion();
  const host = useHost();
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

  const taskLogPanelVariants = shouldReduceMotion
    ? {
        initial: { opacity: 0, transform: 'translateX(0)' },
        animate: {
          opacity: 1,
          transform: 'translateX(0)',
          transition: { duration: 0.16, ease: PANEL_EASE_OUT },
        },
        exit: {
          opacity: 0,
          transform: 'translateX(0)',
          transition: { duration: 0.14, ease: PANEL_EASE_OUT },
        },
      }
    : foldedTaskLogPanelVariants;
  const taskLogContentVariants = shouldReduceMotion
    ? {
        initial: { opacity: 0, transform: 'translateX(0)' },
        animate: {
          opacity: 1,
          transform: 'translateX(0)',
          transition: { duration: 0.16, ease: PANEL_EASE_OUT },
        },
        exit: {
          opacity: 0,
          transform: 'translateX(0)',
          transition: { duration: 0.14, ease: PANEL_EASE_OUT },
        },
      }
    : foldedTaskLogContentVariants;

  const focusAgent = useCallback(() => {
    if (!chatStore?.activeTaskId) return;
    chatStore.setActiveWorkspace(chatStore.activeTaskId, agent.agent_id);
    host?.electronAPI?.hideAllWebview?.();
  }, [chatStore, host, agent.agent_id]);

  if (!chatStore) {
    return null;
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-xl bg-ds-neutral-strong-default">
      <div
        className={cn(
          'top-0 min-h-0 w-full max-w-full min-w-0 shrink-0 bg-ds-neutral-strong-default pt-2 pb-2'
        )}
      >
        <div
          className={cn(
            'min-w-0 px-3 text-base leading-relaxed font-bold',
            preset?.textColor ?? 'text-ds-ink-default-default'
          )}
        >
          {preset?.name ?? agent.name}
        </div>
        <div
          className="mt-sm min-h-4 w-full max-w-full min-w-0 px-3"
          onPointerEnter={() => setToolkitHovered(true)}
          onPointerLeave={() => setToolkitHovered(false)}
        >
          <HoverScrollText
            text={toolkitLine}
            active={toolkitHovered}
            className="text-xs leading-tight font-normal text-ds-ink-muted-default"
            innerClassName="text-xs font-normal leading-tight text-ds-ink-muted-default"
          />
        </div>
        {agent.tasks && agent.tasks.length > 0 && (
          <div className="flex flex-col items-start justify-between gap-1 border-0 border-x-0 border-t-0 border-b border-solid border-ds-hairline-default-default px-3 py-sm">
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
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          className="scrollbar scrollbar-always-visible h-full min-h-0 overflow-y-auto"
          onWheel={(e) => e.stopPropagation()}
        >
          <div
            className="mt-1 mb-2 max-h-[180px] w-full pl-3"
            onClick={focusAgent}
          >
            {browserImages.length > 0 && (
              <div
                className={`grid h-[180px] w-full gap-1 overflow-hidden ${browserImageGridClass}`}
              >
                {browserImages.map((img, index) => (
                  <div
                    key={`${img.img}-${index}`}
                    className="relative h-full w-full overflow-hidden rounded-lg"
                  >
                    <img
                      className="absolute top-0 left-0 h-[250%] w-[250%] origin-top-left scale-[0.4] object-cover"
                      src={img.img}
                      alt={agent.type}
                    />
                  </div>
                ))}
                {Array.from({ length: browserPlaceholderCount }).map(
                  (_, index) => (
                    <div
                      key={`browser-placeholder-${index}`}
                      className="h-full w-full rounded-sm bg-ds-neutral-subtle-default"
                    />
                  )
                )}
              </div>
            )}
            {agent.type === 'document_agent' &&
              agent.tasks &&
              agent.tasks.length > 0 && (
                <div className="relative h-[180px] w-full overflow-hidden rounded-sm">
                  <div className="absolute top-0 left-0 h-[500px] w-[900px] origin-top-left scale-[0.36]">
                    <Folder data={agent} />
                  </div>
                </div>
              )}

            {agent.type === 'developer_agent' && terminalTasks.length > 0 && (
              <div
                className={`grid h-[180px] w-full gap-1 overflow-hidden ${terminalGridClass}`}
              >
                {terminalTasks.map((task) => (
                  <div
                    key={task.id}
                    className="relative h-full w-full overflow-hidden rounded-lg object-cover"
                  >
                    <div className="absolute top-0 left-0 h-[250%] w-[250%] origin-top-left scale-[0.4]">
                      <Terminal content={task.terminal} />
                    </div>
                  </div>
                ))}
                {Array.from({ length: terminalPlaceholderCount }).map(
                  (_, index) => (
                    <div
                      key={`terminal-placeholder-${index}`}
                      className="h-full w-full rounded-lg bg-ds-neutral-subtle-default"
                    />
                  )
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 pb-3 pl-3">
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
                      'flex cursor-pointer flex-col gap-1 rounded-xl border border-x border-y border-solid px-6 py-sm transition-[background-color,border-color] duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)]',
                      task.reAssignTo
                        ? 'bg-ds-bg-status-blocked-subtle-default'
                        : task.status === TaskStatus.COMPLETED
                          ? 'bg-ds-bg-status-completed-subtle-default'
                          : task.status === TaskStatus.FAILED
                            ? 'bg-ds-bg-status-error-subtle-default'
                            : task.status === TaskStatus.RUNNING
                              ? 'bg-ds-bg-status-running-subtle-default'
                              : task.status === TaskStatus.BLOCKED
                                ? 'bg-ds-bg-status-blocked-subtle-default'
                                : task.status === TaskStatus.SKIPPED ||
                                    task.status === TaskStatus.WAITING ||
                                    task.status === TaskStatus.EMPTY
                                  ? 'bg-ds-bg-status-pending-subtle-default'
                                  : 'bg-ds-bg-status-running-subtle-default',
                      task.status === TaskStatus.COMPLETED
                        ? 'hover:border-ds-border-status-completed-default-hover'
                        : task.status === TaskStatus.FAILED
                          ? 'hover:border-ds-border-status-error-default-hover'
                          : task.status === TaskStatus.RUNNING
                            ? 'hover:border-ds-hairline-strong-default'
                            : task.status === TaskStatus.BLOCKED
                              ? 'hover:border-ds-border-status-blocked-default-hover'
                              : task.status === TaskStatus.SKIPPED ||
                                  task.status === TaskStatus.WAITING ||
                                  task.status === TaskStatus.EMPTY
                                ? 'hover:border-ds-border-status-pending-default-hover'
                                : 'hover:border-ds-hairline-default-hover',
                      'border-transparent'
                    )}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-x-2 gap-y-0.5">
                        <div className="flex h-4 shrink-0 items-center justify-center">
                          {task.reAssignTo ? (
                            <CircleSlash2
                              size={16}
                              className="text-ds-icon-status-pending-default-default"
                            />
                          ) : (
                            <>
                              {task.status === TaskStatus.RUNNING && (
                                <LoaderCircle
                                  size={16}
                                  className={cn(
                                    'text-ds-icon-status-splitting-default-default',
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
                                  className="text-ds-icon-status-pending-default-default"
                                />
                              )}
                              {task.status === TaskStatus.COMPLETED && (
                                <CircleCheckBig
                                  size={16}
                                  className="text-ds-icon-status-completed-default-default"
                                />
                              )}
                              {task.status === TaskStatus.FAILED && (
                                <CircleSlash
                                  size={16}
                                  className="text-ds-icon-status-error-default-default"
                                />
                              )}
                              {task.status === TaskStatus.BLOCKED && (
                                <TriangleAlert
                                  size={16}
                                  className="text-ds-icon-status-pending-default-default"
                                />
                              )}
                              {(task.status === TaskStatus.EMPTY ||
                                task.status === TaskStatus.WAITING) && (
                                <Circle
                                  size={16}
                                  className="text-ds-icon-status-pending-default-default"
                                />
                              )}
                            </>
                          )}
                        </div>
                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="shrink-0 text-xs leading-13 font-bold text-ds-ink-default-default">
                            {t('chat.task-number', {
                              value: getTaskIdDisplay(task.id),
                              defaultValue: 'No. {{value}}',
                            })}
                          </span>
                          {task.reAssignTo ? (
                            <div className="rounded-lg bg-ds-bg-document-subtle-default px-1 py-0.5 text-xs leading-none font-bold text-ds-text-warning-strong-default">
                              {t('chat.reassigned-to', {
                                name: task.reAssignTo,
                                defaultValue: 'Reassigned to {{name}}',
                              })}
                            </div>
                          ) : (
                            (task.failure_count ?? 0) > 0 && (
                              <div
                                className={cn(
                                  'rounded-lg px-1 py-0.5 text-xs leading-none font-bold',
                                  task.status === TaskStatus.FAILED
                                    ? 'bg-ds-bg-status-error-subtle-default text-ds-text-status-error-strong-default'
                                    : task.status === TaskStatus.COMPLETED
                                      ? 'bg-ds-neutral-default-default text-ds-text-status-completed-strong-default'
                                      : 'bg-ds-neutral-default-hover text-ds-ink-muted-default'
                                )}
                              >
                                {t('chat.attempt-number', {
                                  count: task.failure_count,
                                  defaultValue: 'Attempt {{count}}',
                                })}
                              </div>
                            )
                          )}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        buttonContent="icon-only"
                        buttonRadius="lg"
                        className="shrink-0 text-ds-ink-muted-default opacity-50"
                        aria-expanded={isExpanded}
                        aria-label={
                          isExpanded
                            ? t('chat.collapse-task-details', {
                                defaultValue: 'Collapse task details',
                              })
                            : t('chat.expand-task', {
                                defaultValue: 'Expand task',
                              })
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
                            'size-4 transition-transform duration-200 motion-reduce:transition-none',
                            isExpanded && 'rotate-180'
                          )}
                          aria-hidden
                        />
                      </Button>
                    </div>
                    <div
                      className={cn(
                        'mt-0.5 w-full max-w-full min-w-0 pl-4 text-left',
                        task.status === TaskStatus.FAILED
                          ? 'text-ds-text-status-error-strong-default'
                          : task.status === TaskStatus.BLOCKED
                            ? 'text-ds-ink-default-default'
                            : 'text-ds-ink-default-default'
                      )}
                    >
                      <div
                        className={cn(
                          'block text-ds-text-meta font-medium break-words select-text',
                          !isExpanded && 'line-clamp-2 overflow-hidden',
                          isExpanded && 'whitespace-pre-line'
                        )}
                      >
                        {task.content ?? ''}
                      </div>
                    </div>
                    {task.status === TaskStatus.RUNNING && isExpanded && (
                      <div className="mt-0.5 ml-4 flex items-center gap-2 duration-400">
                        {lastActiveToolkit?.toolkitStatus ===
                          AgentStatusValue.RUNNING && (
                          <div className="flex min-w-0 flex-1 items-center justify-start gap-sm duration-300">
                            {getToolkitIcon(
                              lastActiveToolkit.toolkitName ?? ''
                            )}
                            <div className="max-w-full min-w-0 shrink grow-0 overflow-hidden pt-1 text-xs leading-17 text-ellipsis whitespace-nowrap text-ds-ink-default-default">
                              <ShinyText
                                text={task.toolkits?.[0]?.toolkitName ?? ''}
                                className="pointer-events-auto w-full overflow-hidden text-xs leading-17 font-bold text-ellipsis whitespace-nowrap text-ds-ink-default-default select-text"
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
              variants={taskLogPanelVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="absolute inset-0 z-20 flex flex-col overflow-hidden rounded-br-xl bg-ds-neutral-strong-default will-change-transform"
            >
              <div className="flex shrink-0 items-center gap-1 px-2 pb-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  buttonContent="icon-only"
                  buttonRadius="lg"
                  className="shrink-0 text-ds-ink-muted-default"
                  aria-label={t('chat.back-to-agent-details', {
                    defaultValue: 'Back to agent details',
                  })}
                  onClick={() => setDetailTask(null)}
                >
                  <ChevronLeft className="size-4" aria-hidden />
                </Button>
                <span className="min-w-0 truncate text-ds-text-base font-bold text-ds-ink-default-default">
                  {t('chat.task-number', {
                    value: getTaskIdDisplay(detailTask.id),
                    defaultValue: 'No. {{value}}',
                  })}
                </span>
              </div>
              <div
                onWheel={(e) => e.stopPropagation()}
                className="scrollbar scrollbar-always-visible min-h-0 flex-1 overflow-y-auto pr-1 pb-2 pl-3"
              >
                <AnimatePresence mode="wait">
                  <motion.div
                    key={detailTask.id}
                    variants={taskLogContentVariants}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    className="flex w-full flex-col gap-sm"
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
