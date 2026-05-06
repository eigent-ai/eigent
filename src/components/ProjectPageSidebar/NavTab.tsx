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

import { TooltipSimple } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { WebSocketConnectionStatus } from '@/store/triggerStore';
import { motion } from 'framer-motion';
import { RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';

import {
  PROJECT_SIDEBAR_FOLD_SPRING,
  SIDEBAR_TOOLTIP_CONTENT_CLASS,
} from './constants';

/** Workspace tabs: layout identical expanded/folded so the leading icon does not jump — text clips as the rail narrows. */
export function workspaceTabButtonClass(active: boolean): string {
  return cn(
    'no-drag h-8 min-h-8 w-full min-w-0 shrink-0 rounded-xl cursor-pointer ease-in-out flex items-center justify-start gap-3 px-3 text-left outline-none overflow-hidden transition-colors duration-200',
    'text-ds-text-neutral-muted-default',
    'hover:bg-ds-bg-neutral-subtle-default focus-visible:ring-ds-ring-neutral-subtle-default focus-visible:ring-2 focus-visible:outline-none',
    active && 'bg-ds-bg-neutral-subtle-default'
  );
}

export const WORKSPACE_TAB_LABEL_CLASS =
  'min-w-0 flex-1 truncate text-ds-text-neutral-muted-default text-body-sm font-medium';

const SPLIT_MAIN_BUTTON_CLASS =
  'no-drag min-h-8 min-w-0 gap-3 rounded-xl py-0 px-3 relative flex flex-1 items-center text-left outline-none text-ds-text-neutral-muted-default focus-visible:ring-ds-ring-neutral-subtle-default hover:bg-transparent focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none';

const SPLIT_OUTER_EXTRA_CLASS =
  'min-w-0 gap-0 !p-0 relative flex items-stretch overflow-visible';

export function triggerListenerLeadIconClass(
  status: WebSocketConnectionStatus
): string {
  switch (status) {
    case 'connected':
      return 'text-ds-icon-neutral-muted-default';
    case 'connecting':
      return 'text-ds-icon-status-warning-default animate-pulse';
    case 'unhealthy':
      return 'text-ds-icon-status-error-default';
    case 'disconnected':
    default:
      return '!text-ds-icon-status-error-default';
  }
}

export interface NavTabReconnectSuffixProps {
  wsConnectionStatus: WebSocketConnectionStatus;
  onReconnect: () => void;
}

/** Reconnect button for the triggers tab — direct click, no dropdown. */
export function NavTabReconnectSuffix({
  wsConnectionStatus,
  onReconnect,
}: NavTabReconnectSuffixProps) {
  return (
    <TooltipSimple
      content="Reconnect to trigger listener"
      side="top"
      sideOffset={8}
      delayDuration={300}
    >
      <button
        type="button"
        className={cn(
          'no-drag h-8 w-8 rounded-xl text-ds-icon-neutral-muted-default hover:bg-ds-bg-neutral-strong-default flex shrink-0 items-center justify-center transition-colors outline-none',
          'focus-visible:ring-ds-ring-neutral-subtle-default focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none'
        )}
        aria-label="Reconnect to trigger listener"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onReconnect();
        }}
      >
        <RefreshCw
          className={cn(
            'h-3.5 w-3.5',
            wsConnectionStatus === 'connecting' && 'animate-spin'
          )}
          aria-hidden
        />
      </button>
    </TooltipSimple>
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
  /** Split only: extra control after `suffix`; shown when the tab row is hovered (or focused within). */
  endAction?: ReactNode;
  /** Override the max-width reveal class on the endAction wrapper (default: `group-hover:max-w-10`). */
  endActionMaxWidthClass?: string;
  tooltip: string;
  /** When true, tooltips are hidden (labels are visible in the fixed-width sidebar). */
  tooltipEnabledWhenCollapsed?: boolean;
  ariaLabel?: string;
  ariaCurrentPage?: boolean;
  /** Merged onto the outer control (`button` when simple, shell `div` when split). */
  className?: string;
  /** When `layout="split"`, extra classes on the primary `button` only. */
  mainButtonClassName?: string;
  /** Icon-only rail: fade/shrink label, trailing, and dot; keep leading icon fixed. */
  folded?: boolean;
}

