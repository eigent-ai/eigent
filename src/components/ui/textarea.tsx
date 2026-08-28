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
  'default' | 'hover' | 'input' | 'error' | 'success' | 'disabled';

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
    const {
      onKeyDown,
      onCompositionStart,
      onCompositionEnd,
      ...textareaProps
    } = props;
    const [isComposing, setIsComposing] = React.useState(false);
    // Original "none" variant - keep the original styling
    if (variant === 'none') {
      return (
        <>
          <textarea
            {...textareaProps}
            data-scrollbar="ui-textarea"
            className={cn(
              'flex min-h-[4rem] w-full [scrollbar-gutter:stable] rounded-ds-field border border-x border-y border-ds-hairline-default-default bg-transparent py-2 pr-3 pl-3 text-ds-text-base shadow-sm placeholder:text-ds-ink-muted-default focus-visible:ring-2 focus-visible:ring-ds-ring-focus focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
              isComposing && 'placeholder:opacity-0',
              className
            )}
            style={mergeAliasStyles(formControlTokenAliases, {
              paddingRight: '4px',
              ...(style as React.CSSProperties),
            })}
            ref={ref}
            disabled={disabled}
            placeholder={placeholder}
            onCompositionStart={(e) => {
              setIsComposing(true);
              onCompositionStart?.(e);
            }}
            onCompositionEnd={(e) => {
              setIsComposing(false);
              onCompositionEnd?.(e);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                if (onEnter) {
                  e.preventDefault();
                  onEnter();
                }
              }
              onKeyDown?.(e);
            }}
          />
          <style>{`
            /* Firefox */
            [data-scrollbar="ui-textarea"] { scrollbar-width: thin; }
            /* Ensure 4px track in Firefox (thin is ~6px, so tighten via colors) */
            [data-scrollbar="ui-textarea"] { scrollbar-color: var(--scrollbar-thumb, var(--colors-black-30)) transparent; }
            /* WebKit */
            [data-scrollbar="ui-textarea"]::-webkit-scrollbar { width: 4px; height: 4px; }
            [data-scrollbar="ui-textarea"]::-webkit-scrollbar-thumb { background-color: var(--scrollbar-thumb, var(--colors-black-30)); border-radius: 9999px; }
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
            <div className="mb-1.5 flex items-center gap-1 text-ds-text-meta font-bold text-ds-ink-default-default">
              <span>{title}</span>
              {required && (
                <span className="text-ds-ink-default-default">*</span>
              )}
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

          <div
            className={cn(
              'relative flex items-start rounded-lg border border-x border-y border-solid shadow-sm transition-[background-color,border-color,box-shadow,opacity]',
              stateCls.field,
              formFieldTextareaSizeClasses[size],
              state !== 'error' &&
                state !== 'success' && [
                  'hover:bg-ds-neutral-subtle-default',
                  'focus-within:bg-ds-neutral-subtle-default',
                  'focus-within:ring-ds-ring-focus hover:ring-ds-hairline-strong-default',
                  'focus-within:ring-1 focus-within:ring-offset-0 hover:ring-1 hover:ring-offset-0',
                ]
            )}
          >
            {leadingIcon ? (
              <span className="pointer-events-none absolute top-2 left-2 inline-flex h-5 w-5 items-center justify-center text-ds-ink-default-default">
                {leadingIcon}
              </span>
            ) : null}

            <textarea
              {...textareaProps}
              data-scrollbar="ui-textarea"
              ref={ref}
              disabled={disabled}
              placeholder={placeholder}
              className={cn(
                'peer w-full resize-none [scrollbar-gutter:stable] border-none bg-transparent outline-none placeholder:transition-colors',
                stateCls.placeholder,
                hasLeft ? 'pl-6' : 'pl-0',
                hasRight ? 'pr-6' : 'pr-0',
                'pt-2 pb-2',
                isComposing && 'placeholder:opacity-0',
                className
              )}
              style={{ paddingRight: '4px', ...(style as React.CSSProperties) }}
              onCompositionStart={(e) => {
                setIsComposing(true);
                onCompositionStart?.(e);
              }}
              onCompositionEnd={(e) => {
                setIsComposing(false);
                onCompositionEnd?.(e);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  if (onEnter) {
                    e.preventDefault();
                    onEnter();
                  }
                }
                onKeyDown?.(e);
              }}
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
                  'absolute top-2 right-2',
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
                'mt-1.5 !text-ds-text-meta',
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
          [data-scrollbar="ui-textarea"] { scrollbar-color: var(--scrollbar-thumb, var(--colors-black-30)) transparent; }
          /* WebKit */
          [data-scrollbar="ui-textarea"]::-webkit-scrollbar { width: 4px; height: 4px; }
          [data-scrollbar="ui-textarea"]::-webkit-scrollbar-thumb { background-color: var(--scrollbar-thumb, var(--colors-black-30)); border-radius: 9999px; }
          [data-scrollbar="ui-textarea"]::-webkit-scrollbar-track { background: transparent; }
        `}</style>
      </>
    );
  }
);
Textarea.displayName = 'Textarea';

export { Textarea };
