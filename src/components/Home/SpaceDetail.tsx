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

import ContentHeader from '@/components/Layout/ContentHeader';
import { Button } from '@/components/ui/button';
import {
  LabelPillToggle,
  type LabelPillToggleOption,
} from '@/components/ui/label-pill-toggle';
import { isLocalWorkspaceSpace } from '@/lib/spaceLabel';
import { cn } from '@/lib/utils';
import {
  Activity,
  ArrowLeft,
  Brain,
  CalendarDays,
  Cloud,
  FolderKanban,
  FolderOpen,
  HardDrive,
  ListChecks,
  LoaderCircle,
  Settings2,
  Zap,
} from 'lucide-react';
import { lazy, Suspense, type ReactNode } from 'react';
import Projects from './Projects';
import Tasks from './Tasks';
import Triggers from './Triggers';
import { useSpaceDetailData } from './hooks/useSpaceDetailData';
import { formatHubDate } from './utils';

const Folder = lazy(() => import('@/components/Folder'));
const Memory = lazy(() => import('@/components/Settings/Memory'));
const WorkspaceConfigurationEditor = lazy(() =>
  import('@/pages/WorkspaceConfiguration').then((module) => ({
    default: module.WorkspaceConfigurationEditor,
  }))
);

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

const SPACE_DETAIL_TAB_OPTIONS: LabelPillToggleOption<SpaceDetailTab>[] = [
  { value: 'projects', label: 'Projects', icon: FolderKanban },
  { value: 'tasks', label: 'Tasks', icon: ListChecks },
  { value: 'triggers', label: 'Triggers', icon: Zap },
  { value: 'context', label: 'Context', icon: FolderOpen },
  { value: 'memory', label: 'Memory', icon: Brain },
  { value: 'workspace-profile', label: 'Workspace Profile', icon: Settings2 },
];

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
  const data = useSpaceDetailData(spaceId);
  const { space } = data;

  if (!space) {
    return (
      <div className="flex h-full flex-col">
        <ContentHeader border={false} />
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
      <ContentHeader border={false} />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="scrollbar-always-visible min-h-0 flex-1 overflow-y-scroll [scrollbar-gutter:stable]">
          <div className="px-8 py-6">
            <div className="mx-auto grid w-full max-w-[1100px] gap-8 xl:grid-cols-[minmax(240px,0.8fr)_minmax(600px,1.4fr)] xl:items-start">
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
            className="sticky top-0 z-20 bg-ds-bg-neutral-subtle-default px-8 py-2"
          >
            <div className="mx-auto w-full max-w-[1100px]">
              <LabelPillToggle
                value={activeTab}
                options={SPACE_DETAIL_TAB_OPTIONS}
                onValueChange={onTabChange}
                layoutId="space-detail-tabs"
                aria-label="Space content"
              />
            </div>
          </div>

          <div
            className={cn(
              'mx-auto w-full max-w-[1100px]',
              contextLikeTab
                ? 'h-[calc(100dvh-8.5rem)] min-h-[32rem]'
                : 'min-h-full px-8 py-4'
            )}
          >
            <Suspense fallback={<DetailFallback />}>{tabContent}</Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}
