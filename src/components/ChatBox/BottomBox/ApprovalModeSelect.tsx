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
 * Approval-mode picker for the chat input bar — same pill-trigger shell as
 * `ThinkingEffortSelect` / `ModelSelect` / `ProjectModeToggle` so the
 * controls read as one family in the `BoxFooter` row.
 *
 * UI only for now: it holds its own local state and is not wired to the
 * human-toolkit / approval backend.
 */

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { Check, ChevronDown, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

export type ApprovalMode = 'manual' | 'skip';

interface ApprovalOption {
  value: ApprovalMode;
  label: string;
  icon: typeof ShieldCheck;
}

const APPROVAL_OPTIONS: ApprovalOption[] = [
  { value: 'manual', label: 'Manual Approval', icon: ShieldCheck },
  { value: 'skip', label: 'Skip all approval', icon: TriangleAlert },
];

// Keep in sync with `DropdownMenuContent`'s `w-[180px]` below.
const MENU_CONTENT_WIDTH_CLASS = 'w-[180px]';

const triggerShellClass = cn(
  'rounded-xl px-2 py-1 inline-flex max-w-[min(100%,320px)] shrink-0 items-center gap-1.5',
  'bg-ds-bg-neutral-default-default text-ds-text-neutral-default-default'
);

export interface ApprovalModeSelectProps {
  disabled?: boolean;
  /** Shows the current mode in the same read-only shell as the model/mode controls. */
  readOnly?: boolean;
  /** When true, hides the text label and shows only the icon (narrow footer). */
  compact?: boolean;
  className?: string;
}

export function ApprovalModeSelect({
  disabled,
  readOnly = false,
  compact = false,
  className,
}: ApprovalModeSelectProps) {
  const [value, setValue] = useState<ApprovalMode>('manual');

  const current =
    APPROVAL_OPTIONS.find((o) => o.value === value) ?? APPROVAL_OPTIONS[0];
  const CurrentIcon = current.icon;

  if (readOnly) {
    return (
      <div
        role="status"
        title={current.label}
        aria-label={current.label}
        className={cn(
          triggerShellClass,
          'pointer-events-none bg-transparent',
          { 'opacity-50': disabled },
          className
        )}
      >
        <span className="inline-flex min-h-[1.25rem] min-w-0 items-center gap-1.5 overflow-hidden">
          <CurrentIcon
            className="h-3.5 w-3.5 shrink-0 opacity-80"
            aria-hidden
          />
          {!compact && (
            <span className="min-w-0 truncate !text-label-xs font-semibold">
              {current.label}
            </span>
          )}
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
          title={current.label}
          aria-label={current.label}
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
            <CurrentIcon
              className="h-3.5 w-3.5 shrink-0 opacity-80"
              aria-hidden
            />
            {!compact && (
              <span className="min-w-0 flex-1 truncate text-left !text-label-xs text-ds-text-neutral-default-default">
                {current.label}
              </span>
            )}
          </span>
          <ChevronDown
            className="h-3.5 w-3.5 shrink-0 opacity-80"
            aria-hidden
            strokeWidth={2}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={4}
        collisionPadding={12}
        avoidCollisions
        className={MENU_CONTENT_WIDTH_CLASS}
      >
        {APPROVAL_OPTIONS.map((option) => {
          const OptionIcon = option.icon;
          return (
            <DropdownMenuItem
              key={option.value}
              onSelect={() => setValue(option.value)}
              className="flex items-center justify-between gap-2"
            >
              <span className="flex items-center gap-2">
                <OptionIcon
                  className="h-4 w-4 shrink-0 opacity-80"
                  aria-hidden
                />
                <span className="text-body-sm">{option.label}</span>
              </span>
              {value === option.value && (
                <Check className="h-4 w-4 text-ds-text-success-default-default" />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
