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
import {
  getTaskListShelfTone,
  type TaskListShelfTone,
} from '@/lib/taskLifecycleUi';
import { cn } from '@/lib/utils';
import type { ChatStore } from '@/store/chatStore';
import { SquarePen } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';

const SHELF_TONE_ROW_CLASS: Record<TaskListShelfTone, string> = {
  splitting: 'bg-input-bg-spliting hover:brightness-[0.98]',
  running: 'bg-input-bg-confirm hover:brightness-[0.98]',
  default: 'bg-transparent hover:bg-surface-tertiary',
};

/** Horizontal drift speed for task query hover (~6px/s, capped) — readable marquee, not a snap. */
const TASK_QUERY_SCROLL_PX_PER_SEC = 16;
const TASK_QUERY_SCROLL_MIN_MS = 10_000;
const TASK_QUERY_SCROLL_MAX_MS = 90_000;

function taskQueryScrollDurationMs(scrollPx: number): number {
  if (scrollPx <= 0) return 300;
  const proportional = (scrollPx / TASK_QUERY_SCROLL_PX_PER_SEC) * 1000;
  return Math.min(
    TASK_QUERY_SCROLL_MAX_MS,
    Math.max(TASK_QUERY_SCROLL_MIN_MS, Math.round(proportional))
  );
}

function taskUserQueryLabel(task: ChatStore['tasks'][string]): string {
  const firstUser = task.messages.find((m) => m.role === 'user');
  const text = firstUser?.content?.trim() ?? '';
  return text || '…';
}

function TaskQueryScrollLabel({
  queryLabel,
  rowHovered,
}: {
  queryLabel: string;
  rowHovered: boolean;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const [scrollPx, setScrollPx] = useState(0);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    const measure = () => {
      setScrollPx(Math.max(0, inner.scrollWidth - outer.clientWidth));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    return () => ro.disconnect();
  }, [queryLabel]);

  const slide = rowHovered && scrollPx > 0;
  const slideMs = taskQueryScrollDurationMs(scrollPx);

  return (
    <div
      ref={outerRef}
      className={cn('text-text-label min-w-0 w-full overflow-hidden')}
    >
      <span
        ref={innerRef}
        title={queryLabel}
        className={cn(
          'text-body-sm font-normal inline-block whitespace-nowrap first-letter:uppercase',
          'transition-[transform]',
          slide ? 'ease-linear' : 'ease-out duration-300'
        )}
        style={{
          transform: slide ? `translateX(-${scrollPx}px)` : 'translateX(0)',
          transitionDuration: slide ? `${slideMs}ms` : undefined,
        }}
      >
        {queryLabel}
      </span>
    </div>
  );
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
  const queryLabel = taskUserQueryLabel(task);
  const shelfTone = getTaskListShelfTone(task);

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
        SHELF_TONE_ROW_CLASS[shelfTone]
      )}
      aria-current={active ? 'true' : undefined}
    >
      <TaskQueryScrollLabel queryLabel={queryLabel} rowHovered={rowHovered} />
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
