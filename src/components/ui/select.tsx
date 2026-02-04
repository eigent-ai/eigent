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
import { TooltipSimple } from './tooltip';

export type SelectSize = 'default' | 'sm';
// Only keep controllable states; hover/focus/default are automatic
export type SelectState = 'error' | 'success';

const Select = SelectPrimitive.Root;

const SelectGroup = SelectPrimitive.Group;

const SelectValue = SelectPrimitive.Value;

// Local copies to mirror Input behavior for size/state without importing internal helpers
const sizeClasses: Record<SelectSize, string> = {
  default: 'h-10 text-body-sm',
  sm: 'h-8 text-body-sm',
};

function resolveStateClasses(
  state: SelectState | undefined,
  disabled: boolean
) {
  if (disabled) {
    return {
      wrapper: 'opacity-50 cursor-not-allowed',
      trigger: 'border-transparent',
      note: 'text-text-label',
    };
  }
  if (state === 'error') {
    return {
      wrapper: '',
      trigger: 'border-input-border-cuation bg-input-bg-default',
      note: 'text-text-cuation',
    };
  }
  if (state === 'success') {
    return {
      wrapper: '',
      trigger: 'border-input-border-success bg-input-bg-confirm',
      note: 'text-text-success',
    };
  }
  return {
    wrapper: '',
    trigger: 'border-transparent',
    note: 'text-text-label',
  };
}

type SelectTriggerExtraProps = {
  size?: SelectSize;
  state?: SelectState;
  title?: string;
  note?: string;
  tooltip?: string;
  required?: boolean;
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
      state,
      title,
      note,
      disabled,
      tooltip,
      required = false,
      ...props
    },
    ref
  ) => {
    const stateCls = resolveStateClasses(state, Boolean(disabled));
    return (
      <div className={cn('w-full', stateCls.wrapper)}>
        {title ? (
          <div className="mb-1.5 flex items-center gap-1 text-body-sm font-bold text-text-heading">
            <span>{title}</span>
            {required && <span className="text-text-body">*</span>}
            {tooltip && (
              <TooltipSimple content={tooltip}>
                <CircleAlert size={16} className="text-icon-primary" />
              </TooltipSimple>
            )}
          </div>
        ) : null}
        <SelectPrimitive.Trigger
          ref={ref}
          disabled={disabled}
          className={cn(
            // Base styles
            'relative flex w-full items-center justify-between gap-2 rounded-lg border-solid px-3 text-text-body outline-none transition-all',
            sizeClasses[size],
            'whitespace-nowrap [&>span]:line-clamp-1',
            // Default state (when no error/success)
            !state && 'bg-input-bg-default',
            // Interactive states (only when no error/success state)
            state !== 'error' &&
              state !== 'success' && [
                'hover:bg-input-bg-hover hover:ring-1 hover:ring-input-border-hover hover:ring-offset-0',
                'focus-visible:ring-1 focus-visible:ring-input-border-focus focus-visible:ring-offset-0 data-[state=open]:bg-input-bg-input data-[state=open]:ring-1 data-[state=open]:ring-input-border-focus data-[state=open]:ring-offset-0',
              ],
            // Validation states (override defaults)
            stateCls.trigger,
            // Placeholder styling
            'data-[placeholder]:text-input-label-default/50',
            className
          )}
          {...props}
        >
          {children}
          <SelectPrimitive.Icon asChild>
            <ChevronDown className="h-4 w-4 text-icon-primary" />
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
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        'text-popover-foreground relative z-50 max-h-[--radix-select-content-available-height] min-w-[8rem] origin-[--radix-select-content-transform-origin] overflow-y-auto overflow-x-hidden rounded-lg border border-solid border-transparent bg-input-bg-default shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        position === 'popper' &&
          'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
        className
      )}
      position={position}
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
      'focus:bg-accent focus:text-accent-foreground relative flex w-full cursor-pointer select-none items-center rounded-lg py-1.5 pl-2 pr-8 text-sm outline-none hover:bg-menutabs-fill-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className
    )}
    {...props}
  >
    <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
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
    className={cn('bg-muted -mx-1 my-1 h-px', className)}
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
        'focus:bg-accent focus:text-accent-foreground group relative flex w-full cursor-pointer select-none items-center rounded-lg py-1.5 pl-2 pr-8 text-sm outline-none hover:bg-menutabs-fill-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
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
