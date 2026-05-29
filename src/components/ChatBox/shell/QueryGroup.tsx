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

import { inferSessionModeFromTask } from '@/lib/sessionMode';
import { VanillaChatStore } from '@/store/chatStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { AgentStep, ChatTaskStatus, SessionMode } from '@/types/constants';
import { motion } from 'framer-motion';
import { ChevronDown, FileText } from 'lucide-react';
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { AgentMessageCard } from '../messages/AgentMessageCard';
import { QuestionBlock } from '../messages/askBlocks/QuestionBlock';
import { TaskCompletionCard } from '../messages/TaskCompletionCard';
import { UserMessageCard } from '../messages/UserMessageCard';
import { NoticeCard } from '../notices/NoticeCard';
import {
  detectInputType,
  extractChoices,
} from '../renderSession/normalizeMessages';
import type { ChatQueryGroup } from '../renderSession/queryGroups';
import type { QuestionChatBlock } from '../renderSession/types';
import { PlanTaskBox } from '../TaskBox/PlanTaskBox';
import { isPlanSplittingPhase } from '../TaskBox/PlanTaskBox/utils';
import { TaskCard } from '../TaskBox/TaskCard';
import { PreparingToExecuteTasks } from '../taskLog/PreparingToExecuteTasks';
import { TaskWorkLogAccordion } from '../taskLog/TaskWorkLogAccordion';

/** Collapsible card that shows a single agent's result (workforce / non–single-agent turns). */
const AgentResultCard: React.FC<{
  id: string;
  agentName?: string;
  content: string;
  attaches?: any[];
  defaultOpen?: boolean;
}> = ({ id, agentName, content, attaches, defaultOpen = false }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const label = agentName || 'Agent';

  return (
    <div className="px-2 overflow-hidden">
      <button
        type="button"
        className="focus-visible:ring-ds-border-brand-default-focus/40 gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-ds-text-neutral-default-default hover:bg-ds-bg-neutral-default-hover active:bg-ds-bg-neutral-default-active flex w-full items-center text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
        onClick={() => setIsOpen((v) => !v)}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronDown
          size={14}
          aria-hidden
          className={`text-ds-icon-neutral-default-default shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : 'rotate-0'}`}
        />
      </button>

      <div
        className={`ease-in-out overflow-hidden transition-all duration-200 ${isOpen ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}`}
      >
        <div className="border-ds-border-neutral-default-default px-1 py-1 border-t">
          <AgentMessageCard
            id={id}
            content={content}
            typewriter={false}
            onTyping={() => {}}
            attaches={attaches}
          />
        </div>
      </div>
    </div>
  );
};

/** Typewriter only for the agent message currently being produced (latest agent row while task is running). */
function shouldUseLiveAgentTypewriter(
  task: {
    type?: string;
    delayTime?: number;
    status: string;
    messages: any[];
  } | null,
  messageId: string
): boolean {
  const replayAllows =
    task?.type !== 'replay' ||
    (task?.type === 'replay' && task?.delayTime !== 0);
  if (!replayAllows) return false;
  if (!task || task.status !== ChatTaskStatus.RUNNING) return false;
  const msgs = task.messages;
  if (!msgs.length) return false;
  const last = msgs[msgs.length - 1];
  return last.role === 'agent' && last.id === messageId;
}

interface QueryGroupProps {
  chatId: string;
  chatStore: VanillaChatStore;
  queryGroup: ChatQueryGroup;
  isActive: boolean;
  onQueryActive: (queryId: string | null) => void;
  index: number;
}

