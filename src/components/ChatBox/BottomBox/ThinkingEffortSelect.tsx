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

/**
 * Reasoning/thinking effort picker for the chat input bar — same pill-trigger
 * shell as `ModelSelect` / `ProjectModeToggle` so the three controls
 * read as one family in the `BoxFooter` row.
 */

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { ThinkingEffort, type ThinkingEffortType } from '@/types/constants';
import { Check, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface ThinkingEffortSelectProps {
  value: ThinkingEffortType;
  onValueChange?: (effort: ThinkingEffortType) => void;
  disabled?: boolean;
  /** Shows the current effort in the same read-only shell as the model/mode controls. */
  readOnly?: boolean;
  className?: string;
}

const EFFORT_OPTIONS: ThinkingEffortType[] = [
  ThinkingEffort.LIGHT,
  ThinkingEffort.MEDIUM,
  ThinkingEffort.HIGH,
  ThinkingEffort.EXTRA_HIGH,
  ThinkingEffort.ULTRA,
];

// Keep in sync with `DropdownMenuContent`'s `w-[160px]` below.
const MENU_CONTENT_WIDTH_CLASS = 'w-[160px]';

const triggerShellClass = cn(
  'rounded-xl px-2 py-1 inline-flex max-w-[min(100%,320px)] shrink-0 items-center gap-1.5',
  'bg-ds-bg-neutral-default-default text-ds-text-neutral-default-default'
);

export function ThinkingEffortSelect({
  value,
  onValueChange,
  disabled,
  readOnly = false,
  className,
}: ThinkingEffortSelectProps) {
  const { t } = useTranslation();

  const effortLabel = (effort: ThinkingEffortType) =>
    t(`layout.thinking-effort-${effort}`);

  const currentLabel = effortLabel(value);

  if (readOnly) {
    return (
      <div
        role="status"
        title={currentLabel}
        aria-label={currentLabel}
        className={cn(
          triggerShellClass,
          'pointer-events-none bg-transparent',
          { 'opacity-50': disabled },
          className
        )}
      >
        <span className="inline-flex min-h-[1.25rem] min-w-0 items-center gap-1.5 overflow-hidden">
          <span className="min-w-0 truncate !text-label-xs font-semibold">
            {currentLabel}
          </span>
        </span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={currentLabel}
          aria-label={currentLabel}
          aria-haspopup="menu"
          className={cn(
            triggerShellClass,
            'min-w-0 cursor-pointer border-0 text-left',
            'justify-between font-semibold transition-colors',
            'hover:bg-ds-bg-neutral-subtle-default active:bg-ds-bg-neutral-subtle-default data-[state=open]:bg-ds-bg-neutral-subtle-default',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-border-neutral-strong-default focus-visible:ring-offset-2 focus-visible:ring-offset-ds-bg-neutral-default-default',
            'disabled:pointer-events-none disabled:opacity-50',
            className
          )}
        >
          <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            <span className="min-w-0 flex-1 truncate text-left !text-label-xs text-ds-text-neutral-default-default">
              {currentLabel}
            </span>
          </span>
          <ChevronDown
            className="h-3.5 w-3.5 shrink-0 opacity-80"
            aria-hidden
            strokeWidth={2}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="top"
        sideOffset={4}
        collisionPadding={12}
        avoidCollisions
        className={MENU_CONTENT_WIDTH_CLASS}
      >
        {EFFORT_OPTIONS.map((effort) => (
          <DropdownMenuItem
            key={effort}
            onSelect={() => onValueChange?.(effort)}
            className="flex items-center justify-between"
          >
            <span className="text-body-sm">{effortLabel(effort)}</span>
            {value === effort && (
              <Check className="h-4 w-4 text-ds-text-success-default-default" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
