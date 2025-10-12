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
}

export const ProjectSection: React.FC<ProjectSectionProps> = ({
  chatId,
  chatStore,
  activeQueryId,
  onQueryActive
}) => {
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
          onPause={() => {
            // Handle pause/resume logic
            const type = task.status === 'running' ? 'pause' : 'resume';
            // Implementation would go here
          }}
          onResume={() => {
            // Handle resume logic
          }}
          onSkip={() => {
            // Handle skip logic
          }}
          loading={false}
        />
      )}
    </motion.div>
  );
};

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
