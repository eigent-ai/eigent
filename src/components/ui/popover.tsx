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

import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as React from 'react';

import { TooltipSimple } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Check, ChevronDown, CircleAlert } from 'lucide-react';
import {
  formFieldSelectSizeClasses,
  formFieldSelectTriggerState,
} from './formFieldSurface';
import { DS_FOCUS_RING } from './semanticProps';

export type PopoverSize = 'default' | 'sm';
export type PopoverState = 'error' | 'success';

type PopoverProps = React.ComponentPropsWithoutRef<
  typeof PopoverPrimitive.Root
> & {
  modal?: boolean;
};

// Default modal to false to allow keyboard input within trigger
const Popover = ({ modal = false, ...props }: PopoverProps) => (
  <PopoverPrimitive.Root modal={modal} {...props} />
);

const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverClose = PopoverPrimitive.Close;

type PopoverTriggerExtraProps = {
  size?: PopoverSize;
  state?: PopoverState;
  title?: string;
  tooltip?: string;
  note?: string;
  required?: boolean;
  showChevron?: boolean;
  leadingIcon?: React.ReactNode;
};

const PopoverTrigger = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Trigger> &
    PopoverTriggerExtraProps
>(
  (
    {
      className,
      children,
      size = 'default',
      state,
      title,
      tooltip,
      note,
      required = false,
      disabled,
      showChevron = true,
      leadingIcon,
      asChild,
      ...props
    },
    ref
  ) => {
    const stateCls = formFieldSelectTriggerState(state, Boolean(disabled));

    // When asChild is used, we need to ensure only a single child is passed
    // The custom wrapper UI (title, note, chevron) is incompatible with asChild
    if (asChild) {
      return (
        <PopoverPrimitive.Trigger
          ref={ref}
          disabled={disabled}
          asChild
          {...props}
        >
          {children}
        </PopoverPrimitive.Trigger>
      );
    }

    return (
      <div className={cn('w-full', stateCls.wrapper)}>
        {title ? (
          <div className="mb-1.5 flex items-center gap-1 text-ds-text-meta font-semibold text-ds-ink-default-default">
            <span>{title}</span>
            {required && <span className="text-ds-ink-default-default">*</span>}
            {tooltip && (
              <TooltipSimple content={tooltip}>
                <CircleAlert
                  size={16}
                  className="text-ds-ink-default-default"
                />
              </TooltipSimple>
            )}
          </div>
        ) : null}
        <PopoverPrimitive.Trigger
          ref={ref}
          disabled={disabled}
          className={cn(
            'relative flex w-full items-center justify-between gap-2 rounded-ds-field border border-x border-y border-solid px-ds-12 text-ds-ink-default-default transition-[background-color,border-color,box-shadow,opacity]',
            DS_FOCUS_RING,
            formFieldSelectSizeClasses[size],
            'whitespace-nowrap [&>span]:line-clamp-1',
            !state && 'bg-ds-neutral-default-default',
            state !== 'error' &&
              state !== 'success' && [
                'hover:bg-ds-neutral-default-hover hover:ring-1 hover:ring-ds-hairline-strong-default hover:ring-offset-0',
                'data-[state=open]:bg-ds-neutral-strong-default data-[state=open]:ring-1 data-[state=open]:ring-ds-ring-focus data-[state=open]:ring-offset-0',
              ],
            stateCls.trigger,
            'data-[placeholder]:text-ds-ink-muted-default/50',
            className
          )}
          {...props}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {leadingIcon && (
              <span className="shrink-0 text-ds-ink-default-default">
                {leadingIcon}
              </span>
            )}
            <span className="truncate">{children}</span>
          </div>
          {showChevron && (
            <ChevronDown className="h-4 w-4 shrink-0 text-ds-ink-default-default" />
          )}
        </PopoverPrimitive.Trigger>
        {note ? (
          <div className={cn('mt-1 text-xs', stateCls.note)}>{note}</div>
        ) : null}
      </div>
    );
  }
);
PopoverTrigger.displayName = PopoverPrimitive.Trigger.displayName;

type PopoverContentProps = React.ComponentPropsWithoutRef<
  typeof PopoverPrimitive.Content
