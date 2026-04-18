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
import EndNoticeDialog from '@/components/Dialog/EndNotice';
import { GlobalSearchDialog } from '@/components/GlobalSearch';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import type { ChatStore } from '@/store/chatStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectStore } from '@/store/projectStore';
import { useTriggerStore } from '@/store/triggerStore';
import { ChatTaskStatus } from '@/types/constants';
import { AnimatePresence, motion } from 'framer-motion';
import { Inbox, LayoutGrid, Plus, Zap, ZapOff } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { BottomAction } from './BottomAction';
import { PROJECT_SIDEBAR_FOLD_SPRING } from './constants';
import { HeaderAction } from './HeaderAction';
import { NavList } from './NavList';
import {
  NavTab,
  NavTabReconnectSuffix,
  triggerListenerLeadIconClass,
} from './NavTab';

function normalizeFolderPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function folderPathBasename(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/$/, '');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

export interface ProjectPageSidebarProps {
  chatStore: ChatStore;
  className?: string;
}

export default function ProjectPageSidebar({
  chatStore,
  className,
}: ProjectPageSidebarProps) {
  const activeWorkspaceTab = usePageTabStore((s) => s.activeWorkspaceTab);
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);
  const requestOpenTriggerAddDialog = usePageTabStore(
    (s) => s.requestOpenTriggerAddDialog
  );
  const projectSidebarFolded = usePageTabStore((s) => s.projectSidebarFolded);
  const unviewedTabs = usePageTabStore((s) => s.unviewedTabs);
  const inboxUnviewedForProjects = usePageTabStore(
    (s) => s.inboxUnviewedForProjects
  );
  const wsConnectionStatus = useTriggerStore((s) => s.wsConnectionStatus);
  const triggerReconnect = useTriggerStore((s) => s.triggerReconnect);
  const triggersListenerConnected = wsConnectionStatus === 'connected';
  const showTriggersDisconnectedTag =
    wsConnectionStatus === 'disconnected' || wsConnectionStatus === 'unhealthy';
  const projectStore = useProjectStore();
  const activeProjectId = projectStore.activeProjectId;
  const folderTabHasUnviewedFiles =
    !!activeProjectId && inboxUnviewedForProjects.has(activeProjectId);
  const customFolderPath = usePageTabStore((s) =>
    activeProjectId
      ? s.customAgentFolderPathByProjectId[activeProjectId]
      : undefined
  );
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [endDialogOpen, setEndDialogOpen] = useState(false);
  const [endProjectLoading, setEndProjectLoading] = useState(false);

  const triggersTabTooltip = t('layout.triggers');

  const triggersTabAriaLabel = useMemo(() => {
    const base = t('layout.triggers');
    if (triggersListenerConnected) return base;
    if (wsConnectionStatus === 'connecting') {
      return `${base}, ${t('layout.triggers-connecting')}`;
    }
    return `${base}, ${t('layout.triggers-disconnected')}`;
  }, [t, triggersListenerConnected, wsConnectionStatus]);

  const email = useAuthStore((s) => s.email);

  const [resolvedDefaultFolderPath, setResolvedDefaultFolderPath] = useState<
    string | null
  >(null);

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

  useEffect(() => {
    let cancelled = false;
    if (!email || !activeProjectId) {
      setResolvedDefaultFolderPath(null);
      return;
    }
    if (typeof window.electronAPI?.getProjectFolderPath !== 'function') {
      setResolvedDefaultFolderPath(null);
      return;
    }
    void window.electronAPI
      .getProjectFolderPath(email, activeProjectId)
      .then((p: string) => {
        if (!cancelled) setResolvedDefaultFolderPath(p || null);
      })
      .catch(() => {
        if (!cancelled) setResolvedDefaultFolderPath(null);
      });
    return () => {
      cancelled = true;
    };
  }, [email, activeProjectId]);

  const folderSettingTagLabel = useMemo(() => {
    const custom = customFolderPath?.trim();
    if (!custom) return t('layout.default');
    const def = resolvedDefaultFolderPath?.trim();
    if (def && normalizeFolderPath(custom) === normalizeFolderPath(def)) {
      return t('layout.default');
    }
    return folderPathBasename(custom);
  }, [customFolderPath, resolvedDefaultFolderPath, t]);

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

  const navSessions = useMemo(
    () =>
      Object.entries(chatStore.tasks)
        .filter(([, task]) => {
          const hasStarted =
            (task.messages?.length || 0) > 0 ||
            task.hasMessages ||
            task.status !== ChatTaskStatus.PENDING;
          return hasStarted;
        })
        .map(([id, task]) => ({
          id,
          title:
            task.summaryTask?.trim() ||
            t('layout.sessions-untitled', { defaultValue: 'Untitled session' }),
          taskStatus: task.status,
        })),
    [chatStore.tasks, t]
  );

  const handleDeleteSession = useCallback(
    (sessionId: string) => {
      if (!window.confirm(t('layout.delete-task-confirmation'))) return;
      const otherIds = Object.keys(chatStore.tasks).filter(
        (id) => id !== sessionId
      );
      const wasActive = chatStore.activeTaskId === sessionId;
      chatStore.removeTask(sessionId);
      if (wasActive) {
        if (otherIds.length > 0) {
          chatStore.setActiveTaskId(otherIds[0]);
        } else {
          chatStore.create();
        }
      }
    },
    [chatStore, t]
  );

  const handleShowAllSessions = useCallback(() => {
    setActiveWorkspaceTab('sessions');
  }, [setActiveWorkspaceTab]);

  return (
    <>
      <GlobalSearchDialog
        open={globalSearchOpen}
        onOpenChange={setGlobalSearchOpen}
      />

      <aside
        className={cn(
          'min-h-0 min-w-0 pt-2 box-border flex h-full w-full shrink-0 flex-col items-start overflow-hidden',
          className
        )}
      >
        <div className="min-h-0 min-w-0 flex h-full w-full max-w-full flex-col overflow-x-hidden">
          <div className="min-h-0 min-w-0 flex flex-1 flex-col overflow-hidden">
            <div className="gap-2 flex w-full shrink-0 flex-col">
              <HeaderAction />

              <div className="gap-2 min-w-0 flex w-full flex-col">
                <NavTab
                  active={activeWorkspaceTab === 'workforce'}
                  onClick={() => setActiveWorkspaceTab('workforce')}
                  leading={
                    <LayoutGrid
                      className="h-4 w-4 shrink-0 text-[color:var(--ds-icon-neutral-default-default)]"
                      aria-hidden
                    />
                  }
                  label={t('triggers.workspace')}
                  tooltip={t('triggers.workspace')}
                  tooltipEnabledWhenCollapsed={!projectSidebarFolded}
                  folded={projectSidebarFolded}
                  ariaLabel={t('triggers.workspace')}
                  ariaCurrentPage={activeWorkspaceTab === 'workforce'}
                />
                <NavTab
                  active={activeWorkspaceTab === 'inbox'}
                  onClick={() => {
                    if (chatStore.activeTaskId) {
                      chatStore.setNuwFileNum(chatStore.activeTaskId, 0);
                    }
                    setActiveWorkspaceTab('inbox', {
                      clearInboxForProjectId: activeProjectId,
                    });
                  }}
                  leading={
                    <span className="h-4 w-4 relative inline-flex shrink-0">
                      <Inbox
                        className="h-4 w-4 text-[color:var(--ds-icon-neutral-default-default)]"
                        aria-hidden
                      />
                      {folderTabHasUnviewedFiles ? (
                        <span
                          className="-right-1 -top-1 h-2 w-2 absolute shrink-0 rounded-full bg-[var(--ds-text-status-error-strong-default)]"
                          aria-hidden
                        />
                      ) : null}
                    </span>
                  }
                  label={t('layout.folder')}
                  trailing={
                    <span
                      className="rounded-md px-1.5 font-medium leading-tight max-w-[5.5rem] shrink-0 truncate bg-[var(--ds-bg-neutral-default-default)] py-px text-[10px] text-[color:var(--ds-text-neutral-muted-default)]"
                      title={
                        customFolderPath &&
                        folderSettingTagLabel !== t('layout.default')
                          ? customFolderPath
                          : (resolvedDefaultFolderPath ?? undefined)
                      }
                    >
                      {folderSettingTagLabel}
                    </span>
                  }
                  tooltip={t('layout.folder')}
                  tooltipEnabledWhenCollapsed={!projectSidebarFolded}
                  folded={projectSidebarFolded}
                  ariaLabel={`${t('layout.folder')}, ${folderSettingTagLabel}`}
                  ariaCurrentPage={activeWorkspaceTab === 'inbox'}
                />
                <NavTab
                  layout="split"
                  active={activeWorkspaceTab === 'triggers'}
                  onClick={() => setActiveWorkspaceTab('triggers')}
                  leading={
                    triggersListenerConnected ? (
                      <Zap
                        className={cn(
                          'h-4 w-4 shrink-0',
                          triggerListenerLeadIconClass(wsConnectionStatus)
                        )}
                        aria-hidden
                      />
                    ) : (
                      <ZapOff
                        className={cn(
                          'h-4 w-4 shrink-0',
                          triggerListenerLeadIconClass(wsConnectionStatus)
                        )}
                        aria-hidden
                      />
                    )
                  }
                  label={t('layout.triggers')}
                  trailing={
                    showTriggersDisconnectedTag ? (
                      <span className="rounded-md px-1.5 font-medium leading-tight max-w-[5.5rem] shrink-0 truncate bg-[var(--ds-bg-neutral-default-default)] py-px text-[10px] text-[color:var(--ds-text-status-error-strong-default)]">
                        {t('layout.triggers-disconnected')}
                      </span>
                    ) : undefined
                  }
                  showNotificationDot={unviewedTabs.has('triggers')}
                  notificationDotTone="attention"
                  notificationDotClassName="h-2 w-2"
                  suffix={
                    wsConnectionStatus !== 'connected' ? (
                      <NavTabReconnectSuffix
                        wsConnectionStatus={wsConnectionStatus}
                        reconnectHint={t('layout.triggers-reconnect-hint')}
                        reconnectButtonLabel={t(
                          'layout.triggers-listener-reconnect'
                        )}
                        onReconnect={triggerReconnect}
                      />
                    ) : undefined
                  }
                  endAction={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      buttonContent="icon-only"
                      className={cn(
                        'no-drag mr-1 rounded-xl shrink-0 hover:bg-[var(--ds-bg-neutral-strong-default)]',
                        'focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-[var(--ds-border-neutral-default-default)] focus-visible:outline-none'
                      )}
                      aria-label={t('triggers.add-trigger')}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        requestOpenTriggerAddDialog();
                      }}
                    >
                      <Plus
                        className="h-4 w-4 text-[color:var(--ds-icon-neutral-muted-default)]"
                        aria-hidden
                      />
                    </Button>
                  }
                  tooltip={triggersTabTooltip}
                  tooltipEnabledWhenCollapsed={!projectSidebarFolded}
                  folded={projectSidebarFolded}
                  ariaLabel={triggersTabAriaLabel}
                  ariaCurrentPage={activeWorkspaceTab === 'triggers'}
                />
              </div>
            </div>

            <AnimatePresence initial={false}>
              {!projectSidebarFolded ? (
                <motion.div
                  key="nav-list"
                  className="min-h-0 min-w-0 flex flex-1 flex-col overflow-hidden"
                  initial={false}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={PROJECT_SIDEBAR_FOLD_SPRING}
                >
                  <NavList
                    className="min-h-0 mt-6 flex flex-1 flex-col"
                    sessions={navSessions}
                    activeSessionId={
                      activeWorkspaceTab === 'session'
                        ? chatStore.activeTaskId
                        : null
                    }
                    onSessionClick={(id) => {
                      chatStore.setActiveTaskId(id);
                      setActiveWorkspaceTab('session');
                    }}
                    onDeleteSession={handleDeleteSession}
                    onShowAll={handleShowAllSessions}
                    showAllActive={activeWorkspaceTab === 'sessions'}
                  />
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          <BottomAction
            showEndProject={showEndProject}
            endProjectLabel={t('layout.end-project')}
            endProjectAriaLabel={t('layout.end-project')}
            onEndProjectClick={() => setEndDialogOpen(true)}
            folded={projectSidebarFolded}
          />
        </div>
      </aside>

      <EndNoticeDialog
        open={endDialogOpen}
        onOpenChange={setEndDialogOpen}
        onConfirm={handleEndProject}
        loading={endProjectLoading}
      />
    </>
  );
}
