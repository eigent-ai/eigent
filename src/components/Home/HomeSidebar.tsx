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

import {
  getChoosableSpaces,
  usePinnedSpaceIds,
} from '@/components/Layout/AppRail/pinnedSpaces';
import {
  spaceRailStatusText,
  spaceRailTileInitial,
} from '@/components/Layout/AppRail/SpaceRailTile';
import {
  NavTab,
  SidebarNavGroup,
  SidebarScrollArea,
  SidebarSection,
  SidebarShell,
} from '@/components/Layout/AppSidebar';
import { SIDEBAR_TAB_TOOLTIP_CONTENT_CLASS } from '@/components/SpaceSidebar/constants';
import { SessionControlDialogs } from '@/components/SpaceSidebar/SessionControlDialogs';
import {
  SessionNavListRows,
  type SessionNavItem,
} from '@/components/SpaceSidebar/SessionNavListRows';
import { SidebarAccordionSection } from '@/components/SpaceSidebar/SidebarAccordionSection';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { ShortcutTooltipContent } from '@/components/ui/shortcut-tooltip';
import { TooltipSimple } from '@/components/ui/tooltip';
import { useSessionNavStatuses } from '@/hooks/useSessionNavStatuses';
import {
  useSessionAttention,
  useSpaceAttention,
  type SpaceAttention,
} from '@/hooks/useSpaceAttention';
import { isProjectAchieved } from '@/lib/projectAchievement';
import {
  presentationForKind,
  resolveSessionNavLeadPresentation,
  type SessionNavLeadPresentation,
} from '@/lib/sessionNavLead';
import { shouldListSession } from '@/lib/sessionOpen';
import { isHomePagePath } from '@/lib/shellRoutes';
import {
  getActiveSpaceTriggerLabel,
  getSessionMetaDisplayName,
} from '@/lib/spaceLabel';
import { cn } from '@/lib/utils';
import type { RunAttentionState } from '@/service/projectRunsApi';
import { usePageTabStore, type HomeSpaceSort } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSessionControlsStore } from '@/store/sessionControlsStore';
import {
  getVisibleProjectMetasForSpace,
  isUnconfiguredPlaceholderSpace,
  useSpaceStore,
  type Space,
  type SpaceProjectMeta,
} from '@/store/spaceStore';
import type { TFunction } from 'i18next';
import {
  ChevronDown,
  ChevronRight,
  Ellipsis,
  Folder,
  Pin,
  Plus,
} from 'lucide-react';
import { useCallback, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useSearchParams } from 'react-router-dom';
import {
  HOME_SPACE_RECENT_SESSIONS,
  nextNeedsYouOrder,
  orderBySnapshot,
  spaceLastActivity,
} from './homeSidebarModel';
import { useHomeVisitStore } from './homeVisit';
import { useHomeNavigation } from './hooks/useHomeNavigation';
import { useNewSpaceCreation } from './hooks/useNewSpaceCreation';
import NewSpaceDialog from './NewSpaceDialog';

const SPACE_ROW_FOCUS_CLASS =
  'outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ds-hairline-subtle-default focus-visible:outline-none';

interface SessionRowSources {
  t: TFunction;
  navLeadByProjectId: Readonly<Record<string, SessionNavLeadPresentation>>;
  historyLoadingProjectIds: Readonly<Record<string, true>>;
  pinnedProjectIds: readonly string[];
  attention: Readonly<Record<string, RunAttentionState>>;
}

/**
 * A Session row as the Space sidebar draws it. A Session that isn't loaded
 * has no live lead yet, so the Brain's running or waiting state stands in.
 */
function toSessionNavItem(
  meta: SpaceProjectMeta,
  sources: SessionRowSources
): SessionNavItem {
  const achieved = isProjectAchieved(meta.metadata);
  const attentionState = sources.attention[meta.id];
  const cachedLead =
    sources.navLeadByProjectId[meta.id] ??
    (attentionState === 'waiting'
      ? presentationForKind('hitl')
      : attentionState === 'running'
        ? presentationForKind('running', true)
        : undefined);
  return {
    id: meta.id,
    title: getSessionMetaDisplayName(meta, sources.t),
    sessionLead: resolveSessionNavLeadPresentation({
      cachedLead,
      isHistoryLoading: Boolean(sources.historyLoadingProjectIds[meta.id]),
      isAchieved: achieved,
    }),
    achieved,
    pinned: sources.pinnedProjectIds.includes(meta.id),
  };
}

