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
  normalizeUiTone,
  type UiEmphasis,
  type UiTone,
  type UiToneInput,
  type UiVariant,
} from './semanticProps';
import { buttonTokenAliases, mergeAliasStyles } from './tokenAliases';

export type ButtonContent = 'text' | 'icon-only';
export type ButtonTextWeight = 'normal' | 'medium' | 'semibold' | 'bold';
/** Corner style; uses Tailwind important so it wins over variant/size radii. */
export type ButtonRadius = 'lg' | 'full';

/** Semantic tone; use `neutral` (preferred) instead of the legacy `default`. */
export type ButtonTone = UiTone;
export type ButtonToneInput = UiToneInput;
export type ButtonEmphasis = UiEmphasis;

/** Visual chrome style axis. */
export type ButtonVariant = UiVariant;
type ButtonStyleVariant = UiVariant | 'inverse';

/**
 * @deprecated Map to `variant` + `tone` (+ optional `emphasis`) instead:
 * - success → variant="primary" tone="success"
 * - warning → variant="primary" tone="warning"
 * - caution → variant="primary" tone="error"
 * - information → variant="primary" tone="information"
 * - inverse → variant="primary" emphasis="inverse"
 */
export type ButtonLegacyVariant =
  | 'inverse'
  | 'success'
  | 'warning'
  | 'caution'
  | 'information';

const LEGACY_VARIANT_TO_TONE: Record<
  Exclude<ButtonLegacyVariant, 'inverse'>,
  { variant: ButtonVariant; tone: ButtonTone }
> = {
  success: { variant: 'primary', tone: 'success' },
  warning: { variant: 'primary', tone: 'warning' },
  caution: { variant: 'primary', tone: 'error' },
  information: { variant: 'primary', tone: 'information' },
};

type ButtonToneForStyles = 'default' | Exclude<ButtonTone, 'neutral'>;

function toStyleTone(tone: ButtonTone): ButtonToneForStyles {
  return tone === 'neutral' ? 'default' : tone;
}

function resolveVariantToneAndEmphasis(
  variant: ButtonVariant | ButtonLegacyVariant | undefined,
  tone: ButtonToneInput | undefined,
  emphasis: ButtonEmphasis | undefined
): {
  variant: ButtonVariant;
  styleVariant: ButtonStyleVariant;
  tone: ButtonTone;
  styleTone: ButtonToneForStyles;
  emphasis: ButtonEmphasis;
} {
  const v = variant ?? 'primary';

  // Deprecated one-word variants remain valid while we move call sites.
  if (v === 'inverse') {
    const normalizedTone = normalizeUiTone(tone);
    return {
      variant: 'primary',
      styleVariant: 'inverse',
      tone: normalizedTone,
      styleTone: toStyleTone(normalizedTone),
      emphasis: 'inverse',
    };
  }

  if (
    v === 'success' ||
    v === 'warning' ||
    v === 'caution' ||
    v === 'information'
  ) {
    const mapped = LEGACY_VARIANT_TO_TONE[v];
    const normalizedTone = normalizeUiTone(tone ?? mapped.tone);
    const resolvedEmphasis = emphasis ?? DEFAULT_EMPHASIS_BY_VARIANT.primary;
    return {
      variant: mapped.variant,
      styleVariant:
        resolvedEmphasis === 'inverse'
          ? 'inverse'
          : resolvedEmphasis === 'subtle' || resolvedEmphasis === 'muted'
            ? 'secondary'
            : 'primary',
      tone: normalizedTone,
      styleTone: toStyleTone(normalizedTone),
      emphasis: resolvedEmphasis,
    };
  }

  const baseVariant = v as ButtonVariant;
  const normalizedTone = normalizeUiTone(tone);
  const resolvedEmphasis = emphasis ?? DEFAULT_EMPHASIS_BY_VARIANT[baseVariant];

  if (resolvedEmphasis === 'inverse') {
    return {
      variant: baseVariant,
      styleVariant: 'inverse',
      tone: normalizedTone,
      styleTone: toStyleTone(normalizedTone),
      emphasis: resolvedEmphasis,
    };
  }

  if (baseVariant === 'primary') {
    return {
      variant: baseVariant,
      styleVariant:
        resolvedEmphasis === 'subtle' || resolvedEmphasis === 'muted'
          ? 'secondary'
          : 'primary',
      tone: normalizedTone,
      styleTone: toStyleTone(normalizedTone),
      emphasis: resolvedEmphasis,
    };
  }

  if (baseVariant === 'secondary') {
    return {
      variant: baseVariant,
      styleVariant: resolvedEmphasis === 'strong' ? 'primary' : 'secondary',
      tone: normalizedTone,
      styleTone: toStyleTone(normalizedTone),
      emphasis: resolvedEmphasis,
    };
  }

  return {
    variant: baseVariant,
    styleVariant: baseVariant,
    tone: normalizedTone,
    styleTone: toStyleTone(normalizedTone),
    emphasis: resolvedEmphasis,
  };
}