export const QueryGroup: React.FC<QueryGroupProps> = ({
  chatId,
  chatStore,
  queryGroup,
  isActive: _isActive,
  onQueryActive,
  index,
}) => {
  const groupRef = useRef<HTMLDivElement>(null);
  const taskBoxRef = useRef<HTMLDivElement>(null);
  const [_isTaskBoxSticky, setIsTaskBoxSticky] = useState(false);
  const [taskCompletionMarkdownReady, setTaskCompletionMarkdownReady] =
    useState(false);
  const [taskCompletionDismissed, setTaskCompletionDismissed] = useState(false);

  const chatState = chatStore.getState();
  // Scope all task-derived UI to this group's taskId, not chatState.activeTaskId.
  const activeTaskId = queryGroup.taskId;
  const activeProjectId = useProjectRuntimeStore(
    (state) => state.activeProjectId
  );
  const setActiveWorkspaceTab = usePageTabStore(
    (state) => state.setActiveWorkspaceTab
  );

  const completionEndMessage = queryGroup.outputMessages.find(
    (m: any) => m.step === AgentStep.END && m.content.length > 0
  );

  useEffect(() => {
    setTaskCompletionMarkdownReady(false);
    setTaskCompletionDismissed(false);
  }, [queryGroup.id, completionEndMessage?.id]);

  const onTaskCompletionMarkdownReady = useCallback(() => {
    setTaskCompletionMarkdownReady(true);
  }, []);

  const openFilePreview = useCallback(
    (file: FileInfo) => {
      const state = chatStore.getState();
      const taskId = state.activeTaskId;
      if (!taskId) return;

      state.setSelectedFile(taskId, file);
      state.setNuwFileNum(taskId, 0);
      state.setActiveWorkspace(taskId, 'documentWorkSpace');
      setActiveWorkspaceTab('inbox', {
        clearInboxForProjectId: activeProjectId,
      });
    },
    [activeProjectId, chatStore, setActiveWorkspaceTab]
  );

  const streamingDecomposeText = useSyncExternalStore(
    (callback) => chatStore.subscribe(callback),
    () => {
      const state = chatStore.getState();
      const taskId = state.activeTaskId;
      if (!taskId || !state.tasks[taskId]) return '';
      return state.tasks[taskId].streamingDecomposeText || '';
    }
  );

  const activeTask = activeTaskId ? chatState.tasks[activeTaskId] : undefined;

  // A human_reply group never shows its own planning/task-log section —
  // those belong to the prior initial_query or follow_up group.
  const isHumanReply = queryGroup.kind === 'human_reply';

  const activeRenderGroupId = activeTask?.activeRenderGroupId ?? null;
  const isActiveGroup = queryGroup.id === activeRenderGroupId;

  // Legacy compat: when renderGroups is empty (old data / replay without metadata),
  // fall back to the last-user-message heuristic.
  const hasRenderGroups =
    !!activeTask?.renderGroups && activeTask.renderGroups.length > 0;
  const lastUserMessageId = activeTask?.messages
    .filter((m: any) => m.role === 'user')
    .pop()?.id;
  const isCurrentUserQuery = hasRenderGroups
    ? isActiveGroup
    : Boolean(
        !queryGroup.taskMessage &&
        !isHumanReply &&
        activeTask &&
        queryGroup.userMessage &&
        queryGroup.userMessage.id === lastUserMessageId
      );

  const isLastUserQuery =
    isCurrentUserQuery && activeTask?.status !== ChatTaskStatus.FINISHED;

  const isSingleAgentTask =
    inferSessionModeFromTask(activeTask, SessionMode.WORKFORCE) ===
    SessionMode.SINGLE_AGENT;
  const hasUnconfirmedPlan = Boolean(
    activeTask?.messages.some(
      (m: any) => m.step === AgentStep.TO_SUB_TASKS && !m.isConfirm
    )
  );
  const isPlanningPhase = Boolean(
    activeTask &&
    !isSingleAgentTask &&
    !activeTask.hasWaitComfirm &&
    (isPlanSplittingPhase(activeTask) ||
      streamingDecomposeText.length > 0 ||
      hasUnconfirmedPlan)
  );

  const shouldShowFallbackTask =
    isLastUserQuery && activeTaskId && isPlanningPhase;
  const shouldShowSingleAgentWorkLog =
    isCurrentUserQuery &&
    activeTaskId &&
    activeTask &&
    isSingleAgentTask &&
    !isPlanningPhase &&
    !isHumanReply;

  const task =
    (queryGroup.taskMessage ||
      shouldShowFallbackTask ||
      shouldShowSingleAgentWorkLog) &&
    activeTaskId
      ? chatState.tasks[activeTaskId]
      : null;

  useEffect(() => {
    if (!groupRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            onQueryActive(queryGroup.id);
          }
        });
      },
      {
        rootMargin: '-20% 0px -60% 0px',
        threshold: 0.1,
      }
    );

    observer.observe(groupRef.current);

    return () => {
      observer.disconnect();
    };
  }, [queryGroup.id, onQueryActive]);

  useEffect(() => {
    if (!taskBoxRef.current || !task) return;

    const sentinel = document.createElement('div');
    sentinel.style.position = 'absolute';
    sentinel.style.top = '0px';
    sentinel.style.left = '0px';
    sentinel.style.width = '1px';
    sentinel.style.height = '1px';
    sentinel.style.pointerEvents = 'none';
    sentinel.style.zIndex = '-1';

    taskBoxRef.current.parentNode?.insertBefore(sentinel, taskBoxRef.current);

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          setIsTaskBoxSticky(!entry.isIntersecting);
        });
      },
      {
        rootMargin: '0px 0px 0px 0px',
        threshold: 0,
      }
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
      sentinel.remove();
    };
  }, [task]);

  const isSkeletonPhase =
    task && !isSingleAgentTask && isPlanSplittingPhase(task) && isLastUserQuery;

  const taskCardVisible = Boolean(task) && !isSkeletonPhase && !isHumanReply;
  const showTaskPlanCard = taskCardVisible && !shouldShowSingleAgentWorkLog;

  const hasConfirmedSubTasks = Boolean(
    task?.messages.some(
      (m: any) => m.step === AgentStep.TO_SUB_TASKS && m.isConfirm
    )
  );
  const showPreparingExecute =
    Boolean(activeTaskId && task) &&
    task!.status === ChatTaskStatus.PENDING &&
    ((showTaskPlanCard && hasConfirmedSubTasks) ||
      shouldShowSingleAgentWorkLog);

  // Show per-turn work log whenever this group has cursor metadata.
  const shouldShowWorkLog =
    Boolean(queryGroup.workLog) && Boolean(activeTaskId);

  return (
    <motion.div
      ref={groupRef}
      data-query-id={queryGroup.id}
      data-task-card={taskCardVisible ? 'true' : undefined}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.3,
        delay: index * 0.1,
      }}
      className="relative"
    >
      {queryGroup.userMessage && !taskCardVisible && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="px-sm py-sm"
        >
          <UserMessageCard
            id={queryGroup.userMessage.id}
            content={queryGroup.userMessage.content}
            attaches={queryGroup.userMessage.attaches}
          />
        </motion.div>
      )}

      {taskCardVisible && queryGroup.userMessage && (
        <motion.div
          ref={taskBoxRef}
          className="top-0 sticky z-20"
          style={{ position: 'sticky', top: 0, zIndex: 20 }}
        >
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="mb-sm"
          >
            <UserMessageCard
              id={queryGroup.userMessage.id}
              content={queryGroup.userMessage.content}
              attaches={queryGroup.userMessage.attaches}
            />
          </motion.div>
        </motion.div>
      )}

      {showTaskPlanCard && activeTaskId && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <div
            style={{
              transition: 'all 0.3s ease-in-out',
              transformOrigin: 'top',
            }}
          >
            {hasConfirmedSubTasks ? (
              <TaskCard
                key={`task-${activeTaskId}-${queryGroup.id}`}
                chatId={chatId}
                taskInfo={task?.taskInfo || []}
                taskType={queryGroup.taskMessage?.taskType || 1}
                taskAssigning={task?.taskAssigning || []}
                taskRunning={task?.taskRunning || []}
                progressValue={task?.progressValue || 0}
                summaryTask={task?.summaryTask || ''}
                onAddTask={() => {
                  chatState.addTaskInfo();
                }}
                onUpdateTask={(taskIndex, content) => {
                  chatState.updateTaskInfo(taskIndex, content);
                }}
                onSaveTask={() => {
                  chatState.saveTaskInfo();
                }}
                onDeleteTask={(taskIndex) => {
                  chatState.deleteTaskInfo(taskIndex);
                }}
                clickable={true}
              />
            ) : isLastUserQuery ? (
              <PlanTaskBox
                chatStore={chatStore}
                taskId={activeTaskId}
                userPrompt={queryGroup.userMessage?.content}
              />
            ) : null}
          </div>
        </motion.div>
      )}

      {shouldShowWorkLog && activeTaskId && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.05 }}
          className="px-sm"
        >
          {showPreparingExecute ? <PreparingToExecuteTasks /> : null}
          <TaskWorkLogAccordion
            chatStore={chatStore}
            taskId={activeTaskId}
            startCursor={queryGroup.workLog!.startCursor}
            endCursor={queryGroup.workLog!.endCursor}
            groupStartElapsedMs={queryGroup.workLog!.startElapsedMs}
            groupEndElapsedMs={queryGroup.workLog!.endElapsedMs}
          />
        </motion.div>
      )}

      {queryGroup.outputMessages.map((message) => {
        if (message.content.length > 0) {
          if (message.step === AgentStep.END) {
            return (
              <motion.div
                key={`end-${message.id}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="gap-4 flex flex-col"
              >
                <AgentMessageCard
                  typewriter={shouldUseLiveAgentTypewriter(
                    isCurrentUserQuery ? (activeTask ?? null) : null,
                    message.id
                  )}
                  id={message.id}
                  content={message.content}
                  onTyping={() => {}}
                  onMarkdownRenderComplete={onTaskCompletionMarkdownReady}
                  deferredFooter={
                    message.fileList?.length ? (
                      <div className="my-2 gap-2 flex flex-wrap">
                        {message.fileList.map(
                          (file: any, fileIndex: number) => (
                            <motion.div
                              key={`file-${message.id}-${file.name}-${fileIndex}`}
                              initial={{ opacity: 0, scale: 0.9 }}
                              animate={{ opacity: 1, scale: 1 }}
                              transition={{ delay: 0.05 }}
                              onClick={() => {
                                openFilePreview(file);
                              }}
                              className="gap-2 rounded-lg bg-ds-bg-neutral-default-default px-3 py-2 hover:bg-ds-bg-neutral-default-hover flex w-[140px] cursor-pointer items-center transition-colors"
                            >
                              <FileText
                                size={16}
                                className="text-ds-icon-neutral-default-default flex-shrink-0"
                              />
                              <div className="flex flex-col">
                                <div className="text-body-sm font-bold text-ds-text-neutral-default-default max-w-[100px] overflow-hidden text-ellipsis whitespace-nowrap">
                                  {file.name.split('.')[0]}
                                </div>
                                <div className="text-label-xs font-medium text-ds-text-neutral-muted-default">
                                  {file.type}
                                </div>
                              </div>
                            </motion.div>
                          )
                        )}
                      </div>
                    ) : undefined
                  }
                />
              </motion.div>
            );
          } else if (message.content === 'skip') {
            return (
              <motion.div
                key={`skip-${message.id}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="gap-4 flex flex-col"
              >
                <AgentMessageCard
                  key={message.id}
                  id={message.id}
                  content="No reply received, task continues..."
                  onTyping={() => {}}
                />
              </motion.div>
            );
          } else if (message.step === AgentStep.ASK) {
            const taskMessages = activeTask?.messages || [];
            const myIndex = taskMessages.findIndex(
              (m: any) => m.id === message.id
            );
            const hasUserAfter = taskMessages
              .slice(myIndex + 1)
              .some((m: any) => m.role === 'user');
            const inputType = detectInputType(message.content);
            const askBlock: QuestionChatBlock = {
              type: 'question',
              id: message.id,
              content: message.content,
              agentName: message.agent_name || activeTask?.activeAsk || '',
              inputType,
              choices:
                inputType === 'choice_input'
                  ? extractChoices(message.content)
                  : undefined,
              isActive: !hasUserAfter && Boolean(activeTask?.activeAsk),
              taskId: activeTaskId || '',
              askPayload: message.askPayload,
            };
            return (
              <motion.div
                key={`ask-${message.id}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="px-sm"
              >
                <QuestionBlock block={askBlock} />
              </motion.div>
            );
          } else if (message.step === AgentStep.AGENT_END) {
            return (
              <motion.div
                key={`agent-end-${message.id}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="px-sm"
              >
                <AgentResultCard
                  id={message.id}
                  agentName={message.agent_name}
                  content={message.content}
                  attaches={message.attaches}
                  defaultOpen
                />
              </motion.div>
            );
          } else {
            return (
              <motion.div
                key={`message-${message.id}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="gap-4 flex flex-col"
              >
                <AgentMessageCard
                  key={message.id}
                  typewriter={shouldUseLiveAgentTypewriter(
                    isCurrentUserQuery ? (activeTask ?? null) : null,
                    message.id
                  )}
                  id={message.id}
                  content={message.content}
                  onTyping={() => {}}
                  attaches={message.attaches}
                />
              </motion.div>
            );
          }
        } else if (message.step === AgentStep.END && message.content === '') {
          return (
            <motion.div
              key={`end-empty-${message.id}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="gap-4 flex flex-col"
            >
              {message.fileList && (
                <div className="gap-2 flex flex-wrap">
                  {message.fileList.map((file: any, fileIndex: number) => (
                    <motion.div
                      key={`file-${message.id}-${file.name}-${fileIndex}`}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.3 }}
                      onClick={() => {
                        openFilePreview(file);
                      }}
                      className="gap-2 rounded-2xl bg-ds-bg-neutral-default-default px-2 py-1 hover:bg-ds-bg-neutral-default-hover flex w-[120px] cursor-pointer items-center transition-colors"
                    >
                      <FileText
                        size={16}
                        className="text-ds-icon-neutral-default-default flex-shrink-0"
                      />
                      <div className="flex flex-col">
                        <div className="text-body max-w-48 text-sm font-bold text-ds-text-neutral-default-default overflow-hidden text-ellipsis whitespace-nowrap">
                          {file.name.split('.')[0]}
                        </div>
                        <div className="text-xs font-medium leading-29 text-ds-text-neutral-default-default">
                          {file.type}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          );
        }

        if (
          message.step === AgentStep.NOTICE_CARD &&
          !activeTask?.isTakeControl &&
          activeTask?.cotList &&
          activeTask.cotList.length > 0
        ) {
          return <NoticeCard key={`notice-${message.id}`} />;
        }

        return null;
      })}

      {task?.status === ChatTaskStatus.FINISHED &&
        completionEndMessage &&
        taskCompletionMarkdownReady &&
        !taskCompletionDismissed && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="mb-md gap-4 px-sm flex flex-col"
          >
            <TaskCompletionCard
              taskPrompt={queryGroup.userMessage?.content}
              onRerun={() => {
                const inputElement = document.querySelector(
                  '[data-chat-input]'
                ) as HTMLInputElement;
                if (inputElement) {
                  inputElement.focus();
                }
              }}
              onDismiss={() => setTaskCompletionDismissed(true)}
            />
          </motion.div>
        )}

      {isSkeletonPhase && activeTaskId && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="px-sm"
        >
          <PlanTaskBox
            chatStore={chatStore}
            taskId={activeTaskId}
            userPrompt={queryGroup.userMessage?.content}
          />
        </motion.div>
      )}
    </motion.div>
  );
};
