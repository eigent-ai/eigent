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

// Context for variant
const TabsContext = React.createContext<{ variant?: 'default' | 'outline' }>({
  variant: 'default',
});

const Tabs = TabsPrimitive.Root;

type TabsListProps = React.ComponentPropsWithoutRef<
  typeof TabsPrimitive.List
> & {
  variant?: 'default' | 'outline';
};

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  TabsListProps
>(({ className, variant = 'default', ...props }, ref) => {
  const tabsListRef = React.useRef<React.ElementRef<
    typeof TabsPrimitive.List
  > | null>(null) as React.MutableRefObject<React.ElementRef<
    typeof TabsPrimitive.List
  > | null>;
  const [sliderStyle, setSliderStyle] = React.useState({ left: 0, width: 0 });

  // Update slider position when active tab changes
  React.useLayoutEffect(() => {
    if (variant !== 'outline' || !tabsListRef.current) return;

    const updateSlider = () => {
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        const activeTab = tabsListRef.current?.querySelector(
          '[data-state="active"][data-variant="outline"]'
        ) as HTMLElement;

        if (activeTab && tabsListRef.current) {
          const containerRect = tabsListRef.current.getBoundingClientRect();
          const tabRect = activeTab.getBoundingClientRect();

          setSliderStyle({
            left: tabRect.left - containerRect.left,
            width: tabRect.width,
          });
        }
      });
    };

    // Initial update
    updateSlider();

    // Watch for changes
    const observer = new MutationObserver(updateSlider);
    if (tabsListRef.current) {
      observer.observe(tabsListRef.current, {
        attributes: true,
        attributeFilter: ['data-state'],
        subtree: true,
      });
    }

    // Also listen for resize
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
      <div className="relative">
        <TabsPrimitive.List
          ref={combinedRef}
          className={cn(
            variant === 'outline'
              ? 'gap-0 bg-ds-bg-neutral-muted-disabled p-0 relative inline-flex items-center justify-center'
              : 'rounded-xl border-menutabs-border-default bg-ds-bg-neutral-strong-default p-0.5 inline-flex items-center justify-center border border-solid',
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
      </div>
    </TabsContext.Provider>
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

type TabsTriggerProps = React.ComponentPropsWithoutRef<
  typeof TabsPrimitive.Trigger
> & {
  variant?: 'default' | 'outline';
};

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  TabsTriggerProps
>(({ className, variant: propVariant, ...props }, ref) => {
  const { variant: contextVariant } = React.useContext(TabsContext);
  const variant = propVariant || contextVariant || 'default';

  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        variant === 'outline'
          ? 'gap-2 px-4 py-3 !text-body-sm !font-semibold text-ds-text-neutral-muted-default data-[state=active]:bg-ds-bg-neutral-muted-disabled data-[state=active]:!font-bold data-[state=active]:text-ds-text-neutral-default-default relative flex cursor-pointer flex-row items-center justify-center bg-transparent transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50'
          : 'ring-offset-background focus-visible:ring-ring gap-1 rounded-xl bg-menutabs-fill-default px-2 py-1 text-body-sm font-semibold data-[state=active]:bg-menutabs-fill-active data-[state=active]:text-menutabs-text-active data-[state=active]:shadow-sm inline-flex items-center justify-center whitespace-nowrap transition-all focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
        className
      )}
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
        'ring-offset-background focus-visible:ring-ring mt-2 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
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