> & {
  /**
   * When true, prevents the popover from closing when interacting outside.
   * Useful when the trigger contains an editable input.
   */
  preventCloseOnTriggerInteraction?: boolean;
};

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  PopoverContentProps
>(
  (
    {
      className,
      align = 'start',
      sideOffset = 4,
      onWheel,
      onTouchMove,
      onOpenAutoFocus,
      onInteractOutside,
      preventCloseOnTriggerInteraction = false,
      ...props
    },
    ref
  ) => {
    // Prevent scroll events from propagating to parent (e.g., dialog)
    const handleWheel = React.useCallback(
      (e: React.WheelEvent<HTMLDivElement>) => {
        e.stopPropagation();
        onWheel?.(e);
      },
      [onWheel]
    );

    const handleTouchMove = React.useCallback(
      (e: React.TouchEvent<HTMLDivElement>) => {
        e.stopPropagation();
        onTouchMove?.(e);
      },
      [onTouchMove]
    );

    // Prevent auto focus to keep focus on input when popover opens
    const handleOpenAutoFocus = React.useCallback(
      (e: Event) => {
        if (preventCloseOnTriggerInteraction) {
          e.preventDefault();
        }
        onOpenAutoFocus?.(e);
      },
      [onOpenAutoFocus, preventCloseOnTriggerInteraction]
    );

    // Prevent closing when clicking on trigger area (e.g., input inside trigger)
    const handleInteractOutside = React.useCallback(
      (e: Parameters<NonNullable<typeof onInteractOutside>>[0]) => {
        if (preventCloseOnTriggerInteraction) {
          const target = e.target as HTMLElement;
          // Check if the click is on the trigger or inside the trigger
          const trigger = target.closest('[data-radix-popover-trigger]');
          if (trigger) {
            e.preventDefault();
            return;
          }
        }
        onInteractOutside?.(e);
      },
      [onInteractOutside, preventCloseOnTriggerInteraction]
    );

    return (
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          ref={ref}
          align={align}
          sideOffset={sideOffset}
          onWheel={handleWheel}
          onTouchMove={handleTouchMove}
          onOpenAutoFocus={handleOpenAutoFocus}
          onInteractOutside={handleInteractOutside}
          className={cn(
            'relative z-50 min-w-[8rem] overflow-hidden rounded-ds-popover border border-x border-y border-solid border-ds-hairline-subtle-default bg-ds-neutral-default-default text-ds-ink-default-default shadow-ds-elevation-popover',
            'origin-(--radix-popover-content-transform-origin) data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
            'w-[var(--radix-popover-trigger-width)]',
            className
          )}
          {...props}
        />
      </PopoverPrimitive.Portal>
    );
  }
);
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

type PopoverItemProps = React.HTMLAttributes<HTMLDivElement> & {
  selected?: boolean;
  disabled?: boolean;
};

const PopoverItem = React.forwardRef<HTMLDivElement, PopoverItemProps>(
  ({ className, children, selected, disabled, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'relative flex min-h-ds-control-lg w-full cursor-pointer items-center rounded-ds-menu-row py-1.5 pr-8 pl-2 text-ds-text-base outline-none select-none hover:bg-ds-neutral-default-hover',
        disabled && 'pointer-events-none opacity-50',
        selected && 'bg-ds-neutral-default-hover',
        className
      )}
      {...props}
    >
      {selected && (
        <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
          <Check className="h-4 w-4" />
        </span>
      )}
      {children}
    </div>
  )
);
PopoverItem.displayName = 'PopoverItem';

type PopoverViewportProps = React.HTMLAttributes<HTMLDivElement> & {
  maxHeight?: string | number;
};

const PopoverViewport = React.forwardRef<HTMLDivElement, PopoverViewportProps>(
  ({ className, maxHeight = 200, style, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('overflow-x-hidden overflow-y-auto p-1', className)}
      style={{
        maxHeight: typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight,
        ...style,
      }}
      {...props}
    />
  )
);
PopoverViewport.displayName = 'PopoverViewport';

export {
  Popover,
  PopoverAnchor,
  PopoverClose,
  PopoverContent,
  PopoverItem,
  PopoverTrigger,
  PopoverViewport,
};
