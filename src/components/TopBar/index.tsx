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

import { proxyFetchGet } from '@/api/http';
import eigentAppIconBlack from '@/assets/logo/icon_black.svg';
import eigentAppIconWhite from '@/assets/logo/icon_white.svg';
import ReportBugDialog from '@/components/Dialog/ReportBugDialog';
import { SpaceSwitchDropdown } from '@/components/ProjectPageSidebar/SpaceSwitchDropdown';
import {
  TOP_BAR_CONTROL_SELECTED_CLASS,
  TOP_BAR_CONTROL_STATE_CLASS,
  TOP_BAR_PILL_CLASS,
} from '@/components/TopBar/controlStyles';
import UpdateButton from '@/components/TopBar/UpdateButton';
import { UserMenu } from '@/components/TopBar/UserMenu';
import AlertDialog from '@/components/ui/alertDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TooltipSimple } from '@/components/ui/tooltip';
import { WorkspaceVersionHistoryDialog } from '@/components/Workspace/WorkspaceVersionHistoryDialog';
import { shellBackState, useShellBackTarget } from '@/hooks/useShellBackTarget';
import { useWorkspaceSavePoint } from '@/hooks/useWorkspaceSavePoint';
import { useHost } from '@/host';
import {
  createSpaceFromFolderPicker,
  getFolderSpaceErrorMessage,
} from '@/lib/createSpaceFromFolder';
import {
  buildTaskQuestionsById,
  computeProjectFreshnessAnchor,
} from '@/lib/replay';
import { ensureScratchSpaceWorkspaceBinding } from '@/lib/scratchSpaceWorkspace';
import { getSessionNavLeadFromHistoryProject } from '@/lib/sessionNavLead';
import { isSettingsRoutePath } from '@/lib/shellRoutes';
import {
  getActiveSpaceTriggerLabel,
  getDefaultNewSpaceName,
} from '@/lib/spaceLabel';
import { resolveServerBackedSpaceId } from '@/lib/spaceProject';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { useInstallationUI } from '@/store/installationStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { openSettings, useSettingsStore } from '@/store/settingsStore';
import {
  getVisibleProjectMetasForSpace,
  isDisposableBlankSpace,
  useSpaceStore,
} from '@/store/spaceStore';
import {
  ChevronsUpDown,
  CircleHelp,
  Minus,
  PanelLeft,
  PanelLeftOpen,
  Settings,
  Square,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import ShellBackButton from './ShellBackButton';

function HeaderWin() {
  const { t } = useTranslation();
  const host = useHost();
  const titlebarRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const [platform, setPlatform] = useState<string>('');
  const navigate = useNavigate();
  const location = useLocation();
  const [reportBugOpen, setReportBugOpen] = useState(false);
  const [renameSpaceDialogOpen, setRenameSpaceDialogOpen] = useState(false);
  const [renameSpaceValue, setRenameSpaceValue] = useState('');
  const [renamingSpace, setRenamingSpace] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [switchingSpaceId, setSwitchingSpaceId] = useState<string | null>(null);
  const projectStore = useProjectRuntimeStore();
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId);
  const spacesById = useSpaceStore((s) => s.spaces);
  const projectsBySpaceId = useSpaceStore((s) => s.projectsBySpaceId);
  const createSpaceOnServer = useSpaceStore((s) => s.createSpaceOnServer);
  const setActiveSpace = useSpaceStore((s) => s.setActiveSpace);
  const renameSpaceOnServer = useSpaceStore((s) => s.renameSpaceOnServer);
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);
  const workspaceSidebarHidden = usePageTabStore(
    (s) => s.workspaceSidebarHidden
  );
  const toggleWorkspaceSidebar = usePageTabStore(
    (s) => s.toggleWorkspaceSidebar
  );
  const requestWorkspaceChatFocus = usePageTabStore(
    (s) => s.requestWorkspaceChatFocus
  );
  const closeSettings = useSettingsStore((state) => state.closeSettings);
  const appearance = useAuthStore((state) => state.appearance);
  const email = useAuthStore((s) => s.email);
  const userId = useAuthStore((s) => s.user_id);
  const { isInstalling, installationState } = useInstallationUI();
  const _isInstallationActive =
    isInstalling || installationState === 'waiting-backend';

  useEffect(() => {
    if (!host?.electronAPI?.getPlatform) return;
    const p = host.electronAPI.getPlatform();
    setPlatform(p);
  }, [host]);

  /**
   * Home and Settings drop the workspace chrome (sidebar toggle, Home /
   * Space switcher) for a single way back. The center slot stays: page
   * title here, Home / Space switcher on the workspace.
   */
  const isSettingsPage = isSettingsRoutePath(location.pathname);
  const isShellSubPage = location.pathname === '/home' || isSettingsPage;
  const shellSubPageTitle = isSettingsPage
    ? t('setting.settings')
    : location.pathname === '/home'
      ? t('layout.home')
      : null;
  // Same origin as Settings' own back control — used when the gear toggles off.
  const { goBack: leaveSettings, label: leaveSettingsLabel } =
    useShellBackTarget();

  const sidebarToggleLabel = workspaceSidebarHidden
    ? t('layout.show-sidebar', { defaultValue: 'Show sidebar' })
    : t('layout.hide-sidebar', { defaultValue: 'Hide sidebar' });

  const activeSpaceTitle = useMemo(
    () =>
      getActiveSpaceTriggerLabel(
        activeSpaceId ? spacesById[activeSpaceId]?.name : undefined,
        t,
        {
          emptyLabelKey: activeSpaceId
            ? 'layout.spaces-untitled'
            : 'layout.spaces-select-space',
        }
      ),
    [activeSpaceId, spacesById, t]
  );

  const activeSpace = activeSpaceId ? spacesById[activeSpaceId] : null;
  const versionHistory = useWorkspaceSavePoint({
    spaceId: activeSpaceId,
    space: activeSpace,
    email,
    userId,
    shortcut: true,
  });
  const canRenameActiveSpace = Boolean(
    activeSpace &&
    activeSpace.status === 'active' &&
    activeSpace.sourceType !== 'legacy' &&
    activeSpace.metadata?.legacy !== true
  );

  const activeSpaces = useMemo(
    () =>
      Object.values(spacesById)
        .filter(
          (space) =>
            space.status !== 'archived' &&
            !(
              space.id === 'legacy_local' &&
              activeSpaceId !== 'legacy_local' &&
              getVisibleProjectMetasForSpace(projectsBySpaceId, space.id)
                .length === 0
            ) &&
            (space.id === activeSpaceId ||
              !isDisposableBlankSpace(space, projectsBySpaceId))
        )
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [activeSpaceId, projectsBySpaceId, spacesById]
  );

  const openHome = useCallback(() => {
    // Home is a project-independent management surface. Clear the active
    // Project so returning to it always runs the normal hydration path.
    projectStore.setActiveProject(null);
    closeSettings();
    // Record the origin so Home's title-bar back button returns to it.
    navigate('/home?section=spaces', {
      state: shellBackState(`${location.pathname}${location.search}`),
    });
  }, [
    closeSettings,
    location.pathname,
    location.search,
    navigate,
    projectStore,
  ]);

  /** Gear is a toggle: open Settings, press again to return to the origin. */
  const toggleSettings = useCallback(() => {
    if (isSettingsPage) {
      leaveSettings();
      return;
    }
    openSettings('models');
  }, [isSettingsPage, leaveSettings]);

  const ensureProjectLoaded = useCallback(
    async (projectId: string) => {
      const project = projectStore.getProjectById(projectId);
      const needsRemoteHistoryHydration =
        project?.metadata?.remoteHistoryHydrationPending === true;
      if (
        projectStore.peekActiveChatStore(projectId) &&
        !needsRemoteHistoryHydration
      ) {
        return;
      }

      try {
        const historyProject = await proxyFetchGet(
          `/api/v1/chat/histories/grouped/${projectId}`,
          { include_tasks: true }
        );
        const taskIdsList = (historyProject?.tasks ?? [])
          .map((task: { task_id?: string | null }) => task.task_id)
          .filter((taskId: string | null | undefined): taskId is string =>
            Boolean(taskId)
          );

        if (taskIdsList.length === 0) {
          if (needsRemoteHistoryHydration) {
            projectStore.updateProject(projectId, {
              metadata: { remoteHistoryHydrationPending: false },
            });
            return;
          }
          projectStore.appendInitChatStore(projectId);
          return;
        }

        projectStore.setProjectNavLead(
          projectId,
          getSessionNavLeadFromHistoryProject(historyProject)
        );

        const firstTask = historyProject.tasks[0];
        const taskQuestionsById = buildTaskQuestionsById(historyProject?.tasks);
        if (needsRemoteHistoryHydration) {
          await projectStore.mergeProjectHistory(
            projectId,
            historyProject.tasks,
            firstTask?.question || historyProject.last_prompt || ''
          );
          return;
        }
        await projectStore.loadProjectFromHistory(
          taskIdsList,
          firstTask?.question || historyProject.last_prompt || '',
          projectId,
          firstTask?.id != null ? String(firstTask.id) : undefined,
          historyProject.project_name,
          undefined,
          taskQuestionsById,
          computeProjectFreshnessAnchor(historyProject)
        );
      } catch (error) {
        console.error(
          `Failed to load Project ${projectId} from history:`,
          error
        );
        if (!projectStore.peekActiveChatStore(projectId)) {
          projectStore.appendInitChatStore(projectId);
        }
      }
    },
    [projectStore]
  );

  const handleCreateBlankSpace = useCallback(async () => {
    try {
      const spaceId = await createSpaceOnServer({
        name: getDefaultNewSpaceName(t),
        sourceType: 'blank',
        setActive: false,
        metadata: {
          createdFrom: 'top_bar',
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
      setActiveWorkspaceTab('workforce');
      requestWorkspaceChatFocus();
    } catch (error) {
      console.error('Failed to create Space:', error);
      toast.error(t('layout.spaces-create-failed'), {
        closeButton: true,
      });
    }
  }, [
    createSpaceOnServer,
    email,
    projectStore,
    requestWorkspaceChatFocus,
    setActiveSpace,
    setActiveWorkspaceTab,
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
        createdFrom: 'top_bar_space_selector',
      });
      if (!spaceId) return;
      setActiveWorkspaceTab('workforce');
      requestWorkspaceChatFocus();
    } catch (error) {
      console.warn('[TopBar] Failed to create folder Space:', error);
      toast.error(getFolderSpaceErrorMessage(error, t), {
        closeButton: true,
      });
    }
  }, [
    activeSpaceId,
    email,
    host,
    projectStore,
    requestWorkspaceChatFocus,
    setActiveWorkspaceTab,
    t,
    userId,
  ]);

  const handleTopBarSpaceSelect = useCallback(
    async (spaceId: string) => {
      setSwitchingSpaceId(spaceId);
      try {
        const resolvedSpaceId = await resolveServerBackedSpaceId(
          projectStore,
          spaceId
        );
        const spaceStore = useSpaceStore.getState();
        if (
          resolvedSpaceId.startsWith('legacy_') ||
          spaceStore.shouldSyncProjects(resolvedSpaceId)
        ) {
          await spaceStore.syncProjectsFromServer(resolvedSpaceId);
        }
        const projectsInSpace = useSpaceStore
          .getState()
          .getProjectsForSpace(resolvedSpaceId);
        setActiveSpace(resolvedSpaceId);
        if (projectsInSpace.length > 0) {
          const lastVisitedProjectId =
            spaceStore.lastVisitedProjectBySpace[resolvedSpaceId];
          const targetProject =
            projectsInSpace.find(
              (project) => project.id === lastVisitedProjectId
            ) ?? projectsInSpace[0];
          projectStore.setActiveProject(targetProject.id);
          await ensureProjectLoaded(targetProject.id);
        } else {
          projectStore.setActiveProject(null);
        }
        setActiveWorkspaceTab('workforce');
        requestWorkspaceChatFocus();
      } catch (error) {
        console.error('Failed to switch Space:', error);
        toast.error(t('layout.spaces-create-failed'), {
          closeButton: true,
        });
      } finally {
        setSwitchingSpaceId(null);
      }
    },
    [
      ensureProjectLoaded,
      projectStore,
      requestWorkspaceChatFocus,
      setActiveSpace,
      setActiveWorkspaceTab,
      t,
    ]
  );

  const openRenameSpaceDialog = useCallback(() => {
    if (!canRenameActiveSpace || !activeSpace) return;
    setRenameSpaceValue(activeSpace.name?.trim() || '');
    setRenameSpaceDialogOpen(true);
  }, [activeSpace, canRenameActiveSpace]);

  const handleRenameSpace = useCallback(async () => {
    const nextName = renameSpaceValue.trim();
    if (!activeSpaceId || !nextName || renamingSpace) return;
    setRenamingSpace(true);
    try {
      await renameSpaceOnServer(activeSpaceId, nextName);
      toast.success(t('layout.spaces-rename-success'));
      setRenameSpaceDialogOpen(false);
    } catch (error) {
      console.warn('[TopBar] Failed to rename Space:', error);
      toast.error(t('layout.spaces-rename-failed'));
    } finally {
      setRenamingSpace(false);
    }
  }, [activeSpaceId, renameSpaceOnServer, renameSpaceValue, renamingSpace, t]);

  return (
    <div
      className={`drag absolute left-0 right-0 top-0 z-50 flex !h-10 min-w-0 items-center py-1 ${
        platform === 'darwin' ? 'pl-[68px] pr-1.5' : 'pl-2'
      }`}
      id="titlebar"
      ref={titlebarRef}
    >
      <AlertDialog
        isOpen={versionHistory.enableConfirmOpen}
        onClose={() => versionHistory.setEnableConfirmOpen(false)}
        onConfirm={() => {
          versionHistory.setEnableConfirmOpen(false);
          void versionHistory.enable(true);
        }}
        title={t('layout.workspace-version-enable-title')}
        message={t('layout.workspace-version-enable-message')}
        confirmText={t('layout.workspace-enable-version-history')}
        cancelText={t('layout.cancel')}
        confirmVariant="primary"
      />
      <WorkspaceVersionHistoryDialog
        open={versionHistoryOpen}
        onOpenChange={setVersionHistoryOpen}
        spaceId={activeSpaceId}
        email={email}
        userId={userId}
        actorId={userId == null ? email || 'local-user' : String(userId)}
      />
      <AlertDialog
        isOpen={renameSpaceDialogOpen}
        onClose={() => setRenameSpaceDialogOpen(false)}
        onConfirm={() => void handleRenameSpace()}
        title={t('layout.spaces-rename-title')}
        confirmText={t('layout.save')}
        cancelText={t('layout.cancel')}
        confirmVariant="primary"
        confirmDisabled={!renameSpaceValue.trim() || renamingSpace}
      >
        <Input
          autoFocus
          value={renameSpaceValue}
          placeholder={t('layout.spaces-rename-placeholder')}
          onChange={(event) => setRenameSpaceValue(event.target.value)}
          onEnter={() => {
            if (renameSpaceValue.trim() && !renamingSpace) {
              void handleRenameSpace();
            }
          }}
        />
      </AlertDialog>
      {/*
        Unified title bar: left controls | center display | right controls.
        Equal flex-1 wings keep the center true-center; interactive chrome
        uses `no-drag` so the surrounding drag region can still move the window.
      */}
      <div className="flex min-h-0 min-w-0 flex-1 items-center">
        {/* Left */}
        <div className="flex min-w-0 flex-1 items-center justify-start">
          <div className="no-drag relative z-50 flex shrink-0 items-center">
            <img
              src={
                appearance === 'dark' ? eigentAppIconWhite : eigentAppIconBlack
              }
              alt=""
              className="mx-1.5 mt-[0.5px] h-6 w-6 select-none"
              width={20}
              height={20}
              draggable={false}
            />
            {isShellSubPage ? (
              <ShellBackButton />
            ) : (
              <TooltipSimple
                content={sidebarToggleLabel}
                side="bottom"
                align="center"
                variant="instant"
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  buttonContent="icon-only"
                  className={cn(
                    'no-drag rounded-full',
                    TOP_BAR_CONTROL_STATE_CLASS,
                    'aria-pressed:!bg-transparent'
                  )}
                  onClick={toggleWorkspaceSidebar}
                  aria-pressed={!workspaceSidebarHidden}
                  aria-label={sidebarToggleLabel}
                >
                  {workspaceSidebarHidden ? (
                    <PanelLeftOpen className="h-4 w-4" aria-hidden />
                  ) : (
                    <PanelLeft className="h-4 w-4" aria-hidden />
                  )}
                </Button>
              </TooltipSimple>
            )}
          </div>
        </div>

        {/* Center: page title (Home / Settings) or Home / Space switch (workspace) */}
        <div className="no-drag flex shrink-0 items-center justify-center px-2">
          {isShellSubPage ? (
            <span className="text-body-sm font-medium text-ds-text-neutral-default-default">
              {shellSubPageTitle}
            </span>
          ) : (
            <div className="flex min-w-0 items-center">
              <button
                type="button"
                onClick={openHome}
                aria-label={t('layout.home')}
                className={TOP_BAR_PILL_CLASS}
              >
                {t('layout.home')}
              </button>
              <span
                className="shrink-0 select-none !text-label-sm font-bold text-ds-text-neutral-subtle-default"
                aria-hidden
              >
                /
              </span>
              <SpaceSwitchDropdown
                contentSideOffset={6}
                onOpenChange={(open) => {
                  if (open && versionHistory.supported) {
                    void versionHistory.loadStatus();
                  }
                }}
                trigger={
                  <button
                    id="active-space-title-btn"
                    type="button"
                    className={TOP_BAR_PILL_CLASS}
                    aria-haspopup="menu"
                    aria-label={activeSpaceTitle}
                  >
                    <span className="min-w-0 max-w-[220px] overflow-hidden text-ellipsis whitespace-nowrap">
                      {activeSpaceTitle}
                    </span>
                    <ChevronsUpDown
                      className="h-3.5 w-3.5 shrink-0 text-ds-icon-neutral-subtle-default"
                      aria-hidden
                    />
                  </button>
                }
                spaces={activeSpaces}
                activeSpaceId={activeSpaceId}
                switchingSpaceId={switchingSpaceId}
                canRenameActiveSpace={canRenameActiveSpace}
                createSpaceMenu={{
                  onStartFromScratch: handleCreateBlankSpace,
                  onSelectFolder: handleCreateSpaceFromFolder,
                }}
                onRenameSpace={openRenameSpaceDialog}
                onSpaceSelect={handleTopBarSpaceSelect}
                contentAlign="center"
                savePointMenu={
                  versionHistory.supported
                    ? {
                        loading:
                          versionHistory.loading ||
                          versionHistory.status === null,
                        saving: versionHistory.saving,
                        enabled: versionHistory.status?.enabled === true,
                        needsAttention:
                          versionHistory.status?.enabled === true &&
                          (versionHistory.status.state !== 'ready' ||
                            versionHistory.status.diagnostics?.healthy ===
                              false),
                        pendingCount:
                          versionHistory.status?.pending_managed_paths
                            ?.length || 0,
                        pendingTruncated:
                          versionHistory.status
                            ?.pending_managed_paths_truncated === true,
                        onEnable: versionHistory.requestEnable,
                        onSave: versionHistory.save,
                        onOpenHistory: () => setVersionHistoryOpen(true),
                      }
                    : undefined
                }
              />
            </div>
          )}
        </div>

        {/* Right */}
        <div className="flex min-w-0 flex-1 items-center justify-end">
          <div
            className={`${
              platform === 'darwin' && 'px-1.5'
            } no-drag relative z-50 flex h-7 shrink-0 items-center`}
          >
            <div className="flex h-full shrink-0 items-center gap-0.5">
              {/* Update slot: hidden → background download progress → launch new version */}
              <UpdateButton />
              <TooltipSimple
                content={t('layout.support')}
                side="bottom"
                align="center"
                variant="instant"
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'no-drag rounded-full',
                    TOP_BAR_CONTROL_STATE_CLASS
                  )}
                  aria-label={t('layout.support')}
                  onClick={() => setReportBugOpen(true)}
                  buttonContent="icon-only"
                >
                  <CircleHelp aria-hidden />
                </Button>
              </TooltipSimple>
              <TooltipSimple
                content={
                  isSettingsPage ? leaveSettingsLabel : t('setting.settings')
                }
                side="bottom"
                align="center"
                variant="instant"
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'no-drag rounded-full',
                    TOP_BAR_CONTROL_STATE_CLASS,
                    isSettingsPage && TOP_BAR_CONTROL_SELECTED_CLASS
                  )}
                  buttonContent="icon-only"
                  aria-label={
                    isSettingsPage ? leaveSettingsLabel : t('setting.settings')
                  }
                  aria-pressed={isSettingsPage}
                  onClick={toggleSettings}
                >
                  <Settings className="h-4 w-4" aria-hidden />
                </Button>
              </TooltipSimple>

              <div className="ml-1.5 flex h-full shrink-0 items-center gap-1 border-y-0 border-l border-r-0 border-solid border-ds-border-neutral-subtle-default pl-1.5">
                <UserMenu />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Custom window controls: Linux Electron only (macOS/Win use native chrome; web has no platform from getPlatform) */}
      {platform === 'linux' && (
        <div
          className="no-drag flex h-full items-center"
          id="window-controls"
          ref={controlsRef}
        >
          <div
            className="flex h-full w-[35px] flex-1 cursor-pointer items-center justify-center text-center leading-5 hover:bg-ds-bg-neutral-subtle-default"
            onClick={() => host?.electronAPI?.minimizeWindow()}
          >
            <Minus className="h-4 w-4" />
          </div>
          <div
            className="flex h-full w-[35px] flex-1 cursor-pointer items-center justify-center text-center leading-5 hover:bg-ds-bg-neutral-subtle-default"
            onClick={() => host?.electronAPI?.toggleMaximizeWindow()}
          >
            <Square className="h-4 w-4" />
          </div>
          <div
            className="flex h-full w-[35px] flex-1 cursor-pointer items-center justify-center text-center leading-5 hover:bg-ds-bg-neutral-subtle-default"
            onClick={() => host?.electronAPI?.closeWindow(false)}
          >
            <X className="h-4 w-4" />
          </div>
        </div>
      )}
      <ReportBugDialog open={reportBugOpen} onOpenChange={setReportBugOpen} />
    </div>
  );
}

export default HeaderWin;
