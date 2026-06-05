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

import * as SwitchPrimitives from '@radix-ui/react-switch';
import * as React from 'react';

import { cn } from '@/lib/utils';
import { mergeAliasStyles, switchTokenAliases } from './tokenAliases';

export type SwitchSize = 'default' | 'sm';
export type SwitchVariant = 'default' | 'outline';

type SwitchProps = React.ComponentPropsWithoutRef<
  typeof SwitchPrimitives.Root
> & {
  size?: SwitchSize;
  variant?: SwitchVariant;
};

const sizeClasses = {
  default: {
    root: 'h-6 w-11',
    thumb: 'h-5 w-5 data-[state=checked]:translate-x-5',
  },
  sm: {
    root: 'h-4 w-8',
    thumb: 'h-3 w-3 data-[state=checked]:translate-x-4',
  },
};

const variantClasses: Record<SwitchVariant, { root: string; thumb: string }> = {
  default: {
    root: 'shadow-sm border-transparent data-[state=checked]:bg-ds-bg-status-completed-default-default data-[state=unchecked]:bg-ds-bg-neutral-subtle-default',
    thumb: 'bg-ds-text-brand-inverse-default',
  },
  outline: {
    root: 'data-[state=checked]:bg-ds-bg-status-completed-default-default data-[state=checked]:border-ds-border-status-completed-default-default data-[state=unchecked]:bg-ds-bg-neutral-default-default data-[state=unchecked]:border-ds-border-neutral-default-default',
    thumb:
      'bg-ds-text-brand-inverse-default data-[state=unchecked]:bg-ds-bg-neutral-strong-default',
  },
};

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  SwitchProps
>(
  (
    { className, size = 'default', variant = 'default', style, ...props },
    ref
  ) => (
    <SwitchPrimitives.Root
      className={cn(
        'peer inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-ring-brand-default-focus focus-visible:ring-offset-2 focus-visible:ring-offset-ds-bg-neutral-subtle-default disabled:cursor-not-allowed disabled:opacity-50',
        sizeClasses[size].root,
        variantClasses[variant].root,
        className
      )}
      style={mergeAliasStyles(switchTokenAliases, style)}
      {...props}
      ref={ref}
    >
      <SwitchPrimitives.Thumb
        className={cn(
          'pointer-events-none block rounded-full shadow-lg ring-0 transition-transform data-[state=unchecked]:translate-x-0',
          sizeClasses[size].thumb,
          variantClasses[variant].thumb
        )}
      />
    </SwitchPrimitives.Root>
  )
);
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
