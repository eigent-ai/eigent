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

import { Button } from '@/components/ui/button';
import { HoverScrollText } from '@/components/ui/HoverScrollText';
import {
  getTaskListShelfTone,
  isTaskListRowFailureState,
} from '@/lib/taskLifecycleUi';
import { cn } from '@/lib/utils';
import type { ChatStore } from '@/store/chatStore';
import { ChatTaskStatus } from '@/types/constants';
import { SquarePen } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

const TASK_LIST_ROW_BG = {
  information: 'bg-surface-information hover:brightness-[0.98]',
  success: 'bg-surface-success hover:brightness-[0.98]',
  caution: 'bg-surface-caution hover:brightness-[0.98]',
  idle: 'bg-transparent hover:bg-surface-tertiary',
} as const;

/** Brief success highlight after a run completes; then idle (transparent). */
const TASK_LIST_SUCCESS_HIGHLIGHT_MS = 1800;

function taskUserQueryLabel(task: ChatStore['tasks'][string]): string {
  const firstUser = task.messages.find((m) => m.role === 'user');
  const text = firstUser?.content?.trim() ?? '';
  return text || '…';
}

function TaskListRow({
  task,
  firstUserMessageId,
  active,
  setScrollToQueryId,
}: {
  task: ChatStore['tasks'][string];
  firstUserMessageId: string | null;
  active: boolean;
  setScrollToQueryId: (id: string) => void;
}) {
  const [rowHovered, setRowHovered] = useState(false);
  const [successHighlight, setSuccessHighlight] = useState(false);
  const mountedRef = useRef(false);
  const prevStatusRef = useRef(task.status);

  const queryLabel = taskUserQueryLabel(task);
  const shelfTone = getTaskListShelfTone(task);
  const failed = isTaskListRowFailureState(task);
  const activeWork = shelfTone === 'splitting' || shelfTone === 'running';
  const finishedSuccess =
    !failed && task.status === ChatTaskStatus.FINISHED && task.type !== '';

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      prevStatusRef.current = task.status;
      return;
    }
    const prev = prevStatusRef.current;
    prevStatusRef.current = task.status;

    if (
      finishedSuccess &&
      prev !== ChatTaskStatus.FINISHED &&
      task.status === ChatTaskStatus.FINISHED
    ) {
      setSuccessHighlight(true);
      const id = window.setTimeout(
        () => setSuccessHighlight(false),
        TASK_LIST_SUCCESS_HIGHLIGHT_MS
      );
      return () => clearTimeout(id);
    }
  }, [task.status, finishedSuccess]);

  const rowBg = failed
    ? TASK_LIST_ROW_BG.caution
    : successHighlight && finishedSuccess
      ? TASK_LIST_ROW_BG.success
      : activeWork
        ? TASK_LIST_ROW_BG.information
        : TASK_LIST_ROW_BG.idle;

  return (
    <button
      type="button"
      onClick={() => {
        if (firstUserMessageId) {
          setScrollToQueryId(firstUserMessageId);
        }
      }}
      onMouseEnter={() => setRowHovered(true)}
      onMouseLeave={() => setRowHovered(false)}
      className={cn(
        'no-drag h-8 rounded-xl min-w-0 gap-3 px-3 relative flex w-full max-w-full shrink-0 cursor-pointer items-center text-left transition-colors',
        rowBg
      )}
      aria-current={active ? 'true' : undefined}
    >
      <HoverScrollText
        text={queryLabel}
        active={rowHovered}
        className="text-text-label"
        innerClassName="text-body-sm font-normal first-letter:uppercase"
      />
    </button>
  );
}

export type TaskListEntry = {
  chatId: string;
  taskId: string;
  task: ChatStore['tasks'][string];
  firstUserMessageId: string | null;
};

export interface TaskListProps {
  collapsed: boolean;
  entries: TaskListEntry[];
  activeTaskId: string | null | undefined;
  setScrollToQueryId: (id: string) => void;
  title: string;
  emptyLabel: string;
  addButtonAriaLabel: string;
  onAddClick: () => void;
}

export function TaskList({
  collapsed,
  entries,
  activeTaskId,
  setScrollToQueryId,
  title,
  emptyLabel,
  addButtonAriaLabel,
  onAddClick,
}: TaskListProps) {
  return (
    <div
      className={cn(
        'min-h-0 min-w-0 flex w-full flex-col overflow-hidden',
        collapsed ? 'max-h-0 pointer-events-none flex-none' : 'min-h-0 flex-1'
      )}
      style={{ minHeight: 0 }}
    >
      <div
        className={cn(
          'gap-2 pl-3 pr-1.5 pb-1.5 pt-0 flex w-full shrink-0 items-center justify-between',
          collapsed && 'hidden'
        )}
      >
        <span className="text-text-label min-w-0 text-xs font-semibold truncate">
          {title}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          buttonContent="icon-only"
          className="text-icon-primary shrink-0"
          aria-label={addButtonAriaLabel}
          onClick={onAddClick}
        >
          <SquarePen className="size-3.5" aria-hidden />
        </Button>
      </div>
      <div className="min-h-0 min-w-0 w-full flex-1 overflow-x-hidden overflow-y-auto">
        {entries.length === 0 ? (
          <p className="text-text-label px-3 text-xs w-full">{emptyLabel}</p>
        ) : (
          <div className="gap-2 min-w-0 flex w-full flex-col">
            {entries.map(({ chatId, taskId, task, firstUserMessageId }) => (
              <TaskListRow
                key={`${chatId}-${taskId}`}
                task={task}
                firstUserMessageId={firstUserMessageId}
                active={activeTaskId === taskId}
                setScrollToQueryId={setScrollToQueryId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
