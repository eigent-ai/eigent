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

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';
import {
  DEFAULT_EMPHASIS_BY_VARIANT,
  normalizeUiEmphasis,
  type UiEmphasis,
  type UiEmphasisLegacy,
  type UiTone,
  type UiToneInput,
  type UiVariant,
} from './semanticProps';
import { mergeAliasStyles, tagTokenAliases } from './tokenAliases';

/** User-friendly tone aliases map to {@link UiTone}. */
export type TagToneInput = UiToneInput | 'info' | 'caution';

export type TagVariant = UiVariant;
export type TagTone = UiTone;
export type TagEmphasis = UiEmphasisLegacy;

type TagStyleTone = 'default' | 'success' | 'error' | 'information' | 'warning';
type TagEmphasisMatrix = 'subtle' | 'muted' | 'default' | 'strong';

export function normalizeTagTone(tone?: TagToneInput): UiTone {
  if (!tone || tone === 'default') return 'neutral';
  if (tone === 'info') return 'information';
  if (tone === 'caution') return 'error';
  return tone;
}

function toStyleTone(tone: UiTone): TagStyleTone {
  return tone === 'neutral' ? 'default' : tone;
}

function resolveTagAxes(
  variant: TagVariant | undefined,
  tone: TagToneInput | undefined,
  emphasis: TagEmphasis | undefined
): {
  variant: UiVariant;
  tone: UiTone;
  emphasis: UiEmphasis;
} {
  const base = variant ?? 'primary';
  return {
    variant: base,
    tone: normalizeTagTone(tone),
    emphasis:
      normalizeUiEmphasis(emphasis) ?? DEFAULT_EMPHASIS_BY_VARIANT[base],
  };
}

/** Filled chips — emphasis ramps from quiet surface to solid semantic fill. */
const TAG_PRIMARY: Record<TagStyleTone, Record<TagEmphasisMatrix, string>> = {
  default: {
    subtle:
      'border-transparent bg-ds-neutral-subtle-default !text-ds-ink-default-default',
    muted:
      'border-transparent bg-ds-neutral-subtle-default !text-ds-ink-muted-default',
    default:
      'border-transparent bg-ds-neutral-default-default !text-ds-ink-default-default',
    strong:
      'border-transparent bg-ds-accent-default-default !text-ds-accent-on-default',
  },
  success: {
    subtle:
      'border-transparent bg-ds-bg-status-completed-subtle-default !text-ds-text-status-completed-muted-default',
    muted:
      'border-transparent bg-ds-neutral-subtle-default !text-ds-text-success-strong-default',
    default:
      'border-transparent bg-ds-bg-success-subtle-default !text-ds-text-success-strong-default',
    strong:
      'border-transparent bg-ds-bg-success-default-default !text-ds-success-on-default',
  },
  error: {
    subtle:
      'border-transparent bg-ds-bg-status-error-subtle-default !text-ds-text-status-error-muted-default',
    muted:
      'border-transparent bg-ds-neutral-subtle-default !text-ds-text-error-strong-default',
    default:
      'border-transparent bg-ds-bg-error-subtle-default !text-ds-text-error-strong-default',
    strong:
      'border-transparent bg-ds-bg-error-default-default !text-ds-error-on-default',
  },
  information: {
    subtle:
      'border-transparent bg-ds-bg-status-splitting-subtle-default !text-ds-text-status-splitting-muted-default',
    muted:
      'border-transparent bg-ds-neutral-subtle-default !text-ds-text-information-strong-default',
    default:
      'border-transparent bg-ds-bg-information-subtle-default !text-ds-text-information-strong-default',
    strong:
      'border-transparent bg-ds-bg-information-default-default !text-ds-information-on-default',
  },
  warning: {
    subtle:
      'border-transparent bg-ds-bg-status-pending-subtle-default !text-ds-text-status-pending-muted-default',
    muted:
      'border-transparent bg-ds-neutral-subtle-default !text-ds-text-warning-strong-default',
    default:
      'border-transparent bg-ds-bg-warning-subtle-default !text-ds-text-warning-strong-default',
    strong:
      'border-transparent bg-ds-bg-warning-default-default !text-ds-warning-on-default',
  },
};

