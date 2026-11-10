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
import { forwardRef, type ComponentPropsWithoutRef } from 'react';

type StepSliderProps = Omit<
  ComponentPropsWithoutRef<'input'>,
  'type' | 'step' | 'value' | 'defaultValue' | 'onChange'
> & {
  value: number;
  onValueChange: (value: number) => void;
};

/** Thinking-effort slider chrome with a uniform pill track and thumb size. */
export const StepSlider = forwardRef<HTMLInputElement, StepSliderProps>(
  ({ className, onKeyDown, onValueChange, ...props }, ref) => {
    const min = Number(props.min ?? 0);
    const max = Number(props.max ?? 100);
    const ratio = max > min ? (props.value - min) / (max - min) : 0;
    const position = (stepRatio: number) =>
      `calc(${stepRatio * 100}% + ${1 - stepRatio * 2} * var(--ds-ref-space-10))`;

    return (
      <div className="relative h-ds-control-md w-full [@media(pointer:coarse)]:min-h-[var(--ds-touch-target-minimum)]">
        <input
          {...props}
          ref={ref}
          type="range"
          step={1}
          onChange={(event) => onValueChange(event.currentTarget.valueAsNumber)}
          onKeyDown={(event) => {
            if (props.disabled) return;
            const min = Number(props.min ?? 0);
            const max = Number(props.max ?? 100);
            const rtl =
              getComputedStyle(event.currentTarget).direction === 'rtl';
            let next = props.value;
            switch (event.key) {
              case 'ArrowRight':
                next += rtl ? -1 : 1;
                break;
              case 'ArrowLeft':
                next += rtl ? 1 : -1;
                break;
              default:
                onKeyDown?.(event);
                return;
            }
            // Horizontal arrows adjust density; vertical and boundary keys belong
            // to the containing menu.
            event.preventDefault();
            event.stopPropagation();
            onKeyDown?.(event);
            onValueChange(Math.min(max, Math.max(min, next)));
          }}
          className={cn(
            'peer !absolute !inset-0 z-20 !m-0 !h-full !min-h-0 !w-full cursor-pointer appearance-none !p-0 opacity-0 disabled:cursor-not-allowed',
            '[&::-moz-range-thumb]:size-ds-20 [&::-webkit-slider-thumb]:size-ds-20 [&::-webkit-slider-thumb]:appearance-none',
            className
          )}
        />
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-x-0 top-1/2 h-ds-16 -translate-y-1/2 rounded-full bg-ds-neutral-default-default ring-offset-2 ring-offset-ds-neutral-subtle-default peer-focus-visible:ring-2 peer-focus-visible:ring-ds-ring-focus',
            props.disabled && 'opacity-50'
          )}
        >
          <span className="absolute inset-0 overflow-hidden rounded-full">
            <span
              className="absolute inset-y-0 start-0 bg-ds-accent-strong-default transition-[width] duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
              style={{ width: `${ratio * 100}%` }}
            />
          </span>
          {Array.from({ length: max - min + 1 }, (_, index) => {
            const stepRatio = max > min ? index / (max - min) : 0;
            return (
              <span
                key={index}
                className={cn(
                  'absolute top-1/2 size-ds-2 -translate-x-1/2 -translate-y-1/2 rounded-full rtl:translate-x-1/2',
                  stepRatio <= ratio && ratio > 0
                    ? 'bg-ds-ink-inverse'
                    : 'bg-ds-ink-muted-default'
                )}
                style={{ insetInlineStart: position(stepRatio) }}
              />
            );
          })}
        </div>
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute top-1/2 z-10 size-ds-20 -translate-x-1/2 -translate-y-1/2 rounded-full border border-x border-y border-solid border-ds-hairline-subtle-default bg-ds-neutral-default-default shadow-ds-elevation-control transition-[inset-inline-start] duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none rtl:translate-x-1/2',
            props.disabled && 'opacity-50'
          )}
          style={{ insetInlineStart: position(ratio) }}
        />
      </div>
    );
  }
);
StepSlider.displayName = 'StepSlider';
