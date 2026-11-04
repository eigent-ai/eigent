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

import { isWeb } from '@/client/platform';
import { SpaceHeaderMenu } from '@/components/Home/SpaceHeaderMenu';
import { useAppCommand } from '@/components/Layout/AppCommandProvider';
import {
  NavTab,
  SidebarNavGroup,
  SidebarSection,
  SidebarSeparator,
  SidebarShell,
} from '@/components/Layout/AppSidebar';
import { SidebarRowTooltip } from '@/components/Layout/AppSidebar/SidebarTooltip';
import { Button } from '@/components/ui/button';
import { DsIcon } from '@/components/ui/ds-icon';
import { ShortcutTooltipContent } from '@/components/ui/shortcut-tooltip';
import { useSessionNavStatuses } from '@/hooks/useSessionNavStatuses';
import {
  getSplitViewUnavailableReason,
  useVisibleSessionPanes,
} from '@/hooks/useSessionSplitView';
import { isProjectAchieved } from '@/lib/projectAchievement';
import { ensureProjectRuntimeLoaded } from '@/lib/projectRuntimeHydration';
import { ensureScratchSpaceWorkspaceBinding } from '@/lib/scratchSpaceWorkspace';
import { resolveSessionNavLeadPresentation } from '@/lib/sessionNavLead';
import { openSessionInShell, shouldListSession } from '@/lib/sessionOpen';
import { openSessionWindow } from '@/lib/sessionWindows';
import {
  getFilesTabBindingLabel,
  getSessionDisplayName,
  isUnboundUntitledSpace,
} from '@/lib/spaceLabel';
import { AUTOMATION_ICON, AUTOMATION_OFF_ICON } from '@/lib/triggerIcon';
import { cn } from '@/lib/utils';
import { APP_COMMAND } from '@/shared/appCommands';
import { useAuthStore } from '@/store/authStore';
import type { ChatStore } from '@/store/chatStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSessionControlsStore } from '@/store/sessionControlsStore';
import {
  MAX_SESSION_PANES,
  useSessionSplitViewStore,
} from '@/store/sessionSplitViewStore';
import { useSessionWindowsStore } from '@/store/sessionWindowsStore';
import {
  getVisibleProjectMetasForSpace,
  useSpaceStore,
} from '@/store/spaceStore';
import { useTriggerStore } from '@/store/triggerStore';
import { Cast, Inbox, Plus, Settings } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { SessionControlDialogs } from './SessionControlDialogs';
import { SessionNavList } from './SessionNavList';
import {
  NavTabReconnectSuffix,
  triggerListenerLeadIconClass,
} from './TriggerNavTab';

const NO_PANES: string[] = [];

export interface SpaceSidebarProps {
  chatStore: ChatStore | null;
  className?: string;
}

let didAttemptBootSessionResume = false;

