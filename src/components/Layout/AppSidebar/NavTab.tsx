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

import { TooltipSimple, type TooltipVariant } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

import {
  SIDEBAR_FOLD_SPRING,
  SIDEBAR_TOOLTIP_CONTENT_CLASS,
} from './constants';

/** App-sidebar tabs keep the same layout while folding so the leading icon does not jump. */
export function sidebarTabButtonClass(active: boolean): string {
  return cn(
    'no-drag h-8 min-h-8 w-full min-w-0 shrink-0 rounded-xl cursor-pointer ease-in-out flex items-center justify-start gap-3 px-3 text-left outline-none overflow-hidden transition-colors duration-200',
    'hover:bg-ds-neutral-subtle-default focus-visible:ring-ds-hairline-subtle-default focus-visible:ring-2 focus-visible:outline-none',
    active
      ? [
          'bg-ds-neutral-subtle-default text-ds-ink-muted-default',
          // Beat global `button .lucide` color so icon matches label emphasis.
          '[&_.lucide]:!text-ds-ink-muted-default',
        ]
      : [
          'text-ds-ink-subtle-default',
          '[&_.lucide]:!text-ds-ink-subtle-default',
        ]
  );
}

export const SIDEBAR_TAB_LABEL_CLASS =
  'min-w-0 flex-1 truncate !text-ds-text-base font-medium';

const SPLIT_MAIN_BUTTON_CLASS =
  'no-drag min-h-8 min-w-0 gap-3 rounded-xl py-0 px-3 relative flex flex-1 items-center text-left outline-none focus-visible:ring-ds-hairline-subtle-default hover:bg-transparent focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none';

const SPLIT_OUTER_EXTRA_CLASS =
  'min-w-0 gap-0 !p-0 relative flex items-stretch overflow-visible';
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
   * Hover tooltip. Omit it on rails whose labels are always fully visible —
   * only rows that can truncate (project names) need one.
   */
  tooltip?: ReactNode;
  /** Removes tooltip vertical padding for a single-line shortcut label. */
  tooltipCompact?: boolean;
  /**
   * Tooltip open timing. Omit to keep the layout default (`instant` on simple
   * rows, `default` on split rows). Use `delayed` for labeled shortcut hints.
   */
  tooltipVariant?: TooltipVariant;
  /** When true, tooltips are hidden (labels are visible in the fixed-width sidebar). */
  tooltipEnabledWhenCollapsed?: boolean;
  ariaLabel?: string;
  /** Id of supporting text that describes this control. */
  ariaDescribedBy?: string;
  ariaCurrentPage?: boolean;
  /** Merged onto the outer control (`button` when simple, shell `div` when split). */
  className?: string;
  /** When `layout="split"`, extra classes on the primary `button` only. */
  mainButtonClassName?: string;
  /** Icon-only rail: fade/shrink label, trailing, and dot; keep leading icon fixed. */
  folded?: boolean;
  disabled?: boolean;
  /** Hover/focus hooks on the primary control (e.g. preloading a lazy section). */
  onPointerEnter?: () => void;
  onFocus?: () => void;
}

function tabMainInner({
  active,
  leading,
  label,
  trailing,
  showNotificationDot,
  notificationDotClassName,
  notificationDotTone = 'default',
  folded = false,
}: Pick<
  NavTabProps,
  | 'active'
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
        className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden"
        initial={false}
        animate={{
          opacity: folded ? 0 : 1,
          maxWidth: folded ? 0 : 1600,
        }}
        transition={SIDEBAR_FOLD_SPRING}
        aria-hidden={folded}
        style={{ pointerEvents: folded ? 'none' : undefined }}
      >
        <span
          className={cn(
            SIDEBAR_TAB_LABEL_CLASS,
            active ? 'text-ds-ink-muted-default' : 'text-ds-ink-subtle-default'
          )}
        >
          {label}
        </span>
        {trailing}
        {showNotificationDot && (
          <span
            className={cn(
              'shrink-0 rounded-full transition-colors duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)]',
              notificationDotTone === 'attention'
                ? 'bg-ds-text-status-error-strong-default'
                : 'bg-ds-accent-default-default',
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
 * Sidebar rail tab: leading icon, label, optional trailing chip, optional dot, optional split suffix.
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
  tooltipCompact = false,
  tooltipVariant,
  tooltipEnabledWhenCollapsed = false,
  ariaLabel,
  ariaDescribedBy,
  ariaCurrentPage,
  className,
  mainButtonClassName,
  folded = false,
  endAction,
  endActionMaxWidthClass,
  disabled = false,
  onPointerEnter,
  onFocus,
}: NavTabProps) {
  const inner = tabMainInner({
    active,
    leading,
    label,
    trailing,
    showNotificationDot,
    notificationDotClassName,
    notificationDotTone,
    folded,
  });

  const tooltipEnabled =
    Boolean(tooltip) && (folded || !tooltipEnabledWhenCollapsed);
  const resolvedTooltipVariant =
    tooltipVariant ?? (layout === 'split' ? 'default' : 'instant');

  if (layout === 'split') {
    return (
      <TooltipSimple
        content={tooltip}
        side="right"
        align="center"
        enabled={tooltipEnabled}
        compact={tooltipCompact}
        variant={resolvedTooltipVariant}
        className={SIDEBAR_TOOLTIP_CONTENT_CLASS}
      >
        <div
          className={cn(
            sidebarTabButtonClass(active),
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
              folded && '!gap-0',
              disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent',
              mainButtonClassName
            )}
            onPointerEnter={onPointerEnter}
            onFocus={onFocus}
            aria-label={ariaLabel}
            aria-describedby={ariaDescribedBy}
            aria-current={ariaCurrentPage ? 'page' : undefined}
            aria-disabled={disabled || undefined}
          >
            {inner}
          </button>
          {suffix || endAction ? (
            <motion.div
              className="flex min-h-8 min-w-0 items-stretch overflow-hidden"
              initial={false}
              animate={{
                opacity: folded ? 0 : 1,
                maxWidth: folded ? 0 : 160,
              }}
              transition={SIDEBAR_FOLD_SPRING}
              aria-hidden={folded}
              style={{ pointerEvents: folded ? 'none' : undefined }}
            >
              {suffix}
              {endAction ? (
                <div
                  className={cn(
                    'flex max-w-0 shrink-0 items-center justify-end overflow-hidden opacity-0 transition-[max-width,opacity] duration-150 ease-out',
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
      compact={tooltipCompact}
      variant={resolvedTooltipVariant}
      className={SIDEBAR_TOOLTIP_CONTENT_CLASS}
    >
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          onClick();
        }}
        className={cn(
          sidebarTabButtonClass(active),
          folded && 'gap-0',
          disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent',
          className
        )}
        onPointerEnter={onPointerEnter}
        onFocus={onFocus}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-current={ariaCurrentPage ? 'page' : undefined}
        aria-disabled={disabled || undefined}
      >
        {inner}
      </button>
    </TooltipSimple>
  );
}
