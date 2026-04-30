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

import { Blocks } from '@/components/ui/animate-ui/icons/blocks';
import { Bot } from '@/components/ui/animate-ui/icons/bot';
import { Compass } from '@/components/ui/animate-ui/icons/compass';
import { Hammer } from '@/components/ui/animate-ui/icons/hammer';
import { AnimateIcon } from '@/components/ui/animate-ui/icons/icon';
import { Radio } from '@/components/ui/animate-ui/icons/radio';
import { Settings } from '@/components/ui/animate-ui/icons/settings';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export const HISTORY_TAB_IDS = [
  'dashboard',
  'agents',
  'channels',
  'connectors',
  'browser',
  'settings',
] as const;

export type HistoryTabId = (typeof HISTORY_TAB_IDS)[number];

export function isHistoryTabId(value: string): value is HistoryTabId {
  return (HISTORY_TAB_IDS as readonly string[]).includes(value);
}

type TabConfig = {
  id: HistoryTabId;
  icon: ReactNode;
  iconAnimateOnHover: boolean | string;
};

const HISTORY_TABS: TabConfig[] = [
  { id: 'dashboard', icon: <Blocks />, iconAnimateOnHover: 'default' },
  { id: 'agents', icon: <Bot />, iconAnimateOnHover: 'default' },
  { id: 'channels', icon: <Radio />, iconAnimateOnHover: 'default' },
  { id: 'connectors', icon: <Hammer />, iconAnimateOnHover: 'default' },
  { id: 'browser', icon: <Compass />, iconAnimateOnHover: 'default' },
  { id: 'settings', icon: <Settings />, iconAnimateOnHover: 'default' },
];

const iconSlotClass =
  'inline-flex size-4 shrink-0 items-center justify-center [&_svg]:size-4';

export type HistoryTabsNavProps = {
  activeTab: HistoryTabId;
  onChange: (value: string) => void;
  className?: string;
  /** Narrow strip (e.g. title bar): omit sticky positioning */
  compact?: boolean;
};

export function HistoryTabsNav({
  activeTab,
  onChange,
  className,
  compact,
}: HistoryTabsNavProps) {
  const { t } = useTranslation();

  return (
    <Tabs
      value={activeTab}
      onValueChange={onChange}
      className={cn('w-full', className)}
    >
      <div
        className={cn(
          'gap-4 border-ds-border-neutral-default-default z-10 flex w-full flex-wrap items-center justify-between border-x-0 border-t-0 border-b-[0.5px] border-solid',
          compact ? 'relative' : 'sticky top-[84px]'
        )}
      >
        <TabsList
          appearance="border"
          className="min-w-0 gap-1 p-0 h-auto flex-1 justify-start bg-transparent"
        >
          {HISTORY_TABS.map(({ id, icon, iconAnimateOnHover }) => (
            <TabsTrigger
              key={id}
              value={id}
              appearance="border"
              className="gap-2"
            >
              <AnimateIcon animateOnHover={iconAnimateOnHover}>
                <span className={iconSlotClass}>{icon}</span>
              </AnimateIcon>
              {t(`layout.${id}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {/* Radix Tabs requires Content per pane; routing is elsewhere — visually hidden */}
      {HISTORY_TABS.map(({ id }) => (
        <TabsContent key={id} value={id} hidden className="mt-0 p-0 sr-only">
          {'\u200b'}
        </TabsContent>
      ))}
    </Tabs>
  );
}

export type PageSubTabItem = {
  id: string;
  label: ReactNode;
};

export type PageSubTabsNavProps = {
  tabs: PageSubTabItem[];
  activeId: string;
  onChange: (value: string) => void;
  className?: string;
  compact?: boolean;
};

/** Border-style TabsList triggers (Agents / Skills strip), for sub-navigation */
export function PageSubTabsNav({
  tabs,
  activeId,
  onChange,
  className,
  compact,
}: PageSubTabsNavProps) {
  return (
    <Tabs
      value={activeId}
      onValueChange={onChange}
      className={cn('w-full', className)}
    >
      <div
        className={cn(
          'gap-4 border-ds-border-neutral-default-default z-10 flex w-full flex-wrap items-center justify-between border-x-0 border-t-0 border-b-[0.5px] border-solid',
          compact ? 'relative' : 'sticky top-[84px]'
        )}
      >
        <TabsList
          appearance="border"
          className="min-w-0 gap-1 p-0 h-auto flex-1 justify-start bg-transparent"
        >
          {tabs.map(({ id, label }) => (
            <TabsTrigger key={id} value={id} appearance="border">
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {tabs.map(({ id }) => (
        <TabsContent key={id} value={id} hidden className="mt-0 p-0 sr-only">
          {'\u200b'}
        </TabsContent>
      ))}
    </Tabs>
  );
}
