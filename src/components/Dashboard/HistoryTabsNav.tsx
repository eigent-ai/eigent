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

import { Bot } from '@/components/ui/animate-ui/icons/bot';
import { Compass } from '@/components/ui/animate-ui/icons/compass';
import { Hammer } from '@/components/ui/animate-ui/icons/hammer';
import { AnimateIcon } from '@/components/ui/animate-ui/icons/icon';
import { Radio } from '@/components/ui/animate-ui/icons/radio';
import { Settings } from '@/components/ui/animate-ui/icons/settings';
import { Sparkle } from '@/components/ui/animate-ui/icons/sparkle';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export const HISTORY_TAB_IDS = [
  'projects',
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
  { id: 'projects', icon: <Sparkle />, iconAnimateOnHover: 'wiggle' },
  { id: 'agents', icon: <Bot />, iconAnimateOnHover: 'default' },
  { id: 'channels', icon: <Radio />, iconAnimateOnHover: 'default' },
  { id: 'connectors', icon: <Hammer />, iconAnimateOnHover: 'default' },
  { id: 'browser', icon: <Compass />, iconAnimateOnHover: 'default' },
  { id: 'settings', icon: <Settings />, iconAnimateOnHover: 'default' },
];

const tabButtonClass =
  'group relative z-10 inline-flex h-8 min-h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-label-sm font-bold transition-colors';

const iconSlotClass =
  'inline-flex size-4 shrink-0 items-center justify-center [&_svg]:size-4';

export type HistoryTabsNavProps = {
  activeTab: HistoryTabId;
  onChange: (value: string) => void;
  className?: string;
};

export function HistoryTabsNav({
  activeTab,
  onChange,
  className,
}: HistoryTabsNavProps) {
  const { t } = useTranslation();
  const navRef = useRef<HTMLDivElement>(null);
  const [hoveredTab, setHoveredTab] = useState<HistoryTabId | null>(null);
  const [hoverRect, setHoverRect] = useState({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  });
  const [activeLine, setActiveLine] = useState({
    left: 0,
    top: 0,
    width: 0,
  });

  const updateActiveLine = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    const el = nav.querySelector<HTMLElement>(
      `[data-history-tab="${activeTab}"]`
    );
    if (!el) return;
    const r = el.getBoundingClientRect();
    const nr = nav.getBoundingClientRect();
    const gapPx = 8;
    setActiveLine({
      left: r.left - nr.left,
      top: r.bottom - nr.top + gapPx,
      width: r.width,
    });
  }, [activeTab]);

  useLayoutEffect(() => {
    updateActiveLine();
    const nav = navRef.current;
    if (!nav) return;
    const onResize = () => updateActiveLine();
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(nav);
    return () => {
      window.removeEventListener('resize', onResize);
      ro.disconnect();
    };
  }, [updateActiveLine]);

  const updateHoverRect = useCallback((el: HTMLElement) => {
    const nav = navRef.current;
    if (!nav) return;
    const r = el.getBoundingClientRect();
    const nr = nav.getBoundingClientRect();
    setHoverRect({
      left: r.left - nr.left,
      top: r.top - nr.top,
      width: r.width,
      height: r.height,
    });
  }, []);

  useLayoutEffect(() => {
    if (!hoveredTab) return;
    const el = navRef.current?.querySelector<HTMLElement>(
      `[data-history-tab="${hoveredTab}"]`
    );
    if (el) updateHoverRect(el);
  }, [activeTab, hoveredTab, updateHoverRect]);

  useLayoutEffect(() => {
    if (!hoveredTab) return;
    const el = navRef.current?.querySelector<HTMLElement>(
      `[data-history-tab="${hoveredTab}"]`
    );
    if (!el || !navRef.current) return;
    const nav = navRef.current;
    const onResize = () => updateHoverRect(el);
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(nav);
    return () => {
      window.removeEventListener('resize', onResize);
      ro.disconnect();
    };
  }, [hoveredTab, updateHoverRect]);

  return (
    <div
      ref={navRef}
      className={cn(
        'gap-2 pb-2 relative flex flex-row flex-wrap items-center',
        className
      )}
      onMouseLeave={() => setHoveredTab(null)}
      role="tablist"
    >
      <motion.div
        aria-hidden
        className="rounded-lg bg-ds-bg-neutral-subtle-default ring-ds-border-neutral-default-default pointer-events-none absolute z-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ring-1"
        initial={false}
        animate={{
          left: hoverRect.left,
          top: hoverRect.top,
          width: hoverRect.width,
          height: hoverRect.height,
          opacity: hoveredTab ? 1 : 0,
        }}
        transition={{
          left: { type: 'spring', stiffness: 440, damping: 36, mass: 0.55 },
          top: { type: 'spring', stiffness: 440, damping: 36, mass: 0.55 },
          width: { type: 'spring', stiffness: 440, damping: 36, mass: 0.55 },
          height: { type: 'spring', stiffness: 440, damping: 36, mass: 0.55 },
          opacity: { duration: 0.18, ease: 'easeOut' },
        }}
        style={{ position: 'absolute' }}
      />
      <motion.div
        aria-hidden
        className="bg-ds-bg-brand-default-default h-0.5 pointer-events-none absolute z-[11] rounded-full"
        initial={false}
        animate={{
          left: activeLine.left,
          top: activeLine.top,
          width: activeLine.width,
        }}
        transition={{
          type: 'spring',
          stiffness: 420,
          damping: 34,
          mass: 0.55,
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
              updateHoverRect(e.currentTarget);
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
