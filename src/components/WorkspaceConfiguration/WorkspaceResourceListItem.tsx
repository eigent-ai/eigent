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
import { cn } from '@/lib/utils';
import { ChevronRight, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';

interface WorkspaceResourceListItemProps {
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  leading?: ReactNode;
  editLabel: string;
  deleteLabel?: string;
  onEdit: () => void;
  onDelete?: () => void;
  className?: string;
}

export function WorkspaceResourceListItem({
  title,
  subtitle,
  meta,
  leading,
  editLabel,
  deleteLabel,
  onEdit,
  onDelete,
  className,
}: WorkspaceResourceListItemProps) {
  return (
    <div
      data-workspace-resource-list-item
      className={cn(
        'flex w-full min-w-0 items-center gap-2 rounded-xl bg-ds-neutral-subtle-default px-3 py-2',
        className
      )}
    >
      <button
        type="button"
        aria-label={editLabel}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ds-ring-focus"
        onClick={onEdit}
      >
        {leading ? (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ds-neutral-default-default text-ds-ink-default-default">
            {leading}
          </span>
        ) : null}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ds-text-base font-bold text-ds-ink-default-default">
            {title}
          </span>
          {subtitle ? (
            <span className="mt-0.5 block truncate text-ds-text-meta text-ds-ink-muted-default">
              {subtitle}
            </span>
          ) : null}
        </span>
        {meta ? (
          <span className="hidden shrink-0 text-ds-text-meta font-medium text-ds-ink-muted-default sm:inline">
            {meta}
          </span>
        ) : null}
        <ChevronRight
          className="h-4 w-4 shrink-0 text-ds-ink-muted-default"
          aria-hidden
        />
      </button>
      {onDelete && deleteLabel ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          buttonContent="icon-only"
          aria-label={deleteLabel}
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}
