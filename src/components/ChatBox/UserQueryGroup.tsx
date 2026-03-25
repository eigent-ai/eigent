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

import { VanillaChatStore } from '@/store/chatStore';
import { AgentStep, ChatTaskStatus } from '@/types/constants';
import { motion } from 'framer-motion';
import { ChevronDown, FileText } from 'lucide-react';
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { MentionAgentListIcon } from './BottomBox/MentionAgentIcons';
import {
  agentNameToMentionId,
  getAgentDisplayLabel,
  getLeadMentionId,
  isSingleAgentTurn,
} from './MentionRouting';
import { AgentMessageCard } from './MessageItem/AgentMessageCard';
import { AgentOutcomeCollapsible } from './MessageItem/AgentOutcomeCollapsible';
import { NoticeCard } from './MessageItem/NoticeCard';
import { SingleAgentRunningRow } from './MessageItem/SingleAgentRunningRow';
import { TaskCompletionCard } from './MessageItem/TaskCompletionCard';
import { UserMessageCard } from './MessageItem/UserMessageCard';
import { StreamingTaskList } from './TaskBox/StreamingTaskList';
import { TaskCard } from './TaskBox/TaskCard';
import { TypeCardSkeleton } from './TaskBox/TypeCardSkeleton';

/** Collapsible card that shows a single agent's result (workforce / non–single-agent turns). */
const AgentResultCard: React.FC<{
  id: string;
  agentName?: string;
  content: string;
  attaches?: any[];
  defaultOpen?: boolean;
}> = ({ id, agentName, content, attaches, defaultOpen = false }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const label = getAgentDisplayLabel(agentName);
  const agentIconId = agentNameToMentionId(agentName) ?? 'workforce';

  return (
    <div className="px-2 overflow-hidden">
      {/* Header (always visible) */}
      <button
        type="button"
        className="gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-text-heading hover:bg-surface-tertiary active:bg-surface-tertiary focus-visible:ring-border-primary/40 flex w-full items-center text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
        onClick={() => setIsOpen((v) => !v)}
      >
        <MentionAgentListIcon
          agentId={agentIconId}
          size={16}
          className="shrink-0"
        />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronDown
          size={14}
          aria-hidden
          className={`text-icon-primary shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : 'rotate-0'}`}
        />
      </button>

      {/* Collapsible body */}
      <div
        className={`ease-in-out overflow-hidden transition-all duration-200 ${isOpen ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}`}
      >
        <div className="border-border-default px-1 py-1 border-t">
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

interface QueryGroup {
  queryId: string;
  userMessage: any;
  taskMessage?: any;
  otherMessages: any[];
}

interface UserQueryGroupProps {
  chatId: string;
  chatStore: VanillaChatStore;
  queryGroup: QueryGroup;
  isActive: boolean;
  onQueryActive: (queryId: string | null) => void;
  index: number;
}

export const UserQueryGroup: React.FC<UserQueryGroupProps> = ({
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

  const completionEndMessage = queryGroup.otherMessages.find(
    (m: any) => m.step === AgentStep.END && m.content.length > 0
  );

  useEffect(() => {
    setTaskCompletionMarkdownReady(false);
    setTaskCompletionDismissed(false);
  }, [queryGroup.queryId, completionEndMessage?.id]);

  const onTaskCompletionMarkdownReady = useCallback(() => {
    setTaskCompletionMarkdownReady(true);
  }, []);
  const activeTaskId = chatState.activeTaskId;
  const activeTask = activeTaskId ? chatState.tasks[activeTaskId] : null;
  const userContent = queryGroup.userMessage?.content ?? '';
  const isSingleAgent = isSingleAgentTurn(userContent);
  const leadMentionId = getLeadMentionId(userContent);

  // Subscribe to streaming decompose text separately for efficient updates
  const streamingDecomposeText = useSyncExternalStore(
    (callback) => chatStore.subscribe(callback),
    () => {
      const state = chatStore.getState();
      const taskId = state.activeTaskId;
      if (!taskId || !state.tasks[taskId]) return '';
      return state.tasks[taskId].streamingDecomposeText || '';
    }
  );

  // Show task if this query group has a task message OR if it's the most recent user query during splitting
  // During splitting phase (no to_sub_tasks yet), show task for the most recent query only
  // Exclude human-reply scenarios (when user is replying to an activeAsk)
  const isHumanReply =
    queryGroup.userMessage &&
    activeTaskId &&
    chatState.tasks[activeTaskId] &&
    (chatState.tasks[activeTaskId].activeAsk ||
      // Check if this user message follows an 'ask' message in the message sequence
      (() => {
        const messages = chatState.tasks[activeTaskId].messages;
        const userMessageIndex = messages.findIndex(
          (m: any) => m.id === queryGroup.userMessage.id
        );
        if (userMessageIndex > 0) {
          // Check the previous message - if it's an agent message with step 'ask', this is a human-reply
          const prevMessage = messages[userMessageIndex - 1];
          return (
            prevMessage?.role === 'agent' && prevMessage?.step === AgentStep.ASK
          );
        }
        return false;
      })());

  const singleAgentHasAgentEndReport =
    isSingleAgent &&
    queryGroup.otherMessages.some(
      (m) => m.step === AgentStep.AGENT_END && (m.content?.length ?? 0) > 0
    );

  let showSingleAgentRunning = false;
  if (
    isSingleAgent &&
    activeTask &&
    leadMentionId &&
    !isHumanReply &&
    (activeTask.status === ChatTaskStatus.RUNNING ||
      activeTask.status === ChatTaskStatus.PAUSE)
  ) {
    const gotAgentEnd = queryGroup.otherMessages.some((m: any) => {
      if (m.step !== AgentStep.AGENT_END || !(m.content?.length > 0)) {
        return false;
      }
      const mid = agentNameToMentionId(m.agent_name);
      if (mid) return mid === leadMentionId;
      return true;
    });
    showSingleAgentRunning = !gotAgentEnd;
  }

  const isLastUserQuery =
    !queryGroup.taskMessage &&
    !isHumanReply &&
    activeTaskId &&
    chatState.tasks[activeTaskId] &&
    queryGroup.userMessage &&
    queryGroup.userMessage.id ===
      chatState.tasks[activeTaskId].messages
        .filter((m: any) => m.role === 'user')
        .pop()?.id &&
    // Only show during active phases (not finished)
    chatState.tasks[activeTaskId].status !== ChatTaskStatus.FINISHED;

  // Only show the fallback task box for the newest query while the agent is still splitting work.
  // Simple Q&A sessions set hasWaitComfirm to true, so we should not render an empty task box there.
  // Also, do not show fallback task if we are currently decomposing (streaming text).
  const isDecomposing = streamingDecomposeText.length > 0;
  const shouldShowFallbackTask =
    isLastUserQuery &&
    activeTaskId &&
    !chatState.tasks[activeTaskId].hasWaitComfirm &&
    !isDecomposing &&
    !isSingleAgent;

  const task =
    (queryGroup.taskMessage || shouldShowFallbackTask) && activeTaskId
      ? chatState.tasks[activeTaskId]
      : null;

  // Set up intersection observer for this query group
  useEffect(() => {
    if (!groupRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            onQueryActive(queryGroup.queryId);
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
  }, [queryGroup.queryId, onQueryActive]);

  // Set up intersection observer for sticky detection
  useEffect(() => {
    if (!taskBoxRef.current || !task) return;

    // Create a sentinel element to detect when the sticky element becomes stuck
    const sentinel = document.createElement('div');
    sentinel.style.position = 'absolute';
    sentinel.style.top = '0px';
    sentinel.style.left = '0px';
    sentinel.style.width = '1px';
    sentinel.style.height = '1px';
    sentinel.style.pointerEvents = 'none';
    sentinel.style.zIndex = '-1';

    // Insert sentinel before the sticky element
    taskBoxRef.current.parentNode?.insertBefore(sentinel, taskBoxRef.current);

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          // When sentinel is not visible, the sticky element is stuck
          const isSticky = !entry.isIntersecting;
          setIsTaskBoxSticky(isSticky);
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

  // Check if we're in skeleton phase
  const anyToSubTasksMessage = task?.messages.find(
    (m: any) => m.step === AgentStep.TO_SUB_TASKS
  );
  const isSkeletonPhase =
    task &&
    ((task.status !== ChatTaskStatus.FINISHED &&
      task.status !== ChatTaskStatus.RUNNING &&
      !anyToSubTasksMessage &&
      !task.hasWaitComfirm &&
      task.messages.length > 0) ||
      (task.isTakeControl && !anyToSubTasksMessage));

  /** Workforce task card visible (user message is sticky alone in this mode). */
  const workforceTaskCardVisible =
    Boolean(task) && !isSkeletonPhase && !isHumanReply && !isSingleAgent;

  return (
    <motion.div
      ref={groupRef}
      data-query-id={queryGroup.queryId}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.3,
        delay: index * 0.1, // Stagger animation for multiple groups
      }}
      className="relative"
    >
      {/* User query: scrolls with content unless workforce task is shown (then sticky user row only). */}
      {queryGroup.userMessage && !workforceTaskCardVisible && (
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

      {showSingleAgentRunning && leadMentionId && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          <SingleAgentRunningRow mentionId={leadMentionId} />
        </motion.div>
      )}

      {/* Sticky user message only — task box scrolls away (workforce only). */}
      {workforceTaskCardVisible && queryGroup.userMessage && (
        <motion.div
          ref={taskBoxRef}
          className="top-0 sticky z-20"
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 20,
          }}
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

      {workforceTaskCardVisible && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{
            opacity: 1,
            y: 0,
          }}
          transition={{
            duration: 0.3,
            delay: 0.1,
          }}
        >
          <div
            style={{
              transition: 'all 0.3s ease-in-out',
              transformOrigin: 'top',
            }}
          >
            <TaskCard
              key={`task-${activeTaskId}-${queryGroup.queryId}`}
              chatId={chatId}
              taskInfo={task?.taskInfo || []}
              taskType={queryGroup.taskMessage?.taskType || 1}
              taskAssigning={task?.taskAssigning || []}
              taskRunning={task?.taskRunning || []}
              progressValue={task?.progressValue || 0}
              summaryTask={task?.summaryTask || ''}
              onAddTask={() => {
                chatState.setIsTaskEdit(activeTaskId as string, true);
                chatState.addTaskInfo();
              }}
              onUpdateTask={(taskIndex, content) => {
                chatState.setIsTaskEdit(activeTaskId as string, true);
                chatState.updateTaskInfo(taskIndex, content);
              }}
              onSaveTask={() => {
                chatState.saveTaskInfo();
              }}
              onDeleteTask={(taskIndex) => {
                chatState.setIsTaskEdit(activeTaskId as string, true);
                chatState.deleteTaskInfo(taskIndex);
              }}
              clickable={true}
            />
          </div>
        </motion.div>
      )}

      {/* Other Messages */}
      {queryGroup.otherMessages.map((message) => {
        if (message.content.length > 0) {
          if (message.step === AgentStep.END) {
            const skipEndMarkdown =
              singleAgentHasAgentEndReport && message.content.length > 0;
            return (
              <motion.div
                key={`end-${message.id}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="gap-4 px-sm flex flex-col"
              >
                {!skipEndMarkdown && (
                  <AgentMessageCard
                    typewriter={
                      task?.type !== 'replay' ||
                      (task?.type === 'replay' && task?.delayTime !== 0)
                    }
                    id={message.id}
                    content={message.content}
                    onTyping={() => {}}
                    onMarkdownRenderComplete={onTaskCompletionMarkdownReady}
                  />
                )}
                {/* File List */}
                {message.fileList && (
                  <div className="gap-2 flex flex-wrap">
                    {message.fileList.map((file: any, fileIndex: number) => (
                      <motion.div
                        key={`file-${message.id}-${file.name}-${fileIndex}`}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.3 }}
                        onClick={() => {
                          chatState.setSelectedFile(
                            activeTaskId as string,
                            file
                          );
                          chatState.setActiveWorkspace(
                            activeTaskId as string,
                            'documentWorkSpace'
                          );
                        }}
                        className="gap-2 rounded-sm bg-message-fill-default px-2 py-1 hover:bg-message-fill-hover flex w-[140px] cursor-pointer items-center transition-colors"
                      >
                        <div className="flex flex-col">
                          <div className="text-body text-sm font-bold text-text-body max-w-[100px] overflow-hidden text-ellipsis whitespace-nowrap">
                            {file.name.split('.')[0]}
                          </div>
                          <div className="text-xs font-medium leading-29 text-text-body">
                            {file.type}
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </motion.div>
            );
          } else if (message.content === 'skip') {
            return (
              <motion.div
                key={`skip-${message.id}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="gap-4 px-sm flex flex-col"
              >
                <AgentMessageCard
                  key={message.id}
                  id={message.id}
                  content="No reply received, task continues..."
                  onTyping={() => {}}
                />
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
                {isSingleAgent ? (
                  <AgentOutcomeCollapsible
                    id={message.id}
                    agentName={message.agent_name}
                    content={message.content}
                    attaches={message.attaches}
                    defaultOpen
                    onMarkdownRenderComplete={onTaskCompletionMarkdownReady}
                  />
                ) : (
                  <AgentResultCard
                    id={message.id}
                    agentName={message.agent_name}
                    content={message.content}
                    attaches={message.attaches}
                    defaultOpen
                  />
                )}
              </motion.div>
            );
          } else {
            return (
              <motion.div
                key={`message-${message.id}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="gap-4 px-sm flex flex-col"
              >
                <AgentMessageCard
                  key={message.id}
                  typewriter={
                    task?.type !== 'replay' ||
                    (task?.type === 'replay' && task?.delayTime !== 0)
                  }
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
              className="gap-4 px-sm flex flex-col"
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
                        chatState.setSelectedFile(activeTaskId as string, file);
                        chatState.setActiveWorkspace(
                          activeTaskId as string,
                          'documentWorkSpace'
                        );
                      }}
                      className="gap-2 rounded-2xl bg-message-fill-default px-2 py-1 hover:bg-message-fill-hover flex w-[120px] cursor-pointer items-center transition-colors"
                    >
                      <FileText
                        size={16}
                        className="text-icon-primary flex-shrink-0"
                      />
                      <div className="flex flex-col">
                        <div className="text-body max-w-48 text-sm font-bold text-text-body overflow-hidden text-ellipsis whitespace-nowrap">
                          {file.name.split('.')[0]}
                        </div>
                        <div className="text-xs font-medium leading-29 text-text-body">
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

        // Notice Card
        if (
          message.step === AgentStep.NOTICE_CARD &&
          !task?.isTakeControl &&
          task?.cotList &&
          task.cotList.length > 0
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
            className="gap-4 px-sm flex flex-col"
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

      {/* Streaming Decompose Text - workforce decomposition only */}
      {isLastUserQuery && streamingDecomposeText && !isSingleAgent && (
        <StreamingTaskList streamingText={streamingDecomposeText} />
      )}

      {/* Skeleton for loading state (workforce task splitting) */}
      {isSkeletonPhase && !isSingleAgent && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <TypeCardSkeleton isTakeControl={task?.isTakeControl || false} />
        </motion.div>
      )}
    </motion.div>
  );
};
