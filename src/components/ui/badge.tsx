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
  DS_FOCUS_RING,
  normalizeUiEmphasis,
  normalizeUiTone,
  type UiEmphasis,
  type UiEmphasisLegacy,
  type UiTone,
  type UiToneInput,
  type UiVariant,
} from './semanticProps';

const badgeBase = cva(
  `inline-flex items-center rounded-full border font-semibold transition-colors ${DS_FOCUS_RING}`,
  {
    variants: {
      size: {
        xs: 'gap-0.5 px-1 py-0 !text-ds-text-meta',
        default: 'px-2 py-1 !text-ds-text-meta',
        sm: 'gap-1 px-2 py-1 !text-ds-text-meta',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  }
);

type BadgeLegacyVariant = 'default' | 'secondary' | 'destructive' | 'outline';
type BadgeStyleVariant = UiVariant;
type BadgeTone = UiTone;

const BADGE_PRIMARY: Record<BadgeTone, string> = {
  neutral:
    'border-transparent bg-ds-accent-default-default text-ds-accent-on-default',
  success:
    'border-transparent bg-ds-bg-success-default-default text-ds-success-on-default',
  error:
    'border-transparent bg-ds-bg-error-default-default text-ds-error-on-default',
  information:
    'border-transparent bg-ds-bg-information-default-default text-ds-information-on-default',
  warning:
    'border-transparent bg-ds-bg-warning-default-default text-ds-warning-on-default',
};

const BADGE_SECONDARY: Record<BadgeTone, string> = {
  neutral:
    'border-transparent bg-ds-neutral-subtle-default text-ds-ink-default-default',
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
    'bg-transparent border-ds-hairline-default-default text-ds-ink-default-default',
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
  neutral: 'border-transparent bg-transparent text-ds-ink-default-default',
  success:
    'border-transparent bg-transparent text-ds-text-success-strong-default',
  error: 'border-transparent bg-transparent text-ds-text-error-strong-default',
  information:
    'border-transparent bg-transparent text-ds-text-information-strong-default',
  warning:
    'border-transparent bg-transparent text-ds-text-warning-strong-default',
};

function resolveBadgeVisual(
  variant: UiVariant | BadgeLegacyVariant | undefined,
  tone: UiToneInput | undefined,
  emphasis: UiEmphasisLegacy | undefined
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
      emphasis:
        normalizeUiEmphasis(emphasis) ?? DEFAULT_EMPHASIS_BY_VARIANT.primary,
      publicVariant: 'primary',
    };
  }
  if (v === 'destructive') {
    return {
      styleVariant: 'primary',
      tone: tone ? normalizedTone : 'error',
      emphasis:
        normalizeUiEmphasis(emphasis) ?? DEFAULT_EMPHASIS_BY_VARIANT.primary,
      publicVariant: 'primary',
    };
  }

  const baseVariant = v as UiVariant;
  const resolvedEmphasis =
    normalizeUiEmphasis(emphasis) ?? DEFAULT_EMPHASIS_BY_VARIANT[baseVariant];

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
  if (styleVariant === 'primary') return BADGE_PRIMARY[tone];
  if (styleVariant === 'secondary') return BADGE_SECONDARY[tone];
  if (styleVariant === 'outline') return BADGE_OUTLINE[tone];
  return BADGE_GHOST[tone];
}

export type BadgeSize = 'xs' | 'default' | 'sm';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: UiVariant | BadgeLegacyVariant;
  emphasis?: UiEmphasisLegacy;
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