export default function SpaceSidebar({
  chatStore: _chatStore,
  className,
}: SpaceSidebarProps) {
  const executeAppCommand = useAppCommand();
  const filesTabDescriptionId = useId();
  const activeWorkspaceTab = usePageTabStore((s) => s.activeWorkspaceTab);
  const spaceWorkspaceTab = usePageTabStore((s) => s.spaceWorkspaceTab);
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);
  const requestOpenTriggerAddDialog = usePageTabStore(
    (s) => s.requestOpenTriggerAddDialog
  );
  const unviewedTabs = usePageTabStore((s) => s.unviewedTabs);
  const filesUnviewedForProjects = usePageTabStore(
    (s) => s.filesUnviewedForProjects
  );
  const wsConnectionStatus = useTriggerStore((s) => s.wsConnectionStatus);
  const triggerReconnect = useTriggerStore((s) => s.triggerReconnect);
  const triggersListenerConnected = wsConnectionStatus === 'connected';
  const projectStore = useProjectRuntimeStore();
  const navLeadByProjectId = useProjectRuntimeStore(
    (s) => s.navLeadByProjectId
  );
  const historyLoadingProjectIds = useProjectRuntimeStore(
    (s) => s.historyLoadingProjectIds
  );
  const activeProjectId = projectStore.activeProjectId;
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId);
  const visiblePanes = useVisibleSessionPanes(activeSpaceId);
  const windowedProjectIds = useSessionWindowsStore((s) => s.openProjectIds);
  const openInMainRequest = useSessionWindowsStore((s) => s.openInMainRequest);
  const spacesById = useSpaceStore((s) => s.spaces);
  const projectsBySpaceId = useSpaceStore((s) => s.projectsBySpaceId);
  const projectMetasForActiveSpace = useMemo(() => {
    if (!activeSpaceId) return [];
    return getVisibleProjectMetasForSpace(projectsBySpaceId, activeSpaceId);
  }, [activeSpaceId, projectsBySpaceId]);
  const filesTabHasUnviewedFiles =
    !!activeProjectId && filesUnviewedForProjects.has(activeProjectId);
  const { t } = useTranslation();
  const pinnedProjectIds = useSessionControlsStore((s) => s.pinnedProjectIds);
  const togglePinned = useSessionControlsStore((s) => s.togglePinned);
  const refreshPinned = useSessionControlsStore((s) => s.refreshPinned);
  const scheduledTabLabel = t('layout.scheduled-tab');

  const triggersTabAriaLabel = useMemo(() => {
    const base = scheduledTabLabel;
    if (triggersListenerConnected) return base;
    if (wsConnectionStatus === 'connecting') {
      return `${base}, ${t('layout.triggers-connecting')}`;
    }
    return `${base}, ${t('layout.triggers-disconnected')}`;
  }, [scheduledTabLabel, t, triggersListenerConnected, wsConnectionStatus]);

  const email = useAuthStore((s) => s.email);
  const userId = useAuthStore((s) => s.user_id);
  useSessionNavStatuses(
    projectMetasForActiveSpace.map((project) => project.id),
    activeSpaceId
  );

  const activeSpace = activeSpaceId ? spacesById[activeSpaceId] : null;
  const isActiveSpaceUnbound = isUnboundUntitledSpace(activeSpace, t);
  const filesTabBinding = useMemo(
    () => getFilesTabBindingLabel(activeSpace, t),
    [activeSpace, t]
  );

  useEffect(() => {
    if (
      !activeSpace ||
      activeSpace.sourceType !== 'blank' ||
      activeSpace.rootPath
    ) {
      return;
    }
    void ensureScratchSpaceWorkspaceBinding({
      email,
      userId,
      space: activeSpace,
    });
  }, [
    activeSpace,
    activeSpace?.id,
    activeSpace?.rootPath,
    activeSpace?.sourceType,
    email,
    userId,
  ]);

  const isSessionNavSelectionActive =
    activeWorkspaceTab === 'project' || activeWorkspaceTab === 'new-project';

  const ensureProjectLoaded = useCallback(
    (projectId: string, onHydrationStarted?: () => void) =>
      ensureProjectRuntimeLoaded(projectStore, projectId, {
        onHydrationStarted,
        requireActiveSelection: true,
      }),
    [projectStore]
  );

  const selectSession = useCallback(
    (projectId: string) => openSessionInShell(projectId),
    []
  );

  // Split view shows the focused Session's split while a Session is open.
  const splitPanes = useMemo(
    () =>
      activeWorkspaceTab === 'project' &&
      activeProjectId &&
      visiblePanes.length >= 2 &&
      visiblePanes.includes(activeProjectId)
        ? visiblePanes
        : NO_PANES,
    [activeProjectId, activeWorkspaceTab, visiblePanes]
  );

  const splitViewUnavailableReason = useCallback(
    (projectId: string): string | undefined => {
      const anchorOpen =
        activeWorkspaceTab === 'project' &&
        activeProjectId &&
        useSpaceStore.getState().getProjectMeta(activeProjectId)?.spaceId ===
          activeSpaceId;
      const reason = getSplitViewUnavailableReason({
        projectId,
        anchorId: anchorOpen ? activeProjectId : null,
        panes: splitPanes,
        windowedIds: windowedProjectIds,
      });
      switch (reason) {
        case 'in-window':
          return t('layout.split-view-unavailable-window', {
            defaultValue: 'Open in its own window',
          });
        case 'no-session':
          return t('layout.split-view-unavailable-no-session', {
            defaultValue: 'Open a session first',
          });
        case 'same':
          return t('layout.split-view-unavailable-same', {
            defaultValue: 'Already open',
          });
        case 'full':
          return t('layout.split-view-unavailable-full', {
            defaultValue: 'Up to {{count}} sessions side by side',
            count: MAX_SESSION_PANES,
          });
        default:
          return undefined;
      }
    },
    [
      activeProjectId,
      activeSpaceId,
      activeWorkspaceTab,
      splitPanes,
      t,
      windowedProjectIds,
    ]
  );

  const openInSplitView = useCallback(
    (projectId: string) => {
      if (!activeSpaceId || !activeProjectId) return;
      if (splitViewUnavailableReason(projectId)) return;
      useSessionSplitViewStore
        .getState()
        .openPane(activeSpaceId, activeProjectId, projectId);
      void selectSession(projectId);
    },
    [activeProjectId, activeSpaceId, selectSession, splitViewUnavailableReason]
  );

  const openInNewWindow = useCallback(
    (projectId: string) => {
      if (!activeSpaceId) return;
      void openSessionWindow({ spaceId: activeSpaceId, projectId }).catch(
        (error: unknown) => {
          console.error('[SpaceSidebar] Failed to open Session window:', error);
          toast.error(
            t('layout.open-in-new-window-failed', {
              defaultValue: 'Could not open the session in a new window',
            })
          );
        }
      );
    },
    [activeSpaceId, t]
  );

  const sessionOpenIn = useMemo(
    () => ({
      onOpenInSplitView: openInSplitView,
      onOpenInNewWindow: openInNewWindow,
      newWindowKind: isWeb() ? ('tab' as const) : ('window' as const),
    }),
    [openInNewWindow, openInSplitView]
  );

  // "Open in main window" from a Session window: show it here again.
  const handledOpenInMain = useRef(openInMainRequest?.sequence ?? 0);
  useEffect(() => {
    if (
      !openInMainRequest ||
      openInMainRequest.sequence <= handledOpenInMain.current
    )
      return;
    handledOpenInMain.current = openInMainRequest.sequence;
    const { spaceId, projectId } = openInMainRequest;
    const spaces = useSpaceStore.getState();
    if (spaces.activeSpaceId !== spaceId && spaces.spaces[spaceId])
      spaces.setActiveSpace(spaceId);
    void selectSession(projectId);
  }, [openInMainRequest, selectSession]);

  // Boot-time session resume: reopen the last visited Session (the way an
  // editor reopens its last workspace) instead of landing on the empty home
  // tab. One-shot per renderer boot (launch or reload; the flag is module
  // scoped so sidebar remounts within a session never re-trigger it), and
  // only from the pristine boot state (default tab, no active Session), so
  // deliberately navigating home later is never hijacked. Uses the same
  // path as clicking the Session in the sidebar.
  useEffect(() => {
    if (didAttemptBootSessionResume) return;
    didAttemptBootSessionResume = true;

    if (activeWorkspaceTab !== 'workforce') return;
    if (projectStore.activeProjectId) return;
    if (!activeSpaceId) return;
    const lastVisitedId =
      useSpaceStore.getState().lastVisitedProjectBySpace[activeSpaceId];
    if (!lastVisitedId) return;
    const lastVisitedMeta = projectMetasForActiveSpace.find(
      (project) => project.id === lastVisitedId
    );
    if (!lastVisitedMeta || !shouldListSession(lastVisitedMeta)) {
      return;
    }
    void selectSession(lastVisitedId);
    // One-shot boot effect: later changes to these values must not
    // re-trigger a resume.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navSessions = useMemo(
    () =>
      projectMetasForActiveSpace
        .filter((project) => shouldListSession(project))
        .map((project) => {
          // `navLeadByProjectId` is kept live by `projectStore`'s chat-store
          // subscription registry — no need to peek into chat-store internals
          // here (those reads aren't tracked by React).
          const projectChatStore = projectStore.peekActiveChatStore(project.id);
          const projectChatState = projectChatStore?.getState();
          const activeTask = projectChatState?.activeTaskId
            ? projectChatState.tasks[projectChatState.activeTaskId]
            : undefined;
          return {
            id: project.id,
            title: getSessionDisplayName(
              project.name,
              project.id,
              t,
              project.metadata?.nameSource
            ),
            sessionLead: resolveSessionNavLeadPresentation({
              cachedLead: navLeadByProjectId[project.id],
              isHistoryLoading: Boolean(historyLoadingProjectIds[project.id]),
              isAchieved: isProjectAchieved(project.metadata),
            }),
            achieved: isProjectAchieved(project.metadata),
            pinned: pinnedProjectIds.includes(project.id),
            source: activeTask?.source,
            openInPane:
              splitPanes.length > 0
                ? splitPanes.includes(project.id) &&
                  project.id !== activeProjectId
                : undefined,
            inOwnWindow: windowedProjectIds.includes(project.id),
            splitViewUnavailableReason: splitViewUnavailableReason(project.id),
          };
        }),
    [
      activeProjectId,
      historyLoadingProjectIds,
      navLeadByProjectId,
      pinnedProjectIds,
      projectMetasForActiveSpace,
      projectStore,
      splitPanes,
      splitViewUnavailableReason,
      t,
      windowedProjectIds,
    ]
  );

  const handleNewSession = useCallback(() => {
    executeAppCommand(APP_COMMAND.newProject);
  }, [executeAppCommand]);

  const spaceSettingsLabel = t('layout.space-settings');
  const isSpaceSettingsActive =
    activeWorkspaceTab === 'space-workspace' &&
    spaceWorkspaceTab === 'workspace-profile';

  const openFilesTab = useCallback(() => {
    let projectId = activeProjectId;

    if (!projectId && activeSpaceId) {
      const spaceStore = useSpaceStore.getState();
      const projectsInSpace = spaceStore.getProjectsForSpace(activeSpaceId);
      if (projectsInSpace.length > 0) {
        const lastVisitedProjectId =
          spaceStore.lastVisitedProjectBySpace[activeSpaceId];
        const targetProject =
          projectsInSpace.find(
            (project) => project.id === lastVisitedProjectId
          ) ?? projectsInSpace[0];
        projectId = targetProject.id;
        projectStore.setActiveProject(projectId);
      }
    }

    if (!projectId) {
      toast.error(t('layout.workspace-select-project'));
      return;
    }

    const projectChatStore = projectStore.peekActiveChatStore(projectId);
    const taskId = projectChatStore?.getState().activeTaskId;
    if (taskId) {
      projectChatStore?.getState().setNuwFileNum(taskId, 0);
    }

    setActiveWorkspaceTab('files', {
      clearFilesForProjectId: projectId,
    });

    const needsRemoteHistoryHydration =
      projectStore.getProjectById(projectId)?.metadata
        ?.remoteHistoryHydrationPending === true;
    if (
      !projectStore.peekActiveChatStore(projectId) ||
      projectStore.historyLoadIncompleteProjectIds[projectId] ||
      needsRemoteHistoryHydration
    ) {
      void ensureProjectLoaded(projectId);
    }
  }, [
    activeProjectId,
    activeSpaceId,
    ensureProjectLoaded,
    projectStore,
    setActiveWorkspaceTab,
    t,
  ]);

  // Automations are listed per Session, like Files. When the Space has no
  // Session, say so instead of opening a tab that cannot show anything.
  const canOpenAutomations = useCallback(() => {
    if (
      activeProjectId ||
      (activeSpaceId &&
        useSpaceStore.getState().getProjectsForSpace(activeSpaceId).length > 0)
    )
      return true;
    toast.error(t('layout.workspace-select-project'));
    return false;
  }, [activeProjectId, activeSpaceId, t]);

  const handlePinSession = useCallback(
    (projectId: string) => togglePinned(projectId),
    [togglePinned]
  );

  const requestSessionAction = useSessionControlsStore((s) => s.requestAction);
  const requestDeleteSession = useCallback(
    (projectId: string) => requestSessionAction('delete', projectId),
    [requestSessionAction]
  );
  const requestEndSession = useCallback(
    (projectId: string) => requestSessionAction('end', projectId),
    [requestSessionAction]
  );

  useEffect(() => {
    refreshPinned();
    window.addEventListener('storage', refreshPinned);
    return () => window.removeEventListener('storage', refreshPinned);
  }, [refreshPinned]);

  return (
    <>
      <SessionControlDialogs />
      <SidebarShell className={className} ariaLabel={t('layout.workspace-tab')}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-clip">
          <SidebarSection>
            <SidebarNavGroup>
              {/* The Space's name opens its menu; the button opens its
                  settings on the Workspace page. */}
              {activeSpaceId ? (
                <div
                  data-sidebar-row
                  className="flex h-8 w-full min-w-0 items-center gap-ds-2"
                >
                  <SpaceHeaderMenu
                    spaceId={activeSpaceId}
                    appearance="sidebar"
                  />
                  <SidebarRowTooltip
                    content={
                      <ShortcutTooltipContent
                        label={spaceSettingsLabel}
                        shortcutId="navigate-configuration"
                      />
                    }
                    className="py-0"
                    rowSelector="[data-sidebar-row]"
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      buttonRadius="full"
                      buttonContent="icon-only"
                      aria-label={spaceSettingsLabel}
                      aria-pressed={isSpaceSettingsActive}
                      className="no-drag shrink-0"
                      onClick={() =>
                        executeAppCommand(APP_COMMAND.navigateConfiguration)
                      }
                    >
                      <DsIcon
                        icon={Settings}
                        className="text-ds-ink-muted-default"
                        aria-hidden
                      />
                    </Button>
                  </SidebarRowTooltip>
                </div>
              ) : null}
              <NavTab
                active={activeWorkspaceTab === 'new-project'}
                onClick={handleNewSession}
                leading={
                  <DsIcon icon={Plus} className="shrink-0" aria-hidden />
                }
                label={t('layout.new-project')}
                tooltip={
                  <ShortcutTooltipContent
                    label={t('layout.new-project')}
                    shortcutId="new-project"
                  />
                }
                tooltipCompact
                tooltipVariant="delayed"
                ariaLabel={t('layout.new-project')}
                ariaCurrentPage={activeWorkspaceTab === 'new-project'}
              />
              <NavTab
                active={activeWorkspaceTab === 'files'}
                onClick={openFilesTab}
                disabled={isActiveSpaceUnbound}
                leading={
                  <span className="relative inline-flex h-4 w-4 shrink-0">
                    <DsIcon icon={Inbox} className="shrink-0" aria-hidden />
                    {filesTabHasUnviewedFiles && !isActiveSpaceUnbound ? (
                      <span
                        className="absolute -top-1 -right-1 h-2 w-2 shrink-0 rounded-full bg-ds-text-error-default-default ease-in-out"
                        aria-hidden
                      />
                    ) : null}
                  </span>
                }
                label={t('layout.files-tab')}
                tooltip={
                  <ShortcutTooltipContent
                    label={t('layout.files-tab')}
                    description={filesTabBinding?.tooltip}
                    shortcutId="navigate-files"
                  />
                }
                tooltipCompact
                tooltipVariant="delayed"
                trailing={
                  filesTabBinding ? (
                    <>
                      <div className="flex shrink-0 flex-col items-center rounded-xl bg-ds-neutral-muted-default px-1.5">
                        <span className="text-ds-text-meta font-medium text-ds-ink-muted-default">
                          {filesTabBinding.label}
                        </span>
                      </div>
                      {filesTabBinding.tooltip ? (
                        <span id={filesTabDescriptionId} className="sr-only">
                          {filesTabBinding.tooltip}
                        </span>
                      ) : null}
                    </>
                  ) : undefined
                }
                ariaLabel={t('layout.files-tab')}
                ariaDescribedBy={
                  filesTabBinding?.tooltip ? filesTabDescriptionId : undefined
                }
                ariaCurrentPage={activeWorkspaceTab === 'files'}
              />
              <NavTab
                layout="split"
                active={activeWorkspaceTab === 'triggers'}
                onClick={() => {
                  if (canOpenAutomations()) setActiveWorkspaceTab('triggers');
                }}
                leading={(() => {
                  const ListenerIcon = triggersListenerConnected
                    ? AUTOMATION_ICON
                    : AUTOMATION_OFF_ICON;
                  return (
                    <DsIcon
                      icon={ListenerIcon}
                      className={triggerListenerLeadIconClass(
                        wsConnectionStatus
                      )}
                    />
                  );
                })()}
                label={scheduledTabLabel}
                tooltip={
                  <ShortcutTooltipContent
                    label={scheduledTabLabel}
                    shortcutId="navigate-scheduled"
                  />
                }
                tooltipCompact
                tooltipVariant="delayed"
                showNotificationDot={unviewedTabs.has('triggers')}
                notificationDotTone="attention"
                notificationDotClassName="h-2 w-2"
                endAction={
                  triggersListenerConnected ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      buttonContent="icon-only"
                      className={cn(
                        'no-drag mr-1 shrink-0 rounded-xl hover:bg-ds-neutral-strong-default',
                        'focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ds-hairline-default-default focus-visible:outline-none'
                      )}
                      aria-label={t('triggers.add-trigger')}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (canOpenAutomations()) requestOpenTriggerAddDialog();
                      }}
                    >
                      <DsIcon
                        icon={Plus}
                        className="text-ds-ink-muted-default"
                        aria-hidden
                      />
                    </Button>
                  ) : (
                    <NavTabReconnectSuffix
                      wsConnectionStatus={wsConnectionStatus}
                      onReconnect={triggerReconnect}
                    />
                  )
                }
                ariaLabel={triggersTabAriaLabel}
                ariaCurrentPage={activeWorkspaceTab === 'triggers'}
              />
              <NavTab
                active={activeWorkspaceTab === 'dispatch'}
                onClick={() => setActiveWorkspaceTab('dispatch')}
                leading={
                  <DsIcon icon={Cast} className="shrink-0" aria-hidden />
                }
                label={t('layout.dispatch-tab')}
                tooltip={
                  <ShortcutTooltipContent
                    label={t('layout.dispatch-tab')}
                    shortcutId="navigate-dispatch"
                  />
                }
                tooltipCompact
                tooltipVariant="delayed"
                ariaLabel={t('layout.dispatch-tab')}
                ariaCurrentPage={activeWorkspaceTab === 'dispatch'}
              />
            </SidebarNavGroup>
          </SidebarSection>

          <SidebarSeparator />

          <SidebarSection grow="fill">
            <SessionNavList
              className="flex min-h-0 flex-1 flex-col"
              sessions={navSessions}
              activeSessionId={
                isSessionNavSelectionActive ? activeProjectId : null
              }
              onSessionClick={selectSession}
              onDeleteSession={requestDeleteSession}
              onEndSession={requestEndSession}
              onPinSession={handlePinSession}
              openIn={sessionOpenIn}
            />
          </SidebarSection>
        </div>
      </SidebarShell>
    </>
  );
}
