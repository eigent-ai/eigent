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

import { resolveSpaceDetailMemoryTarget } from '@/components/Home/memoryRoute';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { isLocalWorkspaceSpace } from '@/lib/spaceLabel';
import { AUTOMATION_ICON } from '@/lib/triggerIcon';
import { cn } from '@/lib/utils';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSpaceStore } from '@/store/spaceStore';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Activity,
  ArrowLeft,
  CalendarDays,
  Cloud,
  FolderOpen,
  HardDrive,
  ListChecks,
  MessageCircle,
} from 'lucide-react';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSpaceDetailData } from './hooks/useSpaceDetailData';
import Projects from './Projects';
import { SpaceDetailTabSkeleton } from './SpaceDetailLoadingSkeleton';
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
const uiEaseOut = [0.23, 1, 0.32, 1] as const;

function CommittedSpaceDetailFallback({
  tab,
  onCommit,
}: {
  tab: SpaceDetailTab;
  onCommit: (tab: SpaceDetailTab) => void;
}) {
  useEffect(() => {
    onCommit(tab);
  }, [onCommit, tab]);

  return <SpaceDetailTabSkeleton tab={tab} />;
}

export function SpaceDetailSuspenseContent({
  activeTab,
  contextLikeTab,
  children,
}: {
  activeTab: SpaceDetailTab;
  contextLikeTab: boolean;
  children: ReactNode;
}) {
  const reduceMotion = Boolean(useReducedMotion());
  const [pendingRevealTab, setPendingRevealTab] =
    useState<SpaceDetailTab | null>(null);

  useEffect(() => {
    setPendingRevealTab((current) => (current === activeTab ? current : null));
  }, [activeTab]);

  const handleFallbackCommit = useCallback((tab: SpaceDetailTab) => {
    setPendingRevealTab(tab);
  }, []);
  const shouldReveal = pendingRevealTab === activeTab;
  const revealDuration = reduceMotion ? 0.12 : 0.2;

  return (
    <Suspense
      fallback={
        <CommittedSpaceDetailFallback
          tab={activeTab}
          onCommit={handleFallbackCommit}
        />
      }
    >
      <motion.div
        key={activeTab}
        data-space-detail-resolved-content={activeTab}
        data-space-detail-content-reveal={shouldReveal ? 'true' : 'false'}
        data-space-detail-reveal-duration={shouldReveal ? revealDuration : 0}
        className={contextLikeTab ? 'h-full' : 'min-h-full'}
        initial={{ opacity: shouldReveal ? 0 : 1 }}
        animate={{ opacity: 1 }}
        transition={{
          duration: shouldReveal ? revealDuration : 0,
          ease: uiEaseOut,
        }}
        onAnimationComplete={() => {
          if (!shouldReveal) return;
          setPendingRevealTab((current) =>
            current === activeTab ? null : current
          );
        }}
      >
        {children}
      </motion.div>
    </Suspense>
  );
}

function Stat({
  icon,
  label,
  value,
  loading = false,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  loading?: boolean;
}) {
  return (
    <div data-space-stat={label} className="flex min-w-0 items-center gap-3">
      <div
        aria-hidden
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-x border-y border-solid border-ds-hairline-subtle-default bg-ds-neutral-default-default text-ds-ink-default-default"
      >
        {icon}
      </div>
      <div className="min-w-0">
        <span className="block truncate !text-ds-text-meta font-semibold tracking-wide text-ds-ink-muted-default uppercase">
          {label}
        </span>
        {loading ? (
          <Skeleton
            data-space-stat-skeleton={label}
            className="mt-1 h-4 w-10"
          />
        ) : (
          <span
            className="mt-1 block truncate !text-ds-text-body-large font-semibold text-ds-ink-default-default"
            title={typeof value === 'string' ? value : undefined}
          >
            {value}
          </span>
        )}
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
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
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
  const memoryTarget = resolveSpaceDetailMemoryTarget(
    spaceId,
    searchParams,
    data.projects
  );

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
            className="h-10 w-10 text-ds-ink-muted-default"
            aria-hidden
          />
          <span className="block !text-ds-text-base text-ds-ink-muted-default">
            {t('layout.space-unavailable', {
              defaultValue: 'This Space is unavailable or has been removed.',
            })}
          </span>
          <Button type="button" variant="secondary" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {t('layout.back-to-home', { defaultValue: 'Back to Home' })}
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
            key={`${memoryTarget.scope.type}:${memoryTarget.scope.id}`}
            fixedScope={memoryTarget.scope}
            fixedScopeLabel={
              memoryTarget.scope.type === 'project'
                ? (memoryTarget.label ??
                  t('layout.memory-overview-untitled-project'))
                : undefined
            }
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
          className="scrollbar-always-visible min-h-0 flex-1 [scrollbar-gutter:stable] overflow-y-scroll"
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
                  className="block truncate !text-ds-text-section font-bold text-ds-ink-default-default"
                  title={space.name?.trim() || 'Untitled Space'}
                >
                  {space.name?.trim() || 'Untitled Space'}
                </span>
                <span className="mt-2 block !text-ds-text-base text-ds-ink-muted-default">
                  {space.description?.trim() || 'No description added.'}
                </span>
              </div>
              <div className="grid min-w-0 grid-cols-3 gap-x-6 gap-y-5">
                <Stat
                  icon={<MessageCircle className={statIconClassName} />}
                  label="Sessions"
                  value={data.projectCount}
                  loading={data.projectsLoading}
                />
                <Stat
                  icon={<ListChecks className={statIconClassName} />}
                  label="Tasks"
                  value={data.taskCount}
                  loading={data.projectsLoading}
                />
                <Stat
                  icon={<AUTOMATION_ICON className={statIconClassName} />}
                  label={t('layout.triggers')}
                  value={data.triggerCount}
                  loading={data.triggersLoading}
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
            className="sticky -top-px z-20 border-x-0 border-t-0 border-b-1 border-solid border-ds-hairline-subtle-disabled bg-ds-neutral-subtle-default px-8 pt-2"
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
                  buttonRadius="full"
                  className="h-8 shrink-0 font-bold"
                  onClick={handleOpenWorkspace}
                >
                  {t('layout.open-workspace', {
                    defaultValue: 'Open Workspace',
                  })}
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
              <SpaceDetailSuspenseContent
                activeTab={activeTab}
                contextLikeTab={contextLikeTab}
              >
                {tabContent}
              </SpaceDetailSuspenseContent>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
