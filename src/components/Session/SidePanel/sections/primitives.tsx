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
import { cva, type VariantProps } from 'class-variance-authority';
import { motion, useReducedMotion } from 'framer-motion';
import { Check, ChevronDown, History } from 'lucide-react';
import {
  forwardRef,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

const SESSION_ROW_EASE: [number, number, number, number] = [0.32, 0.72, 0, 1];

/** Shared SidePanel row variants. */
export const sessionPanelRowVariants = cva(
  [
    'group flex h-10 min-h-10 w-full min-w-0 items-center gap-2 rounded-lg px-2 py-0 text-left',
    'transition-colors duration-150',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-ring-focus/40',
  ],
  {
    variants: {
      variant: {
        section: '!text-ds-text-base font-semibold text-ds-ink-default-default',
        subcategory:
          '!text-ds-text-base font-medium text-ds-ink-default-default',
        item: '!text-ds-text-base font-medium text-ds-ink-default-default',
        history: '!text-ds-text-base font-medium text-ds-ink-muted-default',
        earlier: '!text-ds-text-base font-medium text-ds-ink-muted-default',
      },
      interactive: {
        true: 'cursor-pointer',
        false: 'cursor-default',
      },
    },
    compoundVariants: [
      {
        variant: 'item',
        interactive: true,
        className:
          'hover:bg-ds-neutral-subtle-hover active:shadow-ds-elevation-control-pressed',
      },
    ],
    defaultVariants: {
      variant: 'item',
      interactive: true,
    },
  }
);

export type SessionPanelRowVariant = NonNullable<
  VariantProps<typeof sessionPanelRowVariants>['variant']
>;

type SessionPanelButtonProps = {
  leading?: ReactNode;
  children: ReactNode;
  badge?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  open?: boolean;
  completed?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  interactiveHover?: boolean;
  className?: string;
  variant?: SessionPanelRowVariant;
  ariaLabel?: string;
  ariaExpanded?: boolean;
};

/**
 * Shared 40px interaction row for section triggers, nested categories, items,
 * and the historical-items disclosure.
 */
export const SessionPanelButton = forwardRef<
  HTMLElement,
  SessionPanelButtonProps
>(
  (
    {
      leading,
      children,
      badge,
      trailing,
      chevron,
      open,
      completed,
      disabled,
      onClick,
      interactiveHover,
      className,
      variant = 'item',
      ariaLabel,
      ariaExpanded,
    },
    ref
  ) => {
    const interactive = Boolean(onClick || interactiveHover);
    const earlierRow = variant === 'earlier';
    const disclosureRow = variant !== 'item';
    const base = cn(
      sessionPanelRowVariants({ variant, interactive }),
      disabled && 'pointer-events-none opacity-50',
      className
    );
    const content = (
      <>
        {leading ? (
          <span className="flex size-4 shrink-0 items-center justify-center">
            {leading}
          </span>
        ) : null}
        <span
          className={cn(
            'min-w-0 truncate',
            disclosureRow && !earlierRow ? 'shrink' : 'flex-1',
            completed && 'line-through opacity-70'
          )}
        >
          {children}
        </span>
        {badge ? (
          <span className="flex shrink-0 items-center">{badge}</span>
        ) : null}
        {chevron ? (
          <ChevronDown
            className={cn(
              'size-4 shrink-0 text-ds-ink-muted-default transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none',
              earlierRow
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
              open ? 'rotate-0' : '-rotate-90'
            )}
            aria-hidden
          />
        ) : null}
        {trailing ? (
          <span className="flex shrink-0 items-center">{trailing}</span>
        ) : null}
      </>
    );

    if (onClick) {
      return (
        <button
          ref={ref as React.Ref<HTMLButtonElement>}
          type="button"
          onClick={onClick}
          disabled={disabled}
          className={base}
          aria-label={ariaLabel}
          aria-expanded={ariaExpanded}
        >
          {content}
        </button>
      );
    }

    return (
      <div ref={ref as React.Ref<HTMLDivElement>} className={base}>
        {content}
      </div>
    );
  }
);
SessionPanelButton.displayName = 'SessionPanelButton';

export function SessionPanelCollapse({
  open,
  children,
  className,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
}) {
  const shouldReduceMotion = useReducedMotion();
  const collapseRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    collapseRef.current?.toggleAttribute('inert', !open);
  }, [open]);
  return (
    <motion.div
      ref={collapseRef}
      initial={false}
      animate={{
        height: open ? 'auto' : 0,
        opacity: open ? 1 : 0,
      }}
      transition={
        shouldReduceMotion
          ? { duration: 0 }
          : {
              height: { duration: 0.26, ease: SESSION_ROW_EASE },
              opacity: { duration: open ? 0.18 : 0.12, ease: 'easeOut' },
            }
      }
      aria-hidden={!open}
      style={{ pointerEvents: open ? 'auto' : 'none' }}
      className={cn('min-h-0 w-full overflow-hidden', className)}
    >
      {children}
    </motion.div>
  );
}

