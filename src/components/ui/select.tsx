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

import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp, CircleAlert } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  formFieldSelectSizeClasses,
  formFieldSelectTriggerState,
} from './formFieldSurface';
import { formControlTokenAliases, mergeAliasStyles } from './tokenAliases';
import { TooltipSimple } from './tooltip';

export type SelectSize = keyof typeof formFieldSelectSizeClasses;
/** Primary: default surface. Secondary: subtle surface for nested or lower-emphasis fields. */
export type SelectVariant = 'primary' | 'secondary';
// Only keep controllable states; hover/focus/default are automatic
export type SelectState = 'error' | 'success';

const variantTriggerBase: Record<SelectVariant, string> = {
  primary: 'bg-ds-neutral-default-default',
  secondary: 'bg-ds-neutral-subtle-default',
};

const variantTriggerInteractive: Record<SelectVariant, [string, string]> = {
  primary: [
    'hover:bg-ds-neutral-default-hover hover:ring-ds-hairline-strong-default hover:ring-1 hover:ring-offset-0',
    'focus-visible:ring-ds-ring-focus data-[state=open]:bg-ds-neutral-strong-default data-[state=open]:ring-ds-ring-focus focus-visible:ring-1 focus-visible:ring-offset-0 data-[state=open]:ring-1 data-[state=open]:ring-offset-0',
  ],
  secondary: [
    'hover:bg-ds-neutral-subtle-hover hover:ring-ds-hairline-strong-default hover:ring-1 hover:ring-offset-0',
    'focus-visible:ring-ds-ring-focus data-[state=open]:bg-ds-neutral-default-default data-[state=open]:ring-ds-ring-focus focus-visible:ring-1 focus-visible:ring-offset-0 data-[state=open]:ring-1 data-[state=open]:ring-offset-0',
  ],
};

const Select = SelectPrimitive.Root;

const SelectGroup = SelectPrimitive.Group;

const SelectValue = SelectPrimitive.Value;

type SelectTriggerExtraProps = {
  size?: SelectSize;
  variant?: SelectVariant;
  state?: SelectState;
  title?: string;
  note?: string;
  tooltip?: string;
  required?: boolean;
  /** Outer wrapper width; default `w-fit` keeps intrinsic width for inline selects. */
  wrapperClassName?: string;
};

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> &
    SelectTriggerExtraProps
>(
  (
    {
      className,
      children,
      size = 'default',
      variant = 'primary',
      state,
      title,
      note,
      disabled,
      tooltip,
      required = false,
      wrapperClassName,
      style,
      ...props
    },
    ref
  ) => {
    const stateCls = formFieldSelectTriggerState(state, Boolean(disabled));
    return (
      <div className={cn(wrapperClassName ?? 'w-fit', stateCls.wrapper)}>
        {title ? (
          <div className="mb-1.5 flex items-center gap-1 text-ds-text-meta font-bold text-ds-ink-default-default">
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
        <SelectPrimitive.Trigger
          ref={ref}
          disabled={disabled}
          className={cn(
            // Base styles
            'relative flex w-full items-center justify-between gap-2 rounded-xl border border-x border-y border-solid px-3 text-ds-ink-default-default transition-[background-color,border-color,box-shadow,opacity] outline-none',
            formFieldSelectSizeClasses[size],
            'whitespace-nowrap [&>span]:line-clamp-1',
            // Default surface (when no error/success)
            !state && variantTriggerBase[variant],
            // Interactive states (only when enabled and no error/success state).
            // Disabled triggers still match :hover, so the hover/focus classes
            // must be withheld or the disabled select keeps reacting to hover.
            !disabled &&
              state !== 'error' &&
              state !== 'success' &&
              variantTriggerInteractive[variant],
            // Validation states (override defaults)
            stateCls.trigger,
            // Placeholder styling
            'data-[placeholder]:text-ds-ink-muted-default/50',
            className
          )}
          style={mergeAliasStyles(formControlTokenAliases, style)}
          {...props}
        >
          {children}
          <SelectPrimitive.Icon asChild>
            <ChevronDown className="h-4 w-4 text-ds-ink-default-default" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        {note ? (
          <div className={cn('mt-1 text-xs', stateCls.note)}>{note}</div>
        ) : null}
      </div>
    );
  }
);
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn(
      'flex cursor-default items-center justify-center py-1',
      className
    )}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn(
      'flex cursor-default items-center justify-center py-1',
      className
    )}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName =
  SelectPrimitive.ScrollDownButton.displayName;

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', style, ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        'relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-ds-popover border border-x border-y border-solid border-ds-hairline-subtle-default bg-ds-neutral-subtle-default text-ds-ink-default-default shadow-ds-elevation-popover data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
        position === 'popper' &&
          'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
        className
      )}
      position={position}
      style={mergeAliasStyles(formControlTokenAliases, style)}
      {...props}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={cn(
          'p-1',
          position === 'popper' &&
            'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]'
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn('px-2 py-1.5 text-sm font-semibold', className)}
    {...props}
  />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex min-h-ds-control-lg w-full cursor-pointer items-center rounded-ds-menu-row py-1.5 pr-8 pl-2 text-ds-text-base outline-none select-none hover:bg-ds-neutral-default-hover focus-visible:text-ds-ink-default-default focus-visible:ring-2 focus-visible:ring-ds-ring-focus focus-visible:ring-inset data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className
    )}
    {...props}
  >
    <span className="absolute inset-y-0 right-2 my-auto flex size-4 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn('-mx-1 my-1 h-px bg-ds-hairline-default-default', className)}
    {...props}
  />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

type SelectItemWithButtonProps = {
  value: string;
  label: React.ReactNode;
  enabled: boolean;
  buttonText?: string;
  onButtonClick?: (e: React.MouseEvent) => void;
  className?: string;
};

const SelectItemWithButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  SelectItemWithButtonProps
>(
  (
    {
      value,
      label,
      enabled,
      buttonText = 'Setting',
      onButtonClick,
      className,
      ...props
    },
    ref
  ) => (
    <SelectPrimitive.Item
      ref={ref}
      value={value}
      disabled={!enabled}
      className={cn(
        'group relative flex min-h-ds-control-lg w-full cursor-pointer items-center rounded-ds-menu-row py-1.5 pr-8 pl-2 text-ds-text-base outline-none select-none hover:bg-ds-neutral-default-hover focus-visible:text-ds-ink-default-default focus-visible:ring-2 focus-visible:ring-ds-ring-focus focus-visible:ring-inset data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className
      )}
      {...props}
    >
      <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-4 w-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <div className="flex w-full items-center justify-between">
        <SelectPrimitive.ItemText>{label}</SelectPrimitive.ItemText>
        {!enabled && onButtonClick && (
          <Button
            variant="outline"
            size="sm"
            className="ml-2 opacity-0 transition-opacity group-hover:opacity-100"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onButtonClick(e);
            }}
          >
            {buttonText}
          </Button>
        )}
      </div>
    </SelectPrimitive.Item>
  )
);
SelectItemWithButton.displayName = 'SelectItemWithButton';

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectItemWithButton,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
