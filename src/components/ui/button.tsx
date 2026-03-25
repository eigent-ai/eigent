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

export type ButtonContent = 'text' | 'icon-only';
export type ButtonTextWeight = 'normal' | 'medium' | 'semibold' | 'bold';
/** Corner style; uses Tailwind important so it wins over variant/size radii. */
export type ButtonRadius = 'lg' | 'full';

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

const buttonVariants = cva(
  'inline-flex items-center whitespace-nowrap transition-all duration-200 ease-in-out disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 aria-invalid:border-destructive shrink-0',
  {
    variants: {
      variant: {
        primary:
          'bg-button-primary-fill-default !text-button-primary-text-default font-bold rounded-xs shadow-button-shadow hover:bg-button-primary-fill-hover active:bg-button-primary-fill-active focus:bg-button-primary-fill-hover focus:ring-2 focus:ring-gray-4 focus:ring-offset-2 cursor-pointer',
        secondary:
          'bg-button-secondary-fill-default !text-button-secondary-text-default font-bold rounded-xs shadow-button-shadow hover:bg-button-secondary-fill-hover active:bg-button-secondary-fill-active focus:bg-button-secondary-hover focus:ring-2 focus:ring-gray-4 focus:ring-offset-2 cursor-pointer',
        outline:
          'bg-button-tertiery-fill-default !text-button-tertiery-text-default font-bold rounded-xs shadow-button-shadow hover:bg-button-tertiery-fill-hover active:bg-button-tertiery-fill-active focus:bg-button-tertiery-hover focus:ring-2 focus:ring-gray-4 focus:ring-offset-2 cursor-pointer',
        ghost:
          'bg-button-transparent-fill-default !text-button-transparent-text-default font-bold rounded-xs hover:bg-button-transparent-fill-hover active:bg-button-transparent-fill-active focus:bg-button-transparent-fill-hover focus:ring-2 focus:ring-gray-4 focus:ring-offset-2 cursor-pointer',
        success:
          'bg-button-fill-success !text-button-fill-success-foreground font-bold rounded-xs shadow-button-shadow hover:bg-fill-fill-success-hover active:bg-fill-fill-success-active focus:bg-fill-fill-success-hover focus:ring-2 focus:ring-gray-4 focus:ring-offset-2 cursor-pointer',
        cuation:
          'bg-button-fill-cuation !text-button-fill-cuation-foreground font-bold rounded-xs shadow-button-shadow focus:ring-2 focus:ring-gray-4 focus:ring-offset-2 cursor-pointer',
        information:
          'bg-button-fill-information !text-button-fill-information-foreground font-bold rounded-xs shadow-button-shadow focus:ring-2 focus:ring-gray-4 focus:ring-offset-2 cursor-pointer',
        warning:
          'bg-button-fill-warning !text-button-fill-warning-foreground font-bold rounded-xs shadow-button-shadow focus:ring-2 focus:ring-gray-4 focus:ring-offset-2 cursor-pointer',
      },
      size: {
        xxs: 'rounded-md text-label-xs',
        xs: 'rounded-md text-label-xs',
        sm: 'rounded-md text-label-sm',
        md: 'rounded-md text-label-md',
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
          'box-border min-h-[32px] gap-2 px-4 py-0 font-medium [&_svg:not([class*="size-"])]:size-[24px]',
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
      size: 'md',
      layout: 'text',
    },
  }
);

export type ButtonProps = React.ComponentProps<'button'> &
  Omit<VariantProps<typeof buttonVariants>, 'layout' | 'size'> & {
    asChild?: boolean;
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
      variant,
      size: sizeProp = 'md',
      buttonContent,
      textWeight,
      buttonRadius,
      asChild = false,
      children,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : 'button';

    const legacyIcon = sizeProp === 'icon';
    const resolvedSize: ButtonSize = legacyIcon
      ? 'sm'
      : (sizeProp as ButtonSize);
    const resolvedLayout =
      buttonContent === 'icon-only'
        ? 'icon-only'
        : buttonContent === 'text'
          ? 'text'
          : legacyIcon
            ? 'icon-only'
            : 'text';

    return (
      <Comp
        data-slot="button"
        className={cn(
          buttonVariants({
            variant,
            size: resolvedSize,
            layout: resolvedLayout,
          }),
          textWeight ? TEXT_WEIGHT_CLASSES[textWeight] : null,
          buttonRadius ? RADIUS_CLASSES[buttonRadius] : null,
          className
        )}
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
