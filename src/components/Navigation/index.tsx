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

import * as React from 'react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

export type VerticalNavItem = {
  value: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  content?: React.ReactNode;
  disabled?: boolean;
};

export type VerticalNavigationProps = {
  items: VerticalNavItem[];
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  listClassName?: string;
  triggerClassName?: string;
  contentClassName?: string;
};

export function VerticalNavigation({
  items,
  defaultValue,
  value,
  onValueChange,
  className,
  listClassName,
  triggerClassName,
  contentClassName,
}: VerticalNavigationProps) {
  const initial = React.useMemo(() => {
    if (value) return undefined;
    if (defaultValue) return defaultValue;
    return items[0]?.value;
  }, [value, defaultValue, items]);

  return (
    <Tabs
      orientation="vertical"
      value={value}
      defaultValue={initial}
      onValueChange={onValueChange}
      className={cn('flex w-full gap-4', className)}
    >
      <TabsList
        className={cn(
          'rounded-0 flex w-48 flex-col gap-1 border-0 bg-transparent p-0',
          listClassName
        )}
      >
        {items.map((item) => (
          <TabsTrigger
            key={item.value}
            value={item.value}
            disabled={item.disabled}
            className={cn(
              'w-full justify-start gap-2 rounded-lg px-3 py-2 text-sm',
              'bg-transparent data-[state=inactive]:bg-transparent',
              'data-[state=inactive]:text-menubutton-text-default data-[state=inactive]:opacity-70',
              'data-[state=inactive]:hover:bg-menubutton-fill-hover data-[state=inactive]:hover:opacity-100',
              'data-[state=active]:bg-menubutton-fill-active data-[state=active]:text-menutabs-text-active',
              triggerClassName
            )}
          >
            {item.icon ? (
              <span className="inline-flex h-4 w-4 items-center justify-center">
                {item.icon}
              </span>
            ) : null}
            <span className="truncate">{item.label}</span>
          </TabsTrigger>
        ))}
      </TabsList>

      <div className={cn('flex-1', contentClassName)}>
        {items.map((item) => (
          <TabsContent key={item.value} value={item.value} className="mt-0">
            {item.content}
          </TabsContent>
        ))}
      </div>
    </Tabs>
  );
}

export default VerticalNavigation;
