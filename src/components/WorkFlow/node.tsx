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
  Copy,
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
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { agentMap } from './agents';
import { MarkDown } from './MarkDown';

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

  const wheelHandler = useCallback((e: WheelEvent) => {
    e.stopPropagation();
  }, []);

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

  const agentToolkits = {
    developer_agent: [
      '# Terminal & Shell ',
      '# Web Deployment ',
      '# Screen Capture ',
    ],
    browser_agent: ['# Web Browser ', '# Search Engines '],
    multi_modal_agent: [
      '# Image Analysis ',
      '# Video Processing ',
      '# Audio Processing ',
      '# Image Generation ',
    ],
    document_agent: [
      '# File Management ',
      '# Data Processing ',
      '# Document Creation ',
    ],
  };

  const getTaskId = (taskId: string) => {
    const list = taskId.split('.');
    let idStr = '';
    list.shift();
    list.map((i: string, index: number) => {
      idStr += Number(i) + (index === list.length - 1 ? '' : '.');
    });
    return idStr;
  };

  const customToolkits =
    data.agent?.tools
      ?.map((tool) => (tool ? '# ' + tool.replace(/_/g, ' ') : ''))
      .filter(Boolean) || [];
  const toolkitLabels =
    agentToolkits[data.agent?.type as keyof typeof agentToolkits] ||
    (customToolkits.length > 0 ? customToolkits : ['No Toolkits']);
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
        } rounded-xl border-worker-border-default bg-worker-surface-primary flex overflow-hidden border border-solid ${
          getCurrentTask()?.activeAgent === id
            ? `${agentMap[data.type]?.borderColor} z-50`
            : 'border-worker-border-default z-10'
        } ease-in-out transition-all duration-300 ${
          (data.agent?.tasks?.length ?? 0) === 0 && 'opacity-30'
        }`}
      >
        <div className="border-border-secondary flex w-[342px] shrink-0 flex-col border-y-0 border-r-[0.5px] border-l-0 border-solid">
          <div className="gap-sm px-3 pb-1 pt-2 flex items-center justify-between">
            <div className="gap-md flex items-center justify-between">
              <div
                className={`text-base font-bold leading-relaxed ${
                  agentMap[data.type]?.textColor
                }`}
              >
                {agentMap[data.type]?.name || data.agent?.name}
              </div>
            </div>
            <div className="gap-xs flex items-center">
              <Button
                onClick={handleShowLog}
                variant="ghost"
                size="xs"
                buttonContent="icon-only"
              >
                {isExpanded ? <SquareChevronLeft /> : <SquareCode />}
              </Button>
              {!Object.keys(agentMap).find((key) => key === data.type) &&
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
                    <PopoverContent className="border-dropdown-border bg-dropdown-bg p-sm w-[98px] rounded-[12px] border border-solid">
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
                            className="gap-2 w-full justify-start"
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
                              className="text-icon-primary group-hover:text-icon-cuation"
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
          <div
            ref={toolsRef}
            className="mb-sm min-h-4 px-3 text-xs font-normal leading-tight text-text-label flex flex-shrink-0 flex-wrap"
          >
            {/* {JSON.stringify(data.agent)} */}
            {toolkitLabels.map((toolkit, index) => (
              <span key={index} className="mr-2">
                {toolkit}
              </span>
            ))}
          </div>
          <div
            className="px-3 mb-2 max-h-[180px]"
            onClick={() => {
              chatStore.setActiveWorkspace(
                chatStore.activeTaskId as string,
                data.agent?.agent_id as string
              );

              window.electronAPI.hideAllWebview();
            }}
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
                      alt={data.type}
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
            {data.type === 'document_agent' &&
              data?.agent?.tasks &&
              data.agent.tasks.length > 0 && (
                <div className="rounded-sm relative h-[180px] w-full overflow-hidden">
                  <div className="left-0 top-0 absolute h-[500px] w-[900px] origin-top-left scale-[0.36]">
                    <Folder data={data.agent as Agent} />
                  </div>
                </div>
              )}

            {data.type === 'developer_agent' && terminalTasks.length > 0 && (
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
          {data.agent?.tasks && data.agent?.tasks.length > 0 && (
            <div className="gap-1 border-task-border-default px-3 py-sm flex flex-col items-start justify-between border-[0px] border-t border-solid">
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
            className="scrollbar scrollbar-always-visible gap-2 px-3 pb-2 ease-out animate-in fade-in-0 slide-in-from-bottom-4 flex flex-col overflow-y-auto duration-500"
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
                        window.electronAPI.hideAllWebview();
                      }
                    }}
                    key={`taskList-${task.id}-${task.failure_count}`}
                    className={`gap-2 rounded-xl px-sm py-sm ease-in-out animate-in fade-in-0 slide-in-from-left-2 flex transition-all duration-300 ${
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
                                : 'bg-task-fill-running'
                    } cursor-pointer border border-solid border-transparent ${
                      task.status === TaskStatus.COMPLETED
                        ? 'hover:border-task-border-focus-success'
                        : task.status === TaskStatus.FAILED
                          ? 'hover:border-task-border-focus-error'
                          : task.status === TaskStatus.RUNNING
                            ? 'hover:border-border-primary'
                            : task.status === TaskStatus.BLOCKED
                              ? 'hover:border-task-border-focus-warning'
                              : 'hover:border-task-border-focus'
                    } ${
                      selectedTask?.id === task.id
                        ? task.status === TaskStatus.COMPLETED
                          ? '!border-task-border-focus-success'
                          : task.status === TaskStatus.FAILED
                            ? '!border-task-border-focus-error'
                            : task.status === TaskStatus.RUNNING
                              ? '!border-border-primary'
                              : task.status === TaskStatus.BLOCKED
                                ? '!border-task-border-focus-warning'
                                : '!border-task-border-focus'
                        : 'border-transparent'
                    }`}
                  >
                    <div className="">
                      {task.reAssignTo ? (
                        //  reassign to other agent
                        <CircleSlash2 size={16} className="text-icon-warning" />
                      ) : (
                        // normal task
                        <>
                          {task.status === TaskStatus.RUNNING && (
                            <LoaderCircle
                              size={16}
                              className={`text-icon-information ${
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
                              className={`text-icon-secondary`}
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
                    <div className="flex flex-1 flex-col items-start justify-center">
                      <div
                        className={`w-full flex-grow-0 ${
                          task.status === TaskStatus.FAILED
                            ? 'text-text-cuation-default'
                            : task.status === TaskStatus.BLOCKED
                              ? 'text-text-body'
                              : 'text-text-primary'
                        } text-xs font-medium leading-13 pointer-events-auto text-wrap break-all whitespace-pre-line select-text`}
                      >
                        <div className="gap-sm flex items-center">
                          <div className="text-xs font-bold leading-13 text-text-body">
                            No. {getTaskId(task.id)}
                          </div>
                          {task.reAssignTo ? (
                            <div className="rounded-lg bg-tag-fill-document px-1 py-0.5 text-xs font-bold text-text-warning leading-none">
                              Reassigned to {task.reAssignTo}
                            </div>
                          ) : (
                            (task.failure_count ?? 0) > 0 && (
                              <div
                                className={`${
                                  task.status === TaskStatus.FAILED
                                    ? 'bg-surface-error-subtle text-text-cuation'
                                    : task.status === TaskStatus.COMPLETED
                                      ? 'text-text-success-default bg-tag-fill-developer'
                                      : 'bg-tag-surface-hover text-text-label'
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
                        <div className="mt-xs gap-2 animate-in fade-in-0 slide-in-from-bottom-2 flex items-center duration-400">
                          {/* active toolkit */}
                          {lastActiveToolkit?.toolkitStatus ===
                            AgentStatusValue.RUNNING && (
                            <div className="min-w-0 gap-sm animate-in fade-in-0 slide-in-from-right-2 flex flex-1 items-center justify-start duration-300">
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
                                } min-w-0 pt-1 text-xs leading-17 text-text-primary flex-shrink-0 flex-grow-0 overflow-hidden text-ellipsis whitespace-nowrap`}
                              >
                                <ShinyText
                                  text={task.toolkits?.[0].toolkitName}
                                  className="text-xs font-bold leading-17 text-text-primary pointer-events-auto w-full overflow-hidden text-ellipsis whitespace-nowrap select-text"
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
              className="gap-sm rounded-r-xl bg-worker-surface-secondary py-2 pl-sm flex w-[342px] shrink-0 flex-col overflow-hidden"
            >
              <div
                ref={logRef}
                onWheel={(e) => {
                  e.stopPropagation();
                }}
                className="scrollbar scrollbar-always-visible pr-sm max-h-[calc(100vh-200px)] overflow-y-scroll"
              >
                <AnimatePresence mode="wait">
                  {selectedTask && (
                    <motion.div
                      key={selectedTask.id}
                      initial={{ opacity: 0, x: -16 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -16 }}
                      transition={{ duration: 0.25, ease: 'easeIn' }}
                      className="gap-sm flex w-full flex-col"
                    >
                      {selectedTask.toolkits &&
                        selectedTask.toolkits.length > 0 &&
                        selectedTask.toolkits.map(
                          (toolkit: any, index: number) => (
                            <div key={`toolkit-${toolkit.toolkitId}`}>
                              {toolkit.toolkitName === 'notice' ? (
                                <div
                                  key={`notice-${index}`}
                                  className="gap-sm px-2 py-1 flex w-full flex-col"
                                >
                                  <MarkDown
                                    content={toolkit?.message}
                                    enableTypewriter={false}
                                    pTextSize="text-label-xs"
                                  />
                                </div>
                              ) : (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div
                                      key={`toolkit-${index}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (
                                          toolkit.toolkitMethods ===
                                          'write to file'
                                        ) {
                                          chatStore.tasks[
                                            chatStore.activeTaskId as string
                                          ].activeWorkspace =
                                            'documentWorkSpace';
                                        } else if (
                                          toolkit.toolkitMethods ===
                                          'visit page'
                                        ) {
                                          const parts =
                                            toolkit.message.split('\n');
                                          const url = parts[0]; // the first line is the URL
                                          window.location.href = url;
                                        } else if (
                                          toolkit.toolkitMethods === 'scrape'
                                        ) {
                                          window.location.href =
                                            toolkit.message;
                                        }
                                      }}
                                      className="gap-1 rounded-lg bg-log-default p-1 px-2 flex flex-col items-start justify-center transition-all duration-300 hover:opacity-50"
                                    >
                                      {/* first row: icon + toolkit name */}
                                      <div className="gap-sm flex w-full items-center justify-start">
                                        {toolkit.toolkitStatus ===
                                        AgentStatusValue.RUNNING ? (
                                          <LoaderCircle
                                            size={16}
                                            className={`${
                                              chatStore.tasks[
                                                chatStore.activeTaskId as string
                                              ].status ===
                                                ChatTaskStatus.RUNNING &&
                                              'animate-spin'
                                            }`}
                                          />
                                        ) : (
                                          getToolkitIcon(toolkit.toolkitName)
                                        )}
                                        <span className="gap-sm text-label-xs font-bold text-text-primary flex items-center text-nowrap">
                                          {toolkit.toolkitName}
                                        </span>
                                      </div>
                                      {/* second row: method + message */}
                                      <div className="gap-sm pl-6 pointer-events-auto flex w-full items-start justify-center overflow-hidden select-text">
                                        <div className="text-label-xs font-bold text-text-primary text-nowrap">
                                          {toolkit.toolkitMethods
                                            ? toolkit.toolkitMethods
                                                .charAt(0)
                                                .toUpperCase() +
                                              toolkit.toolkitMethods.slice(1)
                                            : ''}
                                        </div>
                                        <div
                                          className={`text-label-xs font-normal text-text-primary max-w-full flex-1 truncate ${
                                            data.isEditMode
                                              ? 'overflow-hidden'
                                              : 'truncate overflow-hidden'
                                          }`}
                                        >
                                          {toolkit.message}
                                        </div>
                                      </div>
                                    </div>
                                  </TooltipTrigger>
                                  {toolkit.message && (
                                    <TooltipContent
                                      align="start"
                                      className="scrollbar left-6 rounded-lg border-task-border-default bg-surface-tertiary p-2 text-label-xs pointer-events-auto !fixed z-[9999] max-h-[200px] w-max max-w-[296px] overflow-y-auto border border-solid text-wrap break-words select-text"
                                      side="bottom"
                                      sideOffset={4}
                                    >
                                      <MarkDown
                                        content={toolkit.message}
                                        enableTypewriter={false}
                                        pTextSize="text-label-xs"
                                        olPadding="pl-4"
                                      />
                                    </TooltipContent>
                                  )}
                                </Tooltip>
                              )}
                            </div>
                          )
                        )}
                      {selectedTask.report && (
                        <div
                          ref={rePortRef}
                          onWheel={(e) => {
                            e.stopPropagation();
                          }}
                          className="group my-2 rounded-lg bg-surface-primary relative flex w-full flex-col"
                        >
                          <div className="top-0 rounded-lg bg-surface-primary py-2 pl-2 pr-2 sticky z-10 flex items-center justify-between">
                            <div className="text-label-sm font-bold text-text-primary">
                              Completion Report
                            </div>
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={(e) => {
                                e.stopPropagation();
                                const reportText =
                                  typeof selectedTask?.report === 'string'
                                    ? selectedTask.report
                                    : '';
                                if (
                                  reportText &&
                                  navigator.clipboard?.writeText
                                ) {
                                  navigator.clipboard
                                    .writeText(reportText)
                                    .catch(() => {
                                      // silently fail if clipboard is unavailable
                                    });
                                }
                              }}
                              className="text-label-xs"
                            >
                              <Copy className="text-icon-secondary" />
                              <span className="text-icon-secondary">Copy</span>
                            </Button>
                          </div>
                          <div className="px-2 py-2">
                            <MarkDown
                              content={selectedTask?.report}
                              enableTypewriter={false}
                              pTextSize="text-label-xs"
                            />
                          </div>
                        </div>
                      )}
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