function tabMainInner({
  leading,
  label,
  trailing,
  showNotificationDot,
  notificationDotClassName,
  notificationDotTone = 'default',
  folded = false,
}: Pick<
  NavTabProps,
  | 'leading'
  | 'label'
  | 'trailing'
  | 'showNotificationDot'
  | 'notificationDotClassName'
  | 'notificationDotTone'
  | 'folded'
>): ReactNode {
  return (
    <>
      {leading}
      <motion.div
        className="min-w-0 gap-3 flex flex-1 items-center overflow-hidden"
        initial={false}
        animate={{
          opacity: folded ? 0 : 1,
          maxWidth: folded ? 0 : 1600,
        }}
        transition={PROJECT_SIDEBAR_FOLD_SPRING}
        aria-hidden={folded}
        style={{ pointerEvents: folded ? 'none' : undefined }}
      >
        <span className={WORKSPACE_TAB_LABEL_CLASS}>{label}</span>
        {trailing}
        {showNotificationDot && (
          <span
            className={cn(
              'shrink-0 rounded-full transition-all duration-300',
              notificationDotTone === 'attention'
                ? 'bg-ds-text-status-error-strong-default'
                : 'bg-ds-bg-brand-default-default',
              notificationDotClassName
            )}
            aria-hidden
          />
        )}
      </motion.div>
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
  tooltip,
  tooltipEnabledWhenCollapsed = false,
  ariaLabel,
  ariaCurrentPage,
  className,
  mainButtonClassName,
  folded = false,
  endAction,
  endActionMaxWidthClass,
}: NavTabProps) {
  const inner = tabMainInner({
    leading,
    label,
    trailing,
    showNotificationDot,
    notificationDotClassName,
    notificationDotTone,
    folded,
  });

  const tooltipEnabled = folded || !tooltipEnabledWhenCollapsed;

  if (layout === 'split') {
    return (
      <TooltipSimple
        content={tooltip}
        side="right"
        align="center"
        enabled={tooltipEnabled}
        className={SIDEBAR_TOOLTIP_CONTENT_CLASS}
      >
        <div
          className={cn(
            workspaceTabButtonClass(active),
            SPLIT_OUTER_EXTRA_CLASS,
            'group',
            className
          )}
        >
          <button
            type="button"
            onClick={onClick}
            className={cn(
              SPLIT_MAIN_BUTTON_CLASS,
              folded && '!gap-0',
              mainButtonClassName
            )}
            aria-label={ariaLabel}
            aria-current={ariaCurrentPage ? 'page' : undefined}
          >
            {inner}
          </button>
          {suffix || endAction ? (
            <motion.div
              className="min-h-8 min-w-0 flex items-stretch overflow-hidden"
              initial={false}
              animate={{
                opacity: folded ? 0 : 1,
                maxWidth: folded ? 0 : 160,
              }}
              transition={PROJECT_SIDEBAR_FOLD_SPRING}
              aria-hidden={folded}
              style={{ pointerEvents: folded ? 'none' : undefined }}
            >
              {suffix}
              {endAction ? (
                <div
                  className={cn(
                    'max-w-0 ease-out flex shrink-0 items-center justify-end overflow-hidden opacity-0 transition-[max-width,opacity] duration-150',
                    'pointer-events-none opacity-0',
                    'group-hover:pointer-events-auto group-hover:opacity-100',
                    endActionMaxWidthClass ??
                      'group-hover:max-w-10 focus-within:max-w-10',
                    'focus-within:pointer-events-auto focus-within:opacity-100'
                  )}
                >
                  {endAction}
                </div>
              ) : null}
            </motion.div>
          ) : null}
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
      className={SIDEBAR_TOOLTIP_CONTENT_CLASS}
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          workspaceTabButtonClass(active),
          folded && 'gap-0',
          className
        )}
        aria-label={ariaLabel}
        aria-current={ariaCurrentPage ? 'page' : undefined}
      >
        {inner}
      </button>
    </TooltipSimple>
  );
}
