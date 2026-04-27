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
import giftWhiteIcon from '@/assets/gift-white.svg';
import giftIcon from '@/assets/gift.svg';
import eigentAppIconBlack from '@/assets/logo/icon_black.svg';
import eigentAppIconWhite from '@/assets/logo/icon_white.svg';
import EndNoticeDialog from '@/components/Dialog/EndNotice';
import ReportBugDialog from '@/components/Dialog/ReportBugDialog';
import NotificationPanel from '@/components/Notification';
import { Button } from '@/components/ui/button';
import { TooltipSimple } from '@/components/ui/tooltip';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useHost } from '@/host';
import { SITE_URL } from '@/lib';
import { share } from '@/lib/share';
import { useAuthStore } from '@/store/authStore';
import { useInstallationUI } from '@/store/installationStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectStore } from '@/store/projectStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { ChatTaskStatus } from '@/types/constants';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Archive,
  Bell,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
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
  const { canGoBack, canGoForward } = useStackNavigationBounds();
  const [reportBugOpen, setReportBugOpen] = useState(false);
  const [endDialogOpen, setEndDialogOpen] = useState(false);
  const [endProjectLoading, setEndProjectLoading] = useState(false);
  //Get Chatstore for the active project's task
  const { chatStore } = useChatStoreAdapter();
  const projectStore = useProjectStore();
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);
  const projectSidebarFolded = usePageTabStore((s) => s.projectSidebarFolded);
  const toggleProjectSidebarFolded = usePageTabStore(
    (s) => s.toggleProjectSidebarFolded
  );
  const historySidebarOpen = useSidebarStore((s) => s.isOpen);
  const toggleHistorySidebar = useSidebarStore((s) => s.toggle);
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
      navigate('/');
    }
  }, [canGoBack, navigate]);

  const summaryTask =
    chatStore?.tasks[chatStore?.activeTaskId as string]?.summaryTask;
  const activeTaskTitle = useMemo(() => {
    if (!chatStore) return t('layout.new-project');
    if (chatStore.activeTaskId && summaryTask) {
      return summaryTask.split('|')[0];
    }
    return t('layout.new-project');
  }, [chatStore, summaryTask, t]);

  if (!chatStore) {
    return <div>Loading...</div>;
  }

  const getReferFriendsLink = async () => {
    try {
      const res: any = await proxyFetchGet('/api/v1/user/invite_code');
      if (res?.invite_code) {
        const inviteLink = `${SITE_URL}/signup?invite_code=${res.invite_code}`;
        await navigator.clipboard.writeText(inviteLink);
        toast.success(t('layout.invitation-link-copied'));
      } else {
        toast.error(t('layout.failed-to-get-invite-code'));
      }
    } catch (error) {
      console.error('Failed to get referral link:', error);
      toast.error(t('layout.failed-to-get-invitation-link'));
    }
  };

  const handleShare = async (taskId: string) => {
    share(taskId);
  };

  const activeTask = chatStore.activeTaskId
    ? chatStore.tasks[chatStore.activeTaskId as string]
    : undefined;
  const showEndProject = Boolean(
    chatStore.activeTaskId &&
    activeTask &&
    ((activeTask.messages?.length || 0) > 0 ||
      activeTask.hasMessages ||
      activeTask.status !== ChatTaskStatus.PENDING)
  );

  const handleEndProject = async () => {
    const taskId = chatStore.activeTaskId;
    const projectId = projectStore.activeProjectId;

    if (!taskId) {
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

      projectStore.createProject('new project');
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

  if (!chatStore) {
    return <div>Loading...</div>;
  }

  return (
    <div
      className={`drag left-0 right-0 top-0 !h-10 py-1 min-w-0 absolute z-50 flex items-center ${
        platform === 'darwin' ? 'pr-[2px] pl-[68px]' : 'pl-2'
      }`}
      id="titlebar"
      ref={titlebarRef}
    >
      {/* Leading: home ↔ dashboard / new project */}
      <div className="no-drag flex shrink-0 items-center justify-center">
        <TooltipSimple
          content={
            isHistoryRoute ? t('layout.new-project') : t('layout.dashboard')
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
                projectStore.createProject('new project');
                setActiveWorkspaceTab('workforce');
                navigate('/');
              } else {
                navigate('/history');
              }
            }}
            aria-label={
              isHistoryRoute ? t('layout.new-project') : t('layout.home')
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
                  className="gap-1.5 min-w-0 flex items-center"
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
                  {t('layout.new-project')}
                  <Plus
                    className="h-4 w-4 text-ds-icon-neutral-muted-default ml-1 shrink-0"
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
                  className="gap-1.5 min-w-0 flex items-center"
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
                </motion.span>
              )}
            </AnimatePresence>
          </Button>
        </TooltipSimple>
      </div>

      {/* Middle: full width on project home only (/) — left: nav + title; right: project + utilities */}
      <div className="min-h-0 min-w-0 relative z-0 flex h-full flex-1">
        <AnimatePresence initial={false}>
          {isHomeRoute && (
            <motion.div
              key="home-middle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={topBarCrossfade}
              className="drag inset-0 min-w-0 gap-2 absolute z-10 flex items-center justify-between"
            >
              <div className="min-w-0 min-h-0 relative z-50 flex h-full items-center">
                <div className="no-drag min-w-0 flex items-center">
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
                  <TooltipSimple
                    content={t('layout.back')}
                    side="bottom"
                    align="center"
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      buttonContent="icon-only"
                      className="no-drag shrink-0 rounded-full"
                      disabled={!canGoBack}
                      onClick={() => navigate(-1)}
                      aria-label={t('layout.back')}
                    >
                      <ChevronLeft aria-hidden />
                    </Button>
                  </TooltipSimple>
                  <TooltipSimple
                    content={t('layout.forward')}
                    side="bottom"
                    align="center"
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      buttonContent="icon-only"
                      className="no-drag shrink-0 rounded-full"
                      disabled={!canGoForward}
                      onClick={() => navigate(1)}
                      aria-label={t('layout.forward')}
                    >
                      <ChevronRight aria-hidden />
                    </Button>
                  </TooltipSimple>
                  <div className="min-w-0 flex-1 overflow-hidden rounded-full">
                    <TooltipSimple
                      content={
                        activeTaskTitle === t('layout.new-project')
                          ? t('layout.new-project')
                          : activeTaskTitle
                      }
                      side="bottom"
                      align="center"
                    >
                      <button
                        id="active-task-title-btn"
                        type="button"
                        className="no-drag min-w-0 px-2 text-label-sm font-bold !text-ds-text-neutral-default-default focus-visible:ring-ds-ring-brand-default-focus/50 hover:bg-ds-bg-neutral-default-hover active:bg-ds-bg-neutral-default-active flex min-h-[28px] max-w-[300px] flex-1 items-center text-left outline-none focus-visible:ring-[3px]"
                        onClick={toggleHistorySidebar}
                        aria-expanded={historySidebarOpen}
                        aria-haspopup="dialog"
                      >
                        <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                          {activeTaskTitle}
                        </span>
                      </button>
                    </TooltipSimple>
                  </div>
                </div>
              </div>

              <div className="no-drag gap-0 z-50 flex h-full shrink-0 items-center">
                <div className="gap-1 pr-2 border-ds-border-neutral-subtle-default flex items-center border-y-0 border-r border-l-0 border-solid">
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
                  {chatStore.activeTaskId &&
                    chatStore.tasks[chatStore.activeTaskId as string]
                      ?.status === ChatTaskStatus.FINISHED && (
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
                <div className="gap-1 pl-2 flex items-center">
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
                      onClick={getReferFriendsLink}
                      variant="ghost"
                      size="sm"
                      className="no-drag rounded-full"
                      buttonContent="icon-only"
                    >
                      <img
                        src={appearance === 'dark' ? giftWhiteIcon : giftIcon}
                        alt="gift-icon"
                        width={16}
                        height={16}
                      />
                    </Button>
                  </TooltipSimple>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {!isHomeRoute && (
          <div className="drag min-h-0 min-w-0 flex-1" aria-hidden />
        )}
      </div>

      {/* Trailing: update + settings (home) or back (history) — always at the end */}
      <div
        className={`${
          platform === 'darwin' && 'pr-2'
        } no-drag gap-1 relative z-50 flex h-full shrink-0 items-center`}
      >
        {packageUpdateAvailable && (
          <TooltipSimple
            content={t('layout.update', { defaultValue: 'Update' })}
            side="bottom"
            align="end"
          >
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="no-drag px-3 shrink-0 rounded-full"
              onClick={handleStartDownload}
              aria-label={t('layout.update', { defaultValue: 'Update' })}
            >
              {t('layout.update', { defaultValue: 'Update' })}
            </Button>
          </TooltipSimple>
        )}
        <div className="flex h-full shrink-0 items-center">
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
    </div>
  );
}

export default HeaderWin;
