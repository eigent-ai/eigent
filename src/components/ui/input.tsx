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

import * as React from 'react';

import { cn } from '@/lib/utils';
import { CircleAlert } from 'lucide-react';
import { Button } from './button';
import { TooltipSimple } from './tooltip';

export type InputSize = 'default' | 'sm';
export type InputState =
  | 'default'
  | 'hover'
  | 'input'
  | 'error'
  | 'success'
  | 'disabled';

type BaseInputProps = Omit<React.ComponentProps<'input'>, 'size'> & {
  size?: InputSize;
  state?: InputState;
  title?: string;
  tooltip?: string;
  note?: string;
  required?: boolean;
  optional?: boolean;
  leadingIcon?: React.ReactNode;
  backIcon?: React.ReactNode;
  onBackIconClick?: () => void;
  trailingButton?: React.ReactNode;
  onEnter?: () => void;
};

const sizeClasses: Record<InputSize, string> = {
  default: 'h-10 text-body-sm md:text-sm',
  sm: 'h-8 text-body-sm',
};

function resolveStateClasses(state: InputState | undefined) {
  if (state === 'disabled') {
    return {
      container: 'opacity-50 cursor-not-allowed',
      field: 'border-input-border-default bg-input-bg-default',
      input: 'text-text-heading',
      placeholder: 'placeholder-input-label-default',
    };
  }
  if (state === 'hover') {
    return {
      container: '',
      field: 'border-input-border-hover bg-input-bg-default',
      input: 'text-text-heading',
      placeholder: 'placeholder-input-label-default',
    };
  }
  if (state === 'input') {
    return {
      container: '',
      field: 'border-input-border-focus bg-input-bg-input',
      input: 'text-text-heading',
      placeholder: 'placeholder-input-label-default',
    };
  }
  if (state === 'error') {
    return {
      container: '',
      field: 'border-input-border-cuation bg-input-bg-default',
      input: 'text-text-heading',
      placeholder: 'placeholder-input-label-default',
    };
  }
  if (state === 'success') {
    return {
      container: '',
      field: 'border-input-border-success bg-input-bg-confirm',
      input: 'text-text-heading',
      placeholder: 'placeholder-input-label-default',
    };
  }
  return {
    container: '',
    field: 'border-input-border-default bg-input-bg-default',
    input: 'text-text-heading',
    placeholder: 'placeholder-input-label-default/10',
  };
}

const Input = React.forwardRef<HTMLInputElement, BaseInputProps>(
  (
    {
      className,
      type,
      size = 'default',
      state = 'default',
      title,
      tooltip,
      note,
      required = false,
      optional = false,
      leadingIcon,
      backIcon,
      onBackIconClick,
      trailingButton,
      disabled,
      placeholder,
      onEnter,
      ...props
    },
    ref
  ) => {
    const { onKeyDown, ...inputProps } = props;
    const stateCls = resolveStateClasses(disabled ? 'disabled' : state);
    const hasLeft = Boolean(leadingIcon);
    const hasRight = Boolean(backIcon) || Boolean(trailingButton);

    return (
      <div className={cn('w-full', stateCls.container)}>
        {title ? (
          <div className="mb-1.5 flex items-center gap-1 text-body-sm font-bold text-text-heading">
            <span>{title}</span>
            {required && <span className="text-text-body">*</span>}
            {optional && (
              <span className="rounded bg-surface-disabled px-1.5 py-0.5 text-xs font-normal text-text-label">
                (optional)
              </span>
            )}
            {tooltip && (
              <TooltipSimple content={tooltip}>
                <CircleAlert size={16} className="text-icon-primary" />
              </TooltipSimple>
            )}
          </div>
        ) : null}

        <div
          className={cn(
            'relative flex items-center rounded-lg border border-solid shadow-sm transition-colors',
            // Only apply hover/focus visuals when not in error state
            state !== 'error' &&
              state !== 'success' &&
              'focus-within:bg-input-bg-input focus-within:ring-1 focus-within:ring-input-border-focus focus-within:ring-offset-0 hover:bg-input-bg-hover hover:ring-1 hover:ring-input-border-hover hover:ring-offset-0',
            stateCls.field,
            sizeClasses[size]
          )}
        >
          {leadingIcon ? (
            <span className="pointer-events-none absolute left-2 inline-flex h-5 w-5 items-center justify-center text-icon-primary">
              {leadingIcon}
            </span>
          ) : null}

          <input
            type={type}
            ref={ref}
            disabled={disabled}
            placeholder={placeholder}
            className={cn(
              'peer w-full bg-transparent outline-none file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:transition-colors',
              stateCls.input,
              stateCls.placeholder,
              hasLeft ? 'pl-9' : 'pl-3',
              hasRight ? 'pr-9' : 'pr-3',
              className
            )}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onEnter?.();
              }
              onKeyDown?.(e);
            }}
            {...inputProps}
          />

          {backIcon ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              tabIndex={-1}
              className="absolute right-2 inline-flex h-5 w-5 items-center justify-center rounded-full text-icon-primary focus:ring-0 disabled:opacity-50"
              disabled={disabled}
              onClick={onBackIconClick}
            >
              {backIcon}
            </Button>
          ) : null}

          {trailingButton ? (
            <div className={cn('absolute right-2', backIcon ? '-mr-7' : '')}>
              {trailingButton}
            </div>
          ) : null}
        </div>

        {note ? (
          <div
            className={cn(
              'mt-1.5 !text-body-xs',
              state === 'error'
                ? 'text-text-cuation'
                : state === 'success'
                  ? 'text-text-success'
                  : 'text-text-label'
            )}
            dangerouslySetInnerHTML={{
              __html: note.replace(
                /(https?:\/\/[^\s]+)/g,
                '<a href="$1" target="_blank" rel="noopener noreferrer" class="underline text-text-information hover:opacity-70 cursor-pointer transition-opacity duration-200">$1</a>'
              ),
            }}
          />
        ) : null}
      </div>
    );
  }
);
Input.displayName = 'Input';

export { Input };
