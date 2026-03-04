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

import { cn } from '@/lib/utils';
import { useProjectStore } from '@/store/projectStore';
import { House, Plus } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

// Placeholder skeleton items shown before any task is started
const PLACEHOLDER_WIDTHS = ['w-4/5', 'w-3/5', 'w-2/3'];

interface TaskSidebarProps {
  className?: string;
  onNewTask?: () => void;
}

export default function TaskSidebar({
  className,
  onNewTask,
}: TaskSidebarProps) {
  const projectStore = useProjectStore();
  const navigate = useNavigate();

  const taskItems = useMemo(() => {
    const { activeProjectId, projects } = projectStore;
    if (!activeProjectId) return [];

    const project = projects[activeProjectId];
    if (!project) return [];

    const { chatStores, chatStoreTimestamps, activeChatId } = project;

    // Sort chat stores by creation time (oldest first)
    const sortedChatIds = Object.keys(chatStores).sort(
      (a, b) => (chatStoreTimestamps[a] ?? 0) - (chatStoreTimestamps[b] ?? 0)
    );

    return sortedChatIds
      .map((chatId) => {
        const store = chatStores[chatId];
        if (!store) return null;

        const state = store.getState();
        const taskId = state.activeTaskId;
        if (!taskId) return null;

        const task = state.tasks[taskId];
        if (!task || (task.messages.length === 0 && !task.hasMessages))
          return null;

        let taskName: string = task.summaryTask || '';
        if (!taskName) {
          const firstUserMsg = task.messages.find(
            (m: any) => m.role === 'user'
          );
          taskName = firstUserMsg?.content || 'Untitled';
        }

        return {
          chatId,
          taskId,
          taskName,
          isActive: chatId === activeChatId,
        };
      })
      .filter(Boolean);
  }, [projectStore]);

  const handleItemClick = (chatId: string) => {
    const { activeProjectId } = projectStore;
    if (!activeProjectId) return;
    projectStore.setActiveChatStore(activeProjectId, chatId);
  };

  const handleNewTask = () => {
    onNewTask?.();
  };

  return (
    <div
      className={cn(
        'flex h-full w-full flex-none flex-col overflow-hidden',
        className
      )}
    >
      {/* Header — dashboard + new task buttons */}
      <div className="border-border-tertiary px-2 flex h-[44px] shrink-0 items-center justify-between border-b">
        <button
          onClick={() => navigate('/history')}
          className="text-text-tertiary hover:bg-surface-tertiary hover:text-text-body h-7 w-7 rounded-md flex items-center justify-center transition-colors"
          title="Go to dashboard"
        >
          <House className="h-4 w-4" />
        </button>
        <button
          onClick={handleNewTask}
          className="text-text-tertiary hover:bg-surface-tertiary hover:text-text-body h-7 w-7 rounded-md flex items-center justify-center transition-colors"
          title="New task"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Task list */}
      <div className="min-h-0 py-1 flex-1 overflow-y-auto">
        {taskItems.length === 0 ? (
          /* Placeholder skeleton items */
          <div className="px-2 pt-1.5 gap-1 flex flex-col">
            {PLACEHOLDER_WIDTHS.map((w, i) => (
              <div
                key={i}
                className="bg-surface-secondary rounded-lg px-2 py-2 flex items-center"
              >
                <div className={cn('bg-surface-tertiary h-3 rounded-sm', w)} />
              </div>
            ))}
          </div>
        ) : (
          taskItems.map((item) => (
            <button
              key={item!.chatId}
              onClick={() => handleItemClick(item!.chatId)}
              className={cn(
                'mx-1 rounded-lg px-2 py-2 !text-label-sm w-[calc(100%-8px)] truncate text-left transition-colors',
                item!.isActive
                  ? 'bg-surface-tertiary text-text-heading font-medium'
                  : 'text-text-body hover:bg-surface-tertiary'
              )}
            >
              {item!.taskName}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
