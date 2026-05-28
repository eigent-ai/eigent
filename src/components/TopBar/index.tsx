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
import giftWhiteIcon from '@/assets/gift-white.svg';
import giftIcon from '@/assets/gift.svg';
import eigentAppIconBlack from '@/assets/logo/icon_black.svg';
import eigentAppIconWhite from '@/assets/logo/icon_white.svg';
import { type HistoryTabId } from '@/components/Dashboard/HistoryTabsNav';
import InviteCodeDialog from '@/components/Dialog/InviteCodeDialog';
import ReportBugDialog from '@/components/Dialog/ReportBugDialog';
import NotificationPanel from '@/components/Notification';
import { SpaceSwitchDropdown } from '@/components/ProjectPageSidebar/SpaceSwitchDropdown';
import AlertDialog from '@/components/ui/alertDialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { TooltipSimple } from '@/components/ui/tooltip';
import { useHost } from '@/host';
import {
  createSpaceFromFolderPicker,
  getFolderSpaceErrorMessage,
} from '@/lib/createSpaceFromFolder';
import { getSessionNavLeadFromHistoryProject } from '@/lib/sessionNavLead';
import {
  getActiveSpaceTriggerLabel,
  getDefaultNewSpaceName,
} from '@/lib/spaceLabel';
import { resolveServerBackedSpaceId } from '@/lib/spaceProject';
import { useAuthStore } from '@/store/authStore';
import { useInstallationUI } from '@/store/installationStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import {
  getVisibleProjectMetasForSpace,
  isDisposableBlankSpace,
  useSpaceStore,
} from '@/store/spaceStore';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bell,
  ChevronsUpDown,
  CircleHelp,
  Minus,
  PanelLeft,
  PanelLeftClose,
  Settings,
  Square,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  NavigationType,
  useLocation,
  useNavigate,
  useNavigationType,
} from 'react-router-dom';
import { toast } from 'sonner';

/** Tracks linear in-app history so back/forward buttons can enable/disable like a browser. */
function useStackNavigationBounds() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const seededRef = useRef(false);
  const stackRef = useRef<string[]>([]);
  const indexRef = useRef(0);
  const [bounds, setBounds] = useState({
    canGoBack: false,
    canGoForward: false,
  });

  useEffect(() => {
    const fullPath = `${location.pathname}${location.search}`;

    if (!seededRef.current) {
      seededRef.current = true;
      stackRef.current = [fullPath];
      indexRef.current = 0;
      setBounds({ canGoBack: false, canGoForward: false });
      return;
    }

    if (navigationType === NavigationType.Push) {
      const stack = stackRef.current;
      const idx = indexRef.current;
      stackRef.current = [...stack.slice(0, idx + 1), fullPath];
      indexRef.current = stackRef.current.length - 1;
    } else if (navigationType === NavigationType.Replace) {
      stackRef.current[indexRef.current] = fullPath;
    } else {
      const stack = stackRef.current;
      let idx = indexRef.current;
      if (idx > 0 && stack[idx - 1] === fullPath) {
        indexRef.current = idx - 1;
      } else if (idx < stack.length - 1 && stack[idx + 1] === fullPath) {
        indexRef.current = idx + 1;
      } else {
        const found = stack.lastIndexOf(fullPath);
        if (found !== -1) {
          indexRef.current = found;
        }
      }
    }

    const i = indexRef.current;
    const s = stackRef.current;
    setBounds({
      canGoBack: i > 0,
      canGoForward: i < s.length - 1,
    });
  }, [location.pathname, location.search, navigationType]);

  return bounds;
}

const topBarCrossfade = {
  duration: 0.2,
  ease: [0.4, 0, 0.2, 1] as const,
};

const HOME_NAV_HISTORY_MENU: { id: HistoryTabId; labelKey: string }[] = [
  { id: 'agents', labelKey: 'layout.agents' },
  { id: 'channels', labelKey: 'layout.channels' },
  { id: 'connectors', labelKey: 'layout.connectors' },
  { id: 'browser', labelKey: 'layout.browser' },
  { id: 'settings', labelKey: 'layout.settings' },
];

const HOME_NAV_HOVER_CLOSE_MS = 120;

