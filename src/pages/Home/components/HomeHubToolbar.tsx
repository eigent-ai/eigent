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
import { useHost } from '@/host';
import {
  createSpaceFromFolderPicker,
  getFolderSpaceErrorMessage,
} from '@/lib/createSpaceFromFolder';
import { ensureScratchSpaceWorkspaceBinding } from '@/lib/scratchSpaceWorkspace';
import { getDefaultNewSpaceName } from '@/lib/spaceLabel';
import { useAuthStore } from '@/store/authStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSpaceStore } from '@/store/spaceStore';
import {
  ArrowUpDown,
  ChevronDown,
  Columns2,
  Filter,
  FolderOpen,
  LayoutGrid,
  List,
  PlusCircle,
} from 'lucide-react';
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
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
  const navigate = useNavigate();
  const host = useHost();
  const email = useAuthStore((s) => s.email);
  const userId = useAuthStore((s) => s.user_id);
  const projectStore = useProjectRuntimeStore();
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId);
  const createSpaceOnServer = useSpaceStore((s) => s.createSpaceOnServer);
  const setActiveSpace = useSpaceStore((s) => s.setActiveSpace);
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);
  const requestWorkspaceChatFocus = usePageTabStore(
    (s) => s.requestWorkspaceChatFocus
  );
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

  const goToWorkspace = useCallback(() => {
    setActiveWorkspaceTab('workforce');
    requestWorkspaceChatFocus();
    navigate('/');
  }, [navigate, requestWorkspaceChatFocus, setActiveWorkspaceTab]);

  const handleCreateBlankSpace = useCallback(async () => {
    try {
      const spaceId = await createSpaceOnServer({
        name: getDefaultNewSpaceName(t),
        sourceType: 'blank',
        setActive: false,
        metadata: {
          createdFrom: 'home_hub_toolbar',
          autoCreatedPlaceholder: true,
        },
      });
      await ensureScratchSpaceWorkspaceBinding({
        email,
        userId,
        space: useSpaceStore.getState().getSpaceById(spaceId),
      });
      setActiveSpace(spaceId);
      projectStore.setActiveProject(null);
      goToWorkspace();
    } catch (error) {
      console.error('Failed to create Space:', error);
      toast.error(t('layout.spaces-create-failed'), {
        closeButton: true,
      });
    }
  }, [
    createSpaceOnServer,
    email,
    goToWorkspace,
    projectStore,
    setActiveSpace,
    t,
    userId,
  ]);

  const handleCreateSpaceFromFolder = useCallback(async () => {
    try {
      const spaceId = await createSpaceFromFolderPicker({
        host,
        email,
        userId,
        activeSpaceId,
        projectStore,
        createdFrom: 'home_hub_toolbar',
      });
      if (!spaceId) return;
      goToWorkspace();
    } catch (error) {
      console.warn('[HomeHubToolbar] Failed to create folder Space:', error);
      toast.error(getFolderSpaceErrorMessage(error, t), {
        closeButton: true,
      });
    }
  }, [activeSpaceId, email, goToWorkspace, host, projectStore, t, userId]);

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
      className="sticky top-[var(--home-hub-history-tabs-offset,49px)] z-10 mb-3 flex w-full flex-wrap items-center justify-between gap-3 bg-ds-bg-neutral-subtle-default pb-3 pt-8"
    >
      <Tabs value={activeTab} onValueChange={onTabChange}>
        <TabsList appearance="default" className="gap-1">
          {menuItems.map((menu) => (
            <TabsTrigger key={menu.id} value={menu.id}>
              <span className="text-label-sm font-semibold">{menu.name}</span>
              <span className="rounded-full bg-ds-bg-brand-subtle-disabled px-1.5 text-label-xs font-normal tabular-nums text-ds-text-brand-strong-default">
                {menu.count}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center justify-end gap-2">
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
              buttonRadius="full"
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
                <div className="inline-flex h-5 w-5 items-center justify-center">
                  <LayoutGrid size={16} />
                </div>
              </TooltipSimple>
            </TabsTrigger>
            <TabsTrigger value="list" aria-label={t('dashboard.list')}>
              <TooltipSimple content={t('dashboard.list')}>
                <div className="inline-flex h-5 w-5 items-center justify-center">
                  <List size={16} />
                </div>
              </TooltipSimple>
            </TabsTrigger>
            <TabsTrigger value="board" aria-label={t('dashboard.board')}>
              <TooltipSimple content={t('dashboard.board')}>
                <div className="inline-flex h-5 w-5 items-center justify-center">
                  <Columns2 size={16} />
                </div>
              </TooltipSimple>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="primary"
              size="sm"
              buttonContent="text"
              buttonRadius="full"
            >
              {t('layout.spaces-new-space')}
              <ChevronDown className="h-4 w-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44 p-1">
            <DropdownMenuItem
              className="cursor-pointer gap-2"
              onSelect={(event) => {
                event.preventDefault();
                void handleCreateBlankSpace();
              }}
            >
              <PlusCircle className="h-4 w-4 shrink-0" aria-hidden />
              {t('layout.workspace-start-from-scratch')}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer gap-2"
              onSelect={(event) => {
                event.preventDefault();
                void handleCreateSpaceFromFolder();
              }}
            >
              <FolderOpen className="h-4 w-4 shrink-0" aria-hidden />
              {t('layout.workspace-use-local-folder')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
