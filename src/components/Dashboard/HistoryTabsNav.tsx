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
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
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

const tabButtonClass =
  'no-drag group relative z-10 inline-flex h-8 min-h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-label-sm font-bold transition-colors';

const iconSlotClass =
  'inline-flex size-4 shrink-0 items-center justify-center [&_svg]:size-4';

const springTab = {
  type: 'spring' as const,
  stiffness: 440,
  damping: 36,
  mass: 0.55,
};

export type HistoryTabsNavProps = {
  activeTab: HistoryTabId;
  onChange: (value: string) => void;
  className?: string;
  /** Narrow strip (e.g. title bar): no extra bottom padding on the tab row */
  compact?: boolean;
};

export function HistoryTabsNav({
  activeTab,
  onChange,
  className,
  compact,
}: HistoryTabsNavProps) {
  const { t } = useTranslation();
  const navRef = useRef<HTMLDivElement>(null);
  const [hoveredTab, setHoveredTab] = useState<HistoryTabId | null>(null);
  const [selectedRect, setSelectedRect] = useState({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  });
  const [hoverBorder, setHoverBorder] = useState({
    left: 0,
    top: 0,
    width: 0,
    height: 2,
  });

  const updateSelectedRect = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    const el = nav.querySelector<HTMLElement>(
      `[data-history-tab="${activeTab}"]`
    );
    if (!el) return;
    const r = el.getBoundingClientRect();
    const nr = nav.getBoundingClientRect();
    setSelectedRect({
      left: r.left - nr.left,
      top: r.top - nr.top,
      width: r.width,
      height: r.height,
    });
  }, [activeTab]);

  const updateHoverBorder = useCallback((el: HTMLElement) => {
    const nav = navRef.current;
    if (!nav) return;
    const r = el.getBoundingClientRect();
    const nr = nav.getBoundingClientRect();
    const h = 2;
    const offsetBelowTab = 8;
    setHoverBorder({
      left: r.left - nr.left,
      top: r.bottom - nr.top - h + offsetBelowTab,
      width: r.width,
      height: h,
    });
  }, []);

  useLayoutEffect(() => {
    updateSelectedRect();
    const nav = navRef.current;
    if (!nav) return;
    const onResize = () => updateSelectedRect();
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(nav);
    return () => {
      window.removeEventListener('resize', onResize);
      ro.disconnect();
    };
  }, [updateSelectedRect]);

  useLayoutEffect(() => {
    if (!hoveredTab) return;
    const el = navRef.current?.querySelector<HTMLElement>(
      `[data-history-tab="${hoveredTab}"]`
    );
    if (el) updateHoverBorder(el);
  }, [activeTab, hoveredTab, updateHoverBorder]);

  useLayoutEffect(() => {
    if (!hoveredTab) return;
    const el = navRef.current?.querySelector<HTMLElement>(
      `[data-history-tab="${hoveredTab}"]`
    );
    if (!el || !navRef.current) return;
    const nav = navRef.current;
    const onResize = () => updateHoverBorder(el);
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(nav);
    return () => {
      window.removeEventListener('resize', onResize);
      ro.disconnect();
    };
  }, [hoveredTab, updateHoverBorder]);

  return (
    <div
      ref={navRef}
      className={cn(
        'gap-2 relative flex flex-row flex-wrap items-center',
        compact ? 'pb-0' : 'pb-2',
        className
      )}
      onMouseLeave={() => setHoveredTab(null)}
      role="tablist"
    >
      {/* Selected tab: sliding background block */}
      <motion.div
        aria-hidden
        className="bg-ds-bg-neutral-subtle-default ring-ds-border-neutral-default-default shadow-sm pointer-events-none absolute z-[1] rounded-full ring-1"
        initial={false}
        animate={{
          left: selectedRect.left,
          top: selectedRect.top,
          width: selectedRect.width,
          height: selectedRect.height,
          opacity: selectedRect.width > 0 ? 1 : 0,
        }}
        transition={{
          left: springTab,
          top: springTab,
          width: springTab,
          height: springTab,
          opacity: { duration: 0.15 },
        }}
        style={{ position: 'absolute' }}
      />
      {/* Hover: bottom border segment (moves with pointer) */}
      <motion.div
        aria-hidden
        className="bg-ds-bg-brand-default-default pointer-events-none absolute z-[2] rounded-full"
        initial={false}
        animate={{
          left: hoverBorder.left,
          top: hoverBorder.top,
          width: hoverBorder.width,
          height: hoverBorder.height,
          opacity: hoveredTab ? 1 : 0,
        }}
        transition={{
          left: springTab,
          top: springTab,
          width: springTab,
          height: springTab,
          opacity: { duration: 0.15, ease: 'easeOut' },
        }}
        style={{ position: 'absolute' }}
      />
      {HISTORY_TABS.map(({ id, icon, iconAnimateOnHover }) => (
        <AnimateIcon key={id} animateOnHover={iconAnimateOnHover} asChild>
          <button
            type="button"
            role="tab"
            data-history-tab={id}
            aria-selected={activeTab === id}
            onClick={() => onChange(id)}
            onMouseEnter={(e) => {
              setHoveredTab(id);
              updateHoverBorder(e.currentTarget);
            }}
            className={cn(
              tabButtonClass,
              'focus-visible:ring-ds-border-brand-default-focus focus-visible:ring-offset-ds-bg-neutral-default-default !text-body-sm gap-2 flex flex-row border-0 bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
              activeTab === id
                ? 'text-ds-text-neutral-default-default'
                : 'text-ds-text-neutral-muted-default hover:text-ds-text-neutral-default-default'
            )}
          >
            <span className={iconSlotClass}>{icon}</span>
            {t(`layout.${id}`)}
          </button>
        </AnimateIcon>
      ))}
    </div>
  );
}