/** Icon box (width/height) paired with text weight when `textWeight` is set */
const TEXT_WEIGHT_CLASSES: Record<ButtonTextWeight, string> = {
  normal: '!font-normal [&_svg:not([class*="size-"])]:!size-[14px]',
  medium: '!font-medium [&_svg:not([class*="size-"])]:!size-[15px]',
  semibold: '!font-semibold [&_svg:not([class*="size-"])]:!size-[16px]',
  bold: '!font-bold [&_svg:not([class*="size-"])]:!size-[18px]',
};

const RADIUS_CLASSES: Record<ButtonRadius, string> = {
  lg: '!rounded-lg',
  full: '!rounded-full',
};

type ButtonSize = 'xxs' | 'xs' | 'sm' | 'md' | 'lg';

const FOCUS_RING =
  'focus-visible:ring-2 focus-visible:ring-gray-4 focus-visible:ring-offset-2';

/** Filled styles: full background; border matches background. */
const TONE_PRIMARY: Record<ButtonToneForStyles, string> = {
  default: [
    'bg-ds-bg-brand-default-default border-ds-bg-brand-default-default !text-ds-text-brand-inverse-default',
    'shadow-button-shadow',
    'hover:bg-ds-bg-brand-default-hover hover:border-ds-bg-brand-default-hover',
    'active:bg-ds-bg-brand-default-active active:border-ds-bg-brand-default-active',
    `focus:bg-ds-bg-brand-default-hover focus:border-ds-bg-brand-default-hover ${FOCUS_RING}`,
  ].join(' '),
  success: [
    'bg-ds-bg-success-default-default border-ds-bg-success-default-default !text-ds-text-success-inverse-default',
    'shadow-button-shadow',
    'hover:bg-ds-bg-success-default-hover hover:border-ds-bg-success-default-hover',
    'active:bg-ds-bg-success-default-active active:border-ds-bg-success-default-active',
    `focus:bg-ds-bg-success-default-hover focus:border-ds-bg-success-default-hover ${FOCUS_RING}`,
  ].join(' '),
  error: [
    'bg-ds-bg-error-default-default border-ds-bg-error-default-default !text-ds-text-error-inverse-default',
    'shadow-button-shadow',
    'hover:bg-ds-bg-error-default-hover hover:border-ds-bg-error-default-hover',
    'active:bg-ds-bg-error-default-active active:border-ds-bg-error-default-active',
    `focus:bg-ds-bg-error-default-hover focus:border-ds-bg-error-default-hover ${FOCUS_RING}`,
  ].join(' '),
  information: [
    'bg-ds-bg-information-default-default border-ds-bg-information-default-default !text-ds-text-information-inverse-default',
    'shadow-button-shadow',
    'hover:bg-ds-bg-information-default-hover hover:border-ds-bg-information-default-hover',
    'active:bg-ds-bg-information-default-active active:border-ds-bg-information-default-active',
    `focus:bg-ds-bg-information-default-hover focus:border-ds-bg-information-default-hover ${FOCUS_RING}`,
  ].join(' '),
  warning: [
    'bg-ds-bg-warning-default-default border-ds-bg-warning-default-default !text-ds-text-warning-inverse-default',
    'shadow-button-shadow',
    'hover:bg-ds-bg-warning-default-hover hover:border-ds-bg-warning-default-hover',
    'active:bg-ds-bg-warning-default-active active:border-ds-bg-warning-default-active',
    `focus:bg-ds-bg-warning-default-hover focus:border-ds-bg-warning-default-hover ${FOCUS_RING}`,
  ].join(' '),
};

