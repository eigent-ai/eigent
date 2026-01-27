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

interface TagProps
  extends React.ComponentProps<'div'>, VariantProps<typeof tagVariants> {
  asChild?: boolean;
  text?: string;
  icon?: React.ReactNode;
}

const Tag = React.forwardRef<HTMLDivElement, TagProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      text,
      icon,
      children,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : 'div';

    // When asChild is true, just pass through the child without wrapping
    if (asChild) {
      return (
        <Comp
          ref={ref}
          className={cn(tagVariants({ variant, size, className }))}
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
        className={cn(tagVariants({ variant, size, className }))}
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
