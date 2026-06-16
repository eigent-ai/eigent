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
  return (
    <TabsContext.Provider value={{ variant }}>
      <div className="relative">
        <TabsPrimitive.List
          ref={ref}
          className={cn(
            variant === 'outline'
              ? 'relative inline-flex items-center justify-center gap-0 bg-surface-disabled p-0'
              : 'inline-flex items-center justify-center rounded-xl border border-solid border-menutabs-border-default bg-menutabs-bg-default p-0.5',
            'data-[orientation=vertical]:flex data-[orientation=vertical]:h-full data-[orientation=vertical]:w-full data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-stretch data-[orientation=vertical]:justify-start',
            className
          )}
          data-variant={variant}
          {...props}
        />
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
          ? "relative flex cursor-pointer flex-row items-center justify-center gap-2 bg-transparent px-4 py-3 !text-body-sm !font-semibold text-text-label transition-colors after:absolute after:bottom-0 after:left-0 after:h-[1.5px] after:w-full after:bg-text-heading after:opacity-0 after:transition-opacity after:content-[''] focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-surface-disabled data-[state=active]:!font-bold data-[state=active]:text-text-heading data-[state=active]:after:opacity-100"
          : 'ring-offset-background focus-visible:ring-ring inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-xl bg-menutabs-fill-default px-2 py-1 text-body-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-menutabs-fill-active data-[state=active]:text-menutabs-text-active data-[state=active]:shadow-sm',
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
        'ring-offset-background focus-visible:ring-ring mt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
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
          className="flex flex-col gap-4"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </TabsPrimitive.Content>
  );
});
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsContent, TabsList, TabsTrigger };
