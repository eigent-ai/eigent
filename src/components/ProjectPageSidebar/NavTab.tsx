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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { TooltipSimple } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { WebSocketConnectionStatus } from '@/store/triggerStore';
import { RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';

/** Workspace tabs: layout identical expanded/folded so the leading icon does not jump — text clips as the rail narrows. */
export function workspaceTabButtonClass(active: boolean): string {
  return cn(
    'no-drag h-8 min-h-8 w-full min-w-0 shrink-0 rounded-xl cursor-pointer flex items-center justify-start gap-3 px-3 text-left outline-none overflow-hidden',
    'hover:bg-surface-tertiary focus-visible:ring-2 focus-visible:ring-border-secondary focus-visible:outline-none',
    active && 'bg-surface-tertiary'
  );
}

export const WORKSPACE_TAB_LABEL_CLASS =
  'min-w-0 flex-1 truncate text-text-label text-body-sm font-medium';

const SPLIT_MAIN_BUTTON_CLASS =
  'no-drag min-h-8 min-w-0 gap-3 rounded-xl py-0 pl-3 pr-1 relative flex flex-1 items-center text-left outline-none focus-visible:ring-border-secondary hover:bg-transparent focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none';

const SPLIT_OUTER_EXTRA_CLASS =
  'min-w-0 gap-0 !p-0 relative flex items-stretch overflow-visible';

export function triggerListenerLeadIconClass(
  status: WebSocketConnectionStatus
): string {
  switch (status) {
    case 'connected':
      return 'text-icon-primary';
    case 'connecting':
      return 'text-icon-warning animate-pulse';
    case 'unhealthy':
      return 'text-icon-caution';
    case 'disconnected':
    default:
      return 'text-icon-secondary';
  }
}

export interface NavTabReconnectSuffixProps {
  wsConnectionStatus: WebSocketConnectionStatus;
  reconnectHint: string;
  reconnectButtonLabel: string;
  onReconnect: () => void;
}

/** Optional right control for {@link NavTab} `layout="split"` (e.g. triggers reconnect). */
export function NavTabReconnectSuffix({
  wsConnectionStatus,
  reconnectHint,
  reconnectButtonLabel,
  onReconnect,
}: NavTabReconnectSuffixProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'no-drag text-icon-secondary hover:bg-surface-tertiary h-8 w-8 rounded-xl flex shrink-0 items-center justify-center transition-colors outline-none',
            'focus-visible:ring-border-secondary focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none'
          )}
          aria-label={reconnectHint}
        >
          <RefreshCw
            className={cn(
              'h-3.5 w-3.5',
              wsConnectionStatus === 'connecting' && 'animate-spin'
            )}
            aria-hidden
          />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-4" side="right" align="start">
        <div className="gap-3 flex flex-col">
          <p className="text-body-sm text-text-body">{reconnectHint}</p>
          <Button
            variant="primary"
            size="sm"
            className="w-full items-center justify-center"
            onClick={onReconnect}
          >
            <RefreshCw
              className={cn(
                'mr-2 h-4 w-4',
                wsConnectionStatus === 'connecting' && 'animate-spin'
              )}
              aria-hidden
            />
            {reconnectButtonLabel}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export type NavTabLayout = 'simple' | 'split';

export interface NavTabProps {
  active: boolean;
  onClick: () => void;
  leading: ReactNode;
  label: ReactNode;
  /** Tag or secondary affordance after the label. */
  trailing?: ReactNode;
  showNotificationDot?: boolean;
  notificationDotClassName?: string;
  /** Inbox-style dot vs triggers-style attention dot. */
  notificationDotTone?: 'default' | 'attention';
  /**
   * `simple` — one full-width control (default).
   * `split` — shell row with a primary control plus optional `suffix` (e.g. extra icon button).
   */
  layout?: NavTabLayout;
  suffix?: ReactNode;
  collapsed: boolean;
  tooltip: string;
  tooltipEnabledWhenCollapsed?: boolean;
  ariaLabel?: string;
  ariaCurrentPage?: boolean;
  /** Merged onto the outer control (`button` when simple, shell `div` when split). */
  className?: string;
  /** When `layout="split"`, extra classes on the primary `button` only. */
  mainButtonClassName?: string;
}

function tabMainInner({
  leading,
  label,
  trailing,
  showNotificationDot,
  notificationDotClassName,
  notificationDotTone = 'default',
}: Pick<
  NavTabProps,
  | 'leading'
  | 'label'
  | 'trailing'
  | 'showNotificationDot'
  | 'notificationDotClassName'
  | 'notificationDotTone'
>): ReactNode {
  return (
    <>
      {leading}
      <span className={WORKSPACE_TAB_LABEL_CLASS}>{label}</span>
      {trailing}
      {showNotificationDot && (
        <span
          className={cn(
            'shrink-0 rounded-full transition-all duration-300',
            notificationDotTone === 'attention'
              ? 'bg-text-error'
              : 'bg-red-500',
            notificationDotClassName
          )}
          aria-hidden
        />
      )}
    </>
  );
}

/**
 * Project page sidebar rail tab: leading icon, label, optional trailing chip, optional dot, optional split suffix.
 * Add new tabs by composing `leading` / `trailing` / `suffix`; use `layout="split"` when the row needs a separate end control.
 */
export function NavTab({
  active,
  onClick,
  leading,
  label,
  trailing,
  showNotificationDot,
  notificationDotClassName,
  notificationDotTone = 'default',
  layout = 'simple',
  suffix,
  collapsed,
  tooltip,
  tooltipEnabledWhenCollapsed = false,
  ariaLabel,
  ariaCurrentPage,
  className,
  mainButtonClassName,
}: NavTabProps) {
  const inner = tabMainInner({
    leading,
    label,
    trailing,
    showNotificationDot,
    notificationDotClassName,
    notificationDotTone,
  });

  const tooltipEnabled = tooltipEnabledWhenCollapsed ? collapsed : true;

  if (layout === 'split') {
    return (
      <TooltipSimple
        content={tooltip}
        side="right"
        align="center"
        enabled={tooltipEnabled}
      >
        <div
          className={cn(
            workspaceTabButtonClass(active),
            SPLIT_OUTER_EXTRA_CLASS,
            className
          )}
        >
          <button
            type="button"
            onClick={onClick}
            className={cn(SPLIT_MAIN_BUTTON_CLASS, mainButtonClassName)}
            aria-label={ariaLabel}
            aria-current={ariaCurrentPage ? 'page' : undefined}
          >
            {inner}
          </button>
          {suffix}
        </div>
      </TooltipSimple>
    );
  }

  return (
    <TooltipSimple
      content={tooltip}
      side="right"
      align="center"
      enabled={tooltipEnabled}
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(workspaceTabButtonClass(active), className)}
        aria-label={ariaLabel}
        aria-current={ariaCurrentPage ? 'page' : undefined}
      >
        {inner}
      </button>
    </TooltipSimple>
  );
}