/** Lighter fill than primary; border matches background. */
const TONE_SECONDARY: Record<ButtonToneForStyles, string> = {
  default: [
    'bg-ds-bg-neutral-subtle-default border-ds-bg-neutral-subtle-default !text-ds-text-neutral-default-default',
    'shadow-button-shadow',
    'hover:bg-ds-bg-neutral-subtle-hover hover:border-ds-bg-neutral-subtle-hover',
    'active:bg-ds-bg-neutral-subtle-active active:border-ds-bg-neutral-subtle-active',
    `focus:bg-ds-bg-neutral-subtle-hover focus:border-ds-bg-neutral-subtle-hover ${FOCUS_RING}`,
  ].join(' '),
  success: [
    'bg-ds-bg-success-subtle-default border-ds-bg-success-subtle-default !text-ds-text-neutral-inverse-default',
    'shadow-button-shadow',
    'hover:bg-ds-bg-status-completed-subtle-hover hover:border-ds-bg-status-completed-subtle-hover',
    'active:bg-ds-bg-status-completed-subtle-active active:border-ds-bg-status-completed-subtle-active',
    `focus:bg-ds-bg-status-completed-subtle-hover focus:border-ds-bg-status-completed-subtle-hover ${FOCUS_RING}`,
  ].join(' '),
  error: [
    'bg-ds-bg-status-error-subtle-default border-ds-bg-status-error-subtle-default !text-ds-text-status-error-strong-default',
    'shadow-button-shadow',
    'hover:bg-ds-bg-status-error-subtle-hover hover:border-ds-bg-status-error-subtle-hover',
    'active:bg-ds-bg-status-error-subtle-active active:border-ds-bg-status-error-subtle-active',
    `focus:bg-ds-bg-status-error-subtle-hover focus:border-ds-bg-status-error-subtle-hover ${FOCUS_RING}`,
  ].join(' '),
  information: [
    'bg-ds-bg-status-splitting-subtle-default border-ds-bg-status-splitting-subtle-default !text-ds-text-status-splitting-strong-default',
    'shadow-button-shadow',
    'hover:bg-ds-bg-status-splitting-subtle-hover hover:border-ds-bg-status-splitting-subtle-hover',
    'active:bg-ds-bg-status-splitting-subtle-active active:border-ds-bg-status-splitting-subtle-active',
    `focus:bg-ds-bg-status-splitting-subtle-hover focus:border-ds-bg-status-splitting-subtle-hover ${FOCUS_RING}`,
  ].join(' '),
  warning: [
    'bg-ds-bg-status-pending-subtle-default border-ds-bg-status-pending-subtle-default !text-ds-text-status-pending-strong-default',
    'shadow-button-shadow',
    'hover:bg-ds-bg-status-pending-subtle-hover hover:border-ds-bg-status-pending-subtle-hover',
    'active:bg-ds-bg-status-pending-subtle-active active:border-ds-bg-status-pending-subtle-active',
    `focus:bg-ds-bg-status-pending-subtle-hover focus:border-ds-bg-status-pending-subtle-hover ${FOCUS_RING}`,
  ].join(' '),
};

