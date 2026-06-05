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
import {
  type FormFieldInputState,
  formFieldInputStateClasses,
  formFieldNoteTextClassName,
  formFieldSizeClasses,
} from './formFieldSurface';
import { formControlTokenAliases } from './tokenAliases';
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
    const [isComposing, setIsComposing] = React.useState(false);
    const { onKeyDown, onCompositionStart, onCompositionEnd, ...inputProps } =
      props;
    const stateCls = formFieldInputStateClasses(
      disabled ? 'disabled' : (state as FormFieldInputState)
    );
    const hasLeft = Boolean(leadingIcon);
    const hasRight = Boolean(backIcon) || Boolean(trailingButton);

    return (
      <div
        className={cn('w-full min-w-0', stateCls.container)}
        style={formControlTokenAliases}
      >
        {title ? (
          <div className="mb-1.5 flex items-center gap-1 text-body-sm font-bold text-ds-text-neutral-default-default">
            <span>{title}</span>
            {required && (
              <span className="text-ds-text-neutral-default-default">*</span>
            )}
            {optional && (
              <span className="rounded bg-ds-bg-neutral-muted-disabled px-1.5 py-0.5 text-xs font-normal text-ds-text-neutral-muted-default">
                (optional)
              </span>
            )}
            {tooltip && (
              <TooltipSimple content={tooltip}>
                <CircleAlert
                  size={16}
                  className="text-ds-icon-neutral-default-default"
                />
              </TooltipSimple>
            )}
          </div>
        ) : null}

        <div
          className={cn(
            'relative flex items-center rounded-xl border border-solid shadow-sm transition-colors',
            stateCls.field,
            formFieldSizeClasses[size],
            // After field base so hover / focus background wins; subtle surface on interaction
            state !== 'error' &&
              state !== 'success' && [
                'hover:bg-ds-bg-neutral-subtle-default',
                'focus-within:bg-ds-bg-neutral-subtle-default',
                'focus-within:ring-ds-ring-brand-default-focus hover:ring-ds-ring-neutral-strong-default',
                'focus-within:ring-1 focus-within:ring-offset-0 hover:ring-1 hover:ring-offset-0',
              ]
          )}
        >
          {leadingIcon ? (
            <span className="pointer-events-none absolute left-2 inline-flex h-5 w-5 items-center justify-center text-ds-icon-neutral-default-default">
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
              isComposing && 'placeholder:opacity-0',
              className
            )}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onEnter?.();
              }
              onKeyDown?.(e);
            }}
            onCompositionStart={(e) => {
              setIsComposing(true);
              onCompositionStart?.(e);
            }}
            onCompositionEnd={(e) => {
              setIsComposing(false);
              onCompositionEnd?.(e);
            }}
            {...inputProps}
          />

          {backIcon ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              buttonContent="icon-only"
              tabIndex={-1}
              className="absolute right-2 inline-flex items-center justify-center rounded-full text-ds-icon-neutral-default-default focus:ring-0 disabled:opacity-50"
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
              'mt-1.5 w-full min-w-0 overflow-hidden break-all !text-body-xs',
              formFieldNoteTextClassName(
                state === 'error'
                  ? 'error'
                  : state === 'success'
                    ? 'success'
                    : 'default'
              )
            )}
            dangerouslySetInnerHTML={{
              __html: note.replace(
                /(https?:\/\/[^\s]+)/g,
                '<a href="$1" target="_blank" rel="noopener noreferrer" class="underline text-ds-text-status-splitting-strong-default hover:opacity-70 cursor-pointer transition-opacity duration-200">$1</a>'
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
