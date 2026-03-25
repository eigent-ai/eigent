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
import defaultFolderIcon from '@/assets/Folder.svg';
import giftWhiteIcon from '@/assets/gift-white.svg';
import giftIcon from '@/assets/gift.svg';
import EndNoticeDialog from '@/components/Dialog/EndNotice';
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
  ChevronDown,
  ChevronLeft,
  FileDown,
  House,
  Minus,
  Plus,
  Power,
  Settings,
  Square,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

function HeaderWin() {
  const { t } = useTranslation();
  const titlebarRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const [platform, setPlatform] = useState<string>('');
  const navigate = useNavigate();
  const location = useLocation();
  //Get Chatstore for the active project's task
  const { chatStore, projectStore } = useChatStoreAdapter();
  const { toggle } = useSidebarStore();
  const { chatPanelPosition, setChatPanelPosition } = usePageTabStore();
  const appearance = useAuthStore((state) => state.appearance);
  const [endDialogOpen, setEndDialogOpen] = useState(false);
  const [endProjectLoading, setEndProjectLoading] = useState(false);
  const { isInstalling, installationState } = useInstallationUI();
  const _isInstallationActive =
    isInstalling || installationState === 'waiting-backend';

  useEffect(() => {
    const p = window.electronAPI.getPlatform();
    setPlatform(p);
  }, []);
  const exportLog = async () => {
    try {
      const response = await window.electronAPI.exportLog();

      if (!response.success) {
        alert(t('layout.export-cancelled') + response.error);
        return;
      }
      if (response.savedPath) {
        window.location.href =
          'https://github.com/eigent-ai/eigent/issues/new/choose';
        alert(t('layout.log-saved') + response.savedPath);
      }
    } catch (e: any) {
      alert(t('layout.export-error') + e.message);
    }
  };

  // create new project handler reused by plus icon and label
  const createNewProject = () => {
    //Handles refocusing id & nonduplicate internally
    projectStore.createProject('new project');
    navigate('/');
  };

  const summaryTask =
    chatStore?.tasks[chatStore?.activeTaskId as string]?.summaryTask;

  const activeTaskTitle = useMemo(() => {
    if (chatStore?.activeTaskId && summaryTask) {
      return summaryTask.split('|')[0];
    }
    return t('layout.new-project');
  }, [chatStore?.activeTaskId, summaryTask, t]);

  if (!chatStore) {
    return <div>Loading...</div>;
  }

  const getReferFriendsLink = async () => {
    try {
      const res: any = await proxyFetchGet('/api/user/invite_code');
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

  //TODO: Mark ChatStore details as completed
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

      // Stop the task if it's running
      if (task && task.status === ChatTaskStatus.RUNNING) {
        await fetchPut(`/task/${taskId}/take-control`, {
          action: 'stop',
        });
      }

      // Stop Workforce
      try {
        await fetchDelete(`/chat/${projectId}`);
      } catch (error) {
        console.log('Task may not exist on backend:', error);
      }

      // Delete from history using historyId
      if (historyId && task.status !== ChatTaskStatus.FINISHED) {
        try {
          await proxyFetchDelete(`/api/chat/history/${historyId}`);
          // Remove from local store
          chatStore.removeTask(taskId);
        } catch (error) {
          console.log('History may not exist:', error);
        }
      } else {
        console.warn(
          'No historyId found for project or task finished, skipping history deletion'
        );
      }

      // Create a completely new project instead of just a new task
      // This ensures we start fresh without any residual state
      projectStore.createProject('new project');

      // Navigate to home with replace to force refresh
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
      {/* left */}
      <div className="w-8 no-drag gap-1 ml-2 mt-[1.5px] flex items-center justify-center">
        <img src={defaultFolderIcon} alt="folder-icon" className="h-6 w-6" />
        {platform !== 'darwin' && (
          <span className="text-label-md font-bold text-text-heading">
            Eigent
          </span>
        )}
      </div>

      {/* center */}
      <div className="drag pr-2 flex h-full flex-1 items-center justify-between">
        <div className="relative z-50 flex h-full items-center">
          {location.pathname === '/history' && (
            <div className="mr-1 flex items-center">
              <Button
                variant="ghost"
                size="xs"
                buttonRadius="full"
                buttonContent="icon-only"
                className="no-drag rounded-full"
                onClick={() => navigate('/')}
              >
                <ChevronLeft className="h-4 w-4 text-text-label" />
              </Button>
            </div>
          )}
          {location.pathname !== '/history' && (
            <div className="flex items-center">
              <TooltipSimple
                content={t('layout.home')}
                side="bottom"
                align="center"
              >
                <Button
                  variant="ghost"
                  size="xs"
                  buttonRadius="full"
                  buttonContent="icon-only"
                  className="no-drag rounded-full"
                  onClick={() => navigate('/history')}
                >
                  <House className="size-4" />
                </Button>
              </TooltipSimple>
              <TooltipSimple
                content={t('layout.new-project')}
                side="bottom"
                align="center"
              >
                <Button
                  variant="ghost"
                  size="xs"
                  buttonRadius="full"
                  buttonContent="icon-only"
                  className="no-drag rounded-full"
                  onClick={createNewProject}
                >
                  <Plus className="size-4" />
                </Button>
              </TooltipSimple>
            </div>
          )}
          {location.pathname !== '/history' && (
            <>
              {activeTaskTitle === t('layout.new-project') ? (
                <TooltipSimple
                  content={t('layout.new-project')}
                  side="bottom"
                  align="center"
                >
                  <Button
                    id="active-task-title-btn"
                    variant="ghost"
                    onClick={toggle}
                    size="xs"
                    buttonRadius="full"
                    buttonContent="text"
                    textWeight="semibold"
                    className="no-drag text-label-sm"
                  >
                    <span className="inline-block max-w-[300px] overflow-hidden align-middle text-ellipsis whitespace-nowrap">
                      {t('layout.new-project')}
                    </span>
                    <ChevronDown className="size-4" />
                  </Button>
                </TooltipSimple>
              ) : (
                <TooltipSimple
                  content={activeTaskTitle}
                  side="bottom"
                  align="center"
                >
                  <Button
                    id="active-task-title-btn"
                    variant="ghost"
                    size="xs"
                    textWeight="semibold"
                    buttonRadius="full"
                    buttonContent="text"
                    className="no-drag text-label-sm"
                    onClick={toggle}
                  >
                    <span className="inline-block max-w-[300px] overflow-hidden align-middle text-ellipsis whitespace-nowrap">
                      {activeTaskTitle}
                    </span>
                    <ChevronDown className="size-4" />
                  </Button>
                </TooltipSimple>
              )}
            </>
          )}
        </div>

        {/* right */}
        {location.pathname !== '/history' && (
          <div
            className={`${
              platform === 'darwin' && 'pr-2'
            } no-drag gap-1 relative z-50 flex h-full items-center`}
          >
            {chatStore.activeTaskId &&
              chatStore.tasks[chatStore.activeTaskId as string] &&
              ((chatStore.tasks[chatStore.activeTaskId as string]?.messages
                ?.length || 0) > 0 ||
                chatStore.tasks[chatStore.activeTaskId as string]
                  ?.hasMessages ||
                chatStore.tasks[chatStore.activeTaskId as string]?.status !==
                  ChatTaskStatus.PENDING) && (
                <TooltipSimple
                  content={t('layout.end-project')}
                  side="bottom"
                  align="end"
                >
                  <Button
                    onClick={() => setEndDialogOpen(true)}
                    variant="ghost"
                    size="xs"
                    buttonRadius="full"
                    buttonContent="text"
                    textWeight="semibold"
                    className="no-drag bg-surface-cuation !text-text-cuation text-label-xs justify-center"
                  >
                    <Power className="size-4" />
                    {t('layout.end-project')}
                  </Button>
                </TooltipSimple>
              )}
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
                    size="xs"
                    buttonRadius="full"
                    buttonContent="text"
                    textWeight="semibold"
                    className="no-drag bg-surface-information !text-text-information"
                  >
                    {t('layout.share')}
                  </Button>
                </TooltipSimple>
              )}
            {chatStore.activeTaskId &&
              chatStore.tasks[chatStore.activeTaskId as string] && (
                <TooltipSimple
                  content={t('layout.report-bug')}
                  side="bottom"
                  align="end"
                >
                  <Button
                    onClick={exportLog}
                    variant="ghost"
                    size="xs"
                    buttonRadius="full"
                    buttonContent="icon-only"
                    className="no-drag rounded-full"
                  >
                    <FileDown className="size-4" />
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
                size="xs"
                buttonRadius="full"
                buttonContent="icon-only"
                className="no-drag rounded-full"
              >
                <img
                  src={appearance === 'dark' ? giftWhiteIcon : giftIcon}
                  alt="gift-icon"
                  className="size-4"
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
                size="xs"
                buttonRadius="full"
                buttonContent="icon-only"
                className="no-drag rounded-full"
              >
                <Settings className="size-4" />
              </Button>
            </TooltipSimple>
          </div>
        )}
        {location.pathname === '/history' && (
          <div
            className={`${
              platform === 'darwin' && 'pr-2'
            } no-drag gap-1 relative z-50 flex h-full items-center`}
          ></div>
        )}
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
            <Minus className="size-4" />
          </div>
          <div
            className="leading-5 hover:bg-surface-hover-subtle flex h-full w-[35px] flex-1 cursor-pointer items-center justify-center text-center"
            onClick={() => window.electronAPI.toggleMaximizeWindow()}
          >
            <Square className="size-4" />
          </div>
          <div
            className="leading-5 hover:bg-surface-hover-subtle flex h-full w-[35px] flex-1 cursor-pointer items-center justify-center text-center"
            onClick={() => window.electronAPI.closeWindow()}
          >
            <X className="size-4" />
          </div>
        </div>
      )}
      <EndNoticeDialog
        open={endDialogOpen}
        onOpenChange={setEndDialogOpen}
        onConfirm={handleEndProject}
        loading={endProjectLoading}
      />
    </div>
  );
}

export default HeaderWin;