function SpaceStatusMark({ attention }: { attention?: SpaceAttention }) {
  const status = attention?.waiting
    ? 'waiting'
    : attention?.running
      ? 'running'
      : null;
  if (!status) return null;
  return (
    <span
      aria-hidden
      data-home-space-status={status}
      className={cn(
        'size-2 shrink-0 rounded-full',
        status === 'waiting'
          ? 'bg-ds-text-status-error-strong-default'
          : 'border border-x border-y border-solid border-ds-border-information-default-default'
      )}
    />
  );
}

interface HomeSpaceGroupProps {
  space: Space;
  sessions: SpaceProjectMeta[];
  folded: boolean;
  selected: boolean;
  pinned: boolean;
  attention?: SpaceAttention;
  activeSessionId: string | null;
  rowSources: SessionRowSources;
  onToggleFold: () => void;
  onOpenWorkspace: () => void;
  onShowAll: () => void;
  onSessionClick: (projectId: string) => void;
  onPinSession: (projectId: string) => void;
  onEndSession: (projectId: string) => void;
  onDeleteSession: (projectId: string) => void;
}

/**
 * One Space in Home: its icon folds the group, its name opens the Workspace
 * page, and up to four recent Sessions follow.
 */
function HomeSpaceGroup({
  space,
  sessions,
  folded,
  selected,
  pinned,
  attention,
  activeSessionId,
  rowSources,
  onToggleFold,
  onOpenWorkspace,
  onShowAll,
  onSessionClick,
  onPinSession,
  onEndSession,
  onDeleteSession,
}: HomeSpaceGroupProps) {
  const { t } = useTranslation();
  const groupId = useId();
  const name = getActiveSpaceTriggerLabel(space.name, t);
  const statusText = spaceRailStatusText(attention, t);
  const visibleSessions = folded
    ? []
    : sessions.slice(0, HOME_SPACE_RECENT_SESSIONS);
  useSessionNavStatuses(
    visibleSessions.map((session) => session.id),
    folded ? null : space.id
  );

  const nameLabel = [name, pinned ? t('layout.pinned') : '', statusText]
    .filter(Boolean)
    .join(', ');
  const foldLabel = folded
    ? t('layout.unfold-space', { name })
    : t('layout.fold-space', { name });

  return (
    <div data-home-space={space.id} className="flex min-w-0 flex-col">
      <div
        className={cn(
          'group/space-row relative flex h-8 w-full min-w-0 items-center rounded-xl transition-colors duration-150',
          selected
            ? 'bg-ds-neutral-subtle-default'
            : 'hover:bg-ds-neutral-subtle-default'
        )}
      >
        {/* The Space icon is the fold control; hover or focus shows the
            chevron in its place. */}
        <button
          type="button"
          onClick={onToggleFold}
          aria-label={foldLabel}
          aria-expanded={!folded}
          aria-controls={groupId}
          data-home-space-fold
          className={cn(
            'group/fold no-drag ml-ds-8 flex size-ds-control-xs shrink-0 items-center justify-center rounded-ds-compact-control text-ds-ink-muted-default',
            SPACE_ROW_FOCUS_CLASS
          )}
        >
          <span
            aria-hidden
            className="flex size-ds-icon-md items-center justify-center rounded-ds-4 bg-ds-neutral-muted-default text-ds-ink-default-default group-hover/space-row:hidden group-focus-visible/fold:hidden"
          >
            <DsText as="span" role="meta" weight="semibold">
              {spaceRailTileInitial(name)}
            </DsText>
          </span>
          <span
            aria-hidden
            className="hidden items-center justify-center group-hover/space-row:flex group-focus-visible/fold:flex"
          >
            <DsIcon icon={folded ? ChevronRight : ChevronDown} />
          </span>
        </button>
        <TooltipSimple
          content={name}
          side="right"
          align="center"
          variant="instant"
          className={SIDEBAR_TAB_TOOLTIP_CONTENT_CLASS}
        >
          <button
            type="button"
            onClick={onOpenWorkspace}
            aria-label={nameLabel}
            aria-current={selected ? 'page' : undefined}
            className={cn(
              'no-drag flex h-full min-w-0 flex-1 items-center gap-ds-8 rounded-xl pr-3 pl-ds-8 text-left',
              SPACE_ROW_FOCUS_CLASS
            )}
          >
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-ds-text-base font-medium',
                selected
                  ? 'text-ds-ink-default-default'
                  : 'text-ds-ink-muted-default'
              )}
            >
              {name}
            </span>
            {pinned ? (
              <DsIcon
                icon={Pin}
                recipe="main-compact"
                className="text-ds-ink-subtle-default"
              />
            ) : null}
            <SpaceStatusMark attention={attention} />
          </button>
        </TooltipSimple>
      </div>
      <div
        id={groupId}
        hidden={folded}
        className="flex min-w-0 flex-col pl-ds-12"
      >
        {visibleSessions.length > 0 ? (
          <SessionNavListRows
            sessions={visibleSessions.map((session) =>
              toSessionNavItem(session, rowSources)
            )}
            activeSessionId={activeSessionId}
            onSessionClick={onSessionClick}
            onPinSession={onPinSession}
            onEndSession={onEndSession}
            onDeleteSession={onDeleteSession}
            folded={false}
          />
        ) : null}
        {!folded && sessions.length > HOME_SPACE_RECENT_SESSIONS ? (
          <NavTab
            active={false}
            onClick={onShowAll}
            leading={<span aria-hidden className="size-ds-icon-md shrink-0" />}
            label={
              <DsText
                as="span"
                role="meta"
                className="text-ds-ink-muted-default"
              >
                {t('layout.show-all-sessions', { count: sessions.length })}
              </DsText>
            }
            ariaLabel={t('layout.show-all-sessions-in-space', {
              count: sessions.length,
              name,
            })}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Home's sidebar: New session, All Spaces, the Sessions waiting for a reply,
 * and every Space with its recent Sessions. Spaces sort by last activity once
 * per Home visit, so rows don't move while it's open.
 */
export default function HomeSidebar() {
  const { t } = useTranslation();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { openAllSpaces, openSpaceWorkspace, openNewSession, openSession } =
    useHomeNavigation();
  const spaces = useSpaceStore((state) => state.spaces);
  const projectsBySpaceId = useSpaceStore((state) => state.projectsBySpaceId);
  const projectIdIndex = useSpaceStore((state) => state.projectIdIndex);
  const activeSpaceId = useSpaceStore((state) => state.activeSpaceId);
  const activeProjectId = useProjectRuntimeStore(
    (state) => state.activeProjectId
  );
  const navLeadByProjectId = useProjectRuntimeStore(
    (state) => state.navLeadByProjectId
  );
  const historyLoadingProjectIds = useProjectRuntimeStore(
    (state) => state.historyLoadingProjectIds
  );
  const activeWorkspaceTab = usePageTabStore(
    (state) => state.activeWorkspaceTab
  );
  const foldedSpaceIds = usePageTabStore((state) => state.homeFoldedSpaceIds);
  const spaceSort = usePageTabStore((state) => state.homeSpaceSort);
  const setSpaceSort = usePageTabStore((state) => state.setHomeSpaceSort);
  const setHomeSpaceFolded = usePageTabStore(
    (state) => state.setHomeSpaceFolded
  );
  const pinnedProjectIds = useSessionControlsStore(
    (state) => state.pinnedProjectIds
  );
  const togglePinned = useSessionControlsStore((state) => state.togglePinned);
  const requestAction = useSessionControlsStore((state) => state.requestAction);
  const pinnedSpaceIds = usePinnedSpaceIds();
  const spaceAttention = useSpaceAttention();
  const sessionAttention = useSessionAttention();
  const activity = useHomeVisitStore((state) => state.activity);
  const [newSpaceDialogOpen, setNewSpaceDialogOpen] = useState(false);
  const { createBlankSpace, createSpaceFromFolder } =
    useNewSpaceCreation('home_hub');

  const onWorkspaceRoute = location.pathname === '/';
  const onHomePage = isHomePagePath(location.pathname);
  const routeSpaceId = onHomePage ? searchParams.get('spaceId') : null;
  const sessionTabOpen = onWorkspaceRoute && activeWorkspaceTab === 'project';
  const activeSessionId = sessionTabOpen ? activeProjectId : null;

  const sessionsBySpace = useMemo(() => {
    const bySpace: Record<string, SpaceProjectMeta[]> = {};
    for (const spaceId of Object.keys(projectsBySpaceId)) {
      const metas = getVisibleProjectMetasForSpace(projectsBySpaceId, spaceId)
        .filter(shouldListSession)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      const order = orderBySnapshot(
        metas.map((meta) => meta.id),
        activity.sessions
      );
      const byId = new Map(metas.map((meta) => [meta.id, meta]));
      bySpace[spaceId] = order.map((id) => byId.get(id)!);
    }
    return bySpace;
    // Session rows read the chat stores through `shouldListSession`, the
    // same way the Space sidebar does; a Space's metas changing re-reads them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity.sessions, projectsBySpaceId, navLeadByProjectId]);

  const orderedSpaces = useMemo(() => {
    // Like the Spaces hub, skip untouched placeholders; the active Space
    // stays so its Sessions are always reachable.
    const choosable = getChoosableSpaces(
      spaces,
      projectsBySpaceId,
      activeSpaceId
    ).filter(
      (space) =>
        space.id === activeSpaceId ||
        !isUnconfiguredPlaceholderSpace(space, projectsBySpaceId)
    );
    // Creation time never changes, so that order needs no per-visit snapshot.
    if (spaceSort === 'created') {
      return choosable.sort((a, b) => b.createdAt - a.createdAt);
    }
    choosable.sort(
      (a, b) =>
        spaceLastActivity(b, sessionsBySpace[b.id] ?? []) -
        spaceLastActivity(a, sessionsBySpace[a.id] ?? [])
    );
    const byId = new Map(choosable.map((space) => [space.id, space]));
    return orderBySnapshot(
      choosable.map((space) => space.id),
      activity.spaces
    ).map((id) => byId.get(id)!);
  }, [
    activeSpaceId,
    activity.spaces,
    projectsBySpaceId,
    sessionsBySpace,
    spaceSort,
    spaces,
  ]);

  const isListedSession = useCallback(
    (projectId: string) => {
      const spaceId = projectIdIndex[projectId];
      return Boolean(
        spaceId &&
        sessionsBySpace[spaceId]?.some((session) => session.id === projectId)
      );
    },
    [projectIdIndex, sessionsBySpace]
  );

  // Waiting Sessions keep their place while Home is open; new ones join at
  // the end, and answered ones leave.
  const [needsYouOrder, setNeedsYouOrder] = useState<string[]>([]);
  const nextNeedsYou = nextNeedsYouOrder(
    needsYouOrder,
    sessionAttention,
    isListedSession
  );
  if (
    nextNeedsYou.length !== needsYouOrder.length ||
    nextNeedsYou.some((id, index) => id !== needsYouOrder[index])
  ) {
    setNeedsYouOrder(nextNeedsYou);
  }

  const rowSources: SessionRowSources = {
    t,
    navLeadByProjectId,
    historyLoadingProjectIds,
    pinnedProjectIds,
    attention: sessionAttention,
  };

  const needsYouItems = nextNeedsYou.flatMap((projectId) => {
    const spaceId = projectIdIndex[projectId];
    const meta = sessionsBySpace[spaceId]?.find(
      (session) => session.id === projectId
    );
    if (!meta) return [];
    return [
      {
        ...toSessionNavItem(meta, rowSources),
        trailing: getActiveSpaceTriggerLabel(spaces[spaceId]?.name, t),
      },
    ];
  });

  const requestEndSession = useCallback(
    (projectId: string) => requestAction('end', projectId),
    [requestAction]
  );
  const requestDeleteSession = useCallback(
    (projectId: string) => requestAction('delete', projectId),
    [requestAction]
  );

  const newSessionLabel = t('layout.new-project');
  const allSpacesLabel = t('layout.all-spaces');
  const newSpaceLabel = t('layout.new-space');
  const sortSpacesLabel = t('layout.sort-spaces');
  const homeLabel = t('layout.home');

  return (
    <>
      <SessionControlDialogs />
      <NewSpaceDialog
        open={newSpaceDialogOpen}
        onOpenChange={setNewSpaceDialogOpen}
        onStartFromScratch={() => {
          usePageTabStore.getState().setShellPlace('home');
          return createBlankSpace();
        }}
        onUseLocalFolder={() => {
          usePageTabStore.getState().setShellPlace('home');
          return createSpaceFromFolder();
        }}
      />
      <SidebarShell ariaLabel={homeLabel}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-clip">
          <SidebarSection>
            <SidebarNavGroup>
              <NavTab
                active={onWorkspaceRoute && !sessionTabOpen}
                onClick={openNewSession}
                leading={
                  <DsIcon icon={Plus} className="shrink-0" aria-hidden />
                }
                label={newSessionLabel}
                tooltip={
                  <ShortcutTooltipContent
                    label={newSessionLabel}
                    shortcutId="new-project"
                  />
                }
                tooltipCompact
                tooltipVariant="delayed"
                ariaLabel={newSessionLabel}
                ariaCurrentPage={onWorkspaceRoute && !sessionTabOpen}
              />
              <NavTab
                active={onHomePage && !routeSpaceId}
                onClick={openAllSpaces}
                leading={
                  <DsIcon icon={Folder} className="shrink-0" aria-hidden />
                }
                label={allSpacesLabel}
                ariaLabel={allSpacesLabel}
                ariaCurrentPage={onHomePage && !routeSpaceId}
              />
            </SidebarNavGroup>
          </SidebarSection>
          <SidebarSection grow="fill">
            <SidebarScrollArea
              role="navigation"
              ariaLabel={homeLabel}
              className="pb-1"
            >
              {needsYouItems.length > 0 ? (
                <SidebarAccordionSection label={t('layout.needs-you')}>
                  <SessionNavListRows
                    sessions={needsYouItems}
                    activeSessionId={activeSessionId}
                    onSessionClick={openSession}
                    showRowMenu={false}
                    folded={false}
                  />
                </SidebarAccordionSection>
              ) : null}
              <SidebarAccordionSection
                label={t('layout.spaces')}
                actions={
                  <>
                    <DropdownMenu>
                      <TooltipSimple
                        content={sortSpacesLabel}
                        compact
                        side="bottom"
                        variant="instant"
                      >
                        <span className="inline-flex">
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              buttonContent="icon-only"
                              aria-label={sortSpacesLabel}
                            >
                              <DsIcon icon={Ellipsis} aria-hidden />
                            </Button>
                          </DropdownMenuTrigger>
                        </span>
                      </TooltipSimple>
                      <DropdownMenuContent align="end">
                        <DropdownMenuRadioGroup
                          value={spaceSort}
                          onValueChange={(value) =>
                            setSpaceSort(value as HomeSpaceSort)
                          }
                        >
                          <DropdownMenuRadioItem value="updated">
                            {t('layout.home-sort-updated')}
                          </DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="created">
                            {t('layout.home-sort-created')}
                          </DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <TooltipSimple
                      content={newSpaceLabel}
                      compact
                      side="bottom"
                      variant="instant"
                    >
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        buttonContent="icon-only"
                        aria-label={newSpaceLabel}
                        onClick={() => setNewSpaceDialogOpen(true)}
                      >
                        <DsIcon icon={Plus} aria-hidden />
                      </Button>
                    </TooltipSimple>
                  </>
                }
              >
                {orderedSpaces.map((space) => (
                  <HomeSpaceGroup
                    key={space.id}
                    space={space}
                    sessions={sessionsBySpace[space.id] ?? []}
                    folded={foldedSpaceIds.includes(space.id)}
                    selected={routeSpaceId === space.id}
                    pinned={pinnedSpaceIds.includes(space.id)}
                    attention={spaceAttention[space.id]}
                    activeSessionId={activeSessionId}
                    rowSources={rowSources}
                    onToggleFold={() =>
                      setHomeSpaceFolded(
                        space.id,
                        !foldedSpaceIds.includes(space.id)
                      )
                    }
                    onOpenWorkspace={() => openSpaceWorkspace(space.id)}
                    onShowAll={() => openSpaceWorkspace(space.id, 'projects')}
                    onSessionClick={openSession}
                    onPinSession={togglePinned}
                    onEndSession={requestEndSession}
                    onDeleteSession={requestDeleteSession}
                  />
                ))}
              </SidebarAccordionSection>
            </SidebarScrollArea>
          </SidebarSection>
        </div>
      </SidebarShell>
    </>
  );
}
