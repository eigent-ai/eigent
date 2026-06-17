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
import { Check } from 'lucide-react';
import { type ReactNode, forwardRef } from 'react';

/**
 * Small round count/label pill used next to accordion titles.
 */
export function CountPill({ count }: { count: number }) {
  return (
    <span className="bg-ds-bg-neutral-subtle-default text-ds-text-neutral-subtle-default text-label-xs font-bold px-1.5 inline-flex items-center justify-center rounded-full">
      {count}
    </span>
  );
}

/**
 * Small muted category label for grouping list items.
 */
export function CategoryLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'text-ds-text-neutral-muted-default text-body-xs px-1 pb-1 pt-2 first:pt-0',
        className
      )}
    >
      {children}
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
      className,
    },
    ref
  ) => {
    const showAffordance = Boolean(onClick || interactiveHover);
    const base = cn(
      'group gap-2 px-1.5 py-1.5 rounded-md min-w-0 w-full flex items-center',
      'text-ds-text-neutral-default-default text-body-sm text-left',
      'transition-colors',
      disabled
        ? 'opacity-50 pointer-events-none'
        : showAffordance
          ? cn(
              'cursor-pointer hover:bg-ds-bg-neutral-subtle-default active:bg-ds-bg-neutral-subtle-hover',
              onClick &&
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-ring-brand-default-focus/40'
            )
          : '',
      className
    );

    const content = (
      <>
        {leading ? (
          <span className="flex shrink-0 items-center">{leading}</span>
        ) : null}
        <span className="min-w-0 flex-1 truncate">{children}</span>
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
SidePanelListRow.displayName = 'SidePanelListRow';

/**
 * Progress circle. Incomplete: neutral subtle fill so the ring reads on any
 * panel background. Complete: filled success (matches primary success button)
 * with inverse check mark.
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
        'inline-flex shrink-0 items-center justify-center rounded-full border-[0.5px] border-solid',
        done
          ? 'border-ds-bg-success-default-default bg-ds-bg-success-default-default text-ds-text-success-inverse-default'
          : 'border-ds-border-neutral-default-default bg-ds-bg-neutral-subtle-default'
      )}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {done ? (
        <Check
          className="!text-ds-text-success-inverse-default"
          size={Math.max(8, size - 6)}
          strokeWidth={4}
        />
      ) : null}
    </span>
  );
}

/**
 * Thin connector line between two progress circles in the folded strip view.
 */
export function ProgressConnector() {
  return (
    <span
      className="bg-ds-border-neutral-default-default h-px min-w-[6px] flex-1"
      aria-hidden
    />
  );
}