/** Softer bordered / filled secondary surface. */
const TAG_SECONDARY: Record<TagStyleTone, Record<TagEmphasisMatrix, string>> = {
  default: {
    subtle:
      'border-ds-hairline-muted-default bg-ds-neutral-subtle-default !text-ds-ink-muted-default',
    muted:
      'border-transparent bg-ds-neutral-default-default !text-ds-ink-muted-default',
    default:
      'border-ds-hairline-default-default bg-ds-neutral-subtle-default !text-ds-ink-default-default',
    strong:
      'border-ds-hairline-strong-default bg-ds-neutral-default-default !text-ds-ink-default-default',
  },
  success: {
    subtle:
      'border-ds-border-success-muted-default bg-ds-bg-success-subtle-default !text-ds-text-status-completed-muted-default',
    muted:
      'border-transparent bg-ds-neutral-subtle-default !text-ds-text-success-strong-default',
    default:
      'border-ds-border-success-default-default bg-ds-bg-success-subtle-default !text-ds-text-success-strong-default',
    strong:
      'border-ds-border-success-default-default bg-ds-bg-success-default-default !text-ds-success-on-default',
  },
  error: {
    subtle:
      'border-ds-border-error-muted-default bg-ds-bg-error-subtle-default !text-ds-text-status-error-muted-default',
    muted:
      'border-transparent bg-ds-neutral-subtle-default !text-ds-text-error-strong-default',
    default:
      'border-ds-border-error-default-default bg-ds-bg-error-subtle-default !text-ds-text-error-strong-default',
    strong:
      'border-ds-border-error-default-default bg-ds-bg-error-default-default !text-ds-error-on-default',
  },
  information: {
    subtle:
      'border-ds-border-information-muted-default bg-ds-bg-information-subtle-default !text-ds-text-status-splitting-muted-default',
    muted:
      'border-transparent bg-ds-neutral-subtle-default !text-ds-text-information-strong-default',
    default:
      'border-ds-border-information-default-default bg-ds-bg-information-subtle-default !text-ds-text-information-strong-default',
    strong:
      'border-ds-border-information-default-default bg-ds-bg-information-default-default !text-ds-information-on-default',
  },
  warning: {
    subtle:
      'border-ds-border-warning-muted-default bg-ds-bg-warning-subtle-default !text-ds-text-status-pending-muted-default',
    muted:
      'border-transparent bg-ds-neutral-subtle-default !text-ds-text-warning-strong-default',
    default:
      'border-ds-border-warning-default-default bg-ds-bg-warning-subtle-default !text-ds-text-warning-strong-default',
    strong:
      'border-ds-border-warning-default-default bg-ds-bg-warning-default-default !text-ds-warning-on-default',
  },
};

/** Transparent fill; semantic border. */
const TAG_OUTLINE: Record<TagStyleTone, Record<TagEmphasisMatrix, string>> = {
  default: {
    subtle:
      'border-ds-hairline-muted-default bg-transparent !text-ds-ink-muted-default',
    muted:
      'border-ds-hairline-muted-default bg-transparent !text-ds-ink-muted-default',
    default:
      'border-ds-hairline-strong-default bg-transparent !text-ds-ink-default-default',
    strong:
      'border-ds-hairline-strong-default bg-transparent !text-ds-ink-default-default font-semibold',
  },
  success: {
    subtle:
      'border-ds-border-success-muted-default bg-transparent !text-ds-text-status-completed-muted-default',
    muted:
      'border-ds-hairline-default-default bg-transparent !text-ds-text-success-strong-default',
    default:
      'border-ds-border-success-default-default bg-transparent !text-ds-text-success-strong-default',
    strong:
      'border-ds-border-success-strong-default bg-transparent !text-ds-text-success-strong-default font-semibold',
  },
  error: {
    subtle:
      'border-ds-border-error-muted-default bg-transparent !text-ds-text-status-error-muted-default',
    muted:
      'border-ds-hairline-default-default bg-transparent !text-ds-text-error-strong-default',
    default:
      'border-ds-border-error-default-default bg-transparent !text-ds-text-error-strong-default',
    strong:
      'border-ds-border-error-strong-default bg-transparent !text-ds-text-error-strong-default font-semibold',
  },
  information: {
    subtle:
      'border-ds-border-information-muted-default bg-transparent !text-ds-text-status-splitting-muted-default',
    muted:
      'border-ds-hairline-default-default bg-transparent !text-ds-text-information-strong-default',
    default:
      'border-ds-border-information-default-default bg-transparent !text-ds-text-information-strong-default',
    strong:
      'border-ds-border-information-strong-default bg-transparent !text-ds-text-information-strong-default font-semibold',
  },
  warning: {
    subtle:
      'border-ds-border-warning-muted-default bg-transparent !text-ds-text-status-pending-muted-default',
    muted:
      'border-ds-hairline-default-default bg-transparent !text-ds-text-warning-strong-default',
    default:
      'border-ds-border-warning-default-default bg-transparent !text-ds-text-warning-strong-default',
    strong:
      'border-ds-border-warning-strong-default bg-transparent !text-ds-text-warning-strong-default font-semibold',
  },
};

