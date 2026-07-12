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
import { RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { SIDEBAR_TOOLTIP_CONTENT_CLASS } from './constants';

/** Workspace tabs: leading icon column stays fixed; text truncates as the sidebar narrows. */
export function workspaceTabButtonClass(active: boolean): string {
  return cn(
    'no-drag h-8 min-h-8 w-full min-w-0 shrink-0 rounded-lg cursor-pointer ease-in-out flex items-center justify-start gap-3 px-3 text-left outline-none overflow-hidden transition-colors duration-200',
    'text-ds-text-neutral-muted-default',
    'hover:bg-ds-bg-neutral-subtle-default focus-visible:ring-ds-ring-neutral-subtle-default focus-visible:ring-2 focus-visible:outline-none',
    active && 'bg-ds-bg-neutral-subtle-default'
  );
}

export const WORKSPACE_TAB_LABEL_CLASS =
  'min-w-0 flex-1 truncate text-ds-text-neutral-muted-default text-body-sm font-medium';

const SPLIT_MAIN_BUTTON_CLASS =
  'no-drag min-h-8 min-w-0 gap-3 rounded-lg py-0 px-3 relative flex flex-1 items-center text-left outline-none text-ds-text-neutral-muted-default focus-visible:ring-ds-ring-neutral-subtle-default hover:bg-transparent focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none';

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
  const { t } = useTranslation();
  const reconnectLabel = t('layout.triggers-reconnect-hint');
  return (
    <TooltipSimple
      content={reconnectLabel}
      side="top"
      sideOffset={8}
      delayDuration={300}
    >
      <button
        type="button"
        className={cn(
          'no-drag flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ds-icon-neutral-muted-default outline-none transition-colors hover:bg-ds-bg-neutral-strong-default',
          'focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-ring-neutral-subtle-default'
        )}
        aria-label={reconnectLabel}
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
  /**
   * Hover hint shown whenever provided (e.g. a disabled-state explanation).
   * Labels are always visible in the sidebar, so omit when the tooltip would
   * just repeat `label`.
   */
  tooltip?: string;
  ariaLabel?: string;
  ariaCurrentPage?: boolean;
  /** Merged onto the outer control (`button` when simple, shell `div` when split). */
  className?: string;
  /** When `layout="split"`, extra classes on the primary `button` only. */
  mainButtonClassName?: string;
  disabled?: boolean;
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
      <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
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
      </div>
    </>
  );
}

/**
 * Project page sidebar tab: leading icon, label, optional trailing chip, optional dot, optional split suffix.
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
  ariaLabel,
  ariaCurrentPage,
  className,
  mainButtonClassName,
  endAction,
  endActionMaxWidthClass,
  disabled = false,
}: NavTabProps) {
  const inner = tabMainInner({
    leading,
    label,
    trailing,
    showNotificationDot,
    notificationDotClassName,
    notificationDotTone,
  });

  const control =
    layout === 'split' ? (
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
          onClick={() => {
            if (disabled) return;
            onClick();
          }}
          className={cn(
            SPLIT_MAIN_BUTTON_CLASS,
            disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent',
            mainButtonClassName
          )}
          aria-label={ariaLabel}
          aria-current={ariaCurrentPage ? 'page' : undefined}
          aria-disabled={disabled || undefined}
        >
          {inner}
        </button>
        {suffix || endAction ? (
          <div className="flex min-h-8 min-w-0 max-w-40 items-stretch overflow-hidden">
            {suffix}
            {endAction ? (
              <div
                className={cn(
                  'flex max-w-0 shrink-0 items-center justify-end overflow-hidden opacity-0 transition-[max-width,opacity] duration-150 ease-out',
                  'pointer-events-none opacity-0',
                  'group-hover:pointer-events-auto group-hover:opacity-100',
                  endActionMaxWidthClass ??
                    'focus-within:max-w-10 group-hover:max-w-10',
                  'focus-within:pointer-events-auto focus-within:opacity-100'
                )}
              >
                {endAction}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    ) : (
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          onClick();
        }}
        className={cn(
          workspaceTabButtonClass(active),
          disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent',
          className
        )}
        aria-label={ariaLabel}
        aria-current={ariaCurrentPage ? 'page' : undefined}
        aria-disabled={disabled || undefined}
      >
        {inner}
      </button>
    );

  if (!tooltip) {
    return control;
  }

  return (
    <TooltipSimple
      content={tooltip}
      side="right"
      align="center"
      className={SIDEBAR_TOOLTIP_CONTENT_CLASS}
    >
      {control}
    </TooltipSimple>
  );
}
