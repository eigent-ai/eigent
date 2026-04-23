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
  formFieldNoteTextClassName,
  formFieldTextareaSizeClasses,
  formFieldTextareaStateClasses,
  type TextareaFormFieldState,
} from './formFieldSurface';
import { formControlTokenAliases, mergeAliasStyles } from './tokenAliases';
import { TooltipSimple } from './tooltip';

export type TextareaVariant = 'none' | 'enhanced';
export type TextareaSize = 'default' | 'sm';
export type TextareaState =
  | 'default'
  | 'hover'
  | 'input'
  | 'error'
  | 'success'
  | 'disabled';

type BaseTextareaProps = Omit<React.ComponentProps<'textarea'>, 'size'> & {
  variant?: TextareaVariant;
  size?: TextareaSize;
  state?: TextareaState;
  title?: string;
  tooltip?: string;
  note?: string;
  required?: boolean;
  leadingIcon?: React.ReactNode;
  backIcon?: React.ReactNode;
  onBackIconClick?: () => void;
  trailingButton?: React.ReactNode;
  onEnter?: () => void;
};

const Textarea = React.forwardRef<HTMLTextAreaElement, BaseTextareaProps>(
  (
    {
      className,
      variant = 'none',
      size = 'default',
      state = 'default',
      title,
      tooltip,
      note,
      required = false,
      leadingIcon,
      backIcon,
      onBackIconClick,
      trailingButton,
      disabled,
      placeholder,
      style,
      onEnter,
      ...props
    },
    ref
  ) => {
    const { onKeyDown, ...textareaProps } = props;
    // Original "none" variant - keep the original styling
    if (variant === 'none') {
      return (
        <>
          <textarea
            data-scrollbar="ui-textarea"
            className={cn(
              'border-ds-border-neutral-default-default placeholder:text-ds-text-neutral-muted-default/20 focus-visible:ring-ds-ring-brand-default-focus rounded-lg py-2 pl-3 pr-3 text-body-sm shadow-sm flex min-h-[60px] w-full border bg-transparent [scrollbar-gutter:stable] focus-visible:ring-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
              className
            )}
            style={mergeAliasStyles(formControlTokenAliases, {
              paddingRight: '4px',
              ...(style as React.CSSProperties),
            })}
            ref={ref}
            disabled={disabled}
            placeholder={placeholder}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                if (onEnter) {
                  e.preventDefault();
                  onEnter();
                }
              }
              onKeyDown?.(e);
            }}
            {...textareaProps}
          />
          <style>{`
            /* Firefox */
            [data-scrollbar="ui-textarea"] { scrollbar-width: thin; }
            /* Ensure 4px track in Firefox (thin is ~6px, so tighten via colors) */
            [data-scrollbar="ui-textarea"] { scrollbar-color: var(--scrollbar-thumb, rgba(0,0,0,0.3)) transparent; }
            /* WebKit */
            [data-scrollbar="ui-textarea"]::-webkit-scrollbar { width: 4px; height: 4px; }
            [data-scrollbar="ui-textarea"]::-webkit-scrollbar-thumb { background-color: var(--scrollbar-thumb, rgba(0,0,0,0.3)); border-radius: 9999px; }
            [data-scrollbar="ui-textarea"]::-webkit-scrollbar-track { background: transparent; }
          `}</style>
        </>
      );
    }

    // Enhanced variant with input-like functionality
    const stateCls = formFieldTextareaStateClasses(
      disabled ? 'disabled' : (state as TextareaFormFieldState)
    );
    const hasLeft = Boolean(leadingIcon);
    const hasRight = Boolean(backIcon) || Boolean(trailingButton);

    return (
      <>
        <div
          className={cn('w-full', stateCls.container)}
          style={formControlTokenAliases}
        >
          {title ? (
            <div className="mb-1.5 gap-1 text-body-sm font-bold text-ds-text-neutral-default-default flex items-center">
              <span>{title}</span>
              {required && (
                <span className="text-ds-text-neutral-default-default">*</span>
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
              'rounded-lg shadow-sm relative flex items-start border border-solid transition-all',
              stateCls.field,
              formFieldTextareaSizeClasses[size],
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
              <span className="left-2 top-2 h-5 w-5 text-ds-icon-neutral-default-default pointer-events-none absolute inline-flex items-center justify-center">
                {leadingIcon}
              </span>
            ) : null}

            <textarea
              data-scrollbar="ui-textarea"
              ref={ref}
              disabled={disabled}
              placeholder={placeholder}
              className={cn(
                'peer w-full resize-none border-none bg-transparent outline-none [scrollbar-gutter:stable] placeholder:transition-colors',
                stateCls.placeholder,
                hasLeft ? 'pl-9' : 'pl-3',
                hasRight ? 'pr-9' : 'pr-3',
                'pb-2 pt-2',
                className
              )}
              style={{ paddingRight: '4px', ...(style as React.CSSProperties) }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  if (onEnter) {
                    e.preventDefault();
                    onEnter();
                  }
                }
                onKeyDown?.(e);
              }}
              {...textareaProps}
            />

            {backIcon ? (
              <Button
                variant="ghost"
                size="xs"
                buttonContent="icon-only"
                type="button"
                tabIndex={-1}
                disabled={disabled}
                onClick={onBackIconClick}
              >
                {backIcon}
              </Button>
            ) : null}

            {trailingButton ? (
              <div
                className={cn(
                  'right-2 top-2 absolute',
                  backIcon ? '-mr-7' : ''
                )}
              >
                {trailingButton}
              </div>
            ) : null}
          </div>

          {note ? (
            <div
              className={cn(
                'mt-1.5 !text-body-xs',
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
        <style>{`
          /* Firefox */
          [data-scrollbar="ui-textarea"] { scrollbar-width: thin; }
          /* Ensure 4px track in Firefox (thin is ~6px, so tighten via colors) */
          [data-scrollbar="ui-textarea"] { scrollbar-color: var(--scrollbar-thumb, rgba(0,0,0,0.3)) transparent; }
          /* WebKit */
          [data-scrollbar="ui-textarea"]::-webkit-scrollbar { width: 4px; height: 4px; }
          [data-scrollbar="ui-textarea"]::-webkit-scrollbar-thumb { background-color: var(--scrollbar-thumb, rgba(0,0,0,0.3)); border-radius: 9999px; }
          [data-scrollbar="ui-textarea"]::-webkit-scrollbar-track { background: transparent; }
        `}</style>
      </>
    );
  }
);
Textarea.displayName = 'Textarea';

export { Textarea };
