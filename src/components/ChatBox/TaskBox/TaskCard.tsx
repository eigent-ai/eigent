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

import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useHost } from '@/host';
import { TaskItem } from './TaskItem';

import { TaskState, TaskStateType } from '@/components/TaskState';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { ChatTaskStatus, TaskStatus } from '@/types/constants';
import {
  ChevronDown,
  Circle,
  CircleCheckBig,
  CircleSlash,
  LoaderCircle,
  Plus,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

const TASK_CARD_EXPAND_STORAGE_PREFIX = 'eigent:task-card-expanded';

function getTaskCardExpandStorageKey(
  chatId: string | undefined,
  activeTaskId: string | undefined
): string | null {
  if (!activeTaskId) return null;
  if (chatId)
    return `${TASK_CARD_EXPAND_STORAGE_PREFIX}:${chatId}:${activeTaskId}`;
  return `${TASK_CARD_EXPAND_STORAGE_PREFIX}:${activeTaskId}`;
}

function readStoredTaskCardExpanded(key: string | null): boolean {
  if (!key || typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeStoredTaskCardExpanded(key: string | null, expanded: boolean) {
  if (!key || typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(key, expanded ? '1' : '0');
  } catch {
    /* ignore quota / private mode */
  }
}

interface TaskCardProps {
  taskInfo: any[];
  taskAssigning: Agent[];
  taskRunning: TaskInfo[];
  taskType: 1 | 2 | 3;
  progressValue: number;
  summaryTask: string;
  onAddTask: () => void;
  onUpdateTask: (taskIndex: number, content: string) => void;
  onSaveTask: () => void;
  onDeleteTask: (taskIndex: number) => void;
  clickable?: boolean;
  chatId?: string;
}

export function TaskCard({
  taskInfo,
  taskType,
  taskRunning,
  progressValue,
  summaryTask,
  onAddTask,
  onUpdateTask,
  onSaveTask,
  onDeleteTask,
  clickable = true,
  chatId,
}: TaskCardProps) {
  const host = useHost();
  const electronAPI = host?.electronAPI;
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | 'auto'>('auto');
  const [selectedState, setSelectedState] = useState<TaskStateType>('all');
  const [filterTasks, setFilterTasks] = useState<any[]>([]);

  //Get Chatstore and ProjectStore for the active project's task
  const { chatStore, projectStore } = useChatStoreAdapter();

  // Extract values for dependency arrays (must be before any conditional returns)
  const activeTaskId = chatStore?.activeTaskId as string;
  const activeTask = chatStore?.tasks?.[activeTaskId];
  const activeTaskStatus = activeTask?.status;
  const expandStorageKey = getTaskCardExpandStorageKey(chatId, activeTaskId);

  const [isExpanded, setIsExpanded] = useState(() =>
    readStoredTaskCardExpanded(
      getTaskCardExpandStorageKey(chatId, activeTaskId)
    )
  );

  useEffect(() => {
    setIsExpanded(readStoredTaskCardExpanded(expandStorageKey));
  }, [expandStorageKey]);

  useEffect(() => {
    writeStoredTaskCardExpanded(expandStorageKey, isExpanded);
  }, [expandStorageKey, isExpanded]);

  useEffect(() => {
    const tasks = taskRunning || [];

    if (selectedState === 'all') {
      setFilterTasks(tasks);
    } else {
      const newFiltered = tasks.filter((task) => {
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
            return task.status === TaskStatus.FAILED && !task.reAssignTo;
          default:
            return false;
        }
      });
      setFilterTasks(newFiltered);
    }
  }, [selectedState, taskInfo, taskRunning]);

  // Improved height calculation logic
  useEffect(() => {
    if (!contentRef.current) return;

    const updateHeight = () => {
      if (contentRef.current) {
        const scrollHeight = contentRef.current.scrollHeight;
        setContentHeight(scrollHeight);
      }
    };

    // Update height immediately
    updateHeight();

    // Use ResizeObserver to monitor content changes
    const resizeObserver = new ResizeObserver(() => {
      updateHeight();
    });

    resizeObserver.observe(contentRef.current);

    // Update height when taskRunning changes
    const timeoutId = setTimeout(updateHeight, 100);

    return () => {
      resizeObserver.disconnect();
      clearTimeout(timeoutId);
    };
  }, [taskRunning, isExpanded]);

  // Handle height updates specifically for expand/collapse state changes
  useEffect(() => {
    if (!contentRef.current || !isExpanded) return;

    const updateHeightOnExpand = () => {
      if (contentRef.current && isExpanded) {
        // Small delay to ensure DOM is fully rendered
        requestAnimationFrame(() => {
          if (contentRef.current) {
            setContentHeight(contentRef.current.scrollHeight);
          }
        });
      }
    };

    // Update height immediately when expanded
    updateHeightOnExpand();

    // Additional delay when expanded to ensure all animations complete
    if (isExpanded) {
      const timeoutId = setTimeout(updateHeightOnExpand, 300);
      return () => clearTimeout(timeoutId);
    }
  }, [isExpanded]);

  // Early return after all hooks
  if (!chatStore) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <div className="gap-2 px-sm py-2 flex h-auto w-full flex-col transition-all duration-300">
        <div className="rounded-xl py-sm bg-ds-bg-neutral-default-default relative h-auto w-full overflow-hidden">
          <div className="left-0 top-0 absolute w-full bg-transparent">
            <Progress value={progressValue} className="h-[2px] w-full" />
          </div>
          {summaryTask && (
            <div className="mb-2.5 px-sm text-sm font-bold leading-13">
              {summaryTask.split('|')[0].replace(/"/g, '')}
            </div>
          )}

          {summaryTask && (
            <div className={`gap-2 px-sm flex items-center justify-between`}>
              <div className="gap-2 flex items-center">
                {taskType === 1 && (
                  <TaskState
                    all={
                      taskInfo.filter((task) => task.content !== '').length || 0
                    }
                    done={
                      taskInfo.filter(
                        (task) =>
                          task.content !== '' &&
                          task.status === TaskStatus.COMPLETED
                      ).length || 0
                    }
                    progress={
                      taskInfo.filter(
                        (task) =>
                          task.content !== '' &&
                          task.status !== TaskStatus.COMPLETED &&
                          task.status !== TaskStatus.FAILED &&
                          task.status !== TaskStatus.SKIPPED &&
                          task.status !== TaskStatus.WAITING &&
                          task.status !== TaskStatus.EMPTY
                      ).length || 0
                    }
                    skipped={
                      taskInfo.filter(
                        (task) =>
                          task.content !== '' &&
                          (task.status === TaskStatus.SKIPPED ||
                            task.status === TaskStatus.WAITING ||
                            task.status === TaskStatus.EMPTY)
                      ).length || 0
                    }
                    failed={
                      taskInfo.filter(
                        (task) =>
                          task.content !== '' &&
                          task.status === TaskStatus.FAILED
                      ).length || 0
                    }
                    forceVisible={true}
                    clickable={clickable}
                  />
                )}
                {taskType !== 1 && (
                  <TaskState
                    all={taskRunning?.length || 0}
                    done={
                      taskRunning?.filter(
                        (task) =>
                          task.status === TaskStatus.COMPLETED &&
                          !task.reAssignTo
                      ).length || 0
                    }
                    reAssignTo={
                      taskRunning?.filter((task) => task.reAssignTo)?.length ||
                      0
                    }
                    progress={
                      taskRunning?.filter(
                        (task) =>
                          task.status !== TaskStatus.COMPLETED &&
                          task.status !== TaskStatus.FAILED &&
                          task.status !== TaskStatus.SKIPPED &&
                          task.status !== TaskStatus.WAITING &&
                          task.status !== TaskStatus.EMPTY &&
                          !task.reAssignTo
                      ).length || 0
                    }
                    skipped={
                      taskRunning?.filter(
                        (task) =>
                          (task.status === TaskStatus.SKIPPED ||
                            task.status === TaskStatus.WAITING ||
                            task.status === TaskStatus.EMPTY) &&
                          !task.reAssignTo
                      ).length || 0
                    }
                    failed={
                      taskRunning?.filter(
                        (task) =>
                          task.status === TaskStatus.FAILED && !task.reAssignTo
                      ).length || 0
                    }
                    forceVisible={true}
                    selectedState={selectedState}
                    onStateChange={setSelectedState}
                    clickable={clickable}
                  />
                )}
              </div>

              <div className="ease-in-out transition-all duration-300">
                {taskType === 1 && (
                  <Button variant="ghost" size="icon" onClick={onAddTask}>
                    <Plus size={16} />
                  </Button>
                )}
                {taskType === 2 && (
                  <div className="gap-2 animate-in fade-in-0 slide-in-from-right-2 flex items-center duration-300">
                    {isExpanded && (
                      <div className="text-xs font-medium leading-17 text-ds-text-neutral-subtle-default">
                        {taskRunning?.filter(
                          (task) =>
                            task.status === TaskStatus.COMPLETED ||
                            task.status === TaskStatus.FAILED
                        ).length || 0}
                        /{taskRunning?.length || 0}
                      </div>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setIsExpanded((prev) => !prev)}
                    >
                      <ChevronDown
                        size={16}
                        className={`transition-transform duration-300 ${
                          isExpanded ? 'rotate-180' : ''
                        }`}
                      />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="relative">
            {taskType === 1 && (
              <div className="mt-sm px-sm ease-out animate-in fade-in-0 slide-in-from-bottom-4 flex flex-col duration-500">
                {taskInfo.map((task, taskIndex) => (
                  <div
                    key={`task-${taskIndex}`}
                    className="animate-in fade-in-0 slide-in-from-left-2 duration-300"
                  >
                    <TaskItem
                      taskInfo={task}
                      taskIndex={taskIndex}
                      onUpdate={(content) => onUpdateTask(taskIndex, content)}
                      onSave={() => onSaveTask()}
                      onDelete={() => onDeleteTask(taskIndex)}
                    />
                  </div>
                ))}
              </div>
            )}
            {taskType === 2 && (
              <div
                ref={contentRef}
                className="ease-in-out overflow-hidden transition-all duration-300"
                style={{
                  height: isExpanded ? contentHeight : 0,
                  opacity: isExpanded ? 1 : 0,
                }}
              >
                <div className="mt-sm gap-2 px-2 flex flex-col">
                  {filterTasks.map((task: TaskInfo) => {
                    return (
                      <div
                        onClick={() => {
                          if (task.agent) {
                            // Switch to the chatStore that owns this task card (for multi-turn conversations)
                            if (chatId && projectStore.activeProjectId) {
                              const activeProjectId =
                                projectStore.activeProjectId;
                              const activeChatStore =
                                projectStore.getActiveChatStore();
                              const currentChatId = activeChatStore
                                ? Object.keys(
                                    projectStore.projects[activeProjectId]
                                      .chatStores
                                  ).find(
                                    (id) =>
                                      projectStore.projects[activeProjectId]
                                        .chatStores[id] === activeChatStore
                                  )
                                : null;

                              // Only switch if this is a different chat
                              if (currentChatId && currentChatId !== chatId) {
                                projectStore.setActiveChatStore(
                                  activeProjectId,
                                  chatId
                                );
                              }
                            }

                            // Set the active workspace and agent
                            chatStore.setActiveWorkspace(
                              chatStore.activeTaskId as string,
                              'workflow'
                            );
                            chatStore.setActiveAgent(
                              chatStore.activeTaskId as string,
                              task.agent?.agent_id
                            );
                            electronAPI?.hideAllWebview();
                          }
                        }}
                        key={`taskList-${task.id}`}
                        className={`gap-2 rounded-lg px-sm py-sm ease-in-out animate-in fade-in-0 slide-in-from-left-2 flex transition-all duration-300 ${
                          task.status === TaskStatus.COMPLETED
                            ? 'bg-[var(--ds-bg-status-completed-subtle-default)]'
                            : task.status === TaskStatus.FAILED
                              ? 'bg-[var(--ds-bg-status-error-subtle-default)]'
                              : task.status === TaskStatus.RUNNING
                                ? 'bg-[var(--ds-bg-status-running-subtle-default)]'
                                : task.status === TaskStatus.BLOCKED
                                  ? 'bg-[var(--ds-bg-status-blocked-subtle-default)]'
                                  : task.status === TaskStatus.SKIPPED ||
                                      task.status === TaskStatus.WAITING ||
                                      task.status === TaskStatus.EMPTY
                                    ? 'bg-[var(--ds-bg-status-pending-subtle-default)]'
                                    : 'bg-[var(--ds-bg-status-running-subtle-default)]'
                        } cursor-pointer border border-solid border-transparent ${
                          task.status === TaskStatus.COMPLETED
                            ? 'hover:border-[color:var(--ds-border-status-completed-default-focus)]'
                            : task.status === TaskStatus.FAILED
                              ? 'hover:border-[color:var(--ds-border-status-error-default-focus)]'
                              : task.status === TaskStatus.RUNNING
                                ? 'hover:border-[color:var(--ds-border-status-running-default-focus)]'
                                : task.status === TaskStatus.BLOCKED
                                  ? 'hover:border-[color:var(--ds-border-status-blocked-default-focus)]'
                                  : task.status === TaskStatus.SKIPPED ||
                                      task.status === TaskStatus.WAITING ||
                                      task.status === TaskStatus.EMPTY
                                    ? 'hover:border-[color:var(--ds-border-status-pending-default-hover)]'
                                    : 'border-transparent'
                        } `}
                      >
                        <div className="pt-0.5">
                          {task.status === TaskStatus.RUNNING && (
                            <LoaderCircle
                              size={16}
                              className={`text-[color:var(--ds-icon-information-default-default)] ${
                                activeTaskStatus === ChatTaskStatus.RUNNING &&
                                'animate-spin'
                              } `}
                            />
                          )}
                          {task.status === TaskStatus.SKIPPED && (
                            <LoaderCircle
                              size={16}
                              className="text-[color:var(--ds-icon-status-pending-default-default)]"
                            />
                          )}
                          {task.status === TaskStatus.COMPLETED && (
                            <CircleCheckBig
                              size={16}
                              className="text-[color:var(--ds-icon-success-default-default)]"
                            />
                          )}
                          {task.status === TaskStatus.FAILED && (
                            <CircleSlash
                              size={16}
                              className="text-[color:var(--ds-icon-caution-default-default)]"
                            />
                          )}
                          {task.status === TaskStatus.BLOCKED && (
                            <TriangleAlert
                              size={16}
                              className="text-[color:var(--ds-icon-warning-default-default)]"
                            />
                          )}
                          {(task.status === TaskStatus.EMPTY ||
                            task.status === TaskStatus.WAITING) && (
                            <Circle
                              size={16}
                              className="text-[color:var(--ds-icon-status-pending-default-default)]"
                            />
                          )}
                        </div>
                        <div className="min-w-0 flex flex-1 flex-col items-start justify-center">
                          <div
                            className={`min-w-0 w-full [overflow-wrap:anywhere] break-words whitespace-pre-line ${
                              task.status === TaskStatus.FAILED
                                ? 'text-[color:var(--ds-text-caution-default-default)]'
                                : task.status === TaskStatus.BLOCKED
                                  ? 'text-[color:var(--ds-text-warning-default-default)]'
                                  : task.status === TaskStatus.SKIPPED ||
                                      task.status === TaskStatus.WAITING ||
                                      task.status === TaskStatus.EMPTY
                                    ? 'text-[color:var(--ds-text-status-pending-default-default)]'
                                    : 'text-[color:var(--ds-text-neutral-default-default)]'
                            } text-sm font-medium leading-13`}
                          >
                            {task.content}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
