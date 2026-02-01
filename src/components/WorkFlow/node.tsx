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
import { useAuthStore, useWorkerList } from '@/store/authStore';
import { TooltipContent } from '@radix-ui/react-tooltip';
import { Handle, NodeResizer, Position, useReactFlow } from '@xyflow/react';
import {
  Bird,
  Bot,
  Circle,
  CircleCheckBig,
  CircleSlash,
  CircleSlash2,
  CodeXml,
  Ellipsis,
  FileText,
  Globe,
  Image,
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
import { Tooltip, TooltipTrigger } from '../ui/tooltip';
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

  const filterTasks = useMemo(() => {
    const tasks = data.agent?.tasks || [];

    if (selectedState === 'all') {
      return tasks;
    } else {
      return tasks.filter((task) => {
        switch (selectedState) {
          case 'done':
            return task.status === 'completed' && !task.reAssignTo;
          case 'reassigned':
            return !!task.reAssignTo;
          case 'ongoing':
            return (
              task.status !== 'failed' &&
              task.status !== 'completed' &&
              task.status !== 'skipped' &&
              task.status !== 'waiting' &&
              task.status !== '' &&
              !task.reAssignTo
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
  }, [selectedState, data.agent?.tasks]);

  //Get Chatstore for the active project's task
  const { chatStore } = useChatStoreAdapter();
  const { getNode, setViewport, setNodes } = useReactFlow();
  const workerList = useWorkerList();
  const { setWorkerList } = useAuthStore();
  const nodeRef = useRef<HTMLDivElement>(null);
  const lastAutoExpandedTaskIdRef = useRef<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const rePortRef = useRef<HTMLDivElement>(null);
  const [shouldScroll, setShouldScroll] = useState(false);
  const [toolsHeight, setToolsHeight] = useState(0);

  // Sync isExpanded from props, but allow local modifications
  // Use a ref to track the last synced value to avoid unnecessary updates
  const lastSyncedIsExpandedRef = useRef(data.isExpanded);

  useEffect(() => {
    // Only sync if the prop actually changed and differs from current state
    if (
      data.isExpanded !== lastSyncedIsExpandedRef.current &&
      data.isExpanded !== isExpanded
    ) {
      lastSyncedIsExpandedRef.current = data.isExpanded;
      // Use setTimeout to defer the state update and avoid cascading renders
      setTimeout(() => {
        setIsExpanded(data.isExpanded);
      }, 0);
    }
  }, [data.isExpanded, isExpanded]);

  // Auto-expand when a task is running with toolkits
  const tasks = useMemo(() => data.agent?.tasks || [], [data.agent?.tasks]);
  const runningTask = tasks.find((t) => t.status === 'running');
  const runningTaskId = runningTask?.id;
  const runningTaskToolkitsLength = runningTask?.toolkits?.length;

  useEffect(() => {
    // Find running task with active toolkits
    const runningTaskWithToolkits = tasks.find(
      (task) =>
        task.status === 'running' && task.toolkits && task.toolkits.length > 0
    );

    // Reset tracking when no tasks are running
    const hasRunningTasks = tasks.some((task) => task.status === 'running');
    if (!hasRunningTasks && lastAutoExpandedTaskIdRef.current) {
      lastAutoExpandedTaskIdRef.current = null;
    }

    // Auto-expand for new running task
    if (
      runningTaskWithToolkits &&
      runningTaskWithToolkits.id !== lastAutoExpandedTaskIdRef.current
    ) {
      // Use setTimeout to defer state updates and avoid cascading renders
      setTimeout(() => {
        // Always select the new task
        setSelectedTask(runningTaskWithToolkits);

        // Expand if not already expanded
        if (!isExpanded) {
          setIsExpanded(true);
          data.onExpandChange(id, true);
        }
      }, 0);

      lastAutoExpandedTaskIdRef.current = runningTaskWithToolkits.id;
    }
  }, [
    tasks,
    tasks.length,
    runningTaskId,
    runningTaskToolkitsLength,
    id,
    data.onExpandChange,
    isExpanded,
    data,
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

  const activeTaskId = chatStore?.activeTaskId as string;
  const activeAgent = chatStore?.tasks[activeTaskId]?.activeAgent;

  useEffect(() => {
    if (!chatStore) return;
    if (activeAgent === id) {
      const node = getNode(id);
      if (node) {
        setTimeout(() => {
          setViewport(
            { x: -node.position.x, y: 0, zoom: 1 },
            {
              duration: 500,
            }
          );
        }, 100);
      }
    }
  }, [chatStore, activeTaskId, activeAgent, id, getNode, setViewport]);

  useEffect(() => {
    if (wrapperRef.current) {
      const { scrollHeight, clientHeight } = wrapperRef.current;
      setShouldScroll(scrollHeight > clientHeight);
    }
  }, [data.agent?.tasks, toolsHeight]);

  // dynamically calculate tool label height
  useEffect(() => {
    if (toolsRef.current) {
      const height = toolsRef.current.offsetHeight;
      setToolsHeight(height);
    }
  }, [data.agent?.tools]);

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
  }, [
    wheelHandler,
    isExpanded,
    selectedTask,
    selectedTask?.report?.rePort?.content,
  ]);

  if (!chatStore) {
    return <div>Loading...</div>;
  }

  const handleShowLog = () => {
    if (!isExpanded) {
      setSelectedTask(
        data.agent?.tasks.find((task) => task.status === 'running') ||
          data.agent?.tasks[0]
      );
    }
    setIsExpanded(!isExpanded);
    data.onExpandChange(id, !isExpanded);
  };

  const agentMap = {
    developer_agent: {
      name: 'Developer Agent',
      icon: <CodeXml size={16} className="text-text-primary" />,
      textColor: 'text-text-developer',
      bgColor: 'bg-bg-fill-coding-active',
      shapeColor: 'bg-bg-fill-coding-default',
      borderColor: 'border-bg-fill-coding-active',
      bgColorLight: 'bg-emerald-200',
    },
    browser_agent: {
      name: 'Browser Agent',
      icon: <Globe size={16} className="text-text-primary" />,
      textColor: 'text-blue-700',
      bgColor: 'bg-bg-fill-browser-active',
      shapeColor: 'bg-bg-fill-browser-default',
      borderColor: 'border-bg-fill-browser-active',
      bgColorLight: 'bg-blue-200',
    },
    document_agent: {
      name: 'Document Agent',
      icon: <FileText size={16} className="text-text-primary" />,
      textColor: 'text-yellow-700',
      bgColor: 'bg-bg-fill-writing-active',
      shapeColor: 'bg-bg-fill-writing-default',
      borderColor: 'border-bg-fill-writing-active',
      bgColorLight: 'bg-yellow-200',
    },
    multi_modal_agent: {
      name: 'Multi Modal Agent',
      icon: <Image size={16} className="text-text-primary" />,
      textColor: 'text-fuchsia-700',
      bgColor: 'bg-bg-fill-multimodal-active',
      shapeColor: 'bg-bg-fill-multimodal-default',
      borderColor: 'border-bg-fill-multimodal-active',
      bgColorLight: 'bg-fuchsia-200',
    },
    social_media_agent: {
      name: 'Social Media Agent',
      icon: <Bird size={16} className="text-text-primary" />,
      textColor: 'text-purple-700',
      bgColor: 'bg-violet-700',
      shapeColor: 'bg-violet-300',
      borderColor: 'border-violet-700',
      bgColorLight: 'bg-purple-50',
    },
  };

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
  return (
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
      <div
        ref={nodeRef}
        className={`${
          data.isEditMode
            ? `w-full ${isExpanded ? 'min-w-[560px]' : 'min-w-[342px]'}`
            : isExpanded
              ? 'w-[684px]'
              : 'w-[342px]'
        } ${
          data.isEditMode ? 'h-full' : 'max-h-[calc(100vh-200px)]'
        } flex overflow-hidden rounded-xl border border-solid border-worker-border-default bg-worker-surface-primary ${
          chatStore.tasks[chatStore.activeTaskId as string].activeAgent === id
            ? `${agentMap[data.type]?.borderColor} z-50`
            : 'z-10 border-worker-border-default'
        } transition-all duration-300 ease-in-out ${
          (data.agent?.tasks?.length ?? 0) === 0 && 'opacity-30'
        }`}
      >
        <div
          className={`flex flex-col px-3 py-2 pr-0 ${
            data.isEditMode ? 'min-w-[342px] flex-1' : 'w-[342px]'
          }`}
        >
          <div className="flex items-center justify-between gap-sm pr-3">
            <div className="flex items-center justify-between gap-md">
              <div
                className={`text-base font-bold leading-relaxed ${
                  agentMap[data.type]?.textColor
                }`}
              >
                {agentMap[data.type]?.name || data.agent?.name}
              </div>
            </div>
            <div className="flex items-center gap-xs">
              <Button onClick={handleShowLog} variant="ghost" size="icon">
                {isExpanded ? <SquareChevronLeft /> : <SquareCode />}
              </Button>
              {!Object.keys(agentMap).find((key) => key === data.type) &&
                chatStore.tasks[chatStore.activeTaskId as string].messages
                  .length === 0 && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        onClick={(e) => e.stopPropagation()}
                        variant="ghost"
                        size="icon"
                      >
                        <Ellipsis />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[98px] rounded-[12px] border border-solid border-dropdown-border bg-dropdown-bg p-sm">
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
            className="mb-sm min-h-4 flex-shrink-0 pr-3 text-xs font-normal leading-tight text-text-label"
          >
            {/* {JSON.stringify(data.agent)} */}
            {agentToolkits[
              data.agent?.type as keyof typeof agentToolkits
            ]?.join(' ') ||
              data.agent?.tools
                ?.map((tool) => (tool ? '# ' + tool.replace(/_/g, ' ') : ''))
                .filter(Boolean)
                .join(' ') ||
              'No Toolkits'}
          </div>
          <div
            className="max-h-[180px]"
            onClick={() => {
              chatStore.setActiveWorkSpace(
                chatStore.activeTaskId as string,
                data.agent?.agent_id as string
              );

              window.electronAPI.hideAllWebview();
            }}
          >
            {/* {data.img.length} */}
            {data.img && data.img.filter((img) => img?.img).length > 0 && (
              <div className="relative flex h-[180px] max-w-[260px] flex-wrap items-center justify-start gap-1 overflow-hidden">
                {data.img
                  .filter((img) => img?.img)
                  .slice(0, 4)
                  .map(
                    (img, index) =>
                      img.img && (
                        <img
                          key={index}
                          className={`${
                            data.img.length === 1
                              ? 'flex-1'
                              : data.img.length === 2
                                ? 'h-full max-w-[calc(50%-8px)]'
                                : 'h-[calc(50%-8px)] max-w-[calc(50%-8px)]'
                          } min-w-[calc(50%-8px)] rounded-sm object-cover`}
                          src={img.img}
                          alt={data.type}
                        />
                      )
                  )}
              </div>
            )}
            {data.type === 'document_agent' &&
              data?.agent?.tasks &&
              data.agent.tasks.length > 0 && (
                <div className="relative h-[180px] w-full overflow-hidden rounded-sm">
                  <div className="absolute left-0 top-0 h-[500px] w-[500px] origin-top-left scale-[0.3]">
                    <Folder data={data.agent as Agent} />
                  </div>
                </div>
              )}

            {data.type === 'developer_agent' &&
              data?.agent?.tasks &&
              data?.agent?.tasks?.filter(
                (task) => task.terminal && task.terminal.length > 0
              )?.length > 0 && (
                <div className="relative flex h-[180px] w-full flex-wrap items-center justify-start gap-1 overflow-hidden">
                  {data.agent?.tasks
                    .filter((task) => task.terminal && task.terminal.length > 0)
                    .slice(0, 4)
                    .map((task) => {
                      return (
                        <div
                          key={task.id}
                          className={`${
                            data.agent?.tasks.filter(
                              (task) =>
                                task.terminal && task.terminal.length > 0
                            ).length === 1
                              ? 'h-full min-w-full'
                              : 'h-[calc(50%-8px)] min-w-[calc(50%-8px)]'
                          } relative flex-1 overflow-hidden rounded-sm object-cover`}
                        >
                          <div className="absolute left-0 top-0 h-[500px] w-[800px] origin-top-left scale-x-[0.4] scale-y-[0.3]">
                            <Terminal content={task.terminal} />
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
          </div>
          {data.agent?.tasks && data.agent?.tasks.length > 0 && (
            <div className="flex flex-col items-start justify-between gap-1 border-[0px] border-t border-solid border-task-border-default pr-3 pt-sm">
              {/* <div className="font-bold leading-tight text-xs">Subtasks</div> */}
              <div className="flex flex-1 justify-end">
                <TaskState
                  all={data.agent.tasks?.length || 0}
                  done={
                    data.agent?.tasks?.filter(
                      (task) => task.status === 'completed' && !task.reAssignTo
                    ).length || 0
                  }
                  reAssignTo={
                    data.agent.tasks?.filter((task) => task.reAssignTo)
                      ?.length || 0
                  }
                  progress={
                    data.agent?.tasks?.filter(
                      (task) =>
                        task.status !== 'failed' &&
                        task.status !== 'completed' &&
                        task.status !== 'skipped' &&
                        task.status !== 'waiting' &&
                        task.status !== '' &&
                        !task.reAssignTo
                    ).length || 0
                  }
                  skipped={
                    data.agent?.tasks?.filter(
                      (task) =>
                        (task.status === 'skipped' ||
                          task.status === 'waiting' ||
                          task.status === '') &&
                        !task.reAssignTo
                    ).length || 0
                  }
                  failed={
                    data.agent?.tasks?.filter(
                      (task) => task.status === 'failed'
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
            className={`scrollbar mt-sm flex flex-col gap-2 overflow-y-auto pr-3 duration-500 ease-out animate-in fade-in-0 slide-in-from-bottom-4 ${
              shouldScroll && 'scrollbar !overflow-y-scroll'
            }`}
            style={{
              maxHeight:
                data.img && data.img.length > 0
                  ? `calc(100vh - 200px - 180px - 60px - ${toolsHeight}px)`
                  : `calc(100vh - 200px - 60px - ${toolsHeight}px)`,
            }}
          >
            {data.agent?.tasks &&
              filterTasks.map((task) => {
                return (
                  <div
                    onClick={() => {
                      setSelectedTask(task);
                      setIsExpanded(true);
                      data.onExpandChange(id, true);
                      if (task.agent) {
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
                    key={`taskList-${task.id}-${task.failure_count}`}
                    className={`flex gap-2 rounded-lg px-sm py-sm transition-all duration-300 ease-in-out animate-in fade-in-0 slide-in-from-left-2 ${
                      task.reAssignTo
                        ? 'bg-task-fill-warning'
                        : task.status === 'completed'
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
                    } ${
                      selectedTask?.id === task.id
                        ? task.status === 'completed'
                          ? '!border-bg-fill-success-primary'
                          : task.status === 'failed'
                            ? '!border-text-cuation-primary'
                            : task.status === 'running'
                              ? '!border-border-primary'
                              : task.status === 'blocked'
                                ? '!border-text-warning-primary'
                                : 'border-transparent'
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
                          {task.status === 'running' && (
                            <LoaderCircle
                              size={16}
                              className={`text-icon-information ${
                                chatStore.tasks[
                                  chatStore.activeTaskId as string
                                ].status === 'running' && 'animate-spin'
                              }`}
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
                          {(task.status === '' ||
                            task.status === 'waiting') && (
                            <Circle size={16} className="text-slate-400" />
                          )}
                        </>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col items-start justify-center">
                      <div
                        className={`w-full flex-grow-0 ${
                          task.status === 'failed'
                            ? 'text-text-cuation-default'
                            : task.status === 'blocked'
                              ? 'text-text-body'
                              : 'text-text-primary'
                        } pointer-events-auto select-text whitespace-pre-line text-wrap break-all text-xs font-medium leading-13`}
                      >
                        <div className="flex items-center gap-sm">
                          <div className="text-xs font-bold leading-13 text-text-body">
                            No. {getTaskId(task.id)}
                          </div>
                          {task.reAssignTo ? (
                            <div className="rounded-lg bg-tag-fill-document px-1 py-0.5 text-xs font-bold leading-none text-text-warning">
                              Reassigned to {task.reAssignTo}
                            </div>
                          ) : (
                            (task.failure_count ?? 0) > 0 && (
                              <div
                                className={`${
                                  task.status === 'failed'
                                    ? 'bg-red-100 text-text-cuation'
                                    : task.status === 'completed'
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
                      {task?.status === 'running' && (
                        <div className="duration-400 mt-xs flex items-center gap-2 animate-in fade-in-0 slide-in-from-bottom-2">
                          {/* active toolkit */}
                          {task.toolkits &&
                            task.toolkits.length > 0 &&
                            task.toolkits
                              .filter(
                                (tool: any) => tool.toolkitName !== 'notice'
                              )
                              .at(-1)?.toolkitStatus === 'running' && (
                              <div className="flex min-w-0 flex-1 items-center justify-start gap-sm duration-300 animate-in fade-in-0 slide-in-from-right-2">
                                {agentMap[data.type]?.icon ?? (
                                  <Bot className="h-3 w-3" />
                                )}
                                <div
                                  className={`${
                                    chatStore.tasks[
                                      chatStore.activeTaskId as string
                                    ].activeWorkSpace
                                      ? '!w-[100px]'
                                      : '!w-[500px]'
                                  } text-text-primary min-w-0 flex-shrink-0 flex-grow-0 overflow-hidden text-ellipsis whitespace-nowrap pt-1 text-xs leading-17`}
                                >
                                  <ShinyText
                                    text={task.toolkits?.[0].toolkitName}
                                    className="text-text-primary pointer-events-auto w-full select-text overflow-hidden text-ellipsis whitespace-nowrap text-xs font-bold leading-17"
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
        {isExpanded && (
          <div
            key={selectedTask?.id || 'empty'}
            className={`${
              data.isEditMode ? 'flex-1' : 'w-[342px]'
            } flex flex-col gap-sm rounded-r-xl border-l bg-worker-surface-secondary px-sm py-3 pr-0 pt-sm duration-300 animate-in fade-in-0 slide-in-from-right-2`}
          >
            <div
              ref={logRef}
              key={selectedTask?.id + '-log' || 'empty'}
              onWheel={(e) => {
                e.stopPropagation();
              }}
              className="scrollbar scrollbar-gutter-stable my-2 flex max-h-[calc(100vh-200px)] flex-col gap-sm overflow-y-auto pr-sm"
            >
              {selectedTask &&
                selectedTask.toolkits &&
                selectedTask.toolkits.length > 0 &&
                selectedTask.toolkits.map((toolkit: any, index: number) => (
                  <div key={`toolkit-${toolkit.toolkitId}`}>
                    {toolkit.toolkitName === 'notice' ? (
                      <div
                        key={`notice-${index}`}
                        className="flex !w-[calc(100%-10px)] flex-col gap-sm py-2 pl-1"
                      >
                        <MarkDown
                          content={toolkit?.message}
                          enableTypewriter={false}
                          pTextSize="text-[10px]"
                          olPadding="pl-0"
                        />
                      </div>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            key={`toolkit-${index}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (toolkit.toolkitMethods === 'write to file') {
                                chatStore.tasks[
                                  chatStore.activeTaskId as string
                                ].activeWorkSpace = 'documentWorkSpace';
                              } else if (
                                toolkit.toolkitMethods === 'visit page'
                              ) {
                                const parts = toolkit.message.split('\n');
                                const url = parts[0]; // the first line is the URL
                                window.location.href = url;
                              } else if (toolkit.toolkitMethods === 'scrape') {
                                window.location.href = toolkit.message;
                              }
                            }}
                            className="flex items-start gap-xs rounded-sm bg-log-default px-xs py-0.5 transition-all duration-300 hover:opacity-50"
                          >
                            {/* {toolkit.toolkitStatus} */}
                            <div>
                              {toolkit.toolkitStatus === 'running' ? (
                                <LoaderCircle
                                  size={16}
                                  className={`${
                                    chatStore.tasks[
                                      chatStore.activeTaskId as string
                                    ].status === 'running' && 'animate-spin'
                                  }`}
                                />
                              ) : (
                                agentMap[data.type]?.icon
                              )}
                            </div>
                            <div className="pointer-events-auto flex flex-1 select-text flex-col items-start overflow-hidden">
                              <span className="text-text-primary flex items-center gap-sm text-nowrap text-xs font-bold">
                                {toolkit.toolkitName}
                              </span>
                              <div className="flex max-w-full flex-1 items-start gap-sm">
                                <div className="text-text-primary flex flex-1 items-center gap-sm text-xs font-medium">
                                  <div className="text-nowrap font-bold">
                                    {toolkit.toolkitMethods}
                                  </div>

                                  <div
                                    className={`text-text-primary text-xs ${
                                      data.isEditMode
                                        ? 'max-h-[15px] overflow-hidden'
                                        : 'overflow-hidden text-ellipsis whitespace-nowrap'
                                    }`}
                                  >
                                    {toolkit.message}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </TooltipTrigger>
                        {toolkit.message && (
                          <TooltipContent
                            align="start"
                            className="scrollbar pointer-events-auto !fixed z-[9999] max-h-[200px] w-[200px] select-text overflow-y-auto text-wrap break-words rounded-sm border border-solid border-task-border-default bg-white-100% p-2 text-xs"
                            side="left"
                            sideOffset={200}
                          >
                            <MarkDown
                              content={toolkit.message}
                              enableTypewriter={false}
                              pTextSize="text-[10px]"
                              olPadding="pl-0"
                            />
                          </TooltipContent>
                        )}
                      </Tooltip>
                    )}
                  </div>
                ))}
              {selectedTask?.report && (
                <div
                  ref={rePortRef}
                  onWheel={(e) => {
                    e.stopPropagation();
                  }}
                  className="my-2 flex w-full flex-col gap-sm"
                >
                  <div className="text-text-primary text-sm font-bold">
                    Completion Report
                  </div>
                  <MarkDown
                    content={selectedTask?.report}
                    enableTypewriter={false}
                    pTextSize="text-[10px]"
                    olPadding="pl-0"
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <Handle
        className="!h-0 !min-h-0 !w-0 !min-w-0 opacity-0"
        type="source"
        position={Position.Bottom}
        id="bottom"
      />
    </>
  );
}
