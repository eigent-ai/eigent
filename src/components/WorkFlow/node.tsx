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
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useHost } from '@/host';
import { getToolkitIcon } from '@/lib/toolkitIcons';
import { useAuthStore, useWorkerList } from '@/store/authStore';
import {
  AgentStatusValue,
  ChatTaskStatus,
  TaskStatus,
} from '@/types/constants';
import { Handle, NodeResizer, Position, useReactFlow } from '@xyflow/react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Circle,
  CircleCheckBig,
  CircleSlash,
  CircleSlash2,
  Ellipsis,
  LoaderCircle,
  SquareChevronLeft,
  SquareCode,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Folder from '../Folder';
import { TaskState, TaskStateType } from '../TaskState';
import Terminal from '../Terminal';
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from '../ui/popover';
import ShinyText from '../ui/ShinyText/ShinyText';
import { agentMap, type WorkflowAgentType } from './agents';
import { getAgentToolkitLabels } from './agentToolkitLabels';
import { TaskLogPanelContent } from './TaskLogPanelContent';

interface NodeProps {
  id: string;
  data: {
    img: ActiveWebView[];
    agent?: Agent;
    type: AgentNameType;
    isExpanded: boolean;
    onExpandChange: (nodeId: string, isExpanded: boolean) => void;
    isEditMode: boolean;
    workerInfo: {
      name: string;
      description: string;
      tools: any;
      mcp_tools: any;
      selectedTools: any;
    };
  };
}