/** Border-only chrome; transparent fill. */
const TONE_OUTLINE: Record<ButtonToneForStyles, string> = {
  default: [
    'bg-transparent border-ds-border-neutral-strong-default !text-ds-text-neutral-default-default',
    'shadow-button-shadow',
    'hover:bg-ds-bg-neutral-subtle-hover hover:border-ds-border-neutral-strong-hover',
    'active:bg-ds-bg-neutral-default-active active:border-ds-border-neutral-strong-default',
    `focus:bg-ds-bg-neutral-subtle-hover ${FOCUS_RING}`,
  ].join(' '),
  success: [
    'bg-transparent border-ds-border-status-completed-default-default !text-ds-text-status-completed-strong-default',
    'shadow-button-shadow',
    'hover:bg-ds-bg-status-completed-subtle-hover hover:border-ds-border-status-completed-default-hover',
    'active:bg-ds-bg-status-completed-subtle-active',
    `focus:bg-ds-bg-status-completed-subtle-hover ${FOCUS_RING}`,
  ].join(' '),
  error: [
    'bg-transparent border-ds-border-status-error-default-default !text-ds-text-status-error-strong-default',
    'shadow-button-shadow',
    'hover:bg-ds-bg-status-error-subtle-hover hover:border-ds-border-status-error-default-hover',
    'active:bg-ds-bg-status-error-subtle-active',
    `focus:bg-ds-bg-status-error-subtle-hover ${FOCUS_RING}`,
  ].join(' '),
  information: [
    'bg-transparent border-ds-border-status-splitting-default-default !text-ds-text-status-splitting-strong-default',
    'shadow-button-shadow',
    'hover:bg-ds-bg-status-splitting-subtle-hover hover:border-ds-border-status-splitting-default-hover',
    'active:bg-ds-bg-status-splitting-subtle-active',
    `focus:bg-ds-bg-status-splitting-subtle-hover ${FOCUS_RING}`,
  ].join(' '),
  warning: [
    'bg-transparent border-ds-border-status-pending-default-default !text-ds-text-status-pending-strong-default',
    'shadow-button-shadow',
    'hover:bg-ds-bg-status-pending-subtle-hover hover:border-ds-border-status-pending-default-hover',
    'active:bg-ds-bg-status-pending-subtle-active',
    `focus:bg-ds-bg-status-pending-subtle-hover ${FOCUS_RING}`,
  ].join(' '),
};

/** No fill; border transparent but still occupies layout as a border. */
const TONE_GHOST: Record<ButtonToneForStyles, string> = {
  default: [
    'bg-transparent border-transparent !text-ds-text-neutral-default-default',
    'hover:bg-ds-bg-neutral-default-hover active:bg-ds-bg-neutral-default-active',
    `focus:bg-ds-bg-neutral-default-hover ${FOCUS_RING}`,
  ].join(' '),
  success: [
    'bg-transparent border-transparent !text-ds-text-status-completed-strong-default',
    'hover:bg-ds-bg-status-completed-subtle-hover active:bg-ds-bg-status-completed-subtle-active',
    `focus:bg-ds-bg-status-completed-subtle-hover ${FOCUS_RING}`,
  ].join(' '),
  error: [
    'bg-transparent border-transparent !text-ds-text-status-error-strong-default',
    'hover:bg-ds-bg-status-error-subtle-hover active:bg-ds-bg-status-error-subtle-active',
    `focus:bg-ds-bg-status-error-subtle-hover ${FOCUS_RING}`,
  ].join(' '),
  information: [
    'bg-transparent border-transparent !text-ds-text-status-splitting-strong-default',
    'hover:bg-ds-bg-status-splitting-subtle-hover active:bg-ds-bg-status-splitting-subtle-active',
    `focus:bg-ds-bg-status-splitting-subtle-hover ${FOCUS_RING}`,
  ].join(' '),
  warning: [
    'bg-transparent border-transparent !text-ds-text-status-pending-strong-default',
    'hover:bg-ds-bg-status-pending-subtle-hover active:bg-ds-bg-status-pending-subtle-active',
    `focus:bg-ds-bg-status-pending-subtle-hover ${FOCUS_RING}`,
  ].join(' '),
};

/**
 * Canvas-colored control: `bg.neutral.subtle` tracks the theme background seed;
 * text uses ink (`text.neutral.default`). Border matches the fill. Same for every `tone`.
 */
const INVERSE = [
  'bg-ds-bg-neutral-subtle-default border-ds-bg-neutral-subtle-default !text-ds-text-neutral-default-default',
  'shadow-button-shadow',
  'hover:bg-ds-bg-neutral-subtle-selected hover:border-ds-bg-neutral-subtle-selected',
  'active:bg-ds-bg-neutral-default-active active:border-ds-bg-neutral-default-active',
  `focus:bg-ds-bg-neutral-subtle-selected focus:border-ds-bg-neutral-subtle-selected ${FOCUS_RING}`,
].join(' ');