/**
 * Small round count/label pill used next to accordion titles.
 */
export function CountPill({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center justify-center rounded-full bg-ds-neutral-subtle-default px-1.5 text-ds-text-meta font-bold text-ds-ink-subtle-default">
      {count}
    </span>
  );
}

/**
 * Keeps previous-run content available without adding per-item run metadata.
 * The owning task id remains on each row's action, so items can still navigate
 * back to the correct place in chat.
 */
export function EarlierItems({
  children,
  count,
  label,
}: {
  children: ReactNode;
  count: number;
  label?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (count === 0) return null;
  const resolvedLabel =
    label ??
    t('layout.session-panel-earlier', {
      defaultValue: 'Earlier',
    });

  return (
    <div className="flex min-w-0 flex-col">
      <SessionPanelButton
        variant="earlier"
        leading={<History size={16} aria-hidden />}
        chevron
        open={open}
        ariaExpanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {resolvedLabel}
      </SessionPanelButton>
      <SessionPanelCollapse open={open}>
        <div className="min-w-0">{children}</div>
      </SessionPanelCollapse>
    </div>
  );
}

type SidePanelListRowProps = {
  leading?: ReactNode;
  children: ReactNode;
  trailing?: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  /**
   * Pointer + subtle hover/active backgrounds without an action (e.g. read-only list rows).
   * When `onClick` is set, focus ring is included; for hover-only rows it is omitted.
   */
  interactiveHover?: boolean;
  completed?: boolean;
  className?: string;
};

/**
 * Row primitive used across Agent Pool / Execution Context / Agent Folder sections.
 * Rendered as a button when `onClick` is provided, otherwise a div.
 */
export const SidePanelListRow = forwardRef<HTMLElement, SidePanelListRowProps>(
  (
    {
      leading,
      children,
      trailing,
      disabled,
      onClick,
      interactiveHover,
      completed,
      className,
    },
    ref
  ) => {
    return (
      <SessionPanelButton
        ref={ref}
        variant="item"
        leading={leading}
        trailing={trailing}
        disabled={disabled}
        onClick={onClick}
        interactiveHover={interactiveHover}
        completed={completed}
        className={className}
      >
        {children}
      </SessionPanelButton>
    );
  }
);
SidePanelListRow.displayName = 'SidePanelListRow';

/**
 * Progress circle. Incomplete: neutral subtle fill so the ring reads on any
 * panel background. Complete: primary-success pair — strong fill with light
 * on-strong mark, same contrast contract as a success primary button.
 */
export function ProgressCircle({
  done,
  size = 14,
}: {
  done: boolean;
  size?: number;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full border-[0.5px] border-x-[0.5px] border-y-[0.5px] border-solid',
        done
          ? 'border-ds-bg-success-strong-default bg-ds-bg-success-strong-default text-ds-success-on-strong [&_svg]:!text-ds-success-on-strong'
          : 'border-ds-hairline-default-default bg-ds-neutral-subtle-default'
      )}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {done ? <Check size={Math.max(8, size - 6)} strokeWidth={4} /> : null}
    </span>
  );
}
