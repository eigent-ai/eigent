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

import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';
import {
  normalizeUiTone,
  type UiTone,
  type UiToneInput,
} from './semanticProps';

const alertBase =
  'relative w-full rounded-lg border px-4 py-3 text-sm [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg~*]:pl-7';

const alertVariants = cva(alertBase, {
  variants: {
    tone: {
      neutral:
        'border-ds-border-neutral-default-default bg-ds-bg-neutral-default-default text-ds-text-neutral-default-default [&>svg]:text-ds-text-neutral-default-default',
      error:
        'border-ds-border-status-error-default-default/50 text-ds-text-status-error-strong-default [&>svg]:text-ds-text-status-error-strong-default',
      success:
        'border-ds-border-status-completed-default-default/50 text-ds-text-status-completed-strong-default [&>svg]:text-ds-text-status-completed-strong-default',
      warning:
        'border-ds-border-status-pending-default-default/50 text-ds-text-status-pending-strong-default [&>svg]:text-ds-text-status-pending-strong-default',
      information:
        'border-ds-border-status-splitting-default-default/50 text-ds-text-status-splitting-strong-default [&>svg]:text-ds-text-status-splitting-strong-default',
    },
  },
  defaultVariants: {
    tone: 'neutral',
  },
});

/**
 * @deprecated Use `Alert` with `tone` (see {@link AlertToneInput}). `default` and
 * `destructive` map to `tone="neutral"` and `tone="error"` for compatibility.
 */
export type AlertVariant = 'default' | 'destructive';

export type AlertToneInput = UiToneInput;

function resolveAlertTone(
  tone: UiToneInput | undefined,
  /**
   * @deprecated Use `tone` instead
   */
  variant: AlertVariant | undefined
): UiTone {
  if (tone !== undefined) {
    return normalizeUiTone(tone);
  }
  if (variant === 'destructive') {
    return 'error';
  }
  return 'neutral';
}

export type AlertProps = React.HTMLAttributes<HTMLDivElement> &
  Omit<VariantProps<typeof alertVariants>, 'tone'> & {
    /** Semantic palette; aligns with `semanticProps` / `Button` `tone`. */
    tone?: AlertToneInput;
    /**
     * @deprecated Use `tone="error"` instead of `variant="destructive"`, and
     * `tone="neutral"` (or omit) instead of `variant="default"`.
     */
    variant?: AlertVariant;
  };

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, tone: toneProp, variant: variantProp, ...props }, ref) => {
    const effectiveTone = resolveAlertTone(toneProp, variantProp);
    return (
      <div
        ref={ref}
        role="alert"
        data-tone={effectiveTone}
        className={cn(alertVariants({ tone: effectiveTone }), className)}
        {...props}
      />
    );
  }
);
Alert.displayName = 'Alert';

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn('mb-1 font-medium tracking-tight leading-none', className)}
    {...props}
  />
));
AlertTitle.displayName = 'AlertTitle';

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('text-sm [&_p]:leading-relaxed', className)}
    {...props}
  />
));
AlertDescription.displayName = 'AlertDescription';

export { Alert, AlertDescription, AlertTitle, alertVariants };
