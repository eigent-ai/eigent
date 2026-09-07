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

import { AUTOMATION_ICON } from '@/lib/triggerIcon';
import { cn } from '@/lib/utils';
import {
  Brain,
  Library,
  ListChecks,
  MessageCircle,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

export const SPACE_DETAIL_TABS = [
  'projects',
  'tasks',
  'triggers',
  'context',
  'memory',
  'workspace-profile',
] as const;

export type SpaceDetailTab = (typeof SPACE_DETAIL_TABS)[number];

export function getSpaceDetailTabId(tab: SpaceDetailTab) {
  return `space-detail-tab-${tab}`;
}

export function getSpaceDetailPanelId(tab: SpaceDetailTab) {
  return `space-detail-panel-${tab}`;
}

export function isSpaceDetailTab(value: unknown): value is SpaceDetailTab {
  return SPACE_DETAIL_TABS.includes(value as SpaceDetailTab);
}

type SpaceDetailTabConfig = {
  id: SpaceDetailTab;
  labelKey: string;
  defaultLabel: string;
  icon: LucideIcon;
};

const SPACE_DETAIL_TAB_OPTIONS: SpaceDetailTabConfig[] = [
  {
    id: 'projects',
    labelKey: 'layout.projects',
    defaultLabel: 'Sessions',
    icon: MessageCircle,
  },
  {
    id: 'tasks',
    labelKey: 'layout.tasks-heading',
    defaultLabel: 'Tasks',
    icon: ListChecks,
  },
  {
    id: 'triggers',
    labelKey: 'layout.triggers',
    defaultLabel: 'Automations',
    icon: AUTOMATION_ICON,
  },
  {
    id: 'context',
    labelKey: 'layout.context-heading',
    defaultLabel: 'Context',
    icon: Library,
  },
  {
    id: 'memory',
    labelKey: 'layout.memory',
    defaultLabel: 'Memory',
    icon: Brain,
  },
  {
    id: 'workspace-profile',
    labelKey: 'layout.space-settings',
    defaultLabel: 'Space settings',
    icon: Settings,
  },
];

const tabButtonClass =
  "group relative z-10 inline-flex h-8 min-h-8 shrink-0 touch-manipulation items-center gap-2 rounded-full border-x-0 border-y-0 border-solid bg-transparent !px-2 !py-0 !text-ds-text-base font-bold outline-none before:absolute before:inset-x-0 before:-inset-y-ds-6 before:content-[''] focus-visible:ring-2 focus-visible:ring-ds-ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-ds-neutral-subtle-default";

const iconSlotClass =
  'relative z-10 inline-flex size-4 shrink-0 items-center justify-center [&_svg]:size-4';

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
  const { t } = useTranslation();
  const navRef = useRef<HTMLDivElement>(null);
  const [hoveredTab, setHoveredTab] = useState<SpaceDetailTab | null>(null);

  const findTab = useCallback((tab: SpaceDetailTab) => {
    return navRef.current?.querySelector<HTMLElement>(
      `[data-space-detail-tab="${tab}"]`
    );
  }, []);

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
      aria-label={t('layout.space-content', {
        defaultValue: 'Space content',
      })}
      className={cn(
        'relative flex flex-row flex-wrap items-center gap-2 pb-2',
        className
      )}
      data-layout-movement="instant"
      onPointerLeave={() => setHoveredTab(null)}
    >
      {SPACE_DETAIL_TAB_OPTIONS.map(
        ({ id, labelKey, defaultLabel, icon: Icon }) => {
          const label = t(labelKey, { defaultValue: defaultLabel });
          const selected = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={getSpaceDetailTabId(id)}
              aria-controls={getSpaceDetailPanelId(id)}
              data-space-detail-tab={id}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(id)}
              onKeyDown={(event) => handleKeyDown(event, id)}
              onPointerDown={(event) => {
                if (event.pointerType === 'touch') setHoveredTab(null);
              }}
              onPointerEnter={(event) => {
                if (event.pointerType === 'touch') {
                  setHoveredTab(null);
                  return;
                }
                setHoveredTab(id);
              }}
              className={cn(
                tabButtonClass,
                selected
                  ? 'text-ds-ink-default-default'
                  : 'text-ds-ink-muted-default hover:text-ds-ink-default-default'
              )}
            >
              {hoveredTab === id ? (
                <span
                  data-space-detail-tab-hover
                  aria-hidden
                  className="pointer-events-none absolute inset-0 z-0 rounded-full bg-ds-neutral-default-default shadow-sm ring-1 ring-ds-hairline-default-default"
                />
              ) : null}
              {selected ? (
                <span
                  data-space-detail-tab-indicator
                  aria-hidden
                  className="pointer-events-none absolute top-[calc(100%+8px)] left-0 z-[11] h-0.5 w-full rounded-full bg-ds-accent-default-default"
                />
              ) : null}
              <span className={iconSlotClass} aria-hidden>
                <Icon />
              </span>
              <span className="relative z-10 !text-ds-text-base font-bold">
                {label}
              </span>
            </button>
          );
        }
      )}
    </div>
  );
}
