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
// Licensed under the Apache License, Version 2.0 (the "License");

import { Button } from '@/components/ui/button';
import { isLocalWorkspaceSpace } from '@/lib/spaceLabel';
import { cn } from '@/lib/utils';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSpaceStore } from '@/store/spaceStore';
import {
  Activity,
  ArrowLeft,
  CalendarDays,
  Cloud,
  FolderKanban,
  FolderOpen,
  HardDrive,
  ListChecks,
  LoaderCircle,
  Zap,
} from 'lucide-react';
import { lazy, Suspense, useCallback, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSpaceDetailData } from './hooks/useSpaceDetailData';
import Projects from './Projects';
import { SpaceDetailTabsNav, type SpaceDetailTab } from './SpaceDetailTabsNav';
import Tasks from './Tasks';
import Triggers from './Triggers';
import { formatHubDate } from './utils';

export {
  isSpaceDetailTab,
  SPACE_DETAIL_TABS,
  type SpaceDetailTab,
} from './SpaceDetailTabsNav';

const Folder = lazy(() => import('@/components/Folder'));
const Memory = lazy(() => import('@/components/Settings/Memory'));
const WorkspaceConfigurationEditor = lazy(() =>
  import('@/pages/WorkspaceConfiguration').then((module) => ({
    default: module.WorkspaceConfigurationEditor,
  }))
);

const SPACE_DETAIL_RAIL_CLASS = 'mx-auto w-full max-w-[1100px]';

function DetailFallback() {
  return (
    <div
      role="status"
      className="flex min-h-72 items-center justify-center text-ds-icon-neutral-muted-default"
    >
      <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden />
      <span className="sr-only">Loading Space content</span>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
}) {
  return (
    <div data-space-stat={label} className="flex min-w-0 items-center gap-3">
      <div
        aria-hidden
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-solid border-ds-border-neutral-subtle-default bg-ds-bg-neutral-default-default text-ds-icon-neutral-default-default"
      >
        {icon}
      </div>
      <div className="min-w-0">
        <span className="block truncate !text-label-xs font-semibold uppercase tracking-wide text-ds-text-neutral-muted-default">
          {label}
        </span>
        <span
          className="mt-1 block truncate !text-body-md font-semibold text-ds-text-neutral-default-default"
          title={typeof value === 'string' ? value : undefined}
        >
          {value}
        </span>
      </div>
    </div>
  );
}

interface SpaceDetailProps {
  spaceId: string;
  activeTab: SpaceDetailTab;
  onTabChange: (tab: SpaceDetailTab) => void;
  onBack: () => void;
}

