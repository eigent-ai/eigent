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

import { AnimateIcon as AnimateIconProvider } from '@/components/ui/animate-ui/icons/icon';
import { cn } from '@/lib/utils';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

/**
 * Bordered or soft chrome for a menu item (not the full `UiVariant` set).
 * @deprecated `info` — use `variant="default"` (or `clear`) with `tone="information"`.
 */
export type MenuButtonVariant = 'default' | 'clear' | 'info';
export type MenuButtonTone = 'default' | 'information';

const menuButtonVariants = cva(
  'relative inline-flex items-center justify-center select-none transition-colors duration-200 ease-in-out outline-none disabled:opacity-30 disabled:pointer-events-none bg-ds-neutral-subtle-default hover:bg-ds-neutral-default-hover hover:text-ds-ink-default-default focus-visible:text-ds-ink-default-default data-[state=on]:bg-ds-neutral-default-default data-[state=on]:text-ds-ink-default-default text-ds-ink-muted-default disabled:text-ds-ink-muted-disabled cursor-pointer data-[state=on]:shadow-button-shadow rounded-lg',
  {
    variants: {
      look: {
        default:
          'border-x border-y border border-solid text-ds-ink-default-default border-ds-hairline-default-default hover:border-ds-hairline-strong-default focus-visible:border-ds-ring-focus data-[state=on]:border-ds-accent-default-selected data-[state=on]:shadow-button-shadow',
        clear:
          'border-x border-y border border-solid text-ds-ink-default-default border-ds-hairline-default-default hover:border-ds-hairline-strong-default focus-visible:border-ds-hairline-default-default data-[state=on]:shadow-button-shadow',
        info: 'text-ds-ink-default-default !font-medium hover:bg-ds-neutral-default-default data-[state=on]:text-ds-ink-default-default data-[state=on]:!font-bold',
        clearInfo:
          'border-x border-y border border-solid text-ds-ink-default-default border-ds-hairline-default-default hover:border-ds-hairline-strong-default focus-visible:border-ds-hairline-default-default data-[state=on]:shadow-button-shadow !font-medium data-[state=on]:!font-bold',
      },
      size: {
        xs: 'px-2 py-1 text-ds-text-base font-bold [&_svg]:size-[16px] rounded-lg',
        sm: 'p-2 gap-1 text-ds-text-base font-bold [&_svg]:size-[20px] rounded-lg',
        md: 'w-10 h-10 text-ds-text-body-large font-bold [&_svg]:size-[24px] rounded-xl',
        iconxs: 'w-8 h-8 gap-1 font-bold [&_svg]:size-[16px] rounded-lg',
      },
    },
    defaultVariants: {
      look: 'default',
      size: 'md',
    },
  }
);

type MenuButtonLook = NonNullable<
  VariantProps<typeof menuButtonVariants>['look']
>;
type MenuButtonSize = NonNullable<
  VariantProps<typeof menuButtonVariants>['size']
>;

type MenuContextChrome = {
  /** `default` | `clear` — never `info`; use `tone` for emphasis. */
  variant: 'default' | 'clear';
  tone: MenuButtonTone;
  size: MenuButtonSize;
};

const MenuToggleGroupContext = React.createContext<MenuContextChrome>({
  variant: 'default',
  tone: 'default',
  size: 'md',
});

function normalizeGroupVariantTone(
  variant: MenuButtonVariant | undefined,
  tone: MenuButtonTone | undefined
): Pick<MenuContextChrome, 'variant' | 'tone'> {
  if (variant === 'info') {
    return { variant: 'default', tone: 'information' };
  }
  return {
    variant: variant === 'clear' ? 'clear' : 'default',
    tone: tone === 'information' ? 'information' : 'default',
  };
}

/**
 * Resolves to internal `look` for CVA. `info` (legacy) always maps to the former
 * `variant="info"` style.
 */
function resolveMenuItemLook(
  itemVariant: MenuButtonVariant | undefined,
  itemTone: MenuButtonTone | undefined,
  context: MenuContextChrome
): MenuButtonLook {
  if (itemVariant === 'info') {
    return 'info';
  }
  const mergedV: 'default' | 'clear' =
    itemVariant !== undefined
      ? itemVariant === 'clear'
        ? 'clear'
        : 'default'
      : context.variant;
  const mergedT: MenuButtonTone =
    itemTone !== undefined ? itemTone : context.tone;
  if (mergedT === 'information') {
    return mergedV === 'clear' ? 'clearInfo' : 'info';
  }
  return mergedV;
}

