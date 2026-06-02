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

const FOCUS_RING =
  'focus-visible:ring-2 focus-visible:ring-ds-ring-brand-default-focus focus-visible:ring-offset-2';

const variantClasses: Record<ButtonVariant, string> = {
  primary: [
    'border-ds-bg-brand-default-default bg-ds-bg-brand-default-default !text-ds-text-brand-inverse-default',
    'shadow-button-shadow',
    'hover:border-ds-bg-brand-default-hover hover:bg-ds-bg-brand-default-hover',
    'active:border-ds-bg-brand-default-active active:bg-ds-bg-brand-default-active',
    `focus-visible:border-ds-bg-brand-default-hover focus-visible:bg-ds-bg-brand-default-hover ${FOCUS_RING}`,
  ].join(' '),
  secondary: [
    'border-ds-bg-neutral-subtle-default bg-ds-bg-neutral-subtle-default !text-ds-text-neutral-default-default',
    'shadow-button-shadow',
    'hover:border-ds-bg-neutral-subtle-hover hover:bg-ds-bg-neutral-subtle-hover',
    'active:border-ds-bg-neutral-subtle-active active:bg-ds-bg-neutral-subtle-active',
    `focus-visible:border-ds-bg-neutral-subtle-hover focus-visible:bg-ds-bg-neutral-subtle-hover ${FOCUS_RING}`,
  ].join(' '),
  outline: [
    'border-ds-border-neutral-strong-default bg-transparent !text-ds-text-neutral-default-default',
    'shadow-button-shadow',
    'hover:border-ds-border-neutral-strong-hover hover:bg-ds-bg-neutral-subtle-hover',
    'active:border-ds-border-neutral-strong-default active:bg-ds-bg-neutral-default-active',
    `focus-visible:bg-ds-bg-neutral-subtle-hover ${FOCUS_RING}`,
  ].join(' '),
  ghost: [
    'border-transparent bg-transparent !text-ds-text-neutral-default-default',
    'hover:bg-ds-bg-neutral-default-hover active:bg-ds-bg-neutral-default-active',
    `focus-visible:bg-ds-bg-neutral-default-hover ${FOCUS_RING}`,
  ].join(' '),
  destructive: [
    'border-ds-bg-error-default-default bg-ds-bg-error-default-default !text-ds-text-error-inverse-default',
    'shadow-button-shadow',
    'hover:border-ds-bg-error-default-hover hover:bg-ds-bg-error-default-hover',
    'active:border-ds-bg-error-default-active active:bg-ds-bg-error-default-active',
    `focus-visible:border-ds-bg-error-default-hover focus-visible:bg-ds-bg-error-default-hover ${FOCUS_RING}`,
  ].join(' '),
};

const primaryToneClasses: Partial<
  Record<NonNullable<ButtonProps['tone']>, string>
> = {
  success: [
    'border-ds-bg-success-default-default bg-ds-bg-success-default-default !text-ds-text-success-inverse-default',
    'shadow-button-shadow',
    'hover:border-ds-bg-success-default-hover hover:bg-ds-bg-success-default-hover',
    'active:border-ds-bg-success-default-active active:bg-ds-bg-success-default-active',
    `focus-visible:border-ds-bg-success-default-hover focus-visible:bg-ds-bg-success-default-hover ${FOCUS_RING}`,
  ].join(' '),
};

/**
 * Tone-aware outline chrome (border-only, transparent fill) — mirrors the
 * desktop Button's `TONE_OUTLINE`. Used when `variant="outline"` with a
 * semantic `tone`. `neutral` keeps the default `variantClasses.outline`.
 */
const outlineToneClasses: Partial<
  Record<NonNullable<ButtonProps['tone']>, string>
> = {
  success: [
    'border-ds-border-success-default-default bg-transparent !text-ds-text-success-default-default',
    'shadow-button-shadow',
    'hover:border-ds-border-success-default-hover hover:bg-ds-bg-success-subtle-hover',
    'active:bg-ds-bg-success-subtle-active',
    `focus-visible:bg-ds-bg-success-subtle-hover ${FOCUS_RING}`,
  ].join(' '),
  error: [
    'border-ds-border-error-default-default bg-transparent !text-ds-text-error-default-default',
    'shadow-button-shadow',
    'hover:border-ds-border-error-default-hover hover:bg-ds-bg-error-subtle-hover',
    'active:bg-ds-bg-error-subtle-active',
    `focus-visible:bg-ds-bg-error-subtle-hover ${FOCUS_RING}`,
  ].join(' '),
  information: [
    'border-ds-border-information-default-default bg-transparent !text-ds-text-information-default-default',
    'shadow-button-shadow',
    'hover:border-ds-border-information-default-hover hover:bg-ds-bg-information-subtle-hover',
    'active:bg-ds-bg-information-subtle-active',
    `focus-visible:bg-ds-bg-information-subtle-hover ${FOCUS_RING}`,
  ].join(' '),
  warning: [
    'border-ds-border-warning-default-default bg-transparent !text-ds-text-warning-default-default',
    'shadow-button-shadow',
    'hover:border-ds-border-warning-default-hover hover:bg-ds-bg-warning-subtle-hover',
    'active:bg-ds-bg-warning-subtle-active',
    `focus-visible:bg-ds-bg-warning-subtle-hover ${FOCUS_RING}`,
  ].join(' '),
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
          'gap-2 font-semibold ease-in-out [&_svg]:h-4 [&_svg]:w-4 inline-flex shrink-0 cursor-pointer items-center justify-center border border-solid transition-all duration-200 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:!text-inherit',
          tone === 'error' && variant === 'primary'
            ? variantClasses.destructive
            : variant === 'primary' && tone && primaryToneClasses[tone]
              ? primaryToneClasses[tone]
              : variant === 'outline' &&
                  tone &&
                  tone !== 'neutral' &&
                  outlineToneClasses[tone]
                ? outlineToneClasses[tone]
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
