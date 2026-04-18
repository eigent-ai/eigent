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
  normalizeUiTone,
  type UiEmphasis,
  type UiTone,
  type UiToneInput,
  type UiVariant,
} from './semanticProps';
import { mergeAliasStyles, tagTokenAliases } from './tokenAliases';

const tagVariants = cva(
  'inline-flex justify-start items-center leading-relaxed',
  {
    variants: {
      variant: {
        primary: 'bg-tag-fill-info text-[var(--tag-foreground-info)]',
        info: 'bg-tag-fill-info !text-[var(--tag-foreground-info)]',
        success: 'bg-tag-fill-success !text-[var(--tag-foreground-success)]',
        cuation: 'bg-tag-fill-cuation !text-[var(--tag-foreground-cuation)]',
        warning: 'bg-tag-fill-warning !text-[var(--tag-foreground-warning)]',
        default: 'bg-tag-fill-default !text-[var(--tag-foreground-default)]',
        ghost: 'bg-transparent !text-[var(--tag-foreground-default)]',
      },
      size: {
        xs: 'px-2 py-0.5 gap-1 text-body-xs font-bold leading-tight [&_svg]:size-[10px] rounded-full',
        sm: 'px-2 py-1.5 gap-1 text-body-xs font-bold leading-tight [&_svg]:size-[16px] rounded-full',
        md: 'px-3 py-1.5 gap-2 text-body-md font-semibold leading-relaxed [&_svg]:size-[20px] rounded-xl',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'sm',
    },
  }
);

type TagVisualVariant = NonNullable<
  VariantProps<typeof tagVariants>['variant']
>;
type TagSize = NonNullable<VariantProps<typeof tagVariants>['size']>;

export type TagVariant = UiVariant;
export type TagEmphasis = UiEmphasis;
export type TagTone = UiTone;
export type TagLegacyVariant = TagVisualVariant;

const TONE_TO_TAG_VARIANT: Record<TagTone, TagVisualVariant> = {
  neutral: 'default',
  success: 'success',
  error: 'cuation',
  information: 'info',
  warning: 'warning',
};

const OUTLINE_BORDER_BY_TONE: Record<TagTone, string> = {
  neutral: 'border-ds-border-neutral-default-default',
  success: 'border-ds-border-success-default-default',
  error: 'border-ds-border-error-default-default',
  information: 'border-ds-border-information-default-default',
  warning: 'border-ds-border-warning-default-default',
};

function resolveTagVisual(
  variant: TagVariant | TagLegacyVariant | undefined,
  tone: UiToneInput | undefined,
  emphasis: TagEmphasis | undefined
): {
  visualVariant: TagVisualVariant;
  tone: TagTone;
  emphasis: TagEmphasis;
  outlineBorderClass: string | null;
} {
  const normalizedTone = normalizeUiTone(tone);
  const resolvedEmphasis = emphasis ?? 'default';
  const v = variant ?? 'primary';

  // Legacy dedicated semantic variants remain valid.
  if (
    v === 'info' ||
    v === 'success' ||
    v === 'cuation' ||
    v === 'warning' ||
    v === 'default'
  ) {
    return {
      visualVariant: v,
      tone: normalizedTone,
      emphasis: resolvedEmphasis,
      outlineBorderClass: null,
    };
  }

  if (resolvedEmphasis === 'inverse' || v === 'ghost') {
    return {
      visualVariant: 'ghost',
      tone: normalizedTone,
      emphasis: resolvedEmphasis,
      outlineBorderClass: null,
    };
  }

  const visualVariant = TONE_TO_TAG_VARIANT[normalizedTone];
  if (v === 'outline') {
    return {
      visualVariant,
      tone: normalizedTone,
      emphasis: resolvedEmphasis,
      outlineBorderClass: OUTLINE_BORDER_BY_TONE[normalizedTone],
    };
  }

  return {
    visualVariant,
    tone: normalizedTone,
    emphasis: resolvedEmphasis,
    outlineBorderClass: null,
  };
}

interface TagProps extends React.ComponentProps<'div'> {
  asChild?: boolean;
  variant?: TagVariant | TagLegacyVariant;
  emphasis?: TagEmphasis;
  tone?: UiToneInput;
  size?: TagSize;
  text?: string;
  icon?: React.ReactNode;
}

const Tag = React.forwardRef<HTMLDivElement, TagProps>(
  (
    {
      className,
      variant,
      emphasis,
      tone,
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
    const {
      visualVariant,
      tone: resolvedTone,
      emphasis: resolvedEmphasis,
      outlineBorderClass,
    } = resolveTagVisual(variant, tone, emphasis);

    // When asChild is true, just pass through the child without wrapping
    if (asChild) {
      return (
        <Comp
          ref={ref}
          data-variant={variant ?? 'primary'}
          data-tone={resolvedTone}
          data-emphasis={resolvedEmphasis}
          className={cn(
            tagVariants({ variant: visualVariant, size, className }),
            outlineBorderClass
              ? ['border', 'border-solid', outlineBorderClass]
              : null
          )}
          style={mergeAliasStyles(tagTokenAliases, style)}
          {...props}
        >
          {children}
        </Comp>
      );
    }

    // Normal rendering when asChild is false
    return (
      <Comp
        ref={ref}
        data-variant={variant ?? 'primary'}
        data-tone={resolvedTone}
        data-emphasis={resolvedEmphasis}
        className={cn(
          tagVariants({ variant: visualVariant, size, className }),
          outlineBorderClass
            ? ['border', 'border-solid', outlineBorderClass]
            : null
        )}
        style={mergeAliasStyles(tagTokenAliases, style)}
        {...props}
      >
        {icon && <span className="flex-shrink-0">{icon}</span>}
        {text && <span>{text}</span>}
        {children}
      </Comp>
    );
  }
);

Tag.displayName = 'Tag';

export { Tag, tagVariants };
