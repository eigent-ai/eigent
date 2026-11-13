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
import { SpaceEmojiPicker } from '@/components/Home/SpaceEmojiPicker';
import { SpaceHeaderMenu } from '@/components/Home/SpaceHeaderMenu';
import {
  pinSpaceOrChoose,
  usePinnedSpaceIds,
} from '@/components/Layout/AppRail/pinnedSpaces';
import ContentHeader, {
  CONTENT_HEADER_TITLE_CLASS,
  useFocusContentHeading,
} from '@/components/Layout/ContentHeader';
import OverviewIconFrame from '@/components/Layout/OverviewIconFrame';
import { Button } from '@/components/ui/button';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { Skeleton } from '@/components/ui/skeleton';
import { TooltipSimple } from '@/components/ui/tooltip';
import { useSpaceSwitch } from '@/hooks/useSpaceSwitch';
import {
  getSpaceStatusLabel,
  isLegacySpace,
  isLocalWorkspaceSpace,
} from '@/lib/spaceLabel';
import { AUTOMATION_ICON } from '@/lib/triggerIcon';
import { cn } from '@/lib/utils';
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
  Pin,
  PinOff,
  type LucideIcon,
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
import { useSearchParams } from 'react-router-dom';
import { HomeHubListInsetProvider } from './components/HomeHubListTable';
import { useSpaceDetailData } from './hooks/useSpaceDetailData';
import Projects from './Projects';
import { SpaceDetailTabSkeleton } from './SpaceDetailLoadingSkeleton';
import {
  getSpaceDetailPanelId,
  getSpaceDetailTabId,
  SpaceDetailTabsNav,
  type SpaceDetailTab,
} from './SpaceDetailTabsNav';
import { SpaceQuickComposer } from './SpaceQuickComposer';
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
/**
 * Home's Space page lines its content up with the header above it. On the
 * left, that is the icon of the Space menu: a ghost button pulled 8px into
 * the header's 16px inset, with its icon inset by the button's own padding.
 * On the right, it is Open workspace's edge, less the 8px scrollbar track
 * that the scroll area keeps on that side.
 */
const HOME_CONTENT_INSET_CLASS =
  'pl-[calc(var(--ds-ref-space-16)_-_var(--ds-ref-space-8)_+_var(--ds-button-sm-padding-inline))] pr-[calc(var(--ds-ref-space-16)_-_var(--scrollbar-size))]';
const SPACE_VIEW_CONTENT_INSET_CLASS = 'px-8';
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
    <div
      id={getSpaceDetailPanelId(activeTab)}
      role="tabpanel"
      aria-labelledby={getSpaceDetailTabId(activeTab)}
      className={contextLikeTab ? 'h-full' : 'min-h-full'}
    >
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
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  loading = false,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  loading?: boolean;
}) {
  return (
    <div data-space-stat={label} className="flex min-w-0 items-center gap-3">
      <OverviewIconFrame>
        <DsIcon icon={icon} />
      </OverviewIconFrame>
      <div className="min-w-0">
        <DsText
          as="span"
          role="meta"
          className="block truncate text-ds-ink-muted-default"
        >
          {label}
        </DsText>
        {loading ? (
          <Skeleton
            data-space-stat-skeleton={label}
            className="mt-1 h-4 w-10"
          />
        ) : (
          <span
            className="mt-1 block truncate !text-ds-text-body-large font-semibold text-ds-ink-default-default tabular-nums"
            title={typeof value === 'string' ? value : undefined}
          >
            {value}
          </span>
        )}
      </div>
    </div>
  );
}

/** A Space page fact as a row: icon and name, with the value at the end. */
function StatRow({
  icon,
  label,
  value,
  loading = false,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  loading?: boolean;
}) {
  return (
    <div
      data-space-stat={label}
      className="flex min-w-0 items-center gap-ds-12 py-ds-8"
    >
      <DsIcon icon={icon} className="shrink-0 text-ds-ink-muted-default" />
      <DsText
        as="span"
        role="base"
        className="min-w-0 flex-1 truncate text-ds-ink-muted-default"
      >
        {label}
      </DsText>
      {loading ? (
        <Skeleton
          data-space-stat-skeleton={label}
          className="h-4 w-10 shrink-0"
        />
      ) : (
        <span
          className="max-w-[60%] shrink-0 truncate text-right !text-ds-text-base font-semibold text-ds-ink-default-default tabular-nums"
          title={typeof value === 'string' ? value : undefined}
        >
          {value}
        </span>
      )}
    </div>
  );
}

interface SpaceStatItem {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  loading?: boolean;
}

const SPACE_NAME_CLASS =
  'block truncate !text-ds-text-section font-bold text-ds-ink-default-default';