const buttonVariants = cva(
  'inline-flex items-center whitespace-nowrap border border-solid transition-all duration-200 ease-in-out disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:!text-inherit outline-none focus-visible:border-ds-border-brand-default-focus focus-visible:ring-ds-ring-brand-default-focus/50 focus-visible:ring-[3px] aria-invalid:ring-ds-ring-error-default-default/20 aria-invalid:border-ds-border-status-error-default-default shrink-0 cursor-pointer',
  {
    variants: {
      variant: {
        primary: '',
        secondary: '',
        outline: '',
        ghost: '',
        inverse: '',
      },
      tone: {
        default: '',
        success: '',
        error: '',
        information: '',
        warning: '',
      },
      size: {
        xxs: 'rounded-md text-label-xs',
        xs: 'rounded-md text-label-xs',
        sm: 'rounded-md text-label-sm',
        md: 'rounded-md text-label-sm',
        lg: 'rounded-md text-label-lg',
      },
      /**
       * `text`: label + optional icon; shares fixed min-height with `icon-only` per size.
       * `icon-only`: fixed square (equal width/height) with centered icon.
       */
      layout: {
        text: 'justify-start gap-1',
        'icon-only': 'justify-center gap-0',
      },
    },
    compoundVariants: [
      { variant: 'primary', tone: 'default', class: TONE_PRIMARY.default },
      { variant: 'primary', tone: 'success', class: TONE_PRIMARY.success },
      { variant: 'primary', tone: 'error', class: TONE_PRIMARY.error },
      {
        variant: 'primary',
        tone: 'information',
        class: TONE_PRIMARY.information,
      },
      { variant: 'primary', tone: 'warning', class: TONE_PRIMARY.warning },

      { variant: 'secondary', tone: 'default', class: TONE_SECONDARY.default },
      { variant: 'secondary', tone: 'success', class: TONE_SECONDARY.success },
      { variant: 'secondary', tone: 'error', class: TONE_SECONDARY.error },
      {
        variant: 'secondary',
        tone: 'information',
        class: TONE_SECONDARY.information,
      },
      { variant: 'secondary', tone: 'warning', class: TONE_SECONDARY.warning },

      { variant: 'outline', tone: 'default', class: TONE_OUTLINE.default },
      { variant: 'outline', tone: 'success', class: TONE_OUTLINE.success },
      { variant: 'outline', tone: 'error', class: TONE_OUTLINE.error },
      {
        variant: 'outline',
        tone: 'information',
        class: TONE_OUTLINE.information,
      },
      { variant: 'outline', tone: 'warning', class: TONE_OUTLINE.warning },

      { variant: 'ghost', tone: 'default', class: TONE_GHOST.default },
      { variant: 'ghost', tone: 'success', class: TONE_GHOST.success },
      { variant: 'ghost', tone: 'error', class: TONE_GHOST.error },
      { variant: 'ghost', tone: 'information', class: TONE_GHOST.information },
      { variant: 'ghost', tone: 'warning', class: TONE_GHOST.warning },

      { variant: 'inverse', tone: 'default', class: INVERSE },
      { variant: 'inverse', tone: 'success', class: INVERSE },
      { variant: 'inverse', tone: 'error', class: INVERSE },
      { variant: 'inverse', tone: 'information', class: INVERSE },
      { variant: 'inverse', tone: 'warning', class: INVERSE },
      {
        size: 'xxs',
        layout: 'text',
        class:
          'box-border min-h-5 px-1 py-0 font-bold [&_svg:not([class*="size-"])]:size-[14px]',
      },
      {
        size: 'xs',
        layout: 'text',
        class:
          'box-border min-h-6 px-1.5 py-0 font-bold [&_svg:not([class*="size-"])]:size-[14px]',
      },
      {
        size: 'sm',
        layout: 'text',
        class:
          'box-border min-h-[28px] px-2 py-0 font-medium [&_svg:not([class*="size-"])]:size-[16px]',
      },
      {
        size: 'md',
        layout: 'text',
        class:
          'box-border min-h-[32px] gap-2 px-2 py-0 font-medium [&_svg:not([class*="size-"])]:size-[18px]',
      },
      {
        size: 'lg',
        layout: 'text',
        class:
          'box-border min-h-[36px] gap-sm px-4 py-0 font-bold [&_svg:not([class*="size-"])]:size-[24px]',
      },
      {
        size: 'xxs',
        layout: 'icon-only',
        class:
          'box-border h-5 w-5 min-h-5 min-w-5 shrink-0 p-1 font-bold [&_svg:not([class*="size-"])]:size-[12px]',
      },
      {
        size: 'xs',
        layout: 'icon-only',
        class:
          'box-border h-6 w-6 min-h-6 min-w-6 shrink-0 p-[5px] font-bold [&_svg:not([class*="size-"])]:size-[14px]',
      },
      {
        size: 'sm',
        layout: 'icon-only',
        class:
          'box-border h-[28px] w-[28px] min-h-[28px] min-w-[28px] shrink-0 p-1.5 font-bold [&_svg:not([class*="size-"])]:size-[16px]',
      },
      {
        size: 'md',
        layout: 'icon-only',
        class:
          'box-border h-[32px] w-[32px] min-h-[32px] min-w-[32px] shrink-0 p-1.5 font-bold [&_svg:not([class*="size-"])]:size-[20px]',
      },
      {
        size: 'lg',
        layout: 'icon-only',
        class:
          'box-border h-[36px] w-[36px] min-h-[36px] min-w-[36px] shrink-0 p-1.5 font-bold [&_svg:not([class*="size-"])]:size-[24px]',
      },
    ],
    defaultVariants: {
      variant: 'primary',
      tone: 'default',
      size: 'md',
      layout: 'text',
    },
  }
);