type MenuToggleGroupProps = React.ComponentPropsWithoutRef<
  typeof ToggleGroupPrimitive.Root
> & {
  variant?: MenuButtonVariant;
  tone?: MenuButtonTone;
  size?: MenuButtonSize;
};

export const MenuToggleGroup = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Root>,
  MenuToggleGroupProps
>(
  (
    {
      className,
      variant: variantProp,
      tone: toneProp,
      size: sizeProp = 'md',
      children,
      orientation = 'vertical',
      ...props
    },
    ref
  ) => {
    const { variant, tone } = normalizeGroupVariantTone(variantProp, toneProp);
    return (
      <ToggleGroupPrimitive.Root
        ref={ref}
        orientation={orientation}
        className={cn(
          'flex items-center justify-center',
          orientation === 'vertical' ? 'flex-col' : 'flex-row',
          className
        )}
        {...props}
      >
        <MenuToggleGroupContext.Provider
          value={{ variant, tone, size: sizeProp }}
        >
          {children}
        </MenuToggleGroupContext.Provider>
      </ToggleGroupPrimitive.Root>
    );
  }
);

MenuToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName;

type MenuToggleItemProps = React.ComponentPropsWithoutRef<
  typeof ToggleGroupPrimitive.Item
> & {
  variant?: MenuButtonVariant;
  tone?: MenuButtonTone;
  size?: MenuButtonSize;
  icon?: React.ReactNode;
  disableIconAnimation?: boolean;
  iconAnimateOnHover?: boolean | string;
  rightElement?: React.ReactNode;
};

export const MenuToggleItem = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Item>,
  MenuToggleItemProps
>(
  (
    {
      className,
      children,
      size,
      icon,
      variant: itemVariant,
      tone: itemTone,
      disableIconAnimation = false,
      iconAnimateOnHover = true,
      rightElement,
      ...props
    },
    ref
  ) => {
    const context = React.useContext(MenuToggleGroupContext);
    const [isSelected, setIsSelected] = React.useState(false);
    const itemRef = React.useRef<HTMLButtonElement | null>(null);

    const look = resolveMenuItemLook(itemVariant, itemTone, context);
    const isInformationLook = look === 'info' || look === 'clearInfo';
    const resolvedSize = (size ?? context.size) as MenuButtonSize;

    const combinedRef = React.useCallback(
      (node: HTMLButtonElement | null) => {
        itemRef.current = node;
        if (typeof ref === 'function') {
          ref(node);
        } else if (ref) {
          Object.defineProperty(ref, 'current', {
            writable: true,
            value: node,
          });
        }
      },
      [ref]
    );

    React.useEffect(() => {
      const checkSelected = () => {
        if (itemRef.current) {
          const selected = itemRef.current.getAttribute('data-state') === 'on';
          setIsSelected(selected);
        }
      };

      checkSelected();
      const observer = new MutationObserver(checkSelected);
      if (itemRef.current) {
        observer.observe(itemRef.current, {
          attributes: true,
          attributeFilter: ['data-state'],
        });
      }

      return () => observer.disconnect();
    }, []);

    const iconNode =
      React.isValidElement(icon) && isInformationLook
        ? React.cloneElement(icon as React.ReactElement, {
            strokeWidth: isSelected ? 2.5 : 2,
          })
        : icon;

    return (
      <AnimateIconProvider
        animateOnHover={
          disableIconAnimation
            ? false
            : (iconAnimateOnHover as unknown as string | boolean)
        }
        asChild
      >
        <ToggleGroupPrimitive.Item
          ref={combinedRef}
          className={cn(
            'group',
            menuButtonVariants({
              look,
              size: resolvedSize,
            }),
            className
          )}
          data-look={look}
          data-menu-tone={isInformationLook ? 'information' : 'default'}
          {...props}
        >
          <span
            className={cn(
              'flex h-full w-full items-center',
              rightElement ? 'justify-between' : 'justify-center'
            )}
          >
            <span className="inline-flex items-center gap-1">
              {iconNode}
              {children}
            </span>
            {rightElement && (
              <span
                className="pointer-events-auto inline-flex items-center justify-center"
                onClick={(e) => e.stopPropagation()}
              >
                {rightElement}
              </span>
            )}
          </span>
        </ToggleGroupPrimitive.Item>
      </AnimateIconProvider>
    );
  }
);

MenuToggleItem.displayName = ToggleGroupPrimitive.Item.displayName;

export { menuButtonVariants };