/** Home's Space page leads with the Space, so its name reads larger. */
const HOME_SPACE_NAME_CLASS =
  'block truncate !text-ds-text-page font-bold text-ds-ink-default-default';

interface SpaceDetailProps {
  spaceId: string;
  activeTab: SpaceDetailTab;
  onTabChange: (tab: SpaceDetailTab) => void;
  onBack: () => void;
  /**
   * `home` is the Workspace page in Home: its header's title is the Space's
   * name and menu, beside Pin Space and Open workspace, and its summary leads
   * with the Space and a box to start a Session in it, with the facts stacked
   * beside them. `space-view` is the same page next to the Space sidebar,
   * which already has both, so it has no header and keeps the compact summary.
   */
  presentation?: 'home' | 'space-view';
}

export default function SpaceDetail({
  spaceId,
  activeTab,
  onTabChange,
  onBack,
  presentation = 'home',
}: SpaceDetailProps) {
  const { t, i18n } = useTranslation();
  const [searchParams] = useSearchParams();
  const data = useSpaceDetailData(spaceId);
  const { space } = data;
  const spaceName = space?.name?.trim() || t('layout.spaces-untitled');
  const memoryTarget = resolveSpaceDetailMemoryTarget(
    spaceId,
    searchParams,
    data.projects
  );

  const heading = useFocusContentHeading(spaceId);
  const inSpaceView = presentation === 'space-view';
  const { openSpaceView } = useSpaceSwitch();
  const pinned = usePinnedSpaceIds().includes(spaceId);
  const unpinSpace = useSpaceStore((state) => state.unpinSpace);
  // The title is the Space's name and its menu; a missing Space keeps the
  // plain page name.
  const headerTitle = (
    <h1 ref={heading} tabIndex={-1} className={CONTENT_HEADER_TITLE_CLASS}>
      {space ? (
        <SpaceHeaderMenu spaceId={spaceId} />
      ) : (
        t('layout.workspace-tab')
      )}
    </h1>
  );

  if (!space) {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-col">
        <ContentHeader
          persistent
          className="px-ds-16"
          titleAsChild
          title={headerTitle}
        />
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <DsIcon
            icon={FolderOpen}
            recipe="illustration"
            illustrationSize={40}
            className="text-ds-ink-muted-default"
            aria-hidden
          />
          <span className="block !text-ds-text-base text-ds-ink-muted-default">
            {t('layout.space-unavailable', {
              defaultValue: 'This Space is unavailable or has been removed.',
            })}
          </span>
          <Button type="button" variant="secondary" size="sm" onClick={onBack}>
            <DsIcon icon={ArrowLeft} aria-hidden />
            {t('layout.back')}
          </Button>
        </div>
      </div>
    );
  }

  const location = isLocalWorkspaceSpace(space)
    ? t('layout.files-tab-local')
    : t('layout.files-tab-remote');
  const description = space.description?.trim() || t('layout.no-description');
  const stats: SpaceStatItem[] = [
    {
      icon: MessageCircle,
      label: t('layout.projects'),
      value: data.projectCount,
      loading: data.projectsLoading,
    },
    {
      icon: ListChecks,
      label: t('layout.tasks-heading'),
      value: data.taskCount,
      loading: data.projectsLoading,
    },
    {
      icon: AUTOMATION_ICON,
      label: t('layout.triggers'),
      value: data.triggerCount,
      loading: data.triggersLoading,
    },
    {
      icon: Activity,
      label: t('layout.home-list-status'),
      value: getSpaceStatusLabel(space.status, t),
    },
    {
      icon: isLocalWorkspaceSpace(space) ? HardDrive : Cloud,
      label: t('layout.home-list-location'),
      value: location,
    },
    {
      icon: CalendarDays,
      label: t('layout.home-list-created'),
      value:
        formatHubDate(
          space.createdAt,
          i18n.resolvedLanguage || i18n.language
        ) || '—',
    },
  ];
  const pinLabel = pinned ? t('layout.unpin-space') : t('layout.pin-space');

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
  const contentInsetClass = inSpaceView
    ? SPACE_VIEW_CONTENT_INSET_CLASS
    : HOME_CONTENT_INSET_CLASS;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {inSpaceView ? null : (
        <ContentHeader
          persistent
          className="px-ds-16"
          titleAsChild
          title={headerTitle}
          actions={
            <>
              <TooltipSimple
                content={pinLabel}
                compact
                side="bottom"
                variant="instant"
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  buttonRadius="full"
                  buttonContent="icon-only"
                  aria-label={pinLabel}
                  data-space-pin-toggle
                  onClick={() => {
                    if (pinned) unpinSpace(spaceId);
                    else pinSpaceOrChoose(spaceId);
                  }}
                >
                  <DsIcon icon={pinned ? PinOff : Pin} aria-hidden />
                </Button>
              </TooltipSimple>
              <Button
                type="button"
                variant="primary"
                size="sm"
                buttonRadius="full"
                onClick={() => openSpaceView(spaceId)}
              >
                {t('layout.open-workspace')}
              </Button>
            </>
          }
        />
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        <div
          data-space-detail-scroll-container
          className="scrollbar-always-visible grid min-h-0 flex-1 [scrollbar-gutter:stable] grid-rows-[auto_auto_minmax(32rem,1fr)] overflow-y-scroll"
        >
          {inSpaceView ? null : (
            // Home's Space page leads with the Space and a box to start a
            // Session in it; the facts stack beside it, and the tabs sit
            // below the larger summary.
            <div
              data-space-detail-summary-inset
              className={cn(HOME_CONTENT_INSET_CLASS, 'pt-ds-40 pb-ds-32')}
            >
              <div
                data-space-detail-summary-rail
                data-space-detail-summary="home"
                className={cn(
                  SPACE_DETAIL_RAIL_CLASS,
                  'grid gap-ds-32 lg:grid-cols-[minmax(0,1fr)_minmax(220px,280px)] lg:items-start'
                )}
              >
                <div className="flex min-w-0 flex-col gap-ds-24">
                  <div className="flex min-w-0 items-start gap-ds-16">
                    <SpaceEmojiPicker space={space} name={spaceName} />
                    <div className="min-w-0 overflow-hidden">
                      <span className={HOME_SPACE_NAME_CLASS} title={spaceName}>
                        {spaceName}
                      </span>
                      <span className="mt-ds-4 block !text-ds-text-body-large text-ds-ink-muted-default">
                        {description}
                      </span>
                    </div>
                  </div>
                  <SpaceQuickComposer
                    spaceId={spaceId}
                    readOnly={isLegacySpace(space)}
                  />
                </div>
                <div
                  data-space-stats-list
                  className="flex min-w-0 flex-col lg:border-x-0 lg:border-y-0 lg:border-l-ds-hairline lg:border-solid lg:border-ds-hairline-subtle-default lg:pl-ds-24"
                >
                  {stats.map((stat) => (
                    <StatRow key={stat.label} {...stat} />
                  ))}
                </div>
              </div>
            </div>
          )}
          {inSpaceView ? (
            <div className="px-8 py-6">
              <div
                data-space-detail-summary-rail
                data-space-detail-summary="space-view"
                className={cn(
                  SPACE_DETAIL_RAIL_CLASS,
                  'grid gap-6 lg:grid-cols-[minmax(220px,0.8fr)_minmax(420px,1.4fr)] lg:items-start'
                )}
              >
                <div className="flex min-w-0 items-start gap-ds-12">
                  <SpaceEmojiPicker space={space} name={spaceName} />
                  <div className="min-w-0 overflow-hidden">
                    {/* Without the header, the Space's name is the page heading. */}
                    <h1
                      ref={heading}
                      tabIndex={-1}
                      className={cn(SPACE_NAME_CLASS, 'm-0 outline-none')}
                      title={spaceName}
                    >
                      {spaceName}
                    </h1>
                    <span className="mt-1 block !text-ds-text-base text-ds-ink-muted-default">
                      {description}
                    </span>
                  </div>
                </div>
                <div className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-4 min-[560px]:grid-cols-2 xl:grid-cols-3">
                  {stats.map((stat) => (
                    <Stat key={stat.label} {...stat} />
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          <div
            data-space-tabs-sticky
            className={cn(
              'sticky -top-px z-20 border-x-0 border-t-0 border-b-1 border-solid border-ds-hairline-subtle-disabled bg-ds-neutral-subtle-default pt-2',
              contentInsetClass
            )}
          >
            <div
              data-space-detail-tabs-rail
              className={SPACE_DETAIL_RAIL_CLASS}
            >
              <SpaceDetailTabsNav
                activeTab={activeTab}
                onChange={onTabChange}
                className="min-w-0"
              />
            </div>
          </div>

          <div
            className={cn(
              'min-h-0 py-4',
              contentInsetClass,
              contextLikeTab ? 'h-full' : 'min-h-full'
            )}
          >
            <div
              data-space-detail-content-rail
              className={cn(
                SPACE_DETAIL_RAIL_CLASS,
                contextLikeTab ? 'h-full' : 'min-h-full'
              )}
            >
              {/* In Home, list rows line up with the header-aligned edges;
                  this also reaches the loading skeleton. */}
              <HomeHubListInsetProvider
                value={inSpaceView ? 'default' : 'flush'}
              >
                <SpaceDetailSuspenseContent
                  activeTab={activeTab}
                  contextLikeTab={contextLikeTab}
                >
                  {tabContent}
                </SpaceDetailSuspenseContent>
              </HomeHubListInsetProvider>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
