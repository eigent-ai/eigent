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
import { motion } from 'framer-motion';
import React from 'react';
import { normalizeTaskToQueryGroups } from '../renderSession/queryGroups';
import { FloatingAction } from '../taskLog/FloatingAction';
import { QueryGroup } from './QueryGroup';

interface SessionViewProps {
  chatId: string;
  chatStore: VanillaChatStore;
  /** Scoped task ID from #1655 multi-task layout; falls back to chatState.activeTaskId. */
  taskId?: string;
  activeQueryId: string | null;
  onQueryActive: (queryId: string | null) => void;
  onSkip: () => void;
  isPauseResumeLoading: boolean;
}

export const SessionView = React.forwardRef<HTMLDivElement, SessionViewProps>(
  (
    {
      chatId,
      chatStore,
      taskId,
      activeQueryId,
      onQueryActive,
      onSkip,
      isPauseResumeLoading,
    },
    ref
  ) => {
    const [chatState, setChatState] = React.useState(() =>
      chatStore.getState()
    );

    React.useEffect(() => {
      let timeoutId: NodeJS.Timeout | null = null;
      let latestState: any = null;

      const unsubscribe = chatStore.subscribe((state) => {
        latestState = state;

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
          if (latestState) {
            setChatState(latestState);
          }
        }
      };
    }, [chatStore]);

    const scopedTaskId = taskId ?? chatState.activeTaskId;
    const task = scopedTaskId ? chatState.tasks[scopedTaskId] : null;

    const queryGroups = React.useMemo(() => {
      if (!task || !scopedTaskId) return [];
      return normalizeTaskToQueryGroups(task, scopedTaskId);
    }, [task, scopedTaskId]);

    if (!scopedTaskId || !task) {
      return null;
    }

    return (
      <motion.div
        ref={ref}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.3 }}
        className="relative"
      >
        <div className="space-y-0">
          {queryGroups.map((group, index) => (
            <QueryGroup
              key={`${chatId}-${group.id}`}
              chatId={chatId}
              chatStore={chatStore}
              queryGroup={group}
              isActive={activeQueryId === group.id}
              onQueryActive={onQueryActive}
              index={index}
            />
          ))}
        </div>

        {scopedTaskId && (
          <FloatingAction
            status={task.status}
            onSkip={onSkip}
            loading={isPauseResumeLoading}
            hideStop={false}
          />
        )}
      </motion.div>
    );
  }
);

SessionView.displayName = 'SessionView';
