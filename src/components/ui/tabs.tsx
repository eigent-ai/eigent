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

import * as TabsPrimitive from '@radix-ui/react-tabs';
import { AnimatePresence, motion } from 'framer-motion';
import * as React from 'react';

import { cn } from '@/lib/utils';

export type TabsVariant = 'default' | 'outline' | 'border';

// Context for variant
const TabsContext = React.createContext<{ variant?: TabsVariant }>({
  variant: 'default',
});

/** Shared trigger styles — default and outline use the same dimensions. */
const tabsTriggerClassName =
  'ring-offset-ds-bg-neutral-subtle-default focus-visible:ring-ds-ring-brand-default-focus gap-1 rounded-xl bg-ds-bg-neutral-strong-default px-2 py-1 text-body-sm font-semibold text-ds-text-neutral-default-default data-[state=active]:bg-ds-bg-neutral-subtle-default data-[state=active]:text-ds-text-neutral-default-default data-[state=active]:shadow-sm inline-flex items-center justify-center whitespace-nowrap transition-all focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:text-ds-icon-neutral-default-default';

/**
 * Transparent triggers + hover chip (HistoryTabsNav); active selection is shown
 * by the animated bar under the tab row (TabsList), not a border on the trigger.
 */
const tabsTriggerBorderClassName =
  'ring-offset-ds-bg-neutral-default-default focus-visible:ring-ds-ring-brand-default-focus inline-flex h-8 min-h-8 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-solid border-transparent bg-transparent px-2 text-label-sm font-bold text-ds-text-neutral-muted-default transition-colors hover:bg-ds-bg-neutral-subtle-default hover:text-ds-text-neutral-default-default hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:ring-1 hover:ring-ds-border-neutral-default-default focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none data-[state=active]:bg-transparent data-[state=active]:text-ds-text-neutral-default-default data-[state=active]:shadow-none data-[state=active]:ring-0 data-[state=active]:hover:bg-ds-bg-neutral-subtle-default disabled:pointer-events-none disabled:opacity-50 [&_svg]:text-ds-icon-neutral-default-default';

/** Gap (px) between tab row and underline — matches HistoryTabsNav. */
const BORDER_TAB_UNDERLINE_GAP_PX = 8;

const Tabs = TabsPrimitive.Root;

type TabsListProps = React.ComponentPropsWithoutRef<
  typeof TabsPrimitive.List
