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
  fetchDelete,
  fetchPut,
  proxyFetchDelete,
  proxyFetchGet,
} from '@/api/http';
import { GlobalSearchDialog } from '@/components/GlobalSearch';
import { useAppCommand } from '@/components/Layout/AppCommandProvider';
import {
  NavTab,
  SidebarNavGroup,
  SidebarSection,
  SidebarSeparator,
  SidebarShell,
} from '@/components/Layout/AppSidebar';
import AlertDialog from '@/components/ui/alertDialog';
import { Button } from '@/components/ui/button';
import { ShortcutTooltipContent } from '@/components/ui/shortcut-tooltip';
import { useHost } from '@/host';
import {
  isProjectAchieved,
  setProjectAchievedState,
} from '@/lib/projectAchievement';
import { ensureProjectRuntimeLoaded } from '@/lib/projectRuntimeHydration';
import { ensureScratchSpaceWorkspaceBinding } from '@/lib/scratchSpaceWorkspace';
import { resolveSessionNavLeadPresentation } from '@/lib/sessionNavLead';
import { isSettingsRoutePath, shellBackState } from '@/lib/shellRoutes';
import {
  getFilesTabBindingLabel,
  isUnboundUntitledSpace,
} from '@/lib/spaceLabel';
import { AUTOMATION_ICON, AUTOMATION_OFF_ICON } from '@/lib/triggerIcon';
import { cn } from '@/lib/utils';
import { runAfterWorkspaceConfigurationSave } from '@/lib/workspaceConfigurationNavigationGuard';
import { APP_COMMAND } from '@/shared/appCommands';
import { useAuthStore } from '@/store/authStore';
import type { ChatStore } from '@/store/chatStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSettingsStore } from '@/store/settingsStore';
import {
  getVisibleProjectMetasForSpace,
  useSpaceStore,
} from '@/store/spaceStore';
import { useTriggerStore } from '@/store/triggerStore';
import { ChatTaskStatus } from '@/types/constants';
import { Cast, Inbox, LayoutGrid, Plus, ToolCase } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { SessionNavList } from './SessionNavList';
import {
  NavTabReconnectSuffix,
  triggerListenerLeadIconClass,
} from './TriggerNavTab';

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
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);
  const requestWorkspaceChatFocus = usePageTabStore(
    (s) => s.requestWorkspaceChatFocus
  );
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
  const spacesById = useSpaceStore((s) => s.spaces);
  const projectsBySpaceId = useSpaceStore((s) => s.projectsBySpaceId);
  const projectMetasForActiveSpace = useMemo(() => {
    if (!activeSpaceId) return [];
    return getVisibleProjectMetasForSpace(projectsBySpaceId, activeSpaceId);
  }, [activeSpaceId, projectsBySpaceId]);
  const filesTabHasUnviewedFiles =
    !!activeProjectId && filesUnviewedForProjects.has(activeProjectId);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const closeSettings = useSettingsStore((state) => state.closeSettings);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [deleteProjectId, setDeleteProjectId] = useState<string | null>(null);
  const [deleteProjectLoading, setDeleteProjectLoading] = useState(false);
  const [achieveProjectId, setAchieveProjectId] = useState<string | null>(null);
  const [achieveProjectLoading, setAchieveProjectLoading] = useState(false);
  const [achieveDialogOpen, setAchieveDialogOpen] = useState(false);
  const [pinnedProjectIds, setPinnedProjectIds] = useState<Set<string>>(() => {
    try {
      return new Set(
        JSON.parse(
          localStorage.getItem('eigent-pinned-projects') ?? '[]'
        ) as string[]
      );
    } catch {
      return new Set();
    }
  });

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
  const host = useHost();
  const ipcRenderer = host?.ipcRenderer;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setGlobalSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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

  const projectHasStarted = useCallback(
    (projectId: string) => {
      const projectChatStore = projectStore.peekActiveChatStore(projectId);
      const projectChatState = projectChatStore?.getState();
      const projectTask = projectChatState?.activeTaskId
        ? projectChatState.tasks[projectChatState.activeTaskId]
        : undefined;
      return Boolean(
        projectTask &&
        ((projectTask.messages?.length || 0) > 0 ||
          projectTask.hasMessages ||
          projectTask.status !== ChatTaskStatus.PENDING)
      );
    },
    [projectStore]
  );

  const shouldShowSessionInNavList = useCallback(
    (project: (typeof projectMetasForActiveSpace)[number]) => {
      if (project.metadata?.historyId) return true;
      const historyDisplayName =
        typeof project.metadata?.historyDisplayName === 'string'
          ? project.metadata.historyDisplayName.trim()
          : '';
      if (historyDisplayName) return true;

      const normalizedName = (project.name ?? '').trim().toLowerCase();
      if (
        normalizedName &&
        normalizedName !== 'new project' &&
        normalizedName !== 'new space'
      ) {
        return true;
      }

      return projectHasStarted(project.id);
    },
    [projectHasStarted]
  );

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
    async (projectId: string) => {
      projectStore.setActiveProject(projectId);
      const needsRemoteHistoryHydration =
        projectStore.getProjectById(projectId)?.metadata
          ?.remoteHistoryHydrationPending === true;

      // Already loaded — flip to the live Session shell immediately.
      if (
        projectStore.peekActiveChatStore(projectId) &&
        !projectStore.historyLoadIncompleteProjectIds[projectId] &&
        !needsRemoteHistoryHydration
      ) {
        setActiveWorkspaceTab('project');
        return;
      }

      // Enter the replay shell as soon as hydration has synchronously marked
      // it loading. Session keeps loading history shells stable, while the
      // durable stream continues projecting its backlog in the background.
      await ensureProjectLoaded(projectId, () => {
        if (useProjectRuntimeStore.getState().activeProjectId === projectId) {
          setActiveWorkspaceTab('project');
        }
      });

      // A slower, older click may finish after the user selected another
      // Session. It must not change the shared shell for the newer selection.
      if (projectStore.activeProjectId !== projectId) return;
      if (projectStore.historyLoadIncompleteProjectIds[projectId]) return;

      // History-loaded projects are known to have content. Trust the project
      // type tag (set by createProject(REPLAY)) over `projectHasStarted`,
      // which can read a transiently-empty chatStore during the brief
      // window between loadProjectFromHistory's remove+create rebuild.
      const meta = useSpaceStore.getState().getProjectMeta(projectId);
      const projectInStore = projectStore.getProjectById(projectId);
      const isReplayProject = Boolean(
        meta?.metadata?.tags?.includes('replay') ||
        projectInStore?.metadata?.tags?.includes('replay')
      );
      setActiveWorkspaceTab(
        isReplayProject || projectHasStarted(projectId)
          ? 'project'
          : 'new-project'
      );
    },
    [
      ensureProjectLoaded,
      projectHasStarted,
      projectStore,
      setActiveWorkspaceTab,
    ]
  );

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
    if (!lastVisitedMeta || !shouldShowSessionInNavList(lastVisitedMeta)) {
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
        .filter((project) => shouldShowSessionInNavList(project))
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
            title:
              project.name && project.name !== 'new project'
                ? project.name
                : t('layout.new-project'),
            sessionLead: resolveSessionNavLeadPresentation({
              cachedLead: navLeadByProjectId[project.id],
              isHistoryLoading: Boolean(historyLoadingProjectIds[project.id]),
              isAchieved: isProjectAchieved(project.metadata),
            }),
            achieved: isProjectAchieved(project.metadata),
            pinned: pinnedProjectIds.has(project.id),
            source: activeTask?.source,
          };
        }),
    [
      historyLoadingProjectIds,
      navLeadByProjectId,
      pinnedProjectIds,
      projectMetasForActiveSpace,
      projectStore,
      shouldShowSessionInNavList,
      t,
    ]
  );

  const handleNewSession = useCallback(() => {
    executeAppCommand(APP_COMMAND.newProject);
  }, [executeAppCommand]);

  const isConfigurationActive = useMemo(() => {
    if (!activeSpaceId || !isSettingsRoutePath(location.pathname)) {
      return false;
    }
    const searchParams = new URLSearchParams(location.search);
    return (
      searchParams.get('section') === 'spaces' &&
      searchParams.get('spaceId') === activeSpaceId &&
      searchParams.get('spaceTab') === 'workspace-profile'
    );
  }, [activeSpaceId, location.pathname, location.search]);

  const openSpaceConfiguration = useCallback(() => {
    if (!activeSpaceId) return;
    void runAfterWorkspaceConfigurationSave(() => {
      closeSettings();
      navigate(
        `/home?section=spaces&spaceId=${encodeURIComponent(activeSpaceId)}&spaceTab=workspace-profile`,
        {
          state: shellBackState(`${location.pathname}${location.search}`),
        }
      );
    });
  }, [
    activeSpaceId,
    closeSettings,
    location.pathname,
    location.search,
    navigate,
  ]);

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

  const handlePinSession = useCallback((projectId: string) => {
    setPinnedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      try {
        localStorage.setItem(
          'eigent-pinned-projects',
          JSON.stringify([...next])
        );
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }, []);

  const requestDeleteSession = useCallback((projectId: string) => {
    setDeleteProjectId(projectId);
  }, []);

  const requestEndSession = useCallback((projectId: string) => {
    setAchieveProjectId(projectId);
    setAchieveDialogOpen(true);
  }, []);

  const confirmDeleteSession = useCallback(async () => {
    const projectId = deleteProjectId;
    if (!projectId) return;

    setDeleteProjectLoading(true);
    try {
      const projectMeta = useSpaceStore.getState().getProjectMeta(projectId);
      const spaceId = projectMeta?.spaceId ?? activeSpaceId ?? undefined;
      const wasActive = projectStore.activeProjectId === projectId;

      let historyProject: {
        tasks?: Array<{
          id?: number;
          task_id?: string;
          project_id?: string;
        }>;
      } | null = null;

      try {
        historyProject = await proxyFetchGet(
          `/api/v1/chat/histories/grouped/${projectId}`,
          { include_tasks: true }
        );
      } catch (error) {
        console.warn(
          `[SpaceSidebar] No grouped history for project ${projectId}:`,
          error
        );
      }

      // Fan out per-task cleanup in parallel: with many tasks the previous
      // sequential loop kept the confirm dialog spinning for several seconds
      // even though every call is independent and best-effort.
      const cleanupPromises = (historyProject?.tasks ?? [])
        .filter((task) => task?.id != null)
        .flatMap((task) => {
          const work: Promise<unknown>[] = [
            proxyFetchDelete(`/api/v1/chat/history/${task.id}`).catch(
              (error) => {
                console.warn(
                  `[SpaceSidebar] Failed to delete history task ${task.task_id}:`,
                  error
                );
              }
            ),
          ];
          if (task.task_id && email && ipcRenderer) {
            work.push(
              ipcRenderer
                .invoke(
                  'delete-task-files',
                  email,
                  task.task_id,
                  task.project_id ?? projectId
                )
                .catch((error: unknown) => {
                  console.warn(
                    `[SpaceSidebar] Local file cleanup failed for task ${task.task_id}:`,
                    error
                  );
                })
            );
          }
          return work;
        });
      await Promise.allSettled(cleanupPromises);

      try {
        await fetchDelete(`/chat/${projectId}`);
      } catch {
        /* Backend may already have removed the chat */
      }

      if (spaceId) {
        try {
          const { proxyUpdateSpaceProject } =
            await import('@/service/spaceApi');
          await proxyUpdateSpaceProject(spaceId, projectId, {
            status: 'archived',
          });
        } catch (error) {
          console.warn(
            `[SpaceSidebar] Failed to archive server project ${projectId}:`,
            error
          );
        }
      }

      projectStore.removeProject(projectId);

      if (wasActive) {
        setActiveWorkspaceTab('workforce');
        requestWorkspaceChatFocus();
      }

      toast.success(t('layout.delete-project'));
    } catch (error) {
      console.error('[SpaceSidebar] Failed to delete project:', error);
      toast.error(t('layout.delete-project'));
    } finally {
      setDeleteProjectLoading(false);
      setDeleteProjectId(null);
    }
  }, [
    activeSpaceId,
    deleteProjectId,
    email,
    ipcRenderer,
    projectStore,
    requestWorkspaceChatFocus,
    setActiveWorkspaceTab,
    t,
  ]);

  const confirmEndSession = useCallback(async () => {
    const projectId = achieveProjectId;
    if (!projectId) return;

    setAchieveProjectLoading(true);
    try {
      const wasActive = projectStore.activeProjectId === projectId;
      await ensureProjectLoaded(projectId);
      const projectChatStore = projectStore.peekActiveChatStore(projectId);
      const projectChatState = projectChatStore?.getState();
      const taskId = projectChatState?.activeTaskId;
      const task = taskId ? projectChatState?.tasks[taskId] : undefined;

      const hasActiveRun =
        task &&
        (task.status === ChatTaskStatus.RUNNING ||
          task.status === ChatTaskStatus.PAUSE ||
          task.isPending);
      if (taskId && hasActiveRun) {
        await fetchPut(`/task/${taskId}/take-control`, { action: 'stop' });
        projectChatStore?.getState().stopTask(taskId);
        projectChatStore?.getState().setIsPending(taskId, false);
      }

      await setProjectAchievedState({
        projectStore,
        projectId,
        achieved: true,
      });
      if (wasActive) {
        setActiveWorkspaceTab('workforce');
        requestWorkspaceChatFocus();
      }
      toast.success(t('layout.project-ended-successfully'), {
        closeButton: true,
      });
    } catch (error) {
      console.error('[SpaceSidebar] Failed to achieve project:', error);
      toast.error(t('layout.failed-to-end-project'), {
        closeButton: true,
      });
    } finally {
      setAchieveProjectLoading(false);
      setAchieveProjectId(null);
      setAchieveDialogOpen(false);
    }
  }, [
    achieveProjectId,
    ensureProjectLoaded,
    projectStore,
    requestWorkspaceChatFocus,
    setActiveWorkspaceTab,
    t,
  ]);

  return (
    <>
      <GlobalSearchDialog
        open={globalSearchOpen}
        onOpenChange={setGlobalSearchOpen}
      />
      <AlertDialog
        isOpen={deleteProjectId != null}
        onClose={() => {
          if (deleteProjectLoading) return;
          setDeleteProjectId(null);
        }}
        onConfirm={() => void confirmDeleteSession()}
        title={t('layout.delete-project')}
        message={t('layout.delete-project-confirmation')}
        confirmText={t('layout.delete')}
        cancelText={t('layout.cancel')}
        confirmVariant="secondary"
        confirmTone="error"
        confirmDisabled={deleteProjectLoading}
      />

      <AlertDialog
        isOpen={achieveDialogOpen}
        onClose={() => {
          if (achieveProjectLoading) return;
          setAchieveDialogOpen(false);
          setAchieveProjectId(null);
        }}
        onConfirm={() => void confirmEndSession()}
        title={t('layout.achieve-project')}
        message={t('layout.ending-this-project-will-stop')}
        confirmText={t('layout.yes-end-project')}
        cancelText={t('layout.cancel')}
        confirmVariant="primary"
        confirmTone="error"
        confirmDisabled={achieveProjectLoading}
      />

      <SidebarShell className={className} ariaLabel={t('layout.workspace-tab')}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <SidebarSection>
            <SidebarNavGroup>
              <NavTab
                active={activeWorkspaceTab === 'workforce'}
                onClick={() => setActiveWorkspaceTab('workforce')}
                leading={
                  <LayoutGrid className="h-4 w-4 shrink-0" aria-hidden />
                }
                label={t('layout.workspace-tab')}
                tooltip={
                  <ShortcutTooltipContent
                    label={t('layout.workspace-tab')}
                    shortcutId="navigate-workspace"
                  />
                }
                tooltipCompact
                tooltipVariant="delayed"
                ariaLabel={t('layout.workspace-tab')}
                ariaCurrentPage={activeWorkspaceTab === 'workforce'}
              />
              <NavTab
                active={activeWorkspaceTab === 'files'}
                onClick={openFilesTab}
                disabled={isActiveSpaceUnbound}
                leading={
                  <span className="relative inline-flex h-4 w-4 shrink-0">
                    <Inbox className="h-4 w-4 shrink-0" aria-hidden />
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
                onClick={() => setActiveWorkspaceTab('triggers')}
                leading={(() => {
                  const ListenerIcon = triggersListenerConnected
                    ? AUTOMATION_ICON
                    : AUTOMATION_OFF_ICON;
                  return (
                    <ListenerIcon
                      className={cn(
                        'h-4 w-4 shrink-0',
                        triggerListenerLeadIconClass(wsConnectionStatus)
                      )}
                      aria-hidden
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
                        requestOpenTriggerAddDialog();
                      }}
                    >
                      <Plus
                        className="h-4 w-4 text-ds-ink-muted-default"
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
                leading={<Cast className="h-4 w-4 shrink-0" aria-hidden />}
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
              <NavTab
                active={isConfigurationActive}
                onClick={openSpaceConfiguration}
                disabled={!activeSpaceId}
                leading={<ToolCase className="h-4 w-4 shrink-0" aria-hidden />}
                label={t('layout.configuration-tab')}
                tooltip={
                  <ShortcutTooltipContent
                    label={t('layout.configuration-tab')}
                    shortcutId="navigate-configuration"
                  />
                }
                tooltipCompact
                tooltipVariant="delayed"
                ariaLabel={t('layout.configuration-tab')}
                ariaCurrentPage={isConfigurationActive}
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
              onNewSession={handleNewSession}
              newSessionActive={activeWorkspaceTab === 'new-project'}
            />
          </SidebarSection>
        </div>
      </SidebarShell>
    </>
  );
}
