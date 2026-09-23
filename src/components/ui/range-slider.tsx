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
import { DS_FOCUS_RING } from './semanticProps';

export type RangeSliderProps = Omit<ComponentPropsWithoutRef<'input'>, 'type'>;

/** Native range input with a full-height semantic track and thumb. */
export const RangeSlider = forwardRef<HTMLInputElement, RangeSliderProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      type="range"
      className={cn(
        'h-ds-icon-md w-full cursor-pointer appearance-none rounded-full bg-ds-neutral-strong-default disabled:cursor-not-allowed disabled:opacity-50',
        '[&::-webkit-slider-runnable-track]:h-ds-icon-md [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent',
        '[&::-webkit-slider-thumb]:size-ds-icon-md [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-ds-neutral-subtle-default [&::-webkit-slider-thumb]:shadow-ds-elevation-control [&::-webkit-slider-thumb]:ring-1 [&::-webkit-slider-thumb]:ring-ds-hairline-default-default',
        '[&::-moz-range-track]:h-ds-icon-md [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent',
        '[&::-moz-range-thumb]:size-ds-icon-md [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-x-0 [&::-moz-range-thumb]:border-y-0 [&::-moz-range-thumb]:bg-ds-neutral-subtle-default [&::-moz-range-thumb]:shadow-ds-elevation-control [&::-moz-range-thumb]:ring-1 [&::-moz-range-thumb]:ring-ds-hairline-default-default',
        DS_FOCUS_RING,
        className
      )}
      {...props}
    />
  )
);
RangeSlider.displayName = 'RangeSlider';
