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

import { fetchDelete, fetchPut, proxyFetchDelete } from '@/api/http';
import giftWhiteIcon from '@/assets/gift-white.svg';
import giftIcon from '@/assets/gift.svg';
import eigentAppIconBlack from '@/assets/logo/icon_black.svg';
import eigentAppIconWhite from '@/assets/logo/icon_white.svg';
import EndNoticeDialog from '@/components/Dialog/EndNotice';
import InviteCodeDialog from '@/components/Dialog/InviteCodeDialog';
import ReportBugDialog from '@/components/Dialog/ReportBugDialog';
import NotificationPanel from '@/components/Notification';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TooltipSimple } from '@/components/ui/tooltip';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useHost } from '@/host';
import { share } from '@/lib/share';
import {
  createSyncedProjectInSpace,
  resolveServerBackedSpaceId,
} from '@/lib/spaceProject';
import { useAuthStore } from '@/store/authStore';
import { useInstallationUI } from '@/store/installationStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import {
  getVisibleProjectMetasForSpace,
  isDisposableBlankSpace,
  useSpaceStore,
} from '@/store/spaceStore';
import { ChatTaskStatus } from '@/types/constants';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Archive,
  Bell,
  Check,
  CircleHelp,
  FolderKanban,
  Minus,
  PanelLeft,
  PanelLeftClose,
  Plus,
  Settings,
  Share,
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
  const [endDialogOpen, setEndDialogOpen] = useState(false);
  const [endProjectLoading, setEndProjectLoading] = useState(false);
  //Get Chatstore for the active project's task
  const { chatStore } = useChatStoreAdapter();
  const projectStore = useProjectRuntimeStore();
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId);
  const spacesById = useSpaceStore((s) => s.spaces);
  const projectsBySpaceId = useSpaceStore((s) => s.projectsBySpaceId);
  const createSpaceOnServer = useSpaceStore((s) => s.createSpaceOnServer);
  const setActiveSpace = useSpaceStore((s) => s.setActiveSpace);
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);
  const projectSidebarFolded = usePageTabStore((s) => s.projectSidebarFolded);
  const toggleProjectSidebarFolded = usePageTabStore(
    (s) => s.toggleProjectSidebarFolded
  );
  const appearance = useAuthStore((state) => state.appearance);
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

  const activeSpaceTitle = useMemo(() => {
    const defaultLabel = t('layout.spaces-new-space');
    if (!activeSpaceId) return defaultLabel;
    const name = spacesById[activeSpaceId]?.name?.trim();
    if (!name || name === t('layout.new-project') || name === 'New Project') {
      return defaultLabel;
    }
    return name;
  }, [activeSpaceId, spacesById, t]);

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

  const handleCreateBlankSpace = useCallback(async () => {
    try {
      const spaceId = await createSpaceOnServer({
        name: t('layout.spaces-new-space'),
        sourceType: 'blank',
        setActive: false,
        metadata: {
          createdFrom: 'top_bar',
          autoCreatedPlaceholder: true,
        },
      });
      setActiveSpace(spaceId);
      projectStore.setActiveProject(null);
      setActiveWorkspaceTab('new-project');
      navigate('/');
    } catch (error) {
      console.error('Failed to create Space:', error);
      toast.error(t('layout.spaces-create-failed'), {
        closeButton: true,
      });
    }
  }, [
    createSpaceOnServer,
    navigate,
    projectStore,
    setActiveSpace,
    setActiveWorkspaceTab,
    t,
  ]);

  const handleTopBarSpaceSelect = useCallback(
    async (spaceId: string) => {
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
        if (projectsInSpace.length > 0) {
          const nextProject = projectsInSpace[0];
          setActiveSpace(resolvedSpaceId);
          projectStore.setActiveProject(nextProject.id);
          const projectChatStore = projectStore.peekActiveChatStore(
            nextProject.id
          );
          const projectChatState = projectChatStore?.getState();
          const projectTask = projectChatState?.activeTaskId
            ? projectChatState.tasks[projectChatState.activeTaskId]
            : undefined;
          const hasStarted = Boolean(
            projectTask &&
            ((projectTask.messages?.length || 0) > 0 ||
              projectTask.hasMessages ||
              projectTask.status !== ChatTaskStatus.PENDING)
          );
          setActiveWorkspaceTab(hasStarted ? 'project' : 'new-project');
        } else {
          setActiveSpace(resolvedSpaceId);
          projectStore.setActiveProject(null);
          setActiveWorkspaceTab('new-project');
        }
        navigate('/');
      } catch (error) {
        console.error('Failed to switch Space:', error);
        toast.error(t('layout.spaces-create-failed'), {
          closeButton: true,
        });
      }
    },
    [navigate, projectStore, setActiveSpace, setActiveWorkspaceTab, t]
  );

  const handleShare = async (taskId: string) => {
    share(taskId);
  };

  const activeTask = chatStore?.activeTaskId
    ? chatStore.tasks[chatStore.activeTaskId as string]
    : undefined;
  const showEndProject = Boolean(
    chatStore?.activeTaskId &&
    activeTask &&
    ((activeTask.messages?.length || 0) > 0 ||
      activeTask.hasMessages ||
      activeTask.status !== ChatTaskStatus.PENDING)
  );

  const handleEndProject = async () => {
    const taskId = chatStore?.activeTaskId;
    const projectId = projectStore.activeProjectId;

    if (!chatStore || !taskId) {
      toast.error(t('layout.no-active-project-to-end'));
      return;
    }

    const historyId = projectId ? projectStore.getHistoryId(projectId) : null;

    setEndProjectLoading(true);
    try {
      const task = chatStore.tasks[taskId];

      if (task && task.status === ChatTaskStatus.RUNNING) {
        await fetchPut(`/task/${taskId}/take-control`, {
          action: 'stop',
        });
      }

      try {
        await fetchDelete(`/chat/${projectId}`);
      } catch {
        /* Backend may already have removed the chat */
      }

      if (historyId && task.status !== ChatTaskStatus.FINISHED) {
        try {
          await proxyFetchDelete(`/api/v1/chat/history/${historyId}`);
          chatStore.removeTask(taskId);
        } catch {
          /* History may already be deleted */
        }
      } else {
        console.warn(
          'No historyId found for project or task finished, skipping history deletion'
        );
      }

      if (activeSpaceId && spacesById[activeSpaceId]) {
        const result = await createSyncedProjectInSpace({
          projectStore,
          spaceId: activeSpaceId,
          workdirMode:
            spacesById[activeSpaceId].sourceType === 'folder'
              ? 'copy'
              : 'artifact-only',
          metadata: {
            createdFrom: 'end_project',
          },
        });
        setActiveSpace(result.spaceId);
      } else {
        projectStore.createProject('new project');
      }
      navigate('/', { replace: true });

      toast.success(t('layout.project-ended-successfully'), {
        closeButton: true,
      });
    } catch (error) {
      console.error('Failed to end project:', error);
      toast.error(t('layout.failed-to-end-project'), {
        closeButton: true,
      });
    } finally {
      setEndProjectLoading(false);
      setEndDialogOpen(false);
    }
  };

  return (
    <div
      className={`drag absolute left-0 right-0 top-0 z-50 flex !h-10 min-w-0 items-center py-1 ${
        platform === 'darwin' ? 'pl-[68px] pr-[2px]' : 'pl-2'
      }`}
      id="titlebar"
      ref={titlebarRef}
    >
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
        <TooltipSimple
          content={
            isHistoryRoute
              ? t('layout.spaces-new-space')
              : t('layout.dashboard')
          }
          side="bottom"
          align="center"
        >
          <Button
            variant="ghost"
            size="sm"
            buttonContent="text"
            textWeight="bold"
            className="no-drag gap-1.5 rounded-full"
            onClick={() => {
              if (isHistoryRoute) {
                void handleCreateBlankSpace();
              } else {
                navigate('/history');
              }
            }}
            aria-label={
              isHistoryRoute ? t('layout.spaces-new-space') : t('layout.home')
            }
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {isHistoryRoute ? (
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
                  {t('layout.spaces-new-space')}
                  <Plus
                    className="ml-1 h-4 w-4 shrink-0 text-ds-icon-neutral-muted-default"
                    aria-hidden
                  />
                </motion.span>
              ) : (
                <motion.span
                  key="leading-home"
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
                  {t('layout.home')}
                </motion.span>
              )}
            </AnimatePresence>
          </Button>
        </TooltipSimple>
      </div>

      {/* Middle: full width on project home only (/) — nav + title */}
      <div className="no-drag relative z-50 flex h-7 min-h-0 w-full min-w-0">
        <AnimatePresence initial={false}>
          {isHomeRoute && (
            <motion.div
              key="home-middle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={topBarCrossfade}
              className="drag absolute inset-0 z-10 flex min-w-0 items-center"
            >
              <div className="relative z-50 ml-1 flex h-full min-h-0 min-w-0 items-center border-y-0 border-l border-r-0 border-solid border-ds-border-neutral-subtle-default pl-1">
                <div className="min-w-0 flex-1 overflow-hidden rounded-full">
                  <DropdownMenu>
                    <TooltipSimple
                      content={activeSpaceTitle}
                      side="bottom"
                      align="center"
                    >
                      <DropdownMenuTrigger asChild>
                        <button
                          id="active-space-title-btn"
                          type="button"
                          className="no-drag focus-visible:ring-ds-ring-brand-default-focus/50 flex min-h-[28px] min-w-0 max-w-[300px] flex-1 items-center gap-1.5 px-2 text-left text-label-sm font-bold !text-ds-text-neutral-default-default outline-none hover:bg-ds-bg-neutral-default-hover focus-visible:ring-[3px] active:bg-ds-bg-neutral-default-active"
                          aria-haspopup="menu"
                        >
                          <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                            {activeSpaceTitle}
                          </span>
                          <FolderKanban
                            className="h-3.5 w-3.5 shrink-0 text-ds-icon-neutral-subtle-default"
                            aria-hidden
                          />
                        </button>
                      </DropdownMenuTrigger>
                    </TooltipSimple>
                    <DropdownMenuContent
                      align="start"
                      sideOffset={6}
                      className="min-w-56"
                    >
                      <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={() => void handleCreateBlankSpace()}
                      >
                        <Plus className="h-4 w-4" aria-hidden />
                        <span>{t('layout.spaces-new-space')}</span>
                      </DropdownMenuItem>
                      {activeSpaces.length > 0 ? (
                        <DropdownMenuSeparator />
                      ) : null}
                      {activeSpaces.map((space) => (
                        <DropdownMenuItem
                          key={space.id}
                          className="cursor-pointer"
                          onClick={() => void handleTopBarSpaceSelect(space.id)}
                        >
                          <Check
                            className={`h-4 w-4 ${
                              activeSpaceId === space.id
                                ? 'opacity-100'
                                : 'opacity-0'
                            }`}
                            aria-hidden
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {space.name?.trim() || t('layout.spaces-untitled')}
                          </span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {!isHomeRoute && (
          <div className="drag min-h-0 min-w-0 flex-1" aria-hidden />
        )}
      </div>

      {/* Trailing: project actions (home only) + utilities + settings/back + update */}
      <div
        className={`${
          platform === 'darwin' && 'px-1'
        } no-drag relative z-50 flex h-7 shrink-0 items-center`}
      >
        {isHomeRoute && (
          <div className="mr-2 flex items-center gap-1 border-y-0 border-l-0 border-r border-solid border-ds-border-neutral-subtle-default pr-2">
            {showEndProject && (
              <TooltipSimple
                content={t('layout.achieve-project')}
                side="bottom"
                align="end"
              >
                <Button
                  type="button"
                  onClick={() => setEndDialogOpen(true)}
                  variant="ghost"
                  size="sm"
                  buttonContent="icon-only"
                  buttonRadius="full"
                  tone="error"
                  aria-label={t('layout.achieve-project')}
                >
                  <Archive aria-hidden />
                </Button>
              </TooltipSimple>
            )}
            {chatStore?.activeTaskId &&
              chatStore.tasks[chatStore.activeTaskId as string]?.status ===
                ChatTaskStatus.FINISHED && (
                <TooltipSimple
                  content={t('layout.share')}
                  side="bottom"
                  align="end"
                >
                  <Button
                    onClick={() =>
                      handleShare(chatStore.activeTaskId as string)
                    }
                    variant="ghost"
                    size="sm"
                    buttonContent="icon-only"
                    buttonRadius="full"
                    tone="information"
                    aria-label={t('layout.share')}
                  >
                    <Share aria-hidden />
                  </Button>
                </TooltipSimple>
              )}
          </div>
        )}
        <div className="flex h-full shrink-0 items-center gap-1">
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
      <EndNoticeDialog
        open={endDialogOpen}
        onOpenChange={setEndDialogOpen}
        onConfirm={handleEndProject}
        loading={endProjectLoading}
      />
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
