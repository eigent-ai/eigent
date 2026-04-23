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

import { cva } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';
import {
  DEFAULT_EMPHASIS_BY_VARIANT,
  normalizeUiTone,
  type UiEmphasis,
  type UiTone,
  type UiToneInput,
  type UiVariant,
} from './semanticProps';

const badgeBase = cva(
  'inline-flex items-center rounded-md border font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ds-ring-brand-default-focus focus:ring-offset-2 focus:ring-offset-ds-bg-neutral-subtle-default',
  {
    variants: {
      size: {
        xs: 'gap-0.5 px-1 py-0 !text-label-xs',
        default: 'px-2 py-1 !text-label-sm',
        sm: 'gap-1 px-2 py-1 !text-label-sm',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  }
);

type BadgeLegacyVariant = 'default' | 'secondary' | 'destructive' | 'outline';
type BadgeStyleVariant = UiVariant | 'inverse';
type BadgeTone = UiTone;

const BADGE_PRIMARY: Record<BadgeTone, string> = {
  neutral:
    'border-transparent bg-ds-bg-brand-default-default text-ds-text-brand-inverse-default',
  success:
    'border-transparent bg-ds-bg-success-default-default text-ds-text-success-strong-default',
  error:
    'border-transparent bg-ds-bg-error-default-default text-ds-text-error-strong-default',
  information:
    'border-transparent bg-ds-bg-information-default-default text-ds-text-information-strong-default',
  warning:
    'border-transparent bg-ds-bg-warning-default-default text-ds-text-warning-strong-default',
};

const BADGE_SECONDARY: Record<BadgeTone, string> = {
  neutral:
    'border-transparent bg-ds-bg-neutral-subtle-default text-ds-text-neutral-default-default',
  success:
    'border-transparent bg-ds-bg-success-subtle-default text-ds-text-success-strong-default',
  error:
    'border-transparent bg-ds-bg-error-subtle-default text-ds-text-error-strong-default',
  information:
    'border-transparent bg-ds-bg-information-subtle-default text-ds-text-information-strong-default',
  warning:
    'border-transparent bg-ds-bg-warning-subtle-default text-ds-text-warning-strong-default',
};

const BADGE_OUTLINE: Record<BadgeTone, string> = {
  neutral:
    'bg-transparent border-ds-border-neutral-default-default text-ds-text-neutral-default-default',
  success:
    'bg-transparent border-ds-border-success-default-default text-ds-text-success-strong-default',
  error:
    'bg-transparent border-ds-border-error-default-default text-ds-text-error-strong-default',
  information:
    'bg-transparent border-ds-border-information-default-default text-ds-text-information-strong-default',
  warning:
    'bg-transparent border-ds-border-warning-default-default text-ds-text-warning-strong-default',
};

const BADGE_GHOST: Record<BadgeTone, string> = {
  neutral:
    'border-transparent bg-transparent text-ds-text-neutral-default-default',
  success:
    'border-transparent bg-transparent text-ds-text-success-strong-default',
  error: 'border-transparent bg-transparent text-ds-text-error-strong-default',
  information:
    'border-transparent bg-transparent text-ds-text-information-strong-default',
  warning:
    'border-transparent bg-transparent text-ds-text-warning-strong-default',
};

const BADGE_INVERSE =
  'border-transparent bg-ds-bg-neutral-inverse-default text-ds-text-neutral-inverse-default';

function resolveBadgeVisual(
  variant: UiVariant | BadgeLegacyVariant | undefined,
  tone: UiToneInput | undefined,
  emphasis: UiEmphasis | undefined
): {
  styleVariant: BadgeStyleVariant;
  tone: BadgeTone;
  emphasis: UiEmphasis;
  publicVariant: UiVariant;
} {
  const v = variant ?? 'primary';
  const normalizedTone = normalizeUiTone(tone);

  if (v === 'default') {
    return {
      styleVariant: 'primary',
      tone: normalizedTone,
      emphasis: emphasis ?? DEFAULT_EMPHASIS_BY_VARIANT.primary,
      publicVariant: 'primary',
    };
  }
  if (v === 'destructive') {
    return {
      styleVariant: 'primary',
      tone: tone ? normalizedTone : 'error',
      emphasis: emphasis ?? DEFAULT_EMPHASIS_BY_VARIANT.primary,
      publicVariant: 'primary',
    };
  }

  const baseVariant = v as UiVariant;
  const resolvedEmphasis = emphasis ?? DEFAULT_EMPHASIS_BY_VARIANT[baseVariant];

  if (resolvedEmphasis === 'inverse') {
    return {
      styleVariant: 'inverse',
      tone: normalizedTone,
      emphasis: resolvedEmphasis,
      publicVariant: baseVariant,
    };
  }
  if (
    (baseVariant === 'primary' &&
      (resolvedEmphasis === 'subtle' || resolvedEmphasis === 'muted')) ||
    (baseVariant === 'secondary' && resolvedEmphasis === 'strong')
  ) {
    return {
      styleVariant: baseVariant === 'primary' ? 'secondary' : 'primary',
      tone: normalizedTone,
      emphasis: resolvedEmphasis,
      publicVariant: baseVariant,
    };
  }

  return {
    styleVariant: baseVariant,
    tone: normalizedTone,
    emphasis: resolvedEmphasis,
    publicVariant: baseVariant,
  };
}

function badgeToneClasses(
  styleVariant: BadgeStyleVariant,
  tone: BadgeTone
): string {
  if (styleVariant === 'inverse') return BADGE_INVERSE;
  if (styleVariant === 'primary') return BADGE_PRIMARY[tone];
  if (styleVariant === 'secondary') return BADGE_SECONDARY[tone];
  if (styleVariant === 'outline') return BADGE_OUTLINE[tone];
  return BADGE_GHOST[tone];
}

export type BadgeSize = 'xs' | 'default' | 'sm';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: UiVariant | BadgeLegacyVariant;
  emphasis?: UiEmphasis;
  tone?: UiToneInput;
  size?: BadgeSize;
}

function Badge({
  className,
  variant,
  emphasis,
  tone,
  size = 'default',
  ...props
}: BadgeProps) {
  const resolved = resolveBadgeVisual(variant, tone, emphasis);
  return (
    <div
      data-variant={resolved.publicVariant}
      data-tone={resolved.tone}
      data-emphasis={resolved.emphasis}
      data-size={size === 'default' ? undefined : size}
      className={cn(
        badgeBase({ size }),
        badgeToneClasses(resolved.styleVariant, resolved.tone),
        className
      )}
      {...props}
    />
  );
}

export { Badge, badgeBase as badgeVariants };
