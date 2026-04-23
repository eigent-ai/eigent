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
import logoBlack from '@/assets/logo/logo_black.png';
import logoWhite from '@/assets/logo/logo_white.png';
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
import { useSidebarStore } from '@/store/sidebarStore';
import { ChatTaskStatus } from '@/types/constants';
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  FolderOpen,
  House,
  Minus,
  Settings,
  Share,
  Square,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  //Get Chatstore for the active project's task
  const { chatStore } = useChatStoreAdapter();
  const { chatPanelPosition, setChatPanelPosition } = usePageTabStore();
  const historySidebarOpen = useSidebarStore((s) => s.isOpen);
  const toggleHistorySidebar = useSidebarStore((s) => s.toggle);
  const appearance = useAuthStore((state) => state.appearance);
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const logoSrc = appearance === 'dark' ? logoWhite : logoBlack;
  const { isInstalling, installationState } = useInstallationUI();
  const _isInstallationActive =
    isInstalling || installationState === 'waiting-backend';

  useEffect(() => {
    if (!host?.electronAPI?.getPlatform) return;
    const p = host.electronAPI.getPlatform();
    setPlatform(p);
  }, [host]);

  const isHistoryRoute = useMemo(() => {
    const path = location.pathname.replace(/\/$/, '') || '/';
    return path === '/history' || path.endsWith('/history');
  }, [location.pathname]);

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

  if (!chatStore) {
    return <div>Loading...</div>;
  }

  return (
    <div
      className={`drag left-0 right-0 top-0 !h-10 py-1 absolute z-50 flex items-center justify-between ${
        platform === 'darwin' ? 'pr-[2px] pl-[68px]' : 'pl-2'
      }`}
      id="titlebar"
      ref={titlebarRef}
    >
      <div className="no-drag flex h-[28px] w-[28px] shrink-0 items-center justify-center">
        <img
          src={appearance === 'dark' ? eigentAppIconWhite : eigentAppIconBlack}
          alt="Eigent"
          className="h-6 w-6 mt-[2px] select-none"
          width={16}
          height={16}
          draggable={false}
        />
      </div>
      <div className="drag min-w-0 flex h-full flex-1 items-center justify-between">
        <div className="relative z-50 flex h-full items-center">
          <div className="no-drag gap-2 pl-1 flex items-center">
            <div className="flex items-center">
              {isHistoryRoute ? (
                <TooltipSimple
                  content={t('layout.projects')}
                  side="bottom"
                  align="center"
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    buttonContent="icon-only"
                    className="no-drag rounded-full"
                    onClick={() => navigate('/')}
                    aria-label={t('layout.projects')}
                    aria-current="page"
                  >
                    <FolderOpen aria-hidden />
                  </Button>
                </TooltipSimple>
              ) : (
                <TooltipSimple
                  content={t('layout.dashboard')}
                  side="bottom"
                  align="center"
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    buttonContent="icon-only"
                    className="no-drag rounded-full"
                    onClick={() => navigate('/history')}
                    aria-label={t('layout.dashboard')}
                    aria-current="page"
                  >
                    <House aria-hidden />
                  </Button>
                </TooltipSimple>
              )}
              <TooltipSimple
                content={t('layout.back')}
                side="bottom"
                align="center"
              >
                <Button
                  variant="ghost"
                  size="sm"
                  buttonContent="icon-only"
                  className="no-drag rounded-full"
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
                  className="no-drag rounded-full"
                  disabled={!canGoForward}
                  onClick={() => navigate(1)}
                  aria-label={t('layout.forward')}
                >
                  <ChevronRight aria-hidden />
                </Button>
              </TooltipSimple>
            </div>
            {location.pathname === '/' && (
              <div className="no-drag gap-1 inline-flex items-center">
                <div className="ease-out animate-in fade-in-0 inline-flex items-stretch overflow-hidden rounded-full duration-200">
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
                      className="no-drag min-w-0 px-2 text-label-sm font-bold focus-visible:ring-ds-ring-brand-default-focus/50 !text-ds-text-neutral-default-default hover:bg-ds-bg-neutral-default-hover active:bg-ds-bg-neutral-default-active flex min-h-[28px] max-w-[300px] flex-1 items-center text-left outline-none focus-visible:ring-[3px]"
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
            )}
          </div>
        </div>

        {/* right */}
        <div
          className={`${
            platform === 'darwin' && 'pr-2'
          } no-drag gap-1 relative z-50 flex h-full items-center`}
        >
          {location.pathname !== '/history' && (
            <>
              {chatStore.activeTaskId &&
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
                      variant="secondary"
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
                >
                  <Settings aria-hidden />
                </Button>
              </TooltipSimple>
            </>
          )}
        </div>
      </div>
      {/* Custom window controls only for Linux (Windows and macOS use native controls) */}
      {platform !== 'darwin' && platform !== 'win32' && (
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
      <NotificationPanel
        open={notificationPanelOpen}
        onOpenChange={setNotificationPanelOpen}
      />
      <ReportBugDialog open={reportBugOpen} onOpenChange={setReportBugOpen} />
    </div>
  );
}

export default HeaderWin;
