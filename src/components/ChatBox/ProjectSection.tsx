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
import { AgentStep } from '@/types/constants';
import { motion } from 'framer-motion';
import React from 'react';
import { FloatingAction } from './FloatingAction';
import { UserQueryGroup } from './UserQueryGroup';

interface ProjectSectionProps {
  chatId: string;
  chatStore: VanillaChatStore;
  activeQueryId: string | null;
  onQueryActive: (queryId: string | null) => void;
  // onPauseResume: () => void;  // Commented out - temporary not needed
  onSkip: () => void;
  isPauseResumeLoading: boolean;
}

export const ProjectSection = React.forwardRef<
  HTMLDivElement,
  ProjectSectionProps
>(
  (
    {
      chatId,
      chatStore,
      activeQueryId,
      onQueryActive,
      // onPauseResume,  // Commented out - temporary not needed
      onSkip,
      isPauseResumeLoading,
    },
    ref
  ) => {
    // Subscribe to store changes with throttling to prevent excessive re-renders
    const [chatState, setChatState] = React.useState(() =>
      chatStore.getState()
    );

    React.useEffect(() => {
      let timeoutId: NodeJS.Timeout | null = null;
      let latestState: any = null;

      const unsubscribe = chatStore.subscribe((state) => {
        latestState = state;

        // Throttle updates to max once per 100ms
        if (!timeoutId) {
          timeoutId = setTimeout(() => {
            if (latestState) {
              setChatState(latestState);
            }
            timeoutId = null;
          }, 100);
        }
      });

      return () => {
        unsubscribe();
        if (timeoutId) {
          clearTimeout(timeoutId);
          // Apply final state on cleanup
          if (latestState) {
            setChatState(latestState);
          }
        }
      };
    }, [chatStore]);

    const activeTaskId = chatState.activeTaskId;
    const task = activeTaskId ? chatState.tasks[activeTaskId] : null;

    const messages = React.useMemo(() => {
      return task?.messages || [];
    }, [task?.messages]);

    // Memoize grouping to prevent re-creating objects on every render
    const queryGroups = React.useMemo(() => {
      return groupMessagesByQuery(messages);
    }, [messages]);
    if (!activeTaskId || !task) {
      return null;
    }

    return (
      <motion.div
        ref={ref}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.3 }}
        className="relative mb-8"
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
            // onPause={onPauseResume}  // Commented out - temporary not needed
            // onResume={onPauseResume}  // Commented out - temporary not needed
            onSkip={onSkip}
            loading={isPauseResumeLoading}
          />
        )}
      </motion.div>
    );
  }
);

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

  // Track which to_sub_tasks we've already processed to avoid duplicates
  const processedTaskMessages = new Set();

  messages.forEach((message, index) => {
    if (message.role === 'user') {
      // Start a new query group
      if (currentGroup) {
        groups.push(currentGroup);
      }
      currentGroup = {
        queryId: message.id,
        userMessage: message,
        otherMessages: [],
      };
    } else if (message.step === AgentStep.TO_SUB_TASKS) {
      // Task planning message - each should get its own panel

      // Skip if we've already processed this to_sub_tasks
      if (processedTaskMessages.has(message.id)) {
        return;
      }
      processedTaskMessages.add(message.id);

      // Check if any existing group already has this exact taskMessage
      const existingGroupWithTask = groups.find(
        (g) => g.taskMessage && g.taskMessage.id === message.id
      );
      if (existingGroupWithTask) {
        return;
      }

      // If current group doesn't have a task and doesn't already have this task, assign to it
      if (currentGroup && !currentGroup.taskMessage) {
        currentGroup.taskMessage = message;
      } else {
        // Need a new group for this task
        if (currentGroup) {
          groups.push(currentGroup);
        }

        // Find the most recent user message that doesn't have a task yet
        let correspondingUserMessage = null;

        // Look backwards through messages for unassigned user message
        for (let i = index - 1; i >= 0; i--) {
          if (messages[i].role === 'user') {
            // Check if this user message already has a task in existing groups
            const alreadyHasTask = groups.some(
              (g) =>
                g.userMessage &&
                g.userMessage.id === messages[i].id &&
                g.taskMessage
            );

            if (!alreadyHasTask) {
              correspondingUserMessage = messages[i];
              break;
            }
          }
        }

        // Create new group for this to_sub_tasks
        currentGroup = {
          queryId: correspondingUserMessage
            ? correspondingUserMessage.id
            : `task-${message.id}`,
          userMessage: correspondingUserMessage,
          taskMessage: message,
          otherMessages: [],
        };
      }
    } else {
      // Other messages (assistant responses, errors, etc.)
      if (currentGroup) {
        currentGroup.otherMessages.push(message);
      } else {
        // If there is no current user group yet (e.g., the first message is from agent/error),
        // create an anonymous group to ensure the message is rendered.
        currentGroup = {
          queryId: `orphan-${message.id}`,
          userMessage: null,
          otherMessages: [message],
        };
      }
    }
  });

  // Add the last group if it exists
  if (currentGroup) {
    groups.push(currentGroup);
  }

  return groups;
}