export default function SpaceDetail({
  spaceId,
  activeTab,
  onTabChange,
  onBack,
}: SpaceDetailProps) {
  const navigate = useNavigate();
  const setActiveSpace = useSpaceStore((state) => state.setActiveSpace);
  const projectStore = useProjectRuntimeStore();
  const setActiveWorkspaceTab = usePageTabStore(
    (state) => state.setActiveWorkspaceTab
  );
  const requestWorkspaceChatFocus = usePageTabStore(
    (state) => state.requestWorkspaceChatFocus
  );
  const data = useSpaceDetailData(spaceId);
  const { space } = data;

  const handleOpenWorkspace = useCallback(() => {
    setActiveSpace(spaceId);
    projectStore.setActiveProject(null);
    setActiveWorkspaceTab('workforce');
    requestWorkspaceChatFocus();
    navigate('/');
  }, [
    navigate,
    projectStore,
    requestWorkspaceChatFocus,
    setActiveSpace,
    setActiveWorkspaceTab,
    spaceId,
  ]);

  if (!space) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <FolderOpen
            className="h-10 w-10 text-ds-icon-neutral-muted-default"
            aria-hidden
          />
          <span className="block !text-body-sm text-ds-text-neutral-muted-default">
            This Space is unavailable or has been removed.
          </span>
          <Button type="button" variant="secondary" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to Home
          </Button>
        </div>
      </div>
    );
  }

  const location = isLocalWorkspaceSpace(space) ? 'Local' : 'Remote';
  const statIconClassName = 'h-5 w-5';

  const tabContent = (() => {
    switch (activeTab) {
      case 'projects':
        return (
          <Projects
            projectsOverride={data.projects}
            presentation="space-detail"
          />
        );
      case 'tasks':
        return (
          <Tasks projectsOverride={data.projects} presentation="space-detail" />
        );
      case 'triggers':
        return (
          <Triggers
            triggersOverride={data.triggers}
            presentation="space-detail"
          />
        );
      case 'context':
        return <Folder key={spaceId} spaceId={spaceId} />;
      case 'memory':
        return (
          <Memory
            key={spaceId}
            fixedScope={{ type: 'space', id: spaceId }}
            showScopeSelector={false}
          />
        );
      case 'workspace-profile':
        return (
          <WorkspaceConfigurationEditor
            key={spaceId}
            presentation="settings"
            spaceId={spaceId}
          />
        );
    }
  })();

  const contextLikeTab = activeTab === 'context';

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col">
        <div
          data-space-detail-scroll-container
          className="scrollbar-always-visible min-h-0 flex-1 overflow-y-scroll [scrollbar-gutter:stable]"
        >
          <div className="px-8 py-8">
            <div
              data-space-detail-summary-rail
              className={cn(
                SPACE_DETAIL_RAIL_CLASS,
                'grid gap-8 xl:grid-cols-[minmax(240px,0.8fr)_minmax(600px,1.4fr)] xl:items-start'
              )}
            >
              <div className="min-w-0 overflow-hidden">
                <span
                  className="block truncate !text-body-lg font-bold text-ds-text-neutral-default-default"
                  title={space.name?.trim() || 'Untitled Space'}
                >
                  {space.name?.trim() || 'Untitled Space'}
                </span>
                <span className="mt-2 block max-w-xl !text-body-sm text-ds-text-neutral-muted-default">
                  {space.description?.trim() || 'No description added.'}
                </span>
              </div>
              <div className="grid min-w-0 grid-cols-3 gap-x-6 gap-y-5">
                <Stat
                  icon={<FolderKanban className={statIconClassName} />}
                  label="Projects"
                  value={data.projectCount}
                />
                <Stat
                  icon={<ListChecks className={statIconClassName} />}
                  label="Tasks"
                  value={data.taskCount}
                />
                <Stat
                  icon={<Zap className={statIconClassName} />}
                  label="Triggers"
                  value={data.triggerCount}
                />
                <Stat
                  icon={<Activity className={statIconClassName} />}
                  label="Status"
                  value={
                    space.status.charAt(0).toUpperCase() + space.status.slice(1)
                  }
                />
                <Stat
                  icon={
                    isLocalWorkspaceSpace(space) ? (
                      <HardDrive className={statIconClassName} />
                    ) : (
                      <Cloud className={statIconClassName} />
                    )
                  }
                  label="Location"
                  value={location}
                />
                <Stat
                  icon={<CalendarDays className={statIconClassName} />}
                  label="Added"
                  value={formatHubDate(space.createdAt) || '—'}
                />
              </div>
            </div>
          </div>

          <div
            data-space-tabs-sticky
            className="border-b-1 sticky -top-px z-20 border-x-0 border-t-0 border-solid border-ds-border-neutral-subtle-disabled bg-ds-bg-neutral-subtle-default px-8 pt-2"
          >
            <div
              data-space-detail-tabs-rail
              className={SPACE_DETAIL_RAIL_CLASS}
            >
              <div className="flex min-w-0 items-start justify-between gap-4">
                <SpaceDetailTabsNav
                  activeTab={activeTab}
                  onChange={onTabChange}
                  className="min-w-0 flex-1"
                />
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  className="h-8 shrink-0 rounded-lg font-bold"
                  onClick={handleOpenWorkspace}
                >
                  Open Workspace
                </Button>
              </div>
            </div>
          </div>

          <div
            className={cn(
              'px-8',
              contextLikeTab
                ? 'h-[calc(100dvh-8.5rem)] min-h-[32rem]'
                : 'min-h-full py-4'
            )}
          >
            <div
              data-space-detail-content-rail
              className={cn(
                SPACE_DETAIL_RAIL_CLASS,
                contextLikeTab ? 'h-full' : 'min-h-full'
              )}
            >
              <Suspense fallback={<DetailFallback />}>{tabContent}</Suspense>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
