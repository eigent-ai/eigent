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
import type {
  BoardColumnDef,
  DashboardTask,
  TaskStatusBucket,
} from '@/types/dashboard';
import { BoardTaskCard } from './BoardTaskCard';

const COLUMN_LABEL_TEXT: Record<TaskStatusBucket, string> = {
  draft: 'text-ds-text-neutral-default-default',
  todo: 'text-ds-text-status-pending-default-default',
  in_progress: 'text-ds-text-status-running-default-default',
  done: 'text-ds-text-status-completed-default-default',
  failed: 'text-ds-text-status-error-default-default',
  human_review: 'text-ds-text-caution-default-default',
  canceled: 'text-ds-text-neutral-default-default',
  rework: 'text-ds-text-warning-default-default',
};

const HEADER_COLOR: Record<TaskStatusBucket, string> = {
  draft: 'text-ds-text-neutral-muted-default',
  todo: 'text-ds-text-status-pending-muted-default',
  in_progress: 'text-ds-text-status-running-muted-default',
  done: 'text-ds-text-status-completed-muted-default',
  failed: 'text-ds-text-status-error-muted-default',
  human_review: 'text-ds-text-caution-muted-default',
  canceled: 'text-ds-text-neutral-muted-default',
  rework: 'text-ds-text-warning-muted-default',
};

const COLUMN_BACKGROUND: Record<TaskStatusBucket, string> = {
  draft: 'bg-ds-bg-neutral-default-disabled',
  todo: 'bg-ds-bg-status-pending-subtle-disabled',
  in_progress: 'bg-ds-bg-status-running-subtle-disabled',
  done: 'bg-ds-bg-status-completed-subtle-disabled',
  failed: 'bg-ds-bg-status-error-subtle-disabled',
  human_review: 'bg-ds-bg-caution-subtle-disabled',
  canceled: 'bg-ds-bg-neutral-subtle-disabled',
  rework: 'bg-ds-bg-warning-subtle-disabled',
};

type Props = {
  column: BoardColumnDef;
  onOpenSession?: (task: DashboardTask) => void;
};

export function BoardColumn({ column, onOpenSession }: Props) {
  return (
    <div
      className={cn(
        'scrollbar-always-visible gap-2 w-80 min-h-0 rounded-xl p-2 flex flex-shrink-0 flex-col overflow-x-hidden overflow-y-auto',
        COLUMN_BACKGROUND[column.id]
      )}
    >
      {/* header */}
      <div className={cn('gap-2 px-3 py-1 z-10 flex shrink-0 items-center')}>
        <span
          className={cn(
            '!text-label-sm font-bold',
            COLUMN_LABEL_TEXT[column.id]
          )}
        >
          {column.label}
        </span>
        <span
          className={cn(
            '!text-label-sm font-bold inline-flex items-center justify-center tabular-nums',
            HEADER_COLOR[column.id]
          )}
        >
          {column.tasks.length}
        </span>
      </div>

      {/* cards */}
      <div className="gap-2 flex flex-col">
        {column.tasks.length === 0 ? (
          <div className="rounded-xl border-ds-border-neutral-subtle-disabled px-3 py-6 text-label-xs text-ds-text-neutral-muted-default border border-dashed text-center">
            No tasks
          </div>
        ) : (
          column.tasks.map((task) => (
            <BoardTaskCard
              key={task.task_id}
              task={task}
              bucket={column.id}
              onOpenSession={onOpenSession}
            />
          ))
        )}
      </div>
    </div>
  );
}
