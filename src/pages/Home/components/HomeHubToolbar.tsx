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

import SearchInput from '@/components/Dashboard/SearchInput';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TooltipSimple } from '@/components/ui/tooltip';
import { ArrowUpDown, Columns2, Filter, LayoutGrid, List } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useHomeHub } from '../context';
import { defaultSortDirectionForField, type HomeSortBy } from '../utils';

type HomeSection = 'spaces' | 'projects' | 'tasks' | 'triggers';

type HomeHubToolbarProps = {
  activeTab: HomeSection;
  onTabChange: (tabId: string) => void;
  menuItems: Array<{
    id: HomeSection;
    name: string;
    count: number;
  }>;
};

const SEARCH_PLACEHOLDER_KEYS: Record<HomeSection, string> = {
  spaces: 'layout.search-spaces',
  projects: 'layout.search-projects',
  tasks: 'layout.search-tasks',
  triggers: 'layout.search-triggers',
};

export default function HomeHubToolbar({
  activeTab,
  onTabChange,
  menuItems,
}: HomeHubToolbarProps) {
  const { t } = useTranslation();
  const {
    viewMode,
    setViewMode,
    searchQuery,
    setSearchQuery,
    sortBy,
    setSortBy,
    sortDirection,
    setSortDirection,
  } = useHomeHub();

  const sortLabel = useMemo(() => {
    switch (sortBy) {
      case 'updated':
        return t('layout.home-sort-updated');
      case 'name':
        return t('layout.home-sort-name');
      case 'created':
      default:
        return t('layout.home-sort-created');
    }
  }, [sortBy, t]);

  const handleSortChange = (nextSortBy: HomeSortBy) => {
    if (nextSortBy === sortBy) {
      setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc');
      return;
    }
    setSortBy(nextSortBy);
    setSortDirection(defaultSortDirectionForField(nextSortBy));
  };

  const toolbarRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    const host = toolbar?.parentElement;
    if (!toolbar || !host) return;

    const syncToolbarHeight = () => {
      host.style.setProperty(
        '--home-hub-toolbar-sticky-height',
        `${toolbar.offsetHeight}px`
      );
    };

    syncToolbarHeight();
    const observer = new ResizeObserver(syncToolbarHeight);
    observer.observe(toolbar);

    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={toolbarRef}
      className="gap-3 pb-3 mb-3 pt-8 bg-ds-bg-neutral-subtle-default sticky top-[var(--home-hub-history-tabs-offset,49px)] z-10 flex w-full flex-wrap items-center justify-between"
    >
      <Tabs value={activeTab} onValueChange={onTabChange}>
        <TabsList appearance="default" className="gap-1">
          {menuItems.map((menu) => (
            <TabsTrigger key={menu.id} value={menu.id}>
              <span className="text-label-sm font-semibold">{menu.name}</span>
              <span className="bg-ds-bg-brand-subtle-disabled px-1.5 text-label-xs font-normal text-ds-text-brand-strong-default rounded-full tabular-nums">
                {menu.count}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="gap-1 flex flex-wrap items-center justify-end">
        <SearchInput
          variant="icon"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={t(SEARCH_PLACEHOLDER_KEYS[activeTab])}
        />

        <TooltipSimple content={t('layout.home-filter-disabled-tooltip')}>
          <span className="inline-flex">
            <Button
              type="button"
              variant="ghost"
              buttonContent="icon-only"
              size="sm"
              className="rounded-lg"
              disabled
              aria-label={t('layout.home-filter-disabled-tooltip')}
            >
              <Filter className="h-4 w-4" />
            </Button>
          </span>
        </TooltipSimple>

        <DropdownMenu>
          <TooltipSimple content={sortLabel}>
            <span className="inline-flex">
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  buttonContent="icon-only"
                  size="sm"
                  className="rounded-lg"
                  aria-label={sortLabel}
                >
                  <ArrowUpDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
            </span>
          </TooltipSimple>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => handleSortChange('created')}>
              {t('layout.home-sort-created')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleSortChange('updated')}>
              {t('layout.home-sort-updated')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleSortChange('name')}>
              {t('layout.home-sort-name')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Tabs
          value={viewMode}
          onValueChange={(value) =>
            setViewMode(value as 'grid' | 'list' | 'board')
          }
        >
          <TabsList appearance="default">
            <TabsTrigger value="grid" aria-label={t('dashboard.grid')}>
              <TooltipSimple content={t('dashboard.grid')}>
                <div className="w-5 h-5 inline-flex items-center justify-center">
                  <LayoutGrid size={16} />
                </div>
              </TooltipSimple>
            </TabsTrigger>
            <TabsTrigger value="list" aria-label={t('dashboard.list')}>
              <TooltipSimple content={t('dashboard.list')}>
                <div className="w-5 h-5 inline-flex items-center justify-center">
                  <List size={16} />
                </div>
              </TooltipSimple>
            </TabsTrigger>
            <TabsTrigger value="board" aria-label={t('dashboard.board')}>
              <TooltipSimple content={t('dashboard.board')}>
                <div className="w-5 h-5 inline-flex items-center justify-center">
                  <Columns2 size={16} />
                </div>
              </TooltipSimple>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </div>
  );
}
