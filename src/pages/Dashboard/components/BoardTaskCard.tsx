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
import type { DashboardTask, TaskStatusBucket } from '@/types/dashboard';
import { format } from 'date-fns';
import { Coins } from 'lucide-react';

const CARD_BACKGROUND: Record<TaskStatusBucket, string> = {
  draft: 'bg-ds-bg-neutral-subtle-default',
  todo: 'bg-ds-bg-status-pending-subtle-default',
  in_progress: 'bg-ds-bg-status-running-subtle-default',
  done: 'bg-ds-bg-status-completed-subtle-default',
  failed: 'bg-ds-bg-status-error-subtle-default',
  human_review: 'bg-ds-bg-caution-subtle-default',
  canceled: 'bg-ds-bg-neutral-subtle-default',
  rework: 'bg-ds-bg-warning-subtle-default',
};

const CARD_BORDER: Record<TaskStatusBucket, string> = {
  draft: 'border-ds-border-neutral-subtle-hover',
  todo: 'border-ds-border-status-pending-subtle-hover',
  in_progress: 'border-ds-border-status-running-subtle-hover',
  done: 'border-ds-border-status-completed-subtle-hover',
  failed: 'border-ds-border-status-error-subtle-hover',
  human_review: 'border-ds-border-caution-subtle-hover',
  canceled: 'border-ds-border-neutral-subtle-hover',
  rework: 'border-ds-border-warning-subtle-hover',
};

type Props = {
  task: DashboardTask;
  bucket: TaskStatusBucket;
  onOpenSession?: (task: DashboardTask) => void;
};

export function BoardTaskCard({ task, bucket, onOpenSession }: Props) {
  const title = task.summary ?? task.question;

  const createdAt = task.created_at ? new Date(task.created_at) : null;
  const dateStr = createdAt ? format(createdAt, 'MMM d') : null;

  return (
    <button
      type="button"
      onClick={() => onOpenSession?.(task)}
      className={cn(
        'group w-full text-left',
        CARD_BACKGROUND[bucket],
        CARD_BORDER[bucket],
        'rounded-xl px-3 py-3 border border-solid',
        'gap-2.5 flex cursor-pointer flex-col',
        'focus-visible:ring-ds-ring-brand-default-focus focus-visible:ring-offset-ds-bg-neutral-subtle-default focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none'
      )}
    >
      <span className="!text-label-xs font-bold text-ds-text-neutral-default-default min-w-0 block w-full truncate overflow-hidden">
        {task.project_name}
      </span>

      <p className="text-body-sm font-medium text-ds-text-neutral-default-default m-0 min-w-0 leading-snug line-clamp-3 w-full overflow-hidden break-words">
        {title}
      </p>

      <div className="gap-2 flex flex-col items-start justify-between">
        <span className="text-label-xs text-ds-text-neutral-muted-default">
          {dateStr ?? '—'}
        </span>
        <span className="text-label-xs text-ds-text-neutral-muted-default gap-1 inline-flex items-center">
          <Coins size={10} className="shrink-0" />
          {task.tokens?.toLocaleString() ?? '0'}
        </span>
      </div>
    </button>
  );
}
