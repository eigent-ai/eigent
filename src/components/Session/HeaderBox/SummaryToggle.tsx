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

import { SUMMARY_WIDTH } from '@/components/Session/layout/sessionColumns';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ShortcutTooltipContent } from '@/components/ui/shortcut-tooltip';
import { TooltipSimple } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { SquareMenu } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export interface SummaryToggleProps {
  /** Summary is docked as a column. */
  open: boolean;
  onToggle: () => void;
  /**
   * Summary content to show over chat when there is no room to dock it. When
   * set, the toggle opens this popover instead of calling `onToggle`.
   */
  popover?: ReactNode;
  popoverOpen?: boolean;
  onPopoverOpenChange?: (open: boolean) => void;
  /** Element the popover stays within (the chat side). */
  popoverBoundary?: HTMLElement | null;
}

export function SummaryToggle({
  open,
  onToggle,
  popover,
  popoverOpen = false,
  onPopoverOpenChange,
  popoverBoundary,
}: SummaryToggleProps) {
  const { t } = useTranslation();
  const label = t('layout.session-summary', { defaultValue: 'Summary' });
  const pressed = open || popoverOpen;

  const button = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      buttonContent="icon-only"
      aria-label={label}
      aria-pressed={pressed}
      onClick={popover ? undefined : onToggle}
      className={cn(
        'no-drag shrink-0 text-ds-ink-muted-default',
        pressed && 'bg-ds-neutral-strong-default text-ds-ink-default-default'
      )}
    >
      <SquareMenu aria-hidden />
    </Button>
  );
  const trigger = (
    <TooltipSimple
      content={
        <ShortcutTooltipContent
          label={label}
          shortcutId="toggle-session-side-panel"
        />
      }
      compact
      variant="instant"
      side="bottom"
    >
      {popover ? <PopoverTrigger asChild>{button}</PopoverTrigger> : button}
    </TooltipSimple>
  );

  if (!popover) return trigger;
  return (
    <Popover open={popoverOpen} onOpenChange={onPopoverOpenChange}>
      {trigger}
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={8}
        collisionBoundary={popoverBoundary}
        collisionPadding={8}
        aria-label={label}
        className="flex max-w-[var(--radix-popover-content-available-width)] flex-col p-ds-4"
        style={{
          // Matches the docked column (split-pane-geometry exception).
          width: SUMMARY_WIDTH,
          height: 'var(--radix-popover-content-available-height)',
        }}
      >
        {popover}
      </PopoverContent>
    </Popover>
  );
}
