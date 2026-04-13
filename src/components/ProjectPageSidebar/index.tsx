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
import {
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogHeader,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TooltipSimple } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import type { ChatStore } from '@/store/chatStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectStore } from '@/store/projectStore';
import { useTriggerStore } from '@/store/triggerStore';
import { ChatTaskStatus } from '@/types/constants';
import { motion } from 'framer-motion';
import {
  ChevronDown,
  Inbox,
  LayoutGrid,
  MonitorSmartphone,
  Power,
  ScrollText,
  Zap,
  ZapOff,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  NavTab,
  NavTabReconnectSuffix,
  WORKSPACE_TAB_LABEL_CLASS,
  triggerListenerLeadIconClass,
  workspaceTabButtonClass,
} from './NavTab';

const SUPPORT_EMAIL = 'info@eigent.ai';

function normalizeFolderPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function folderPathBasename(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/$/, '');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

const PROJECT_SIDEBAR_WIDTH_PX = 280;
/** Folded rail: tab row needs pl-3 + icon + pr-3 (no outer sidebar horizontal padding). */
const PROJECT_SIDEBAR_FOLDED_WIDTH_PX = 40;
/** Matches Home main panel layout animation */
const PROJECT_SIDEBAR_SPRING = {
  type: 'spring' as const,
  stiffness: 380,
  damping: 38,
  mass: 0.85,
};

const SIDEBAR_EDGE_MARGIN_PX = 8;

export interface ProjectPageSidebarProps {
  chatStore: ChatStore;
  className?: string;
}