function HeaderWin() {
  const { t } = useTranslation();
  const host = useHost();
  const titlebarRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const [platform, setPlatform] = useState<string>('');
  const navigate = useNavigate();
  const location = useLocation();
  const { canGoBack } = useStackNavigationBounds();
  const [reportBugOpen, setReportBugOpen] = useState(false);
  const [inviteCodeDialogOpen, setInviteCodeDialogOpen] = useState(false);
  const [renameSpaceDialogOpen, setRenameSpaceDialogOpen] = useState(false);
  const [renameSpaceValue, setRenameSpaceValue] = useState('');
  const [renamingSpace, setRenamingSpace] = useState(false);
  const [switchingSpaceId, setSwitchingSpaceId] = useState<string | null>(null);
  const projectStore = useProjectRuntimeStore();
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId);
  const spacesById = useSpaceStore((s) => s.spaces);
  const projectsBySpaceId = useSpaceStore((s) => s.projectsBySpaceId);
  const createSpaceOnServer = useSpaceStore((s) => s.createSpaceOnServer);
  const setActiveSpace = useSpaceStore((s) => s.setActiveSpace);
  const renameSpaceOnServer = useSpaceStore((s) => s.renameSpaceOnServer);
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);
  const requestWorkspaceChatFocus = usePageTabStore(
    (s) => s.requestWorkspaceChatFocus
  );
  const projectSidebarFolded = usePageTabStore((s) => s.projectSidebarFolded);
  const toggleProjectSidebarFolded = usePageTabStore(
    (s) => s.toggleProjectSidebarFolded
  );
  const appearance = useAuthStore((state) => state.appearance);
  const email = useAuthStore((s) => s.email);
  const userId = useAuthStore((s) => s.user_id);
  const [homeNavMenuOpen, setHomeNavMenuOpen] = useState(false);
  const homeNavHoverCloseTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [packageUpdateAvailable, setPackageUpdateAvailable] = useState(false);
  const ipcRenderer = host?.ipcRenderer;
  const { isInstalling, installationState } = useInstallationUI();
  const _isInstallationActive =
    isInstalling || installationState === 'waiting-backend';

  useEffect(() => {
    if (!host?.electronAPI?.getPlatform) return;
    const p = host.electronAPI.getPlatform();
    setPlatform(p);
  }, [host]);

  useEffect(() => {
    const ipc = ipcRenderer;
    if (!ipc) return;

    const onUpdateCanAvailable = (
      _event: Electron.IpcRendererEvent,
      info: VersionInfo
    ) => {
      setPackageUpdateAvailable(Boolean(info.update));
    };

    const onUpdateDownloaded = () => {
      setPackageUpdateAvailable(false);
    };

    ipc.on('update-can-available', onUpdateCanAvailable);
    ipc.on('update-downloaded', onUpdateDownloaded);
    void ipc.invoke('check-update');

    return () => {
      ipc.off('update-can-available', onUpdateCanAvailable);
      ipc.off('update-downloaded', onUpdateDownloaded);
    };
  }, [ipcRenderer]);

  const handleStartDownload = useCallback(() => {
    void ipcRenderer?.invoke('start-download');
  }, [ipcRenderer]);

  const isHistoryRoute = useMemo(() => {
    const path = location.pathname.replace(/\/$/, '') || '/';
    return path === '/history' || path.endsWith('/history');
  }, [location.pathname]);

  const isHomeRoute = location.pathname === '/';

  const handleExitHistoryOrSettings = useCallback(() => {
    if (canGoBack) {
      navigate(-1);
    } else {
      setActiveWorkspaceTab('workforce');
      navigate('/');
    }
  }, [canGoBack, navigate, setActiveWorkspaceTab]);

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

  const openInviteCodeDialog = () => {
    setInviteCodeDialogOpen(true);
  };

  const clearHomeNavHoverCloseTimer = useCallback(() => {
    if (homeNavHoverCloseTimerRef.current) {
      clearTimeout(homeNavHoverCloseTimerRef.current);
      homeNavHoverCloseTimerRef.current = null;
    }
  }, []);

  const scheduleHomeNavClose = useCallback(() => {
    clearHomeNavHoverCloseTimer();
    homeNavHoverCloseTimerRef.current = setTimeout(() => {
      homeNavHoverCloseTimerRef.current = null;
      setHomeNavMenuOpen(false);
    }, HOME_NAV_HOVER_CLOSE_MS);
  }, [clearHomeNavHoverCloseTimer]);

  const openHomeNavMenu = useCallback(() => {
    clearHomeNavHoverCloseTimer();
    setHomeNavMenuOpen(true);
  }, [clearHomeNavHoverCloseTimer]);

  const navigateToHistoryDefault = useCallback(() => {
    clearHomeNavHoverCloseTimer();
    setHomeNavMenuOpen(false);
    navigate('/history?tab=home&section=spaces');
  }, [clearHomeNavHoverCloseTimer, navigate]);

  const navigateToHistoryTab = useCallback(
    (tab: HistoryTabId) => {
      clearHomeNavHoverCloseTimer();
      setHomeNavMenuOpen(false);
      if (tab === 'home') {
        navigate('/history?tab=home&section=spaces');
        return;
      }
      navigate(`/history?tab=${tab}`);
    },
    [clearHomeNavHoverCloseTimer, navigate]
  );

  const handleHomeNavTriggerClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      navigateToHistoryDefault();
    },
    [navigateToHistoryDefault]
  );

  useEffect(
    () => () => clearHomeNavHoverCloseTimer(),
    [clearHomeNavHoverCloseTimer]
  );

  const ensureProjectLoaded = useCallback(
    async (projectId: string) => {
      if (projectStore.peekActiveChatStore(projectId)) {
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
          projectStore.appendInitChatStore(projectId);
          return;
        }

        projectStore.setProjectNavLead(
          projectId,
          getSessionNavLeadFromHistoryProject(historyProject)
        );

        const firstTask = historyProject.tasks[0];
        await projectStore.loadProjectFromHistory(
          taskIdsList,
          firstTask?.question || historyProject.last_prompt || '',
          projectId,
          firstTask?.id != null ? String(firstTask.id) : undefined,
          historyProject.project_name
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
    projectStore,
    requestWorkspaceChatFocus,
    setActiveSpace,
    setActiveWorkspaceTab,
    t,
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
        platform === 'darwin' ? 'pl-[68px] pr-[2px]' : 'pl-2'
      }`}
      id="titlebar"
      ref={titlebarRef}
    >
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
      {/* Leading: home ↔ dashboard / new Space */}
      <div className="no-drag flex shrink-0 items-center justify-center">
        {isHistoryRoute ? (
          <div className="no-drag h-[28px] w-[28px] shrink-0" aria-hidden />
        ) : (
          <TooltipSimple
            content={
              projectSidebarFolded
                ? t('layout.expand-project-sidebar', {
                    defaultValue: 'Expand sidebar',
                  })
                : t('layout.fold-project-sidebar', {
                    defaultValue: 'Fold sidebar',
                  })
            }
            side="bottom"
            align="center"
          >
            <Button
              variant="ghost"
              size="sm"
              buttonContent="icon-only"
              className="no-drag shrink-0 rounded-full"
              onClick={() => toggleProjectSidebarFolded()}
              aria-pressed={!projectSidebarFolded}
              aria-label={
                projectSidebarFolded
                  ? t('layout.expand-project-sidebar', {
                      defaultValue: 'Expand sidebar',
                    })
                  : t('layout.fold-project-sidebar', {
                      defaultValue: 'Fold sidebar',
                    })
              }
            >
              {projectSidebarFolded ? (
                <PanelLeft className="h-4 w-4" aria-hidden />
              ) : (
                <PanelLeftClose className="h-4 w-4" aria-hidden />
              )}
            </Button>
          </TooltipSimple>
        )}
        {isHistoryRoute ? (
          <TooltipSimple
            content={t('layout.back', { defaultValue: 'Back' })}
            side="bottom"
            align="center"
          >
            <Button
              variant="ghost"
              size="sm"
              buttonContent="text"
              textWeight="bold"
              className="no-drag w-22 gap-1.5 rounded-full"
              onClick={handleExitHistoryOrSettings}
              aria-label={t('layout.back', { defaultValue: 'Back' })}
            >
              <motion.span
                key="leading-history"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={topBarCrossfade}
                className="flex min-w-0 items-center gap-1.5"
              >
                <img
                  src={
                    appearance === 'dark'
                      ? eigentAppIconWhite
                      : eigentAppIconBlack
                  }
                  alt=""
                  className="mt-[2px] h-6 w-6 select-none"
                  width={16}
                  height={16}
                  draggable={false}
                />
                {t('layout.back', { defaultValue: 'Back' })}
              </motion.span>
            </Button>
          </TooltipSimple>
        ) : (
          <DropdownMenu
            modal={false}
            open={homeNavMenuOpen}
            onOpenChange={(open) => {
              if (!open) clearHomeNavHoverCloseTimer();
              setHomeNavMenuOpen(open);
            }}
          >
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="no-drag focus-visible:ring-ds-ring-brand-default-focus/50 w-22 flex min-h-[28px] items-center gap-1.5 rounded-full px-2 text-label-sm font-bold !text-ds-text-neutral-default-default outline-none hover:bg-ds-bg-neutral-default-hover focus-visible:ring-[3px] active:bg-ds-bg-neutral-default-active"
                aria-label={t('layout.home')}
                aria-haspopup="menu"
                onPointerDown={(event) => event.preventDefault()}
                onMouseEnter={openHomeNavMenu}
                onMouseLeave={scheduleHomeNavClose}
                onClick={handleHomeNavTriggerClick}
              >
                <img
                  src={
                    appearance === 'dark'
                      ? eigentAppIconWhite
                      : eigentAppIconBlack
                  }
                  alt=""
                  className="mt-[2px] h-6 w-6 select-none"
                  width={16}
                  height={16}
                  draggable={false}
                />
                {t('layout.home')}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              sideOffset={6}
              className="min-w-32 duration-100 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
              onMouseEnter={openHomeNavMenu}
              onMouseLeave={scheduleHomeNavClose}
            >
              {HOME_NAV_HISTORY_MENU.map(({ id, labelKey }) => (
                <DropdownMenuItem
                  key={id}
                  className="cursor-pointer"
                  onClick={() => navigateToHistoryTab(id)}
                >
                  <span>{t(labelKey)}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Middle: full width on project home only (/) — nav + title */}
      <div className="no-drag relative z-50 flex h-7 min-h-0 w-full min-w-0">
        <AnimatePresence initial={false}>
          {isHomeRoute && projectSidebarFolded && (
            <motion.div
              key="home-middle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={topBarCrossfade}
              className="drag absolute inset-0 z-10 flex min-w-0 items-center"
            >
              <div className="relative z-50 ml-1 flex h-full min-h-0 min-w-0 items-center border-y-0 border-l border-r-0 border-solid border-ds-border-neutral-subtle-default pl-1">
                <SpaceSwitchDropdown
                  openOnHover
                  contentSideOffset={6}
                  trigger={
                    <button
                      id="active-space-title-btn"
                      type="button"
                      className="no-drag focus-visible:ring-ds-ring-brand-default-focus/50 flex min-h-[28px] w-full min-w-0 max-w-[300px] flex-1 items-center gap-1.5 px-2 text-left text-label-sm font-bold !text-ds-text-neutral-default-default outline-none hover:bg-ds-bg-neutral-default-hover focus-visible:ring-[3px] active:bg-ds-bg-neutral-default-active"
                      aria-haspopup="menu"
                      aria-label={activeSpaceTitle}
                    >
                      <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
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
                  contentAlign="start"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {(!isHomeRoute || !projectSidebarFolded) && (
          <div className="drag min-h-0 min-w-0 flex-1" aria-hidden />
        )}
      </div>

      {/* Trailing: project actions (home only) + utilities + settings/back + update */}
      <div
        className={`${
          platform === 'darwin' && 'px-1.5'
        } no-drag relative z-50 flex h-7 shrink-0 items-center`}
      >
        <div className="flex h-full shrink-0 items-center">
          <TooltipSimple
            content={t('layout.notifications')}
            side="bottom"
            align="end"
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="no-drag rounded-full"
              aria-label={t('layout.notifications')}
              aria-expanded={notificationPanelOpen}
              aria-controls="notification-panel"
              onClick={() => setNotificationPanelOpen((open) => !open)}
              buttonContent="icon-only"
            >
              <Bell aria-hidden />
            </Button>
          </TooltipSimple>
          <TooltipSimple
            content={t('layout.support')}
            side="bottom"
            align="end"
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="no-drag rounded-full"
              aria-label={t('layout.support')}
              onClick={() => setReportBugOpen(true)}
              buttonContent="icon-only"
            >
              <CircleHelp aria-hidden />
            </Button>
          </TooltipSimple>
          <TooltipSimple
            content={t('layout.refer-friends')}
            side="bottom"
            align="end"
          >
            <Button
              onClick={openInviteCodeDialog}
              variant="ghost"
              size="sm"
              className="no-drag rounded-full"
              buttonContent="icon-only"
              aria-label={t('layout.refer-friends')}
            >
              <img
                src={appearance === 'dark' ? giftWhiteIcon : giftIcon}
                alt=""
                width={16}
                height={16}
                aria-hidden
              />
            </Button>
          </TooltipSimple>

          <div className="ml-1.5 flex h-full shrink-0 items-center gap-1 border-y-0 border-l border-r-0 border-solid border-ds-border-neutral-subtle-default pl-1.5">
            <AnimatePresence mode="wait" initial={false}>
              {isHomeRoute ? (
                <motion.div
                  key="trailing-settings"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={topBarCrossfade}
                  className="flex"
                >
                  <TooltipSimple
                    content={t('layout.settings')}
                    side="bottom"
                    align="end"
                  >
                    <Button
                      onClick={() => navigate('/history?tab=settings')}
                      variant="ghost"
                      buttonContent="icon-only"
                      size="sm"
                      className="no-drag rounded-full"
                      aria-label={t('layout.settings')}
                    >
                      <Settings aria-hidden />
                    </Button>
                  </TooltipSimple>
                </motion.div>
              ) : (
                <motion.div
                  key="trailing-back"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={topBarCrossfade}
                  className="flex"
                >
                  <TooltipSimple
                    content={t('layout.back', { defaultValue: 'Back' })}
                    side="bottom"
                    align="end"
                  >
                    <Button
                      type="button"
                      onClick={handleExitHistoryOrSettings}
                      variant="ghost"
                      buttonContent="icon-only"
                      size="sm"
                      className="no-drag rounded-full"
                      aria-label={t('layout.back', { defaultValue: 'Back' })}
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </Button>
                  </TooltipSimple>
                </motion.div>
              )}
            </AnimatePresence>
            {packageUpdateAvailable && (
              <TooltipSimple
                content={t('layout.update')}
                side="bottom"
                align="end"
              >
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  className="no-drag shrink-0 rounded-full px-3"
                  onClick={handleStartDownload}
                  aria-label={t('layout.update')}
                >
                  {t('layout.update')}
                </Button>
              </TooltipSimple>
            )}
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
            className="flex h-full w-[35px] flex-1 cursor-pointer items-center justify-center text-center leading-5 hover:bg-ds-bg-neutral-default-hover"
            onClick={() => host?.electronAPI?.minimizeWindow()}
          >
            <Minus className="h-4 w-4" />
          </div>
          <div
            className="flex h-full w-[35px] flex-1 cursor-pointer items-center justify-center text-center leading-5 hover:bg-ds-bg-neutral-default-hover"
            onClick={() => host?.electronAPI?.toggleMaximizeWindow()}
          >
            <Square className="h-4 w-4" />
          </div>
          <div
            className="flex h-full w-[35px] flex-1 cursor-pointer items-center justify-center text-center leading-5 hover:bg-ds-bg-neutral-default-hover"
            onClick={() => host?.electronAPI?.closeWindow(false)}
          >
            <X className="h-4 w-4" />
          </div>
        </div>
      )}
      <NotificationPanel
        open={notificationPanelOpen}
        onOpenChange={setNotificationPanelOpen}
      />
      <ReportBugDialog open={reportBugOpen} onOpenChange={setReportBugOpen} />
      <InviteCodeDialog
        open={inviteCodeDialogOpen}
        onOpenChange={setInviteCodeDialogOpen}
      />
    </div>
  );
}

export default HeaderWin;
