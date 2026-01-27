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
import { TaskItem } from './TaskItem';

import { TaskState, TaskStateType } from '@/components/TaskState';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import {
  ChevronDown,
  Circle,
  CircleCheckBig,
  CircleSlash,
  LoaderCircle,
  Plus,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

interface TaskCardProps {
  taskInfo: any[];
  taskAssigning: Agent[];
  taskRunning: TaskInfo[];
  taskType: 1 | 2 | 3;
  progressValue: number;
  summaryTask: string;
  onAddTask: () => void;
  onUpdateTask: (taskIndex: number, content: string) => void;
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
  onDeleteTask,
  clickable = true,
  chatId,
}: TaskCardProps) {
  // const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | 'auto'>('auto');

  //Get Chatstore and ProjectStore for the active project's task
  const { chatStore, projectStore } = useChatStoreAdapter();

  const [selectedState, setSelectedState] = useState<TaskStateType>('all');

  // Use useMemo to derive filterTasks from taskRunning and selectedState
  const filterTasks = useMemo(() => {
    const tasks = taskRunning || [];

    if (selectedState === 'all') {
      return tasks;
    } else {
      return tasks.filter((task) => {
        switch (selectedState) {
          case 'done':
            return task.status === 'completed' && !task.reAssignTo;
          case 'ongoing':
            return (
              task.status !== 'failed' &&
              task.status !== 'completed' &&
              task.status !== 'skipped' &&
              task.status !== 'waiting' &&
              task.status !== ''
            );
          case 'pending':
            return (
              (task.status === 'skipped' ||
                task.status === 'waiting' ||
                task.status === '') &&
              !task.reAssignTo
            );
          case 'failed':
            return task.status === 'failed';
          default:
            return false;
        }
      });
    }
  }, [selectedState, taskRunning]);

  const activeTaskId = chatStore?.activeTaskId as string;
  const activeTask = activeTaskId ? chatStore?.tasks[activeTaskId] : null;
  const activeTaskStatus = activeTask?.status;
  const activeWorkSpace = activeTask?.activeWorkSpace;

  const isAllTaskFinished = useMemo(() => {
    return activeTaskStatus === 'finished';
  }, [activeTaskStatus]);

  useEffect(() => {
    // Use setTimeout to defer state update and avoid cascading renders
    setTimeout(() => {
      if (activeWorkSpace === 'workflow') {
        setIsExpanded(false);
      } else {
        setIsExpanded(true);
      }
    }, 0);
  }, [activeWorkSpace]);

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

  if (!chatStore) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <div className="flex h-auto w-full flex-col gap-2 pl-sm transition-all duration-300">
        <div className="relative h-auto w-full overflow-hidden rounded-xl bg-task-surface py-sm">
          <div className="absolute left-0 top-0 w-full bg-transparent">
            <Progress value={progressValue} className="h-[2px] w-full" />
          </div>
          {summaryTask && (
            <div className="mb-2.5 px-sm text-sm font-bold leading-13">
              {summaryTask.split('|')[0].replace(/"/g, '')}
            </div>
          )}

          {summaryTask && (
            <div className={`flex items-center justify-between gap-2 px-sm`}>
              <div className="flex items-center gap-2">
                {taskType === 1 && (
                  <TaskState
                    all={
                      taskInfo.filter((task) => task.content !== '').length || 0
                    }
                    done={
                      taskInfo.filter(
                        (task) =>
                          task.content !== '' && task.status === 'completed'
                      ).length || 0
                    }
                    progress={
                      taskInfo.filter(
                        (task) =>
                          task.content !== '' &&
                          task.status !== 'completed' &&
                          task.status !== 'failed' &&
                          task.status !== 'skipped' &&
                          task.status !== 'waiting' &&
                          task.status !== ''
                      ).length || 0
                    }
                    skipped={
                      taskInfo.filter(
                        (task) =>
                          task.content !== '' &&
                          (task.status === 'skipped' ||
                            task.status === 'waiting' ||
                            task.status === '')
                      ).length || 0
                    }
                    failed={
                      taskInfo.filter(
                        (task) =>
                          task.content !== '' && task.status === 'failed'
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
                      taskRunning?.filter((task) => task.status === 'completed')
                        .length || 0
                    }
                    progress={
                      taskRunning?.filter(
                        (task) =>
                          task.status !== 'completed' &&
                          task.status !== 'failed' &&
                          task.status !== 'skipped' &&
                          task.status !== 'waiting' &&
                          task.status !== ''
                      ).length || 0
                    }
                    skipped={
                      taskRunning?.filter(
                        (task) =>
                          task.status === 'skipped' ||
                          task.status === 'waiting' ||
                          task.status === ''
                      ).length || 0
                    }
                    failed={
                      taskRunning?.filter((task) => task.status === 'failed')
                        .length || 0
                    }
                    forceVisible={true}
                    selectedState={selectedState}
                    onStateChange={setSelectedState}
                    clickable={clickable}
                  />
                )}
              </div>

              <div className="transition-all duration-300 ease-in-out">
                {taskType === 1 && (
                  <Button variant="ghost" size="icon" onClick={onAddTask}>
                    <Plus size={16} />
                  </Button>
                )}
                {taskType === 2 && (
                  <div className="flex items-center gap-2 duration-300 animate-in fade-in-0 slide-in-from-right-2">
                    {(isExpanded || isAllTaskFinished) && (
                      <div className="text-text-tertiary text-xs font-medium leading-17">
                        {taskRunning?.filter(
                          (task) =>
                            task.status === 'completed' ||
                            task.status === 'failed'
                        ).length || 0}
                        /{taskRunning?.length || 0}
                      </div>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setIsExpanded(!isExpanded)}
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
              <div className="mt-sm flex flex-col px-sm duration-500 ease-out animate-in fade-in-0 slide-in-from-bottom-4">
                {taskInfo.map((task, taskIndex) => (
                  <div
                    key={`task-${taskIndex}`}
                    className="duration-300 animate-in fade-in-0 slide-in-from-left-2"
                  >
                    <TaskItem
                      taskInfo={task}
                      taskIndex={taskIndex}
                      onUpdate={(content) => onUpdateTask(taskIndex, content)}
                      onDelete={() => onDeleteTask(taskIndex)}
                    />
                  </div>
                ))}
              </div>
            )}
            {taskType === 2 && (
              <div
                ref={contentRef}
                className="overflow-hidden transition-all duration-300 ease-in-out"
                style={{
                  height: isExpanded ? contentHeight : 0,
                  opacity: isExpanded ? 1 : 0,
                }}
              >
                <div className="mt-sm flex flex-col gap-2 px-2">
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
                            chatStore.setActiveWorkSpace(
                              chatStore.activeTaskId as string,
                              'workflow'
                            );
                            chatStore.setActiveAgent(
                              chatStore.activeTaskId as string,
                              task.agent?.agent_id
                            );
                            window.electronAPI.hideAllWebview();
                          }
                        }}
                        key={`taskList-${task.id}`}
                        className={`flex gap-2 rounded-lg px-sm py-sm transition-all duration-300 ease-in-out animate-in fade-in-0 slide-in-from-left-2 ${
                          task.status === 'completed'
                            ? 'bg-green-50'
                            : task.status === 'failed'
                              ? 'bg-task-fill-error'
                              : task.status === 'running'
                                ? 'bg-zinc-50'
                                : task.status === 'blocked'
                                  ? 'bg-task-fill-warning'
                                  : 'bg-zinc-50'
                        } cursor-pointer border border-solid border-transparent ${
                          task.status === 'completed'
                            ? 'hover:border-bg-fill-success-primary'
                            : task.status === 'failed'
                              ? 'hover:border-task-border-focus-error'
                              : task.status === 'running'
                                ? 'hover:border-border-primary'
                                : task.status === 'blocked'
                                  ? 'hover:border-task-border-focus-warning'
                                  : 'border-transparent'
                        } `}
                      >
                        <div className="pt-0.5">
                          {task.status === 'running' && (
                            <LoaderCircle
                              size={16}
                              className={`text-icon-information ${
                                chatStore.tasks[
                                  chatStore.activeTaskId as string
                                ].status === 'running' && 'animate-spin'
                              } `}
                            />
                          )}
                          {task.status === 'skipped' && (
                            <LoaderCircle
                              size={16}
                              className={`text-icon-secondary`}
                            />
                          )}
                          {task.status === 'completed' && (
                            <CircleCheckBig
                              size={16}
                              className="text-icon-success"
                            />
                          )}
                          {task.status === 'failed' && (
                            <CircleSlash
                              size={16}
                              className="text-icon-cuation"
                            />
                          )}
                          {task.status === 'blocked' && (
                            <TriangleAlert
                              size={16}
                              className="text-icon-warning"
                            />
                          )}
                          {task.status === '' && (
                            <Circle size={16} className="text-icon-secondary" />
                          )}
                        </div>
                        <div className="flex flex-1 flex-col items-start justify-center">
                          <div
                            className={`w-full whitespace-pre-line break-words ${
                              task.status === 'failed'
                                ? 'text-text-cuation-default'
                                : task.status === 'blocked'
                                  ? 'text-text-body'
                                  : 'text-text-primary'
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