export default function ProjectPageSidebar({
  chatStore,
  className,
}: ProjectPageSidebarProps) {
  const collapsed = usePageTabStore((s) => s.projectSidebarCollapsed);
  const activeWorkspaceTab = usePageTabStore((s) => s.activeWorkspaceTab);
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);
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
  const [instructionsExpanded, setInstructionsExpanded] = useState(true);
  const [endDialogOpen, setEndDialogOpen] = useState(false);
  const [endProjectLoading, setEndProjectLoading] = useState(false);

  const triggersTabTooltip = useMemo(() => {
    const base = t('layout.triggers');
    if (!collapsed) return base;
    if (triggersListenerConnected) return base;
    if (wsConnectionStatus === 'connecting') {
      return `${base} — ${t('layout.triggers-connecting')}`;
    }
    if (wsConnectionStatus === 'unhealthy') {
      return `${base} — ${t('layout.triggers-disconnected')}`;
    }
    return `${base} — ${t('layout.triggers-disconnected')}`;
  }, [collapsed, t, triggersListenerConnected, wsConnectionStatus]);

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

  const [supportDialogOpen, setSupportDialogOpen] = useState(false);

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

  const copySupportEmail = async () => {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      toast.success(
        t('layout.email-copied', {
          defaultValue: 'Email copied to clipboard',
        })
      );
    } catch {
      toast.error(
        t('layout.copy-failed', {
          defaultValue: 'Could not copy email',
        })
      );
    }
  };

  const showEndProject = useMemo(() => {
    const taskId = chatStore.activeTaskId;
    if (!taskId) return false;
    const task = chatStore.tasks[taskId as string];
    if (!task) return false;
    return (
      (task.messages?.length || 0) > 0 ||
      !!task.hasMessages ||
      task.status !== ChatTaskStatus.PENDING
    );
  }, [chatStore.activeTaskId, chatStore.tasks]);

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
      if (!task) {
        toast.error(t('layout.no-active-project-to-end'));
        return;
      }

      if (task.status === ChatTaskStatus.RUNNING) {
        await fetchPut(`/task/${taskId}/take-control`, {
          action: 'stop',
        });
      }

      try {
        await fetchDelete(`/chat/${projectId}`);
      } catch (error) {
        console.log('Task may not exist on backend:', error);
      }

      if (historyId && task.status !== ChatTaskStatus.FINISHED) {
        try {
          await proxyFetchDelete(`/api/v1/chat/history/${historyId}`);
          chatStore.removeTask(taskId);
        } catch (error) {
          console.log('History may not exist:', error);
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

  return (
    <>
      <Dialog open={supportDialogOpen} onOpenChange={setSupportDialogOpen}>
        <DialogContent
          size="sm"
          showCloseButton
          onClose={() => setSupportDialogOpen(false)}
        >
          <DialogHeader
            title={t('layout.contact-support')}
            subtitle={t('layout.contact-support-description')}
          />
          <DialogContentSection className="gap-3 flex flex-col">
            <p className="text-label-sm text-text-label">
              {t('layout.contact-support-body', {
                defaultValue: 'Copy our support email and reach out anytime.',
              })}
            </p>
            <div className="gap-2 flex flex-wrap items-center">
              <code className="text-body-sm bg-surface-secondary text-text-body rounded-lg px-3 py-2 font-medium max-w-full truncate">
                {SUPPORT_EMAIL}
              </code>
              <Button type="button" size="sm" onClick={copySupportEmail}>
                {t('layout.copy-email', { defaultValue: 'Copy email' })}
              </Button>
            </div>
          </DialogContentSection>
        </DialogContent>
      </Dialog>

      <GlobalSearchDialog
        open={globalSearchOpen}
        onOpenChange={setGlobalSearchOpen}
      />

      <motion.aside
        initial={false}
        animate={{
          width: collapsed
            ? PROJECT_SIDEBAR_FOLDED_WIDTH_PX
            : PROJECT_SIDEBAR_WIDTH_PX,
          marginRight: SIDEBAR_EDGE_MARGIN_PX,
          paddingTop: 8,
          paddingBottom: 4,
        }}
        transition={PROJECT_SIDEBAR_SPRING}
        className={cn(
          'min-h-0 flex h-full shrink-0 flex-col overflow-hidden',
          className
        )}
      >
        <div className="min-h-0 min-w-0 flex h-full w-full flex-col overflow-x-hidden">
          <div className="gap-2 min-h-0 min-w-0 flex flex-1 flex-col overflow-x-hidden overflow-y-auto">
            <div className="gap-2 min-w-0 flex w-full flex-col">
              <TooltipSimple
                content={t('layout.sidebar-instructions')}
                side="right"
                align="center"
                enabled={collapsed}
              >
                <div
                  className={cn(
                    'min-w-0 rounded-xl w-full overflow-hidden transition-colors',
                    instructionsExpanded && !collapsed && 'bg-surface-tertiary'
                  )}
                >
                  <button
                    type="button"
                    className={cn(
                      workspaceTabButtonClass(
                        instructionsExpanded && !collapsed
                      ),
                      'w-full',
                      instructionsExpanded && !collapsed && 'rounded-b-none'
                    )}
                    aria-expanded={instructionsExpanded && !collapsed}
                    aria-label={t('layout.sidebar-instructions')}
                    onClick={() => {
                      if (!collapsed) {
                        setInstructionsExpanded((open) => !open);
                      }
                    }}
                  >
                    <ScrollText
                      className="h-4 w-4 text-icon-primary shrink-0"
                      aria-hidden
                    />
                    <span className={WORKSPACE_TAB_LABEL_CLASS}>
                      {t('layout.sidebar-instructions')}
                    </span>
                    {!collapsed ? (
                      <ChevronDown
                        className={cn(
                          'h-4 w-4 text-icon-secondary shrink-0 transition-transform',
                          instructionsExpanded && 'rotate-180'
                        )}
                        aria-hidden
                      />
                    ) : null}
                  </button>
                  {instructionsExpanded && !collapsed ? (
                    <div className="flex flex-col">
                      <p className="text-text-secondary pl-8 pr-1 pb-2 text-body-sm leading-snug">
                        {t('layout.sidebar-instructions-description')}
                      </p>
                      <div className="pr-1 pl-8">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className={cn(
                                'hover:bg-surface-secondary/80 gap-2 min-w-0 rounded-lg px-2 py-2 flex w-full cursor-pointer items-center text-left transition-colors',
                                'text-text-heading text-body-sm font-medium'
                              )}
                              aria-label={t('layout.sidebar-memory')}
                            >
                              <span className="min-w-0 flex-1 truncate">
                                {t('layout.sidebar-memory')}
                              </span>
                              <ChevronDown
                                className="h-4 w-4 text-icon-secondary shrink-0 opacity-70"
                                aria-hidden
                              />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="start"
                            side="right"
                            sideOffset={8}
                            className="border-dropdown-border bg-dropdown-bg p-0 max-w-[min(260px,calc(100vw-2rem))]"
                          >
                            <div className="text-text-secondary px-3 py-2.5 text-body-sm leading-snug">
                              {t('layout.sidebar-memory-description')}
                            </div>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  ) : null}
                </div>
              </TooltipSimple>
              <NavTab
                active={activeWorkspaceTab === 'workforce'}
                onClick={() => setActiveWorkspaceTab('workforce')}
                leading={
                  <LayoutGrid
                    className="h-4 w-4 text-icon-primary shrink-0"
                    aria-hidden
                  />
                }
                label={t('triggers.workspace')}
                collapsed={collapsed}
                tooltip={t('triggers.workspace')}
                tooltipEnabledWhenCollapsed
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
                    <Inbox className="h-4 w-4 text-icon-primary" aria-hidden />
                    {folderTabHasUnviewedFiles ? (
                      <span
                        className="-right-1 -top-1 h-2 w-2 bg-red-500 absolute shrink-0 rounded-full"
                        aria-hidden
                      />
                    ) : null}
                  </span>
                }
                label={t('layout.folder')}
                trailing={
                  !collapsed ? (
                    <span
                      className="bg-surface-secondary text-text-secondary rounded-md px-1.5 font-medium leading-tight max-w-[5.5rem] shrink-0 truncate py-px text-[10px]"
                      title={
                        customFolderPath &&
                        folderSettingTagLabel !== t('layout.default')
                          ? customFolderPath
                          : (resolvedDefaultFolderPath ?? undefined)
                      }
                    >
                      {folderSettingTagLabel}
                    </span>
                  ) : undefined
                }
                collapsed={collapsed}
                tooltip={
                  collapsed
                    ? `${t('layout.folder')} · ${folderSettingTagLabel}`
                    : t('layout.folder')
                }
                tooltipEnabledWhenCollapsed
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
                  !collapsed && showTriggersDisconnectedTag ? (
                    <span className="bg-surface-secondary text-text-error rounded-md px-1.5 font-medium leading-tight max-w-[5.5rem] shrink-0 truncate py-px text-[10px]">
                      {t('layout.triggers-disconnected')}
                    </span>
                  ) : undefined
                }
                showNotificationDot={unviewedTabs.has('triggers')}
                notificationDotTone="attention"
                notificationDotClassName={
                  collapsed ? 'top-1 right-1 h-2 w-2 absolute' : 'h-2 w-2'
                }
                suffix={
                  wsConnectionStatus !== 'connected' && !collapsed ? (
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
                collapsed={collapsed}
                tooltip={triggersTabTooltip}
                tooltipEnabledWhenCollapsed
                ariaLabel={triggersTabAriaLabel}
                ariaCurrentPage={activeWorkspaceTab === 'triggers'}
              />
              <NavTab
                active={false}
                onClick={() => void 0}
                leading={
                  <MonitorSmartphone
                    className="h-4 w-4 text-icon-primary shrink-0"
                    aria-hidden
                  />
                }
                label={t('layout.sidebar-dispatch', {
                  defaultValue: 'Dispatch',
                })}
                collapsed={collapsed}
                tooltip={t('layout.sidebar-dispatch', {
                  defaultValue: 'Dispatch',
                })}
                tooltipEnabledWhenCollapsed
                ariaLabel={t('layout.sidebar-dispatch', {
                  defaultValue: 'Dispatch',
                })}
              />
            </div>
          </div>
          {showEndProject ? (
            <div className="border-border-secondary pt-2 shrink-0 border-t">
              <NavTab
                active={false}
                onClick={() => setEndDialogOpen(true)}
                leading={
                  <Power
                    className="h-4 w-4 text-icon-primary shrink-0"
                    aria-hidden
                  />
                }
                label={t('layout.end-project')}
                collapsed={collapsed}
                tooltip={t('layout.end-project')}
                tooltipEnabledWhenCollapsed
                ariaLabel={t('layout.end-project')}
              />
            </div>
          ) : null}
        </div>
      </motion.aside>
      <EndNoticeDialog
        open={endDialogOpen}
        onOpenChange={setEndDialogOpen}
        onConfirm={handleEndProject}
        loading={endProjectLoading}
      />
    </>
  );
}
