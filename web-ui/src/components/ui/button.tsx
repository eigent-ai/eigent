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
import { Slot } from '@radix-ui/react-slot';
import * as React from 'react';

type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'destructive';
type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean;
  variant?: ButtonVariant;
  tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'error' | 'information';
  size?: ButtonSize;
  buttonContent?: 'text' | 'icon-only';
  buttonRadius?: 'lg' | 'full';
};

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'border-ds-bg-brand-default-default bg-ds-bg-brand-default-default text-ds-text-brand-inverse-default hover:bg-ds-bg-brand-default-hover',
  secondary:
    'border-ds-border-neutral-subtle-default bg-ds-bg-neutral-default-default text-ds-text-neutral-default-default hover:bg-ds-bg-neutral-default-hover',
  outline:
    'border-ds-border-neutral-default-default bg-transparent text-ds-text-neutral-default-default hover:bg-ds-bg-neutral-subtle-hover',
  ghost:
    'border-transparent bg-transparent text-ds-text-neutral-default-default hover:bg-ds-bg-neutral-subtle-hover',
  destructive:
    'border-ds-bg-error-default-default bg-ds-bg-error-default-default text-ds-text-error-inverse-default hover:bg-ds-bg-error-default-hover',
};

const sizeClasses: Record<ButtonSize, string> = {
  xs: 'h-7 px-2 text-body-xs',
  sm: 'h-8 px-3 text-body-sm',
  md: 'h-10 px-4 text-body-sm',
  lg: 'h-11 px-5 text-body-md',
};

const iconSizeClasses: Record<ButtonSize, string> = {
  xs: 'h-7 w-7 p-0',
  sm: 'h-8 w-8 p-0',
  md: 'h-10 w-10 p-0',
  lg: 'h-11 w-11 p-0',
};

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      asChild,
      className,
      variant = 'primary',
      tone,
      size = 'md',
      buttonContent = 'text',
      buttonRadius = 'lg',
      type = 'button',
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : type}
        className={cn(
          'inline-flex shrink-0 items-center justify-center gap-2 border border-solid font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-ring-brand-default-focus disabled:pointer-events-none disabled:opacity-50 [&_svg]:h-4 [&_svg]:w-4',
          tone === 'error' && variant === 'primary'
            ? variantClasses.destructive
            : variantClasses[variant],
          buttonContent === 'icon-only'
            ? iconSizeClasses[size]
            : sizeClasses[size],
          buttonRadius === 'full' ? 'rounded-full' : 'rounded-lg',
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button };
