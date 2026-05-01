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
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectStore } from '@/store/projectStore';
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
import { AgentMessageCard } from './MessageItem/AgentMessageCard';
import { NoticeCard } from './MessageItem/NoticeCard';
import { PreparingToExecuteTasks } from './MessageItem/PreparingToExecuteTasks';
import { SplittingProgressRow } from './MessageItem/SplittingProgressRow';
import { TaskCompletionCard } from './MessageItem/TaskCompletionCard';
import { TaskWorkLogAccordion } from './MessageItem/TaskWorkLogAccordion';
import { UserMessageCard } from './MessageItem/UserMessageCard';
import { StreamingTaskList } from './TaskBox/StreamingTaskList';
import { TaskCard } from './TaskBox/TaskCard';

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
    <div className="overflow-hidden px-2">
      {/* Header (always visible) */}
      <button
        type="button"
        className="focus-visible:ring-ds-border-brand-default-focus/40 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold text-ds-text-neutral-default-default transition-colors hover:bg-ds-bg-neutral-default-hover focus-visible:outline-none focus-visible:ring-2 active:bg-ds-bg-neutral-default-active"
        onClick={() => setIsOpen((v) => !v)}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronDown
          size={14}
          aria-hidden
          className={`shrink-0 text-ds-icon-neutral-default-default transition-transform duration-200 ${isOpen ? 'rotate-180' : 'rotate-0'}`}
        />
      </button>

      {/* Collapsible body */}
      <div
        className={`overflow-hidden transition-all duration-200 ease-in-out ${isOpen ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}`}
      >
        <div className="border-t border-ds-border-neutral-default-default px-1 py-1">
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
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const setActiveWorkspaceTab = usePageTabStore(
    (state) => state.setActiveWorkspaceTab
  );
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
    !isDecomposing;

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

  /** Task card visible (user message is sticky alone in this mode). */
  const taskCardVisible = Boolean(task) && !isSkeletonPhase && !isHumanReply;

  const hasConfirmedSubTasks = Boolean(
    task?.messages.some(
      (m: any) => m.step === AgentStep.TO_SUB_TASKS && m.isConfirm
    )
  );
  const showPreparingExecute =
    taskCardVisible &&
    Boolean(activeTaskId && task) &&
    hasConfirmedSubTasks &&
    task!.status === ChatTaskStatus.PENDING;

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

      {/* Sticky user message only — task box scrolls away. */}
      {taskCardVisible && queryGroup.userMessage && (
        <motion.div
          ref={taskBoxRef}
          className="sticky top-0 z-20"
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

      {taskCardVisible && (
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

      {taskCardVisible && activeTaskId && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.05 }}
          className="px-sm"
        >
          {showPreparingExecute ? <PreparingToExecuteTasks /> : null}
          <TaskWorkLogAccordion chatStore={chatStore} taskId={activeTaskId} />
        </motion.div>
      )}

      {/* Other Messages */}
      {queryGroup.otherMessages.map((message) => {
        if (message.content.length > 0) {
          if (message.step === AgentStep.END) {
            return (
              <motion.div
                key={`end-${message.id}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="flex flex-col gap-4"
              >
                <AgentMessageCard
                  typewriter={shouldUseLiveAgentTypewriter(task, message.id)}
                  id={message.id}
                  content={message.content}
                  onTyping={() => {}}
                  onMarkdownRenderComplete={onTaskCompletionMarkdownReady}
                  deferredFooter={
                    message.fileList?.length ? (
                      <div className="my-2 flex flex-wrap gap-2">
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
                              className="flex w-[140px] cursor-pointer items-center gap-2 rounded-lg bg-ds-bg-neutral-default-default px-3 py-2 transition-colors hover:bg-ds-bg-neutral-default-hover"
                            >
                              <FileText
                                size={16}
                                className="flex-shrink-0 text-ds-icon-neutral-default-default"
                              />
                              <div className="flex flex-col">
                                <div className="max-w-[100px] overflow-hidden text-ellipsis whitespace-nowrap text-body-sm font-bold text-ds-text-neutral-default-default">
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
                className="flex flex-col gap-4"
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
                className="flex flex-col gap-4"
              >
                <AgentMessageCard
                  key={message.id}
                  typewriter={shouldUseLiveAgentTypewriter(task, message.id)}
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
              className="flex flex-col gap-4"
            >
              {message.fileList && (
                <div className="flex flex-wrap gap-2">
                  {message.fileList.map((file: any, fileIndex: number) => (
                    <motion.div
                      key={`file-${message.id}-${file.name}-${fileIndex}`}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.3 }}
                      onClick={() => {
                        openFilePreview(file);
                      }}
                      className="flex w-[120px] cursor-pointer items-center gap-2 rounded-2xl bg-ds-bg-neutral-default-default px-2 py-1 transition-colors hover:bg-ds-bg-neutral-default-hover"
                    >
                      <FileText
                        size={16}
                        className="flex-shrink-0 text-ds-icon-neutral-default-default"
                      />
                      <div className="flex flex-col">
                        <div className="text-body max-w-48 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-bold text-ds-text-neutral-default-default">
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
            className="mb-md flex flex-col gap-4 px-sm"
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

      {/* Streaming Decompose Text */}
      {isLastUserQuery && streamingDecomposeText && (
        <StreamingTaskList streamingText={streamingDecomposeText} />
      )}

      {isSkeletonPhase && activeTaskId && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="px-sm"
        >
          <SplittingProgressRow chatStore={chatStore} taskId={activeTaskId} />
        </motion.div>
      )}
    </motion.div>
  );
};
