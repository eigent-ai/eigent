import React, { useRef, useEffect, useState } from 'react';
import { motion, useMotionValue, useTransform } from 'framer-motion';
import { UserMessageCard } from './MessageItem/UserMessageCard';
import { AgentMessageCard } from './MessageItem/AgentMessageCard';
import { NoticeCard } from './MessageItem/NoticeCard';
import { TypeCardSkeleton } from './TaskBox/TypeCardSkeleton';
import { TaskCard } from './TaskBox/TaskCard';
import { VanillaChatStore } from '@/store/chatStore';
import { FileText } from 'lucide-react';

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
  isActive,
  onQueryActive,
  index
}) => {
  const groupRef = useRef<HTMLDivElement>(null);
  const taskBoxRef = useRef<HTMLDivElement>(null);
  const [isTaskBoxSticky, setIsTaskBoxSticky] = useState(false);
  const chatState = chatStore.getState();
  const activeTaskId = chatState.activeTaskId;

  // Show task if this query group has a task message OR if it's the most recent user query during splitting
  // During splitting phase (no to_sub_tasks yet), show task for the most recent query only
  // Exclude human-reply scenarios (when user is replying to an activeAsk)
  const isHumanReply = queryGroup.userMessage && 
    activeTaskId &&
    chatState.tasks[activeTaskId] &&
    (chatState.tasks[activeTaskId].activeAsk || 
     // Check if this user message follows an 'ask' message in the message sequence
     (() => {
       const messages = chatState.tasks[activeTaskId].messages;
       const userMessageIndex = messages.findIndex((m: any) => m.id === queryGroup.userMessage.id);
       if (userMessageIndex > 0) {
         // Check the previous message - if it's an agent message with step 'ask', this is a human-reply
         const prevMessage = messages[userMessageIndex - 1];
         return prevMessage?.role === 'agent' && prevMessage?.step === 'ask';
       }
       return false;
     })());

  const isLastUserQuery = !queryGroup.taskMessage &&
    !isHumanReply &&
    activeTaskId &&
    chatState.tasks[activeTaskId] &&
    queryGroup.userMessage &&
    queryGroup.userMessage.id === chatState.tasks[activeTaskId].messages.filter((m: any) => m.role === 'user').pop()?.id &&
    // Only show during active phases (not finished)
    chatState.tasks[activeTaskId].status !== 'finished';

  // Only show the fallback task box for the newest query while the agent is still splitting work.
  // Simple Q&A sessions set hasWaitComfirm to true, so we should not render an empty task box there.
  const shouldShowFallbackTask =
    isLastUserQuery && activeTaskId && !chatState.tasks[activeTaskId].hasWaitComfirm;

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
        threshold: 0.1
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
        threshold: 0
      }
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
      sentinel.remove();
    };
  }, [task]);

  // Check if we're in skeleton phase
  const anyToSubTasksMessage = task?.messages.find((m: any) => m.step === "to_sub_tasks");
  const isSkeletonPhase = task && (
    (task.status !== 'finished' &&
     !anyToSubTasksMessage && 
     !task.hasWaitComfirm && 
     task.messages.length > 0) || 
    (task.isTakeControl && !anyToSubTasksMessage)
  );

  return (
    <motion.div
      ref={groupRef}
      data-query-id={queryGroup.queryId}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ 
        duration: 0.3,
        delay: index * 0.1 // Stagger animation for multiple groups
      }}
      className="relative"
    >
      {/* User Query (render only if exists) */}
      {queryGroup.userMessage && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="pl-sm py-sm"
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
              y: 0
            }}
            transition={{ 
              duration: 0.3,
              delay: 0.1 // Slight delay for sequencing
            }}
          >
            <div 
              style={{
                transition: 'all 0.3s ease-in-out',
                transformOrigin: 'top'
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
                summaryTask={task?.summaryTask || ""}
                onAddTask={() => {
                  chatState.setIsTaskEdit(activeTaskId as string, true);
                  chatState.addTaskInfo();
                }}
                onUpdateTask={(taskIndex, content) => {
                  chatState.setIsTaskEdit(activeTaskId as string, true);
                  chatState.updateTaskInfo(taskIndex, content);
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
            if (message.step === "end") {
              return (
                <motion.div
                  key={`end-${message.id}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="flex flex-col pl-3 gap-4"
                >
                  <AgentMessageCard
                    typewriter={
                      task?.type !== "replay" ||
                      (task?.type === "replay" && task?.delayTime !== 0)
                    }
                    id={message.id}
                    content={message.content}
                    onTyping={() => {}}
                  />
                  {/* File List */}
                  {message.fileList && (
                    <div className="flex pl-3 gap-2 flex-wrap">
                      {message.fileList.map((file: any, fileIndex: number) => (
                        <motion.div
                          key={`file-${message.id}-${file.name}-${fileIndex}`}
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: 0.3 }}
                          onClick={() => {
                            chatState.setSelectedFile(activeTaskId as string, file);
                            chatState.setActiveWorkSpace(activeTaskId as string, "documentWorkSpace");
                          }}
                          className="flex items-center gap-2 bg-message-fill-default rounded-sm px-2 py-1 w-[140px] cursor-pointer hover:bg-message-fill-hover transition-colors"
                        >
                          <div className="flex flex-col">
                            <div className="max-w-[100px] font-bold text-sm text-body text-text-body overflow-hidden text-ellipsis whitespace-nowrap">
                              {file.name.split(".")[0]}
                            </div>
                            <div className="font-medium leading-29 text-xs text-text-body">
                              {file.type}
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </motion.div>
              );
            } else if (message.content === "skip") {
              return (
                <motion.div
                  key={`skip-${message.id}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="flex flex-col pl-3 gap-4"
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
                  className="flex flex-col pl-3 gap-4"
                >
                <AgentMessageCard
                  key={message.id}
                  typewriter={
                    task?.type !== "replay" ||
                    (task?.type === "replay" && task?.delayTime !== 0)
                  }
                  id={message.id}
                  content={message.content}
                  onTyping={() => {}}
                  attaches={message.attaches}
                />
                </motion.div>
              );
            }
          } else if (message.step === "end" && message.content === "") {
            return (
              <motion.div
                key={`end-empty-${message.id}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="flex flex-col pl-3 gap-4"
              >
                {message.fileList && (
                  <div className="flex gap-2 flex-wrap">
                    {message.fileList.map((file: any, fileIndex: number) => (
                      <motion.div
                        key={`file-${message.id}-${file.name}-${fileIndex}`}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.3 }}
                        onClick={() => {
                          chatState.setSelectedFile(activeTaskId as string, file);
                          chatState.setActiveWorkSpace(activeTaskId as string, "documentWorkSpace");
                        }}
                        className="flex items-center gap-2 bg-message-fill-default rounded-2xl px-2 py-1 w-[120px] cursor-pointer hover:bg-message-fill-hover transition-colors"
                      >
                        <FileText size={16} className="text-icon-primary flex-shrink-0" />
                        <div className="flex flex-col">
                          <div className="max-w-48 font-bold text-sm text-body text-text-body overflow-hidden text-ellipsis whitespace-nowrap">
                            {file.name.split(".")[0]}
                          </div>
                          <div className="font-medium leading-29 text-xs text-text-body">
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
            message.step === "notice_card" &&
            !task?.isTakeControl &&
            task?.cotList && task.cotList.length > 0
          ) {
            return <NoticeCard key={`notice-${message.id}`} />;
          }

          return null;
        })}

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
