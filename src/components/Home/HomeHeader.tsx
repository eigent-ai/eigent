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
import { ArrowUpDown, LayoutGrid, List } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHomeHub } from './context';
import { useNewSpaceCreation } from './hooks/useNewSpaceCreation';
import NewSpaceDialog from './NewSpaceDialog';
import { defaultSortDirectionForField, type HomeSortBy } from './utils';

/**
 * In-page Spaces toolbar: visible search, ordering, view, and create controls.
 */
export default function HomeHeader() {
  const { t } = useTranslation();
  const [newSpaceDialogOpen, setNewSpaceDialogOpen] = useState(false);
  const { createBlankSpace, createSpaceFromFolder } =
    useNewSpaceCreation('home_hub_toolbar');
  const {
    sectionCounts,
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

  return (
    <section
      data-home-spaces-toolbar
      aria-label={t('layout.spaces-toolbar', {
        defaultValue: 'Spaces toolbar',
      })}
      className="sticky -top-px z-20 flex min-w-0 flex-wrap items-center justify-between gap-4 border-x-0 border-t-0 border-b border-solid border-ds-hairline-subtle-default bg-ds-neutral-subtle-default py-4"
    >
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="!text-ds-text-section font-bold text-ds-ink-default-default">
          {t('layout.spaces')}
        </h2>
        <span className="inline-flex shrink-0 items-center rounded-xl bg-ds-neutral-muted-default px-2 py-0.5 !text-ds-text-meta font-medium text-ds-ink-muted-default tabular-nums">
          {sectionCounts.spaces}{' '}
          {sectionCounts.spaces === 1 ? 'Space' : 'Spaces'}
        </span>
      </div>

      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        <div className="w-56 max-w-full">
          <SearchInput
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t('layout.search-spaces')}
          />
        </div>

        <DropdownMenu>
          <TooltipSimple content={sortLabel} variant="instant" side="bottom">
            <span className="inline-flex">
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="secondary"
                  buttonContent="icon-only"
                  size="sm"
                  className="rounded-full"
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
          value={viewMode === 'board' ? 'grid' : viewMode}
          onValueChange={(value) => setViewMode(value as 'grid' | 'list')}
        >
          <TabsList appearance="default">
            <TabsTrigger value="grid" aria-label={t('dashboard.grid')}>
              <TooltipSimple
                content={t('dashboard.grid')}
                variant="instant"
                side="bottom"
              >
                <div className="inline-flex h-5 w-5 items-center justify-center">
                  <LayoutGrid size={16} />
                </div>
              </TooltipSimple>
            </TabsTrigger>
            <TabsTrigger value="list" aria-label={t('dashboard.list')}>
              <TooltipSimple
                content={t('dashboard.list')}
                variant="instant"
                side="bottom"
              >
                <div className="inline-flex h-5 w-5 items-center justify-center">
                  <List size={16} />
                </div>
              </TooltipSimple>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <Button
          type="button"
          variant="primary"
          size="sm"
          buttonContent="text"
          className="rounded-full"
          onClick={() => setNewSpaceDialogOpen(true)}
        >
          {t('layout.spaces-new-space')}
        </Button>
      </div>

      <NewSpaceDialog
        open={newSpaceDialogOpen}
        onOpenChange={setNewSpaceDialogOpen}
        onStartFromScratch={createBlankSpace}
        onUseLocalFolder={createSpaceFromFolder}
      />
    </section>
  );
}
