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
import { Button } from '@/components/ui/button';
import { TooltipSimple } from '@/components/ui/tooltip';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { share } from '@/lib/share';
import { useAuthStore } from '@/store/authStore';
import { useInstallationUI } from '@/store/installationStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { ChatTaskStatus } from '@/types/constants';
import {
  ChevronLeft,
  ChevronRight,
  House,
  Minus,
  Settings,
  Share,
  Sparkles,
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
  const titlebarRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const [platform, setPlatform] = useState<string>('');
  const navigate = useNavigate();
  const location = useLocation();
  const { canGoBack, canGoForward } = useStackNavigationBounds();
  //Get Chatstore for the active project's task
  const { chatStore, projectStore } = useChatStoreAdapter();
  const { chatPanelPosition, setChatPanelPosition } = usePageTabStore();
  const historySidebarOpen = useSidebarStore((s) => s.isOpen);
  const toggleHistorySidebar = useSidebarStore((s) => s.toggle);
  const appearance = useAuthStore((state) => state.appearance);
  const { isInstalling, installationState } = useInstallationUI();
  const _isInstallationActive =
    isInstalling || installationState === 'waiting-backend';

  useEffect(() => {
    const p = window.electronAPI.getPlatform();
    setPlatform(p);
  }, []);

  // create new project handler reused by plus icon and label
  const createNewProject = () => {
    //Handles refocusing id & nonduplicate internally
    projectStore.createProject('new project');
    navigate('/');
  };

  const summaryTask =
    chatStore?.tasks[chatStore?.activeTaskId as string]?.summaryTask;
  const activeTaskTitle = useMemo(() => {
    if (!chatStore) return t('layout.new-project');
    if (chatStore.activeTaskId && summaryTask) {
      return summaryTask.split('|')[0];
    }
    return t('layout.new-project');
  }, [chatStore, summaryTask, t]);

  const isHistoryRoute = useMemo(() => {
    const path = location.pathname.replace(/\/$/, '') || '/';
    return path === '/history' || path.endsWith('/history');
  }, [location.pathname]);

  if (!chatStore) {
    return <div>Loading...</div>;
  }

  const getReferFriendsLink = async () => {
    try {
      const res: any = await proxyFetchGet('/api/v1/user/invite_code');
      if (res?.invite_code) {
        const inviteLink = `https://www.eigent.ai/signup?invite_code=${res.invite_code}`;
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
      className={`drag left-0 right-0 top-0 !h-9 py-1 absolute z-50 flex items-center justify-between ${
        platform === 'darwin' ? 'pl-16' : 'pl-2'
      }`}
      id="titlebar"
      ref={titlebarRef}
    >
      {/* left — macOS uses pl-16 for traffic lights only; no extra spacer */}
      {platform !== 'darwin' && (
        <div className="no-drag ml-2 gap-1 pr-4 mt-[1.5px] flex w-auto items-center justify-center">
          <span className="text-label-md font-bold text-text-heading whitespace-nowrap">
            Eigent
          </span>
        </div>
      )}

      {/* center */}
      <div className="drag pr-2 flex h-full flex-1 items-center justify-between">
        <div className="relative z-50 flex h-full items-center">
          <div className="no-drag gap-2 pl-2 flex items-center">
            <div className="flex items-center">
              {isHistoryRoute ? (
                <TooltipSimple
                  content={t('layout.home')}
                  side="bottom"
                  align="center"
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className="no-drag rounded-full"
                    onClick={() => navigate('/')}
                    aria-label={t('layout.home')}
                    aria-current="page"
                  >
                    <Sparkles
                      className="h-4 w-4 text-icon-primary"
                      aria-hidden
                    />
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
                    size="icon"
                    className="no-drag rounded-full"
                    onClick={() => navigate('/history')}
                    aria-label={t('layout.dashboard')}
                    aria-current="page"
                  >
                    <House className="h-4 w-4 text-icon-primary" aria-hidden />
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
                  size="icon"
                  className="no-drag rounded-full"
                  disabled={!canGoBack}
                  onClick={() => navigate(-1)}
                  aria-label={t('layout.back')}
                >
                  <ChevronLeft
                    className="h-4 w-4 text-icon-primary"
                    aria-hidden
                  />
                </Button>
              </TooltipSimple>
              <TooltipSimple
                content={t('layout.forward')}
                side="bottom"
                align="center"
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className="no-drag rounded-full"
                  disabled={!canGoForward}
                  onClick={() => navigate(1)}
                  aria-label={t('layout.forward')}
                >
                  <ChevronRight
                    className="h-4 w-4 text-icon-primary"
                    aria-hidden
                  />
                </Button>
              </TooltipSimple>
            </div>
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
                      variant="ghost"
                      size="icon"
                      className="no-drag bg-surface-information !text-text-information rounded-full"
                      aria-label={t('layout.share')}
                    >
                      <Share className="h-4 w-4" aria-hidden />
                    </Button>
                  </TooltipSimple>
                )}
              <TooltipSimple
                content={t('layout.refer-friends')}
                side="bottom"
                align="end"
              >
                <Button
                  onClick={getReferFriendsLink}
                  variant="ghost"
                  size="icon"
                  className="no-drag rounded-full"
                >
                  <img
                    src={appearance === 'dark' ? giftWhiteIcon : giftIcon}
                    alt="gift-icon"
                    className="h-4 w-4"
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
                  size="icon"
                  className="no-drag rounded-full"
                >
                  <Settings className="h-4 w-4" />
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
            className="leading-5 hover:bg-surface-hover-subtle flex h-full w-[35px] flex-1 cursor-pointer items-center justify-center text-center"
            onClick={() => window.electronAPI.minimizeWindow()}
          >
            <Minus className="h-4 w-4" />
          </div>
          <div
            className="leading-5 hover:bg-surface-hover-subtle flex h-full w-[35px] flex-1 cursor-pointer items-center justify-center text-center"
            onClick={() => window.electronAPI.toggleMaximizeWindow()}
          >
            <Square className="h-4 w-4" />
          </div>
          <div
            className="leading-5 hover:bg-surface-hover-subtle flex h-full w-[35px] flex-1 cursor-pointer items-center justify-center text-center"
            onClick={() => window.electronAPI.closeWindow()}
          >
            <X className="h-4 w-4" />
          </div>
        </div>
      )}
    </div>
  );
}

export default HeaderWin;
