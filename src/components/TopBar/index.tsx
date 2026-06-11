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
import giftWhiteIcon from '@/assets/custom/gift-white.svg';
import giftIcon from '@/assets/custom/gift.svg';
import eigentAppIconBlack from '@/assets/logo/icon_black.svg';
import eigentAppIconWhite from '@/assets/logo/icon_white.svg';
import { type HistoryTabId } from '@/components/Dashboard/HistoryTabsNav';
import InviteCodeDialog from '@/components/Dialog/InviteCodeDialog';
import ReportBugDialog from '@/components/Dialog/ReportBugDialog';
import { SpaceSwitchDropdown } from '@/components/ProjectPageSidebar/SpaceSwitchDropdown';
import AlertDialog from '@/components/ui/alertDialog';
import { Blocks } from '@/components/ui/animate-ui/icons/blocks';
import { Bot } from '@/components/ui/animate-ui/icons/bot';
import { Compass } from '@/components/ui/animate-ui/icons/compass';
import { Hammer } from '@/components/ui/animate-ui/icons/hammer';
import { AnimateIcon } from '@/components/ui/animate-ui/icons/icon';
import { Radio } from '@/components/ui/animate-ui/icons/radio';
import { Settings as AnimateSettings } from '@/components/ui/animate-ui/icons/settings';
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
import {
  buildTaskQuestionsById,
  computeProjectFreshnessAnchor,
} from '@/lib/replay';
import { ensureScratchSpaceWorkspaceBinding } from '@/lib/scratchSpaceWorkspace';
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
  ArrowLeft,
  ChevronsUpDown,
  CircleHelp,
  Minus,
  PanelLeft,
  PanelLeftClose,
  Settings,
  Square,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
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

