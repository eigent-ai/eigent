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

import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import {
  Brain,
  FolderKanban,
  FolderOpen,
  ListChecks,
  Settings,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

const underlineSlideTransition = {
  type: 'spring' as const,
  stiffness: 420,
  damping: 34,
  mass: 0.55,
};

const underlineInstantTransition = { duration: 0 };

export const SPACE_DETAIL_TABS = [
  'projects',
  'tasks',
  'triggers',
  'context',
  'memory',
  'workspace-profile',
] as const;

export type SpaceDetailTab = (typeof SPACE_DETAIL_TABS)[number];

export function isSpaceDetailTab(value: unknown): value is SpaceDetailTab {
  return SPACE_DETAIL_TABS.includes(value as SpaceDetailTab);
}

type SpaceDetailTabConfig = {
  id: SpaceDetailTab;
  label: string;
  icon: LucideIcon;
};

const SPACE_DETAIL_TAB_OPTIONS: SpaceDetailTabConfig[] = [
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'tasks', label: 'Tasks', icon: ListChecks },
  { id: 'triggers', label: 'Triggers', icon: Zap },
  { id: 'context', label: 'Context', icon: FolderOpen },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'workspace-profile', label: 'Space Settings', icon: Settings },
];

const tabButtonClass =
  'group relative z-10 inline-flex h-8 min-h-8 shrink-0 items-center gap-2 rounded-lg border-0 bg-transparent px-2 !text-body-sm font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ds-border-brand-default-focus focus-visible:ring-offset-2 focus-visible:ring-offset-ds-bg-neutral-default-default';

const iconSlotClass =
  'inline-flex size-4 shrink-0 items-center justify-center [&_svg]:size-4';

type TabRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type SpaceDetailTabsNavProps = {
  activeTab: SpaceDetailTab;
  onChange: (value: SpaceDetailTab) => void;
  className?: string;
};

