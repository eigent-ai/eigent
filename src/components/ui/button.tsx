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
  DS_FOCUS_RING,
  normalizeUiEmphasis,
  normalizeUiTone,
  type UiEmphasisLegacy,
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
export type ButtonEmphasis = UiEmphasisLegacy;

/** Visual chrome style axis. */
export type ButtonVariant = UiVariant | 'text';
type ButtonStyleVariant = ButtonVariant;

/**
 * @deprecated Map to `variant` + `tone` (+ optional `emphasis`) instead:
 * - success → variant="primary" tone="success"
 * - warning → variant="primary" tone="warning"
 * - information → variant="primary" tone="information"
 * - caution → variant="primary" tone="error" (legacy destructive name)
 */
export type ButtonLegacyVariant =
  'inverse' | 'success' | 'warning' | 'caution' | 'information';

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
  emphasis: Exclude<ButtonEmphasis, 'inverse'>;
} {
  const v = variant ?? 'primary';

  // Deprecated one-word variants remain valid while we move call sites.
  if (v === 'inverse') {
    const normalizedTone = normalizeUiTone(tone);
    return {
      variant: 'primary',
      styleVariant: 'primary',
      tone: normalizedTone,
      styleTone: toStyleTone(normalizedTone),
      emphasis: 'strong',
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
    const resolvedEmphasis =
      normalizeUiEmphasis(emphasis) ?? DEFAULT_EMPHASIS_BY_VARIANT.primary;
    return {
      variant: mapped.variant,
      styleVariant:
        resolvedEmphasis === 'subtle' || resolvedEmphasis === 'muted'
          ? 'secondary'
          : 'primary',
      tone: normalizedTone,
      styleTone: toStyleTone(normalizedTone),
      emphasis: resolvedEmphasis,
    };
  }

  const baseVariant = v as ButtonVariant;
  const normalizedTone = normalizeUiTone(tone);
  const resolvedEmphasis =
    normalizeUiEmphasis(emphasis) ??
    (baseVariant === 'text'
      ? 'default'
      : DEFAULT_EMPHASIS_BY_VARIANT[baseVariant]);

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

/** Icon box is owned by the size recipe; weight never changes icon size. */
const TEXT_WEIGHT_CLASSES: Record<ButtonTextWeight, string> = {
  normal: '!font-normal',
  medium: '!font-medium',
  semibold: '!font-semibold',
  bold: '!font-bold',
};

const RADIUS_CLASSES: Record<ButtonRadius, string> = {
  lg: '!rounded-lg',
  full: '!rounded-full',
};

type ButtonSize = 'xxs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/** Filled styles: Accent/Feedback strong fill with paired foreground. */
const TONE_PRIMARY: Record<ButtonToneForStyles, string> = {
  default: [
    'bg-ds-accent-strong-default border-transparent !text-ds-ink-inverse',
    'shadow-ds-elevation-control',
    'hover:bg-ds-accent-strong-hover hover:shadow-ds-elevation-control-hover',
    'active:shadow-ds-elevation-control-pressed',
    `disabled:bg-ds-accent-strong-disabled ${DS_FOCUS_RING}`,
  ].join(' '),
  success: [
    'bg-ds-bg-success-strong-default border-transparent !text-ds-success-on-strong',
    'shadow-ds-elevation-control',
    'hover:bg-ds-bg-success-strong-hover hover:shadow-ds-elevation-control-hover',
    'active:shadow-ds-elevation-control-pressed',
    `disabled:bg-ds-bg-success-strong-disabled ${DS_FOCUS_RING}`,
  ].join(' '),
  error: [
    'bg-ds-bg-error-strong-default border-transparent !text-ds-error-on-strong',
    'shadow-ds-elevation-control',
    'hover:bg-ds-bg-error-strong-hover hover:shadow-ds-elevation-control-hover',
    'active:shadow-ds-elevation-control-pressed',
    `disabled:bg-ds-bg-error-strong-disabled ${DS_FOCUS_RING}`,
  ].join(' '),
  information: [
    'bg-ds-bg-information-strong-default border-transparent !text-ds-information-on-strong',
    'shadow-ds-elevation-control',
    'hover:bg-ds-bg-information-strong-hover hover:shadow-ds-elevation-control-hover',
    'active:shadow-ds-elevation-control-pressed',
    `disabled:bg-ds-bg-information-strong-disabled ${DS_FOCUS_RING}`,
  ].join(' '),
  warning: [
    'bg-ds-bg-warning-strong-default border-transparent !text-ds-warning-on-strong',
    'shadow-ds-elevation-control',
    'hover:bg-ds-bg-warning-strong-hover hover:shadow-ds-elevation-control-hover',
    'active:shadow-ds-elevation-control-pressed',
    `disabled:bg-ds-bg-warning-strong-disabled ${DS_FOCUS_RING}`,
  ].join(' '),
};

/** Borderless Neutral fill; a transparent border preserves box sizing. */
const TONE_SECONDARY: Record<ButtonToneForStyles, string> = {
  default: [
    'bg-ds-neutral-muted-default border-transparent !text-ds-ink-default-default',
    'hover:bg-ds-neutral-muted-hover',
    'active:shadow-ds-elevation-control-pressed',
    `disabled:bg-ds-neutral-muted-disabled ${DS_FOCUS_RING}`,
  ].join(' '),
  success: [
    'bg-ds-bg-success-subtle-default border-transparent !text-ds-text-success-strong-default',
    'hover:bg-ds-bg-success-subtle-hover',
    `disabled:bg-ds-bg-success-subtle-disabled ${DS_FOCUS_RING}`,
  ].join(' '),
  error: [
    'bg-ds-bg-error-subtle-default border-transparent !text-ds-text-error-strong-default',
    'hover:bg-ds-bg-error-subtle-hover',
    `disabled:bg-ds-bg-error-subtle-disabled ${DS_FOCUS_RING}`,
  ].join(' '),
  information: [
    'bg-ds-bg-information-subtle-default border-transparent !text-ds-text-information-strong-default',
    'hover:bg-ds-bg-information-subtle-hover',
    `disabled:bg-ds-bg-information-subtle-disabled ${DS_FOCUS_RING}`,
  ].join(' '),
  warning: [
    'bg-ds-bg-warning-subtle-default border-transparent !text-ds-text-warning-strong-default',
    'hover:bg-ds-bg-warning-subtle-hover',
    `disabled:bg-ds-bg-warning-subtle-disabled ${DS_FOCUS_RING}`,
  ].join(' '),
};

/** Transparent pill with Hairline; hover adds Neutral subtle fill. */
const TONE_OUTLINE: Record<ButtonToneForStyles, string> = {
  default: [
    'bg-transparent border-ds-hairline-default-default !text-ds-ink-default-default',
    'hover:bg-ds-neutral-subtle-hover hover:border-ds-hairline-default-hover',
    `disabled:border-ds-hairline-default-disabled ${DS_FOCUS_RING}`,
  ].join(' '),
  success: [
    'bg-transparent border-ds-border-success-default-default !text-ds-text-success-strong-default',
    'hover:bg-ds-bg-success-subtle-hover',
    DS_FOCUS_RING,
  ].join(' '),
  error: [
    'bg-transparent border-ds-border-error-default-default !text-ds-text-error-strong-default',
    'hover:bg-ds-bg-error-subtle-hover',
    DS_FOCUS_RING,
  ].join(' '),
  information: [
    'bg-transparent border-ds-border-information-default-default !text-ds-text-information-strong-default',
    'hover:bg-ds-bg-information-subtle-hover',
    DS_FOCUS_RING,
  ].join(' '),
  warning: [
    'bg-transparent border-ds-border-warning-default-default !text-ds-text-warning-strong-default',
    'hover:bg-ds-bg-warning-subtle-hover',
    DS_FOCUS_RING,
  ].join(' '),
};

/** Transparent pill; Neutral subtle fill on hover. */
const TONE_GHOST: Record<ButtonToneForStyles, string> = {
  default: [
    'bg-transparent border-transparent !text-ds-ink-default-default',
    'hover:bg-ds-neutral-subtle-hover',
    'disabled:opacity-50 disabled:!text-ds-ink-muted-disabled',
    DS_FOCUS_RING,
  ].join(' '),
  success: [
    'bg-transparent border-transparent !text-ds-text-success-strong-default',
    'hover:bg-ds-bg-success-subtle-hover',
    'disabled:opacity-50',
    DS_FOCUS_RING,
  ].join(' '),
  error: [
    'bg-transparent border-transparent !text-ds-text-error-strong-default',
    'hover:bg-ds-bg-error-subtle-hover',
    'disabled:opacity-50',
    DS_FOCUS_RING,
  ].join(' '),
  information: [
    'bg-transparent border-transparent !text-ds-text-information-strong-default',
    'hover:bg-ds-bg-information-subtle-hover',
    'disabled:opacity-50',
    DS_FOCUS_RING,
  ].join(' '),
  warning: [
    'bg-transparent border-transparent !text-ds-text-warning-strong-default',
    'hover:bg-ds-bg-warning-subtle-hover',
    'disabled:opacity-50',
    DS_FOCUS_RING,
  ].join(' '),
};

/** No container at rest; Ink + underline on hover. */
const TONE_TEXT: Record<ButtonToneForStyles, string> = {
  default: [
    'bg-transparent border-transparent !text-ds-ink-default-default shadow-none rounded-none',
    'hover:underline hover:!text-ds-ink-default-hover',
    'disabled:opacity-50 disabled:!text-ds-ink-muted-disabled',
    DS_FOCUS_RING,
  ].join(' '),
  success: [
    'bg-transparent border-transparent !text-ds-text-success-strong-default shadow-none rounded-none',
    'hover:underline',
    'disabled:opacity-50',
    DS_FOCUS_RING,
  ].join(' '),
  error: [
    'bg-transparent border-transparent !text-ds-text-error-strong-default shadow-none rounded-none',
    'hover:underline',
    'disabled:opacity-50',
    DS_FOCUS_RING,
  ].join(' '),
  information: [
    'bg-transparent border-transparent !text-ds-text-information-strong-default shadow-none rounded-none',
    'hover:underline',
    'disabled:opacity-50',
    DS_FOCUS_RING,
  ].join(' '),
  warning: [
    'bg-transparent border-transparent !text-ds-text-warning-strong-default shadow-none rounded-none',
    'hover:underline',
    'disabled:opacity-50',
    DS_FOCUS_RING,
  ].join(' '),
};

const SIZE_TEXT: Record<Exclude<ButtonSize, 'xxs'>, string> = {
  xs: 'box-border !h-[var(--ds-button-xs-height)] !min-h-[var(--ds-button-xs-height)] !px-[var(--ds-button-xs-padding-inline)] !py-0 !gap-[var(--ds-button-xs-gap)] rounded-[var(--ds-button-xs-radius)] font-[number:var(--ds-button-xs-weight)] !text-ds-text-meta leading-[var(--ds-button-xs-line-height)] [&_svg:not([class*="size-"])]:size-[length:var(--ds-button-xs-icon)]',
  sm: 'box-border !h-[var(--ds-button-sm-height)] !min-h-[var(--ds-button-sm-height)] !px-[var(--ds-button-sm-padding-inline)] !py-0 !gap-[var(--ds-button-sm-gap)] rounded-[var(--ds-button-sm-radius)] font-[number:var(--ds-button-sm-weight)] !text-ds-text-base leading-[var(--ds-button-sm-line-height)] [&_svg:not([class*="size-"])]:size-[length:var(--ds-button-sm-icon)]',
  md: 'box-border !h-[var(--ds-button-md-height)] !min-h-[var(--ds-button-md-height)] !px-[var(--ds-button-md-padding-inline)] !py-0 !gap-[var(--ds-button-md-gap)] rounded-[var(--ds-button-md-radius)] font-[number:var(--ds-button-md-weight)] !text-ds-text-base leading-[var(--ds-button-md-line-height)] [&_svg:not([class*="size-"])]:size-[length:var(--ds-button-md-icon)]',
  lg: 'box-border !h-[var(--ds-button-lg-height)] !min-h-[var(--ds-button-lg-height)] !px-[var(--ds-button-lg-padding-inline)] !py-0 !gap-[var(--ds-button-lg-gap)] rounded-[var(--ds-button-lg-radius)] font-[number:var(--ds-button-lg-weight)] !text-ds-text-base leading-[var(--ds-button-lg-line-height)] [&_svg:not([class*="size-"])]:size-[length:var(--ds-button-lg-icon)]',
  xl: 'box-border !h-[var(--ds-button-xl-height)] !min-h-[var(--ds-button-xl-height)] !px-[var(--ds-button-xl-padding-inline)] !py-0 !gap-[var(--ds-button-xl-gap)] rounded-[var(--ds-button-xl-radius)] font-[number:var(--ds-button-xl-weight)] !text-ds-text-body-large leading-[var(--ds-button-xl-line-height)] [&_svg:not([class*="size-"])]:size-[length:var(--ds-button-xl-icon)]',
};

const SIZE_ICON: Record<Exclude<ButtonSize, 'xxs'>, string> = {
  xs: 'box-border !size-[var(--ds-button-xs-height)] !min-h-[var(--ds-button-xs-height)] !min-w-[var(--ds-button-xs-height)] shrink-0 !p-0 rounded-full [&_svg:not([class*="size-"])]:size-[length:var(--ds-button-xs-icon)]',
  sm: 'box-border !size-[var(--ds-button-sm-height)] !min-h-[var(--ds-button-sm-height)] !min-w-[var(--ds-button-sm-height)] shrink-0 !p-0 rounded-full [&_svg:not([class*="size-"])]:size-[length:var(--ds-button-sm-icon)]',
  md: 'box-border !size-[var(--ds-button-md-height)] !min-h-[var(--ds-button-md-height)] !min-w-[var(--ds-button-md-height)] shrink-0 !p-0 rounded-full [&_svg:not([class*="size-"])]:size-[length:var(--ds-button-md-icon)]',
  lg: 'box-border !size-[var(--ds-button-lg-height)] !min-h-[var(--ds-button-lg-height)] !min-w-[var(--ds-button-lg-height)] shrink-0 !p-0 rounded-full [&_svg:not([class*="size-"])]:size-[length:var(--ds-button-lg-icon)]',
  xl: 'box-border !size-[var(--ds-button-xl-height)] !min-h-[var(--ds-button-xl-height)] !min-w-[var(--ds-button-xl-height)] shrink-0 !p-0 rounded-full [&_svg:not([class*="size-"])]:size-[length:var(--ds-button-xl-icon)]',
};

const buttonVariants = cva(
  'inline-flex items-center whitespace-nowrap !border !border-solid !border-x !border-y transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:!text-inherit outline-none aria-invalid:ring-ds-ring-error-default-default/20 aria-invalid:border-ds-border-status-error-default-default shrink-0 cursor-pointer',
  {
    variants: {
      variant: {
        primary: '',
        secondary: '',
        outline: '',
        ghost: '',
        text: '',
      },
      tone: {
        default: '',
        success: '',
        error: '',
        information: '',
        warning: '',
      },
      size: {
        xxs: '',
        xs: '',
        sm: '',
        md: '',
        lg: '',
        xl: '',
      },
      layout: {
        text: 'justify-start',
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

      { variant: 'text', tone: 'default', class: TONE_TEXT.default },
      { variant: 'text', tone: 'success', class: TONE_TEXT.success },
      { variant: 'text', tone: 'error', class: TONE_TEXT.error },
      { variant: 'text', tone: 'information', class: TONE_TEXT.information },
      { variant: 'text', tone: 'warning', class: TONE_TEXT.warning },

      { size: 'xxs', layout: 'text', class: SIZE_TEXT.xs },
      { size: 'xs', layout: 'text', class: SIZE_TEXT.xs },
      { size: 'sm', layout: 'text', class: SIZE_TEXT.sm },
      { size: 'md', layout: 'text', class: SIZE_TEXT.md },
      { size: 'lg', layout: 'text', class: SIZE_TEXT.lg },
      { size: 'xl', layout: 'text', class: SIZE_TEXT.xl },
      { size: 'xxs', layout: 'icon-only', class: SIZE_ICON.xs },
      { size: 'xs', layout: 'icon-only', class: SIZE_ICON.xs },
      { size: 'sm', layout: 'icon-only', class: SIZE_ICON.sm },
      { size: 'md', layout: 'icon-only', class: SIZE_ICON.md },
      { size: 'lg', layout: 'icon-only', class: SIZE_ICON.lg },
      { size: 'xl', layout: 'icon-only', class: SIZE_ICON.xl },
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
    /** Visual intensity. Legacy `inverse` maps to `strong` and `--ds-ink-inverse`. */
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
    const resolvedSize: ButtonSize =
      legacyIcon || sizeProp === 'xxs' ? 'xs' : (sizeProp as ButtonSize);
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
