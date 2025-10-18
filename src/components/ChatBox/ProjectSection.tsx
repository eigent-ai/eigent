import React from 'react';
import { motion } from 'framer-motion';
import { UserQueryGroup } from './UserQueryGroup';
import { FloatingAction } from './FloatingAction';
import { VanillaChatStore } from '@/store/chatStore';

interface ProjectSectionProps {
  chatId: string;
  chatStore: VanillaChatStore;
  activeQueryId: string | null;
  onQueryActive: (queryId: string | null) => void;
  onPauseResume: () => void;
  onSkip: () => void;
  isPauseResumeLoading: boolean;
}

export const ProjectSection = React.forwardRef<HTMLDivElement, ProjectSectionProps>(({
  chatId,
  chatStore,
  activeQueryId,
  onQueryActive,
  onPauseResume,
  onSkip,
  isPauseResumeLoading
}, ref) => {
  const chatState = chatStore.getState();
  const activeTaskId = chatState.activeTaskId;

  if (!activeTaskId || !chatState.tasks[activeTaskId]) {
    return null;
  }

  const task = chatState.tasks[activeTaskId];
  const messages = task.messages || [];

  // Group messages by query cycles and show in chronological order (oldest first)
  const queryGroups = groupMessagesByQuery(messages);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3 }}
      className="relative"
    >
      {/* User Query Groups */}
      <div className="space-y-0">
        {queryGroups.map((group, index) => (
          <UserQueryGroup
            key={`${chatId}-${group.queryId}`}
            chatId={chatId}
            chatStore={chatStore}
            queryGroup={group}
            isActive={activeQueryId === group.queryId}
            onQueryActive={onQueryActive}
            index={index}
          />
        ))}
      </div>

      {/* Floating Action Button - positioned at project level */}
      {activeTaskId && (
        <FloatingAction
          status={task.status}
          onPause={onPauseResume}
          onResume={onPauseResume}
          onSkip={onSkip}
          loading={isPauseResumeLoading}
        />
      )}
    </motion.div>
  );
});

// Add display name for better debugging
ProjectSection.displayName = 'ProjectSection';

// Helper function to group messages by query cycles
function groupMessagesByQuery(messages: any[]) {
  const groups: Array<{
    queryId: string;
    userMessage: any;
    taskMessage?: any;
    otherMessages: any[];
  }> = [];

  let currentGroup: any = null;

  messages.forEach((message) => {
    if (message.role === 'user') {
      // Start a new query group
      if (currentGroup) {
        groups.push(currentGroup);
      }
      currentGroup = {
        queryId: message.id,
        userMessage: message,
        otherMessages: []
      };
    } else if (message.step === 'to_sub_tasks') {
      // Task planning message
      if (currentGroup) {
        currentGroup.taskMessage = message;
      }
    } else {
      // Other messages (assistant responses, etc.)
      if (currentGroup) {
        currentGroup.otherMessages.push(message);
      }
    }
  });

  // Add the last group if it exists
  if (currentGroup) {
    groups.push(currentGroup);
  }

  return groups;
}