/** No border; text-first. */
const TAG_GHOST: Record<TagStyleTone, Record<TagEmphasisMatrix, string>> = {
  default: {
    subtle: 'border-transparent bg-transparent !text-ds-ink-muted-default',
    muted: 'border-transparent bg-transparent !text-ds-ink-muted-default',
    default: 'border-transparent bg-transparent !text-ds-ink-default-default',
    strong:
      'border-transparent bg-transparent !text-ds-ink-default-default font-semibold',
  },
  success: {
    subtle:
      'border-transparent bg-transparent !text-ds-text-status-completed-muted-default',
    muted:
      'border-transparent bg-transparent opacity-80 !text-ds-text-success-strong-default',
    default:
      'border-transparent bg-transparent !text-ds-text-success-strong-default',
    strong:
      'border-transparent bg-transparent !text-ds-text-success-strong-default font-semibold',
  },
  error: {
    subtle:
      'border-transparent bg-transparent !text-ds-text-status-error-muted-default',
    muted:
      'border-transparent bg-transparent opacity-80 !text-ds-text-error-strong-default',
    default:
      'border-transparent bg-transparent !text-ds-text-error-strong-default',
    strong:
      'border-transparent bg-transparent !text-ds-text-error-strong-default font-semibold',
  },
  information: {
    subtle:
      'border-transparent bg-transparent !text-ds-text-status-splitting-muted-default',
    muted:
      'border-transparent bg-transparent opacity-80 !text-ds-text-information-strong-default',
    default:
      'border-transparent bg-transparent !text-ds-text-information-strong-default',
    strong:
      'border-transparent bg-transparent !text-ds-text-information-strong-default font-semibold',
  },
  warning: {
    subtle:
      'border-transparent bg-transparent !text-ds-text-status-pending-muted-default',
    muted:
      'border-transparent bg-transparent opacity-80 !text-ds-text-warning-strong-default',
    default:
      'border-transparent bg-transparent !text-ds-text-warning-strong-default',
    strong:
      'border-transparent bg-transparent !text-ds-text-warning-strong-default font-semibold',
  },
};

const TAG_BY_VARIANT: Record<
  UiVariant,
  Record<TagStyleTone, Record<TagEmphasisMatrix, string>>
> = {
  primary: TAG_PRIMARY,
  secondary: TAG_SECONDARY,
  outline: TAG_OUTLINE,
  ghost: TAG_GHOST,
};

function tagChromeClasses(
  variant: UiVariant,
  styleTone: TagStyleTone,
  emphasis: UiEmphasis
): string {
  return TAG_BY_VARIANT[variant][styleTone][emphasis];
}

const tagVariants = cva(
  'inline-flex justify-start items-center border border-solid border-x border-y leading-relaxed transition-colors duration-150',
  {
    variants: {
      size: {
        xxs: 'gap-0.5 rounded-full !px-1.5 !py-px !text-ds-text-meta font-medium [&_svg]:size-[12px]',
        xs: 'gap-1 rounded-full !px-2 !py-0.5 !text-ds-text-meta font-medium [&_svg]:size-[12px]',
        sm: 'gap-1 rounded-full !px-2 !py-1 !text-ds-text-meta font-medium [&_svg]:size-[16px]',
        md: 'gap-1.5 rounded-full !px-2.5 !py-1 !text-ds-text-meta font-medium [&_svg]:size-[16px]',
        lg: 'gap-2 rounded-full !px-3 !py-1.5 !text-ds-text-meta font-semibold [&_svg]:size-[16px]',
      },
    },
    defaultVariants: {
      size: 'sm',
    },
  }
);

type TagSize = NonNullable<VariantProps<typeof tagVariants>['size']>;

interface TagProps extends React.ComponentProps<'div'> {
  asChild?: boolean;
  /** Chrome pattern: filled, softer fill, outline, or text-only. */
  variant?: TagVariant;
  /** Visual weight within the chosen `variant`. */
  emphasis?: TagEmphasis;
  /**
   * Semantic palette. Shorthands: `info` → information, `caution` → error; `default` → neutral.
   * Omitted tone reads as neutral.
   */
  tone?: TagToneInput;
  size?: TagSize;
  text?: string;
  icon?: React.ReactNode;
}

const Tag = React.forwardRef<HTMLDivElement, TagProps>(
  (
    {
      className,
      variant: variantProp,
      emphasis: emphasisProp,
      tone: toneProp,
      size,
      asChild = false,
      text,
      icon,
      children,
      style,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : 'div';
    const { variant, tone, emphasis } = resolveTagAxes(
      variantProp,
      toneProp,
      emphasisProp
    );
    const styleTone = toStyleTone(tone);
    const chrome = tagChromeClasses(variant, styleTone, emphasis);

    if (asChild) {
      return (
        <Comp
          ref={ref}
          data-variant={variant}
          data-tone={tone}
          data-emphasis={emphasis}
          className={cn(tagVariants({ size }), chrome, className)}
          style={mergeAliasStyles(tagTokenAliases, style)}
          {...props}
        >
          {children}
        </Comp>
      );
    }

    return (
      <Comp
        ref={ref}
        data-variant={variant}
        data-tone={tone}
        data-emphasis={emphasis}
        className={cn(tagVariants({ size }), chrome, className)}
        style={mergeAliasStyles(tagTokenAliases, style)}
        {...props}
      >
        {icon && <span className="shrink-0">{icon}</span>}
        {text && <span>{text}</span>}
        {children}
      </Comp>
    );
  }
);

Tag.displayName = 'Tag';

export { Tag, tagVariants };