> & {
  variant?: TabsVariant;
};

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  TabsListProps
>(({ className, variant = 'default', ...props }, ref) => {
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const tabsListRef = React.useRef<React.ElementRef<
    typeof TabsPrimitive.List
  > | null>(null) as React.MutableRefObject<React.ElementRef<
    typeof TabsPrimitive.List
  > | null>;
  const [sliderStyle, setSliderStyle] = React.useState({ left: 0, width: 0 });
  const [borderBarStyle, setBorderBarStyle] = React.useState({
    left: 0,
    top: 0,
    width: 0,
  });

  // Update underline position when active tab changes (outline: inside list; border: below row, HistoryTabsNav-style)
  React.useLayoutEffect(() => {
    if (
      !tabsListRef.current ||
      (variant !== 'outline' && variant !== 'border')
    ) {
      return;
    }

    const updateSlider = () => {
      requestAnimationFrame(() => {
        const list = tabsListRef.current;
        const wrap = wrapperRef.current;
        if (!list) return;

        if (variant === 'outline') {
          const activeTab = list.querySelector(
            '[data-state="active"][data-variant="outline"]'
          ) as HTMLElement | null;
          if (activeTab) {
            const containerRect = list.getBoundingClientRect();
            const tabRect = activeTab.getBoundingClientRect();
            setSliderStyle({
              left: tabRect.left - containerRect.left,
              width: tabRect.width,
            });
          }
          return;
        }

        const activeTab = list.querySelector(
          '[data-state="active"][data-variant="border"]'
        ) as HTMLElement | null;
        if (activeTab && wrap) {
          const wr = wrap.getBoundingClientRect();
          const tabRect = activeTab.getBoundingClientRect();
          setBorderBarStyle({
            left: tabRect.left - wr.left,
            top: tabRect.bottom - wr.top + BORDER_TAB_UNDERLINE_GAP_PX,
            width: tabRect.width,
          });
        }
      });
    };

    updateSlider();

    const observer = new MutationObserver(updateSlider);
    if (tabsListRef.current) {
      observer.observe(tabsListRef.current, {
        attributes: true,
        attributeFilter: ['data-state'],
        subtree: true,
      });
    }

    window.addEventListener('resize', updateSlider);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateSlider);
    };
  }, [variant]);

  const combinedRef = React.useCallback(
    (node: React.ElementRef<typeof TabsPrimitive.List> | null) => {
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref && 'current' in ref) {
        (
          ref as React.MutableRefObject<React.ElementRef<
            typeof TabsPrimitive.List
          > | null>
        ).current = node;
      }
      tabsListRef.current = node;
    },
    [ref]
  );

  return (
    <TabsContext.Provider value={{ variant }}>
      <div
        ref={wrapperRef}
        className={cn('relative', variant === 'border' && 'pb-2')}
      >
        <TabsPrimitive.List
          ref={combinedRef}
          className={cn(
            'inline-flex items-center justify-center',
            variant === 'border' &&
              'gap-2 p-0 rounded-none border-0 border-solid bg-transparent shadow-none',
            variant === 'outline' &&
              'rounded-xl border-ds-border-neutral-default-default bg-ds-bg-neutral-strong-default p-0.5 relative border border-solid',
            variant === 'default' &&
              'rounded-xl bg-ds-bg-neutral-strong-default p-0.5 border border-solid border-[color:var(--ds-bg-neutral-strong-default)]',
            'data-[orientation=vertical]:flex data-[orientation=vertical]:h-full data-[orientation=vertical]:w-full data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-stretch data-[orientation=vertical]:justify-start',
            className
          )}
          data-variant={variant}
          {...props}
        />
        {variant === 'outline' && sliderStyle.width > 0 && (
          <motion.div
            className="bottom-0 bg-text-heading absolute z-10 h-[1.5px]"
            initial={false}
            animate={{
              left: sliderStyle.left,
              width: sliderStyle.width,
            }}
            transition={{
              type: 'spring',
              stiffness: 300,
              damping: 30,
            }}
          />
        )}
        {variant === 'border' && borderBarStyle.width > 0 && (
          <motion.div
            aria-hidden
            className="bg-ds-bg-brand-default-default h-0.5 pointer-events-none absolute z-10 rounded-full"
            initial={false}
            animate={{
              left: borderBarStyle.left,
              top: borderBarStyle.top,
              width: borderBarStyle.width,
            }}
            transition={{
              type: 'spring',
              stiffness: 420,
              damping: 34,
              mass: 0.55,
            }}
          />
        )}
      </div>
    </TabsContext.Provider>
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

type TabsTriggerProps = React.ComponentPropsWithoutRef<
  typeof TabsPrimitive.Trigger
> & {
  variant?: TabsVariant;
};

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  TabsTriggerProps
>(({ className, variant: propVariant, ...props }, ref) => {
  const { variant: contextVariant } = React.useContext(TabsContext);
  const variant = propVariant || contextVariant || 'default';
  const triggerBase =
    variant === 'border' ? tabsTriggerBorderClassName : tabsTriggerClassName;

  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(triggerBase, className)}
      data-variant={variant}
      data-value={props.value}
      {...props}
    />
  );
});
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  return (
    <TabsPrimitive.Content
      ref={ref}
      className={cn(
        'ring-offset-ds-bg-neutral-subtle-default focus-visible:ring-ds-ring-brand-default-focus mt-2 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
        className
      )}
      {...props}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={props.value}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="gap-4 flex flex-col"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </TabsPrimitive.Content>
  );
});
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsContent, TabsList, TabsTrigger };