export function Node({ id, data }: NodeProps) {
  const host = useHost();
  const electronAPI = host?.electronAPI;
  const [isExpanded, setIsExpanded] = useState(data.isExpanded);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [selectedState, setSelectedState] = useState<TaskStateType>('all');

  const [filterTasks, setFilterTasks] = useState<any[]>([]);
  useEffect(() => {
    const tasks = data.agent?.tasks || [];

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
            return task.status === TaskStatus.FAILED;
          default:
            return false;
        }
      });
      setFilterTasks(newFiltered);
    }
  }, [selectedState, data.agent?.tasks]);

  //Get Chatstore for the active project's task
  const { chatStore } = useChatStoreAdapter();
  const { getNode, setViewport, setNodes } = useReactFlow();
  const workerList = useWorkerList();
  const { setWorkerList } = useAuthStore();
  const nodeRef = useRef<HTMLDivElement>(null);
  const lastAutoExpandedTaskIdRef = useRef<string | null>(null);
  const onExpandChange = data.onExpandChange;
  const agentTasks = useMemo(
    () => data.agent?.tasks || [],
    [data.agent?.tasks]
  );
  const runningTask = agentTasks.find(
    (task) => task.status === TaskStatus.RUNNING
  );
  const runningTaskId = runningTask?.id;
  const runningTaskToolkitsLength = runningTask?.toolkits?.length;
  const activeTaskId = chatStore?.activeTaskId as string;
  const activeAgent = activeTaskId
    ? chatStore?.tasks?.[activeTaskId]?.activeAgent
    : undefined;

  // Helper to safely access task properties
  const getCurrentTask = () =>
    activeTaskId ? chatStore?.tasks?.[activeTaskId] : undefined;

  useEffect(() => {
    setIsExpanded(data.isExpanded);
  }, [data.isExpanded]);

  // Auto-expand when a task is running with toolkits
  useEffect(() => {
    const tasks = agentTasks;

    // Find running task with active toolkits
    const runningTaskWithToolkits = tasks.find(
      (task) =>
        task.status === TaskStatus.RUNNING &&
        task.toolkits &&
        task.toolkits.length > 0
    );

    // Reset tracking when no tasks are running
    const hasRunningTasks = tasks.some(
      (task) => task.status === TaskStatus.RUNNING
    );
    if (!hasRunningTasks && lastAutoExpandedTaskIdRef.current) {
      lastAutoExpandedTaskIdRef.current = null;
    }

    // Auto-expand for new running task
    if (
      runningTaskWithToolkits &&
      runningTaskWithToolkits.id !== lastAutoExpandedTaskIdRef.current
    ) {
      // Always select the new task
      setSelectedTask(runningTaskWithToolkits);

      // Expand if not already expanded
      if (!isExpanded) {
        setIsExpanded(true);
        onExpandChange(id, true);
      }

      lastAutoExpandedTaskIdRef.current = runningTaskWithToolkits.id;
    }
  }, [
    agentTasks,
    runningTaskId,
    runningTaskToolkitsLength,
    id,
    onExpandChange,
    isExpanded,
  ]);

  // manually control node size
  useEffect(() => {
    if (data.isEditMode) {
      const targetWidth = isExpanded ? 684 : 342;
      const targetHeight = 600;

      setNodes((nodes) =>
        nodes.map((node) => {
          if (node.id === id) {
            return {
              ...node,
              style: {
                ...node.style,
                width: targetWidth,
                height: targetHeight,
              },
            };
          }
          return node;
        })
      );
    }
  }, [isExpanded, data.isEditMode, id, setNodes]);

  const handleShowLog = () => {
    if (!isExpanded) {
      setSelectedTask(
        data.agent?.tasks.find((task) => task.status === TaskStatus.RUNNING) ||
          data.agent?.tasks[0]
      );
    }
    setIsExpanded(!isExpanded);
    onExpandChange(id, !isExpanded);
  };

  useEffect(() => {
    if (activeAgent !== id) {
      return;
    }

    const node = getNode(id);
    if (!node) {
      return;
    }

    setTimeout(() => {
      setViewport(
        { x: -node.position.x, y: 0, zoom: 1 },
        {
          duration: 500,
        }
      );
    }, 100);
  }, [activeAgent, id, getNode, setViewport]);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const [toolsHeight, setToolsHeight] = useState(0);

  // dynamically calculate tool label height
  useEffect(() => {
    if (toolsRef.current) {
      const height = toolsRef.current.offsetHeight;
      setToolsHeight(height);
    }
  }, [data.agent?.tools]);

  const logRef = useRef<HTMLDivElement>(null);
  const rePortRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);
  const scrollThresholdPx = 60;

  const wheelHandler = useCallback((e: WheelEvent) => {
    e.stopPropagation();
  }, []);

  // Auto-scroll log panel to latest when toolkits update (only if user was already at bottom)
  const scrollLogToBottom = useCallback(() => {
    const el = logRef.current;
    if (!el || !wasAtBottomRef.current) return;
    setTimeout(() => {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: 'smooth',
      });
    }, 50);
  }, []);

  const toolkits = selectedTask?.toolkits;
  const lastToolkit = toolkits?.[toolkits.length - 1];
  const toolkitChangeKey = `${selectedTask?.id ?? ''}:${toolkits?.length ?? 0}:${lastToolkit?.toolkitId ?? ''}:${lastToolkit?.toolkitStatus ?? ''}:${lastToolkit?.message?.slice(-30) ?? ''}`;

  useEffect(() => {
    if (!isExpanded || !toolkits?.length) return;
    scrollLogToBottom();
  }, [isExpanded, toolkits?.length, toolkitChangeKey, scrollLogToBottom]);

  // Scroll to bottom when a report appears
  useEffect(() => {
    if (!isExpanded || !selectedTask?.report) return;
    scrollLogToBottom();
  }, [isExpanded, selectedTask?.report, scrollLogToBottom]);

  // Reset scroll-to-bottom flag when switching tasks or when panel opens
  useEffect(() => {
    wasAtBottomRef.current = true;
  }, [selectedTask?.id]);

  useEffect(() => {
    if (isExpanded) {
      wasAtBottomRef.current = true;
    }
  }, [isExpanded]);

  // Track whether user has scrolled up so we don't override manual reading
  useEffect(() => {
    const el = logRef.current;
    if (!el || !isExpanded) return;
    const onScroll = () => {
      const { scrollTop, clientHeight, scrollHeight } = el;
      wasAtBottomRef.current =
        scrollTop + clientHeight >= scrollHeight - scrollThresholdPx;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [isExpanded, selectedTask?.id]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const log = logRef.current;

    if (wrapper) {
      wrapper.addEventListener('wheel', wheelHandler, { passive: false });
    }

    if (log) {
      log.addEventListener('wheel', wheelHandler, { passive: false });
    }

    return () => {
      if (wrapper) {
        wrapper.removeEventListener('wheel', wheelHandler);
      }
      if (log) {
        log.removeEventListener('wheel', wheelHandler);
      }
    };
  }, [wheelHandler, isExpanded, selectedTask, selectedTask?.report]);

  const getTaskId = (taskId: string) => {
    const list = taskId.split('.');
    let idStr = '';
    list.shift();
    list.map((i: string, index: number) => {
      idStr += Number(i) + (index === list.length - 1 ? '' : '.');
    });
    return idStr;
  };

  const toolkitLabels = getAgentToolkitLabels(data.agent);
  const browserImages = (data.img || []).filter((img) => img?.img).slice(0, 4);
  const browserImageGridClass =
    browserImages.length === 1
      ? 'grid-cols-1 grid-rows-1'
      : browserImages.length === 2
        ? 'grid-cols-2 grid-rows-1'
        : 'grid-cols-2 grid-rows-2';
  const browserPlaceholderCount =
    browserImages.length >= 3 ? Math.max(0, 4 - browserImages.length) : 0;
  const terminalTasks = (data.agent?.tasks || [])
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
  const workflowAgentType =
    data.type in agentMap ? (data.type as WorkflowAgentType) : undefined;
  const displayInfo = workflowAgentType
    ? agentMap[workflowAgentType]
    : undefined;

  return chatStore ? (
    <>
      <NodeResizer
        minWidth={isExpanded ? 684 : 342}
        minHeight={300}
        isVisible={data.isEditMode}
        keepAspectRatio={false}
        color="transparent"
        lineStyle={{ stroke: 'transparent' }}
      />
      <Handle
        className="!h-0 !min-h-0 !w-0 !min-w-0 opacity-0"
        type="target"
        position={Position.Top}
        id="top"
      />
      <motion.div
        layout
        ref={nodeRef}
        transition={{ layout: { duration: 0.3, ease: 'easeIn' } }}
        className={`${
          data.isEditMode
            ? `w-full ${isExpanded ? 'min-w-[684px]' : 'min-w-[342px]'}`
            : isExpanded
              ? 'w-[684px]'
              : 'w-[342px]'
        } ${
          data.isEditMode ? 'h-full' : 'max-h-[calc(100vh-200px)]'
        } flex overflow-hidden rounded-xl border border-solid border-ds-border-neutral-subtle-default bg-ds-bg-neutral-subtle-default shadow-sm ${
          getCurrentTask()?.activeAgent === id
            ? `${displayInfo?.borderColor} z-50`
            : 'z-10 border-ds-border-neutral-default-default'
        } transition-all duration-300 ease-in-out ${
          (data.agent?.tasks?.length ?? 0) === 0 && 'opacity-30'
        }`}
      >
        <div className="flex w-[342px] shrink-0 flex-col border-y-0 border-l-0 border-r-[0.5px] border-solid border-ds-border-neutral-default-default">
          {/* header */}
          <div className="flex items-center justify-between gap-sm px-3 pb-1 pt-2">
            <div className="flex items-center justify-between gap-md">
              <div
                className={`text-base font-bold leading-relaxed ${
                  displayInfo?.textColor
                }`}
              >
                {displayInfo?.name || data.agent?.name}
              </div>
            </div>
            <div className="flex items-center gap-xs">
              <Button
                onClick={handleShowLog}
                variant="ghost"
                size="xs"
                buttonContent="icon-only"
              >
                {isExpanded ? <SquareChevronLeft /> : <SquareCode />}
              </Button>
              {!workflowAgentType &&
                getCurrentTask()?.messages?.length === 0 && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        onClick={(e) => e.stopPropagation()}
                        variant="ghost"
                        size="xs"
                        buttonContent="icon-only"
                      >
                        <Ellipsis />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[98px] rounded-[12px] border border-solid border-ds-border-neutral-default-default bg-ds-bg-neutral-strong-default p-sm">
                      <div className="space-y-1">
                        <PopoverClose asChild>
                          <AddWorker
                            edit={true}
                            workerInfo={data.agent as Agent}
                          />
                        </PopoverClose>
                        <PopoverClose asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full justify-start gap-2"
                            onClick={(e) => {
                              e.stopPropagation();
                              const newWorkerList = workerList.filter(
                                (worker) => worker.type !== data.workerInfo.name
                              );
                              setWorkerList(newWorkerList);
                            }}
                          >
                            <Trash2
                              size={16}
                              className="text-ds-icon-neutral-default-default group-hover:text-ds-icon-status-error-default-default"
                            />
                            Delete
                          </Button>
                        </PopoverClose>
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
            </div>
          </div>
          {/* tools */}
          <div
            ref={toolsRef}
            className="mb-sm flex min-h-4 flex-shrink-0 flex-wrap px-3 text-xs font-normal leading-tight text-ds-text-neutral-muted-default"
          >
            {/* {JSON.stringify(data.agent)} */}
            {toolkitLabels.map((toolkit, index) => (
              <span key={index} className="mr-2">
                {toolkit}
              </span>
            ))}
          </div>
          {/* workspace */}
          <div
            className="mb-2 max-h-[180px] px-3"
            onClick={() => {
              chatStore.setActiveWorkspace(
                chatStore.activeTaskId as string,
                data.agent?.agent_id as string
              );

              electronAPI?.hideAllWebview();
            }}
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
                      className="absolute left-0 top-0 h-[250%] w-[250%] origin-top-left scale-[0.4] object-cover"
                      src={img.img}
                      alt={data.type}
                    />
                  </div>
                ))}
                {Array.from({ length: browserPlaceholderCount }).map(
                  (_, index) => (
                    <div
                      key={`browser-placeholder-${index}`}
                      className="h-full w-full rounded-sm bg-ds-bg-neutral-subtle-default"
                    />
                  )
                )}
              </div>
            )}
            {data.type === 'document_agent' &&
              data?.agent?.tasks &&
              data.agent.tasks.length > 0 && (
                <div className="relative h-[180px] w-full overflow-hidden rounded-sm">
                  <div className="absolute left-0 top-0 h-[500px] w-[900px] origin-top-left scale-[0.36]">
                    <Folder data={data.agent as Agent} />
                  </div>
                </div>
              )}

            {data.type === 'developer_agent' && terminalTasks.length > 0 && (
              <div
                className={`grid h-[180px] w-full gap-1 overflow-hidden ${terminalGridClass}`}
              >
                {terminalTasks.map((task) => (
                  <div
                    key={task.id}
                    className="relative h-full w-full overflow-hidden rounded-lg object-cover"
                  >
                    <div className="absolute left-0 top-0 h-[250%] w-[250%] origin-top-left scale-[0.4]">
                      <Terminal content={task.terminal} />
                    </div>
                  </div>
                ))}
                {Array.from({ length: terminalPlaceholderCount }).map(
                  (_, index) => (
                    <div
                      key={`terminal-placeholder-${index}`}
                      className="h-full w-full rounded-lg bg-ds-bg-neutral-subtle-default"
                    />
                  )
                )}
              </div>
            )}
          </div>
          {/* subtasks */}
          {data.agent?.tasks && data.agent?.tasks.length > 0 && (
            <div className="flex flex-col items-start justify-between gap-1 border-[0px] border-t border-solid border-ds-border-neutral-default-default px-3 py-sm">
              {/* <div className="font-bold leading-tight text-xs">Subtasks</div> */}
              <div className="flex flex-1 justify-end">
                <TaskState
                  all={data.agent.tasks?.length || 0}
                  done={
                    data.agent?.tasks?.filter(
                      (task) =>
                        task.status === TaskStatus.COMPLETED && !task.reAssignTo
                    ).length || 0
                  }
                  reAssignTo={
                    data.agent.tasks?.filter((task) => task.reAssignTo)
                      ?.length || 0
                  }
                  progress={
                    data.agent?.tasks?.filter(
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
                    data.agent?.tasks?.filter(
                      (task) =>
                        (task.status === TaskStatus.SKIPPED ||
                          task.status === TaskStatus.WAITING ||
                          task.status === TaskStatus.EMPTY) &&
                        !task.reAssignTo
                    ).length || 0
                  }
                  failed={
                    data.agent?.tasks?.filter(
                      (task) => task.status === TaskStatus.FAILED
                    ).length || 0
                  }
                  selectedState={selectedState}
                  onStateChange={setSelectedState}
                  clickable={true}
                />
              </div>
            </div>
          )}
          <div
            ref={wrapperRef}
            onWheel={(e) => {
              e.stopPropagation();
            }}
            className="scrollbar scrollbar-always-visible flex flex-col gap-2 overflow-y-auto px-3 pb-2 duration-500 ease-out animate-in fade-in-0 slide-in-from-bottom-4"
            style={{
              maxHeight:
                data.img && data.img.length > 0
                  ? `calc(100vh - 200px - 180px - 60px - ${toolsHeight}px)`
                  : `calc(100vh - 200px - 60px - ${toolsHeight}px)`,
            }}
          >
            {data.agent?.tasks &&
              filterTasks.map((task) => {
                const lastActiveToolkit = task.toolkits
                  ?.filter((tool: any) => tool.toolkitName !== 'notice')
                  .at(-1);
                const taskRowBgHover =
                  task.reAssignTo || task.status === TaskStatus.BLOCKED
                    ? 'bg-ds-bg-status-blocked-subtle-default hover:bg-ds-bg-status-blocked-subtle-hover'
                    : task.status === TaskStatus.COMPLETED
                      ? 'bg-ds-bg-status-completed-subtle-default hover:bg-ds-bg-status-completed-subtle-hover'
                      : task.status === TaskStatus.FAILED
                        ? 'bg-ds-bg-status-error-subtle-default hover:bg-ds-bg-status-error-subtle-hover'
                        : task.status === TaskStatus.RUNNING
                          ? 'bg-ds-bg-status-running-subtle-default hover:bg-ds-bg-status-running-subtle-hover'
                          : task.status === TaskStatus.SKIPPED ||
                              task.status === TaskStatus.WAITING ||
                              task.status === TaskStatus.EMPTY
                            ? 'bg-ds-bg-status-pending-subtle-default hover:bg-ds-bg-status-pending-subtle-hover'
                            : 'bg-ds-bg-status-running-subtle-default hover:bg-ds-bg-status-running-subtle-hover';
                const taskTextClass = task.reAssignTo
                  ? 'text-ds-text-status-blocked-strong-default'
                  : task.status === TaskStatus.COMPLETED
                    ? 'text-ds-text-status-completed-strong-default'
                    : task.status === TaskStatus.FAILED
                      ? 'text-ds-text-status-error-strong-default'
                      : task.status === TaskStatus.RUNNING
                        ? 'text-ds-text-status-running-strong-default'
                        : task.status === TaskStatus.BLOCKED
                          ? 'text-ds-text-status-blocked-strong-default'
                          : task.status === TaskStatus.SKIPPED ||
                              task.status === TaskStatus.WAITING ||
                              task.status === TaskStatus.EMPTY
                            ? 'text-ds-text-status-pending-strong-default'
                            : 'text-ds-text-status-running-strong-default';
                return (
                  <div
                    onClick={() => {
                      setSelectedTask(task);
                      setIsExpanded(true);
                      onExpandChange(id, true);
                      if (task.agent) {
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
                    key={`taskList-${task.id}-${task.failure_count}`}
                    className={`flex gap-2 rounded-xl px-sm py-sm transition-all duration-300 ease-in-out animate-in fade-in-0 slide-in-from-left-2 ${taskRowBgHover} cursor-pointer border border-solid border-transparent ${
                      task.status === TaskStatus.COMPLETED
                        ? 'hover:border-ds-border-status-completed-subtle-focus'
                        : task.status === TaskStatus.FAILED
                          ? 'hover:border-ds-border-status-error-subtle-focus'
                          : task.status === TaskStatus.RUNNING
                            ? 'hover:border-ds-border-neutral-subtle-default'
                            : task.status === TaskStatus.BLOCKED
                              ? 'hover:border-ds-border-status-blocked-subtle-focus'
                              : 'hover:border-ds-border-neutral-subtle-focus'
                    } ${
                      selectedTask?.id === task.id
                        ? task.status === TaskStatus.COMPLETED
                          ? '!border-ds-border-status-completed-subtle-focus'
                          : task.status === TaskStatus.FAILED
                            ? '!border-ds-border-status-error-subtle-focus'
                            : task.status === TaskStatus.RUNNING
                              ? '!border-ds-border-neutral-subtle-focus'
                              : task.status === TaskStatus.BLOCKED
                                ? '!border-ds-border-status-blocked-subtle-focus'
                                : task.status === TaskStatus.SKIPPED ||
                                    task.status === TaskStatus.WAITING ||
                                    task.status === TaskStatus.EMPTY
                                  ? '!border-ds-border-status-pending-default-hover'
                                  : '!border-ds-border-neutral-subtle-focus'
                        : 'border-transparent'
                    }`}
                  >
                    <div className="">
                      {task.reAssignTo ? (
                        //  reassign to other agent
                        <CircleSlash2
                          size={16}
                          className="text-ds-icon-status-blocked-default-default"
                        />
                      ) : (
                        // normal task
                        <>
                          {task.status === TaskStatus.RUNNING && (
                            <LoaderCircle
                              size={16}
                              className={`text-ds-icon-status-running-default-default ${
                                chatStore.tasks[
                                  chatStore.activeTaskId as string
                                ].status === ChatTaskStatus.RUNNING &&
                                'animate-spin'
                              }`}
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
                              className="text-ds-icon-status-blocked-default-default"
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
                    <div className="flex flex-1 flex-col items-start justify-center">
                      <div
                        className={`w-full flex-grow-0 ${taskTextClass} pointer-events-auto select-text whitespace-pre-line text-wrap break-all text-xs font-medium leading-13`}
                      >
                        <div className="flex items-center gap-sm">
                          <div
                            className={`text-xs font-bold leading-13 ${taskTextClass}`}
                          >
                            No. {getTaskId(task.id)}
                          </div>
                          {task.reAssignTo ? (
                            <div className="rounded-lg bg-ds-bg-document-subtle-default px-1 py-0.5 text-xs font-bold leading-none text-ds-text-document-default-default hover:bg-ds-bg-document-subtle-hover">
                              Reassigned to {task.reAssignTo}
                            </div>
                          ) : (
                            (task.failure_count ?? 0) > 0 && (
                              <div
                                className={`${
                                  task.status === TaskStatus.FAILED
                                    ? 'bg-ds-bg-status-error-subtle-default text-ds-text-status-error-default-default hover:bg-ds-bg-status-error-subtle-hover'
                                    : task.status === TaskStatus.COMPLETED
                                      ? 'bg-ds-bg-neutral-subtle-default text-ds-text-status-completed-default-default'
                                      : 'bg-ds-bg-neutral-subtle-default text-ds-text-neutral-default-default hover:bg-ds-bg-neutral-subtle-hover'
                                } rounded-lg px-1 py-0.5 text-xs font-bold leading-none`}
                              >
                                Attempt {task.failure_count}
                              </div>
                            )
                          )}
                        </div>
                        <div>{task.content}</div>
                      </div>
                      {task?.status === TaskStatus.RUNNING && (
                        <div className="duration-400 mt-xs flex items-center gap-2 animate-in fade-in-0 slide-in-from-bottom-2">
                          {/* active toolkit */}
                          {lastActiveToolkit?.toolkitStatus ===
                            AgentStatusValue.RUNNING && (
                            <div className="flex min-w-0 flex-1 items-center justify-start gap-sm duration-300 animate-in fade-in-0 slide-in-from-right-2">
                              {getToolkitIcon(
                                lastActiveToolkit.toolkitName ?? ''
                              )}
                              <div
                                className={`${
                                  chatStore.tasks[
                                    chatStore.activeTaskId as string
                                  ].activeWorkspace
                                    ? '!w-[100px]'
                                    : '!w-[500px]'
                                } min-w-0 flex-shrink-0 flex-grow-0 overflow-hidden text-ellipsis whitespace-nowrap pt-1 text-xs leading-17 text-ds-text-status-running-default-default`}
                              >
                                <ShinyText
                                  text={task.toolkits?.[0].toolkitName}
                                  className="pointer-events-auto w-full select-text overflow-hidden text-ellipsis whitespace-nowrap text-xs font-bold leading-17 text-ds-text-status-running-default-default"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              key="log-panel"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ duration: 0.3, ease: 'easeIn' }}
              className="flex w-[342px] shrink-0 flex-col gap-sm overflow-hidden rounded-r-xl bg-ds-bg-neutral-subtle-default py-2 pl-sm"
            >
              <div
                ref={logRef}
                onWheel={(e) => {
                  e.stopPropagation();
                }}
                className="scrollbar scrollbar-always-visible max-h-[calc(100vh-200px)] overflow-y-scroll rounded-xl pr-sm"
              >
                <AnimatePresence mode="wait">
                  {selectedTask && (
                    <motion.div
                      key={selectedTask.id}
                      initial={{ opacity: 0, x: -16 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -16 }}
                      transition={{ duration: 0.25, ease: 'easeIn' }}
                      className="flex w-full flex-col gap-sm"
                    >
                      <TaskLogPanelContent
                        selectedTask={selectedTask}
                        chatStore={chatStore}
                        isEditMode={data.isEditMode}
                        reportRef={rePortRef}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
      <Handle
        className="!h-0 !min-h-0 !w-0 !min-w-0 opacity-0"
        type="source"
        position={Position.Bottom}
        id="bottom"
      />
    </>
  ) : (
    <div>Loading...</div>
  );
}