export function SpaceDetailTabsNav({
  activeTab,
  onChange,
  className,
}: SpaceDetailTabsNavProps) {
  const navRef = useRef<HTMLDivElement>(null);
  const [hoveredTab, setHoveredTab] = useState<SpaceDetailTab | null>(null);
  const [hoverRect, setHoverRect] = useState<TabRect>({
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
  const [underlineEntered, setUnderlineEntered] = useState(false);
  const isFirstUnderlinePositionRef = useRef(true);

  const findTab = useCallback((tab: SpaceDetailTab) => {
    return navRef.current?.querySelector<HTMLElement>(
      `[data-space-detail-tab="${tab}"]`
    );
  }, []);

  const updateActiveLine = useCallback(() => {
    const nav = navRef.current;
    const tab = findTab(activeTab);
    if (!nav || !tab) return;

    const tabRect = tab.getBoundingClientRect();
    const navRect = nav.getBoundingClientRect();
    const next = {
      left: tabRect.left - navRect.left,
      top: tabRect.bottom - navRect.top + 8,
      width: tabRect.width,
    };
    if (next.width <= 0) return;

    setActiveLine(next);
    if (isFirstUnderlinePositionRef.current) {
      isFirstUnderlinePositionRef.current = false;
      requestAnimationFrame(() => setUnderlineEntered(true));
    }
  }, [activeTab, findTab]);

  const updateHoverRect = useCallback((tab: HTMLElement) => {
    const nav = navRef.current;
    if (!nav) return;

    const tabRect = tab.getBoundingClientRect();
    const navRect = nav.getBoundingClientRect();
    setHoverRect({
      left: tabRect.left - navRect.left,
      top: tabRect.top - navRect.top,
      width: tabRect.width,
      height: tabRect.height,
    });
  }, []);

  useLayoutEffect(() => {
    updateActiveLine();
    const nav = navRef.current;
    if (!nav) return;

    const onResize = () => updateActiveLine();
    window.addEventListener('resize', onResize);
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(nav);
    return () => {
      window.removeEventListener('resize', onResize);
      resizeObserver.disconnect();
    };
  }, [updateActiveLine]);

  useLayoutEffect(() => {
    if (!hoveredTab) return;
    const tab = findTab(hoveredTab);
    if (tab) updateHoverRect(tab);
  }, [activeTab, findTab, hoveredTab, updateHoverRect]);

  useLayoutEffect(() => {
    if (!hoveredTab) return;
    const nav = navRef.current;
    const tab = findTab(hoveredTab);
    if (!nav || !tab) return;

    const onResize = () => updateHoverRect(tab);
    window.addEventListener('resize', onResize);
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(nav);
    return () => {
      window.removeEventListener('resize', onResize);
      resizeObserver.disconnect();
    };
  }, [findTab, hoveredTab, updateHoverRect]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, tab: SpaceDetailTab) => {
      const currentIndex = SPACE_DETAIL_TABS.indexOf(tab);
      let nextIndex: number | null = null;

      if (event.key === 'ArrowRight') {
        nextIndex = (currentIndex + 1) % SPACE_DETAIL_TABS.length;
      } else if (event.key === 'ArrowLeft') {
        nextIndex =
          (currentIndex - 1 + SPACE_DETAIL_TABS.length) %
          SPACE_DETAIL_TABS.length;
      } else if (event.key === 'Home') {
        nextIndex = 0;
      } else if (event.key === 'End') {
        nextIndex = SPACE_DETAIL_TABS.length - 1;
      }

      if (nextIndex === null) return;
      event.preventDefault();
      const nextTab = SPACE_DETAIL_TABS[nextIndex];
      onChange(nextTab);
      requestAnimationFrame(() => findTab(nextTab)?.focus());
    },
    [findTab, onChange]
  );

  return (
    <div
      ref={navRef}
      role="tablist"
      aria-label="Space content"
      className={cn(
        'relative flex flex-row flex-wrap items-center gap-2 pb-2',
        className
      )}
      onMouseLeave={() => setHoveredTab(null)}
    >
      <motion.div
        data-space-detail-tab-hover
        aria-hidden
        className="pointer-events-none absolute z-0 rounded-lg bg-ds-bg-neutral-default-default shadow-sm ring-1 ring-ds-border-neutral-default-default"
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

      {activeLine.width > 0 && (
        <motion.div
          data-space-detail-tab-indicator
          aria-hidden
          className="pointer-events-none absolute z-[11] h-0.5 rounded-full bg-ds-bg-brand-default-default"
          initial={false}
          animate={{
            left: activeLine.left,
            top: activeLine.top,
            width: activeLine.width,
            opacity: underlineEntered ? 1 : 0,
          }}
          transition={{
            left: underlineEntered
              ? underlineSlideTransition
              : underlineInstantTransition,
            top: underlineEntered
              ? underlineSlideTransition
              : underlineInstantTransition,
            width: underlineEntered
              ? underlineSlideTransition
              : underlineInstantTransition,
            opacity: { duration: 0.2, ease: 'easeOut' },
          }}
          style={{ position: 'absolute' }}
        />
      )}

      {SPACE_DETAIL_TAB_OPTIONS.map(({ id, label, icon: Icon }) => {
        const selected = activeTab === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            data-space-detail-tab={id}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(id)}
            onKeyDown={(event) => handleKeyDown(event, id)}
            onMouseEnter={(event) => {
              setHoveredTab(id);
              updateHoverRect(event.currentTarget);
            }}
            className={cn(
              tabButtonClass,
              selected
                ? 'text-ds-text-neutral-default-default'
                : 'text-ds-text-neutral-muted-default hover:text-ds-text-neutral-default-default'
            )}
          >
            <span className={iconSlotClass} aria-hidden>
              <Icon />
            </span>
            {label}
          </button>
        );
      })}
    </div>
  );
}