const HOME_NAV_HISTORY_MENU: {
  id: HistoryTabId;
  labelKey: string;
  icon: ReactNode;
}[] = [
  { id: 'home', labelKey: 'layout.spaces', icon: <Blocks /> },
  { id: 'agents', labelKey: 'layout.agents', icon: <Bot /> },
  { id: 'channels', labelKey: 'layout.channels', icon: <Radio /> },
  { id: 'connectors', labelKey: 'layout.connectors', icon: <Hammer /> },
  { id: 'browser', labelKey: 'layout.browser', icon: <Compass /> },
  { id: 'settings', labelKey: 'layout.settings', icon: <AnimateSettings /> },
];

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

  const navigateToHistoryTab = useCallback(
    (tab: HistoryTabId) => {
      setHomeNavMenuOpen(false);
      if (tab === 'home') {
        // The Home/Spaces hub is a project-independent surface and may
        // re-select the same project the user just left. Clearing
        // activeProjectId routes through `setActiveProject(null)`, which
        // runs the stale-eviction hook on the outgoing project. Without
        // this, returning to a stale-marked project from the hub would
        // short-circuit on `setActiveProject(id)`'s same-id no-op and
        // keep serving the cached state for the rest of the session.
        projectStore.setActiveProject(null);
        navigate('/history?tab=home&section=spaces');
        return;
      }
      navigate(`/history?tab=${tab}`);
    },
    [navigate, projectStore]
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
        const taskQuestionsById = buildTaskQuestionsById(historyProject?.tasks);
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
      className={`drag left-0 right-0 top-0 !h-10 min-w-0 py-1 absolute z-50 flex items-center ${
        platform === 'darwin' ? 'pr-[2px] pl-[68px]' : 'pl-2'
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
          <TooltipSimple
            content={t('layout.back', { defaultValue: 'Back' })}
            side="bottom"
            align="center"
          >
            <Button
              variant="ghost"
              size="sm"
              buttonContent="icon-only"
              className="no-drag shrink-0 rounded-full"
              onClick={handleExitHistoryOrSettings}
              aria-label={t('layout.back', { defaultValue: 'Back' })}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </Button>
          </TooltipSimple>
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
          <div
            className="no-drag px-2 flex min-h-[28px] items-center"
            aria-hidden
          >
            <img
              src={
                appearance === 'dark' ? eigentAppIconWhite : eigentAppIconBlack
              }
              alt=""
              className="h-6 w-6 mt-[2px] select-none"
              width={16}
              height={16}
              draggable={false}
            />
          </div>
        ) : (
          <DropdownMenu
            modal={false}
            open={homeNavMenuOpen}
            onOpenChange={setHomeNavMenuOpen}
          >
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="no-drag focus-visible:ring-ds-ring-brand-default-focus/50 w-22 gap-1.5 px-2 text-label-sm font-bold !text-ds-text-neutral-default-default hover:bg-ds-bg-neutral-default-hover active:bg-ds-bg-neutral-default-active flex min-h-[28px] items-center rounded-full outline-none focus-visible:ring-[3px]"
                aria-label={t('layout.home')}
                aria-haspopup="menu"
                onDoubleClick={(e) => {
                  e.preventDefault();
                  setHomeNavMenuOpen(false);
                  navigateToHistoryTab('home');
                }}
              >
                <img
                  src={
                    appearance === 'dark'
                      ? eigentAppIconWhite
                      : eigentAppIconBlack
                  }
                  alt=""
                  className="h-6 w-6 mt-[2px] select-none"
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
              className="min-w-32 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 duration-100"
            >
              {HOME_NAV_HISTORY_MENU.map(({ id, labelKey, icon }) => (
                <AnimateIcon key={id} animateOnHover="default" asChild>
                  <DropdownMenuItem
                    className="gap-2 cursor-pointer"
                    onClick={() => navigateToHistoryTab(id)}
                  >
                    <span className="size-4 [&_svg]:size-4 inline-flex shrink-0 items-center justify-center">
                      {icon}
                    </span>
                    <span>{t(labelKey)}</span>
                  </DropdownMenuItem>
                </AnimateIcon>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Middle: full width on project home only (/) — nav + title */}
      <div className="no-drag h-7 min-h-0 min-w-0 relative z-50 flex w-full">
        <AnimatePresence initial={false}>
          {isHomeRoute && projectSidebarFolded && (
            <motion.div
              key="home-middle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={topBarCrossfade}
              className="drag inset-0 min-w-0 absolute z-10 flex items-center"
            >
              <div className="ml-1 min-h-0 min-w-0 border-ds-border-neutral-subtle-default pl-1 relative z-50 flex h-full items-center border-y-0 border-r-0 border-l border-solid">
                <SpaceSwitchDropdown
                  contentSideOffset={6}
                  trigger={
                    <button
                      id="active-space-title-btn"
                      type="button"
                      className="no-drag focus-visible:ring-ds-ring-brand-default-focus/50 min-w-0 gap-1.5 px-2 text-label-sm font-bold !text-ds-text-neutral-default-default hover:bg-ds-bg-neutral-default-hover active:bg-ds-bg-neutral-default-active flex min-h-[28px] w-full max-w-[300px] flex-1 items-center rounded-full text-left outline-none focus-visible:ring-[3px]"
                      aria-haspopup="menu"
                      aria-label={activeSpaceTitle}
                    >
                      <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                        {activeSpaceTitle}
                      </span>
                      <ChevronsUpDown
                        className="h-3.5 w-3.5 text-ds-icon-neutral-subtle-default shrink-0"
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
        } no-drag h-7 relative z-50 flex shrink-0 items-center`}
      >
        <div className="flex h-full shrink-0 items-center">
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

          <div className="ml-1.5 gap-1 border-ds-border-neutral-subtle-default pl-1.5 flex h-full shrink-0 items-center border-y-0 border-r-0 border-l border-solid">
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
                  className="no-drag px-3 shrink-0 rounded-full"
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
            className="leading-5 hover:bg-ds-bg-neutral-default-hover flex h-full w-[35px] flex-1 cursor-pointer items-center justify-center text-center"
            onClick={() => host?.electronAPI?.minimizeWindow()}
          >
            <Minus className="h-4 w-4" />
          </div>
          <div
            className="leading-5 hover:bg-ds-bg-neutral-default-hover flex h-full w-[35px] flex-1 cursor-pointer items-center justify-center text-center"
            onClick={() => host?.electronAPI?.toggleMaximizeWindow()}
          >
            <Square className="h-4 w-4" />
          </div>
          <div
            className="leading-5 hover:bg-ds-bg-neutral-default-hover flex h-full w-[35px] flex-1 cursor-pointer items-center justify-center text-center"
            onClick={() => host?.electronAPI?.closeWindow(false)}
          >
            <X className="h-4 w-4" />
          </div>
        </div>
      )}
      <ReportBugDialog open={reportBugOpen} onOpenChange={setReportBugOpen} />
      <InviteCodeDialog
        open={inviteCodeDialogOpen}
        onOpenChange={setInviteCodeDialogOpen}
      />
    </div>
  );
}

export default HeaderWin;