export type ButtonProps = React.ComponentProps<'button'> &
  Omit<
    VariantProps<typeof buttonVariants>,
    'layout' | 'size' | 'variant' | 'tone'
  > & {
    asChild?: boolean;
    /** Component chrome pattern. */
    variant?: ButtonVariant | ButtonLegacyVariant;
    /** Visual intensity axis. `inverse` is the replacement for legacy `variant="inverse"`. */
    emphasis?: ButtonEmphasis;
    /** Semantic palette. Prefer `neutral` over legacy `default`. */
    tone?: ButtonToneInput;
    /** Text + optional icon (default). `icon-only`: fixed square per `size`, same outer height as text. */
    buttonContent?: ButtonContent;
    /** Overrides label weight and default icon size (when SVG has no explicit size class). */
    textWeight?: ButtonTextWeight;
    /** `lg` = rounded corners; `full` = pill / circle (icon-only). */
    buttonRadius?: ButtonRadius;
    /**
     * @deprecated Use `size="xs"` with `buttonContent="icon-only"` instead.
     */
    size?: ButtonSize | 'icon';
  };

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant: variantProp,
      emphasis: emphasisProp,
      tone: toneProp,
      size: sizeProp = 'md',
      buttonContent,
      textWeight,
      buttonRadius,
      asChild = false,
      children,
      style,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : 'button';

    const legacyIcon = sizeProp === 'icon';
    const resolvedSize: ButtonSize = legacyIcon
      ? 'xs'
      : (sizeProp as ButtonSize);
    const resolvedLayout =
      buttonContent === 'icon-only'
        ? 'icon-only'
        : buttonContent === 'text'
          ? 'text'
          : legacyIcon
            ? 'icon-only'
            : 'text';

    const {
      variant: resolvedVariant,
      styleVariant,
      tone: resolvedTone,
      styleTone,
      emphasis: resolvedEmphasis,
    } = resolveVariantToneAndEmphasis(variantProp, toneProp, emphasisProp);

    return (
      <Comp
        data-slot="button"
        data-variant={resolvedVariant}
        data-tone={resolvedTone}
        data-emphasis={resolvedEmphasis}
        className={cn(
          buttonVariants({
            variant: styleVariant,
            tone: styleTone,
            size: resolvedSize,
            layout: resolvedLayout,
          }),
          textWeight ? TEXT_WEIGHT_CLASSES[textWeight] : null,
          buttonRadius ? RADIUS_CLASSES[buttonRadius] : null,
          className
        )}
        style={mergeAliasStyles(buttonTokenAliases, style)}
        ref={ref}
        {...props}
      >
        {children}
      </Comp>
    );
  }
);

Button.displayName = 'Button';

export { Button, buttonVariants };
