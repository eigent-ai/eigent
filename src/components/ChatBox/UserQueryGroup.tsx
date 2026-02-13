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
import { FileText } from 'lucide-react';
import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { AgentMessageCard } from './MessageItem/AgentMessageCard';
import { NoticeCard } from './MessageItem/NoticeCard';
import { UserMessageCard } from './MessageItem/UserMessageCard';
import { StreamingTaskList } from './TaskBox/StreamingTaskList';
import { TaskCard } from './TaskBox/TaskCard';
import { TypeCardSkeleton } from './TaskBox/TypeCardSkeleton';

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
  const chatState = chatStore.getState();
  const activeTaskId = chatState.activeTaskId;

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
      !anyToSubTasksMessage &&
      !task.hasWaitComfirm &&
      task.messages.length > 0) ||
      (task.isTakeControl && !anyToSubTasksMessage));

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
      {/* User Query (render only if exists) */}
      {queryGroup.userMessage && (
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

      {/* Sticky Task Box - Show only when task exists and NOT in skeleton phase */}
      {task && !isSkeletonPhase && !isHumanReply && (
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
            initial={{ opacity: 0, y: 20 }}
            animate={{
              opacity: 1,
              y: 0,
            }}
            transition={{
              duration: 0.3,
              delay: 0.1, // Slight delay for sequencing
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
                className="flex flex-col gap-4 px-sm"
              >
                <AgentMessageCard
                  typewriter={
                    task?.type !== 'replay' ||
                    (task?.type === 'replay' && task?.delayTime !== 0)
                  }
                  id={message.id}
                  content={message.content}
                  onTyping={() => {}}
                />
                {/* File List */}
                {message.fileList && (
                  <div className="flex flex-wrap gap-2">
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
                          chatState.setActiveWorkSpace(
                            activeTaskId as string,
                            'documentWorkSpace'
                          );
                        }}
                        className="flex w-[140px] cursor-pointer items-center gap-2 rounded-sm bg-message-fill-default px-2 py-1 transition-colors hover:bg-message-fill-hover"
                      >
                        <div className="flex flex-col">
                          <div className="text-body max-w-[100px] overflow-hidden text-ellipsis whitespace-nowrap text-sm font-bold text-text-body">
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
                className="flex flex-col gap-4 px-sm"
              >
                <AgentMessageCard
                  key={message.id}
                  id={message.id}
                  content="No reply received, task continues..."
                  onTyping={() => {}}
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
                className="flex flex-col gap-4 px-sm"
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
              className="flex flex-col gap-4 px-sm"
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
                        chatState.setSelectedFile(activeTaskId as string, file);
                        chatState.setActiveWorkSpace(
                          activeTaskId as string,
                          'documentWorkSpace'
                        );
                      }}
                      className="flex w-[120px] cursor-pointer items-center gap-2 rounded-2xl bg-message-fill-default px-2 py-1 transition-colors hover:bg-message-fill-hover"
                    >
                      <FileText
                        size={16}
                        className="flex-shrink-0 text-icon-primary"
                      />
                      <div className="flex flex-col">
                        <div className="text-body max-w-48 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-bold text-text-body">
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

      {/* Streaming Decompose Text - rendered separately to avoid flickering */}
      {isLastUserQuery && streamingDecomposeText && (
        <StreamingTaskList streamingText={streamingDecomposeText} />
      )}

      {/* Skeleton for loading state */}
      {isSkeletonPhase && (
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
