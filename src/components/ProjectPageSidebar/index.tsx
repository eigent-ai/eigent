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
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogHeader,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import type { ChatStore } from '@/store/chatStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectStore } from '@/store/projectStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useTriggerStore } from '@/store/triggerStore';
import { motion } from 'framer-motion';
import { Inbox, LayoutGrid, Zap, ZapOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { BottomAction } from './BottomAction';
import { HeaderAction } from './HeaderAction';
import {
  NavTab,
  NavTabReconnectSuffix,
  triggerListenerLeadIconClass,
} from './NavTab';
import { TaskList } from './TaskList';

/** Match History.tsx tab normalization for sidebar “active hub” styling */
const HISTORY_TAB_ALIASES: Record<string, string> = {
  mcp_tools: 'connectors',
};

const SUPPORT_EMAIL = 'info@eigent.ai';
const GITHUB_NEW_ISSUE_URL =
  'https://github.com/eigent-ai/eigent/issues/new/choose';

function humanizeCloudModelId(id: string): string {
  return id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function capitalizeFirstLetter(text: string): string {
  const s = text.trim();
  if (!s) return text;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function normalizeFolderPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function folderPathBasename(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/$/, '');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

const PROJECT_SIDEBAR_WIDTH_PX = 240;
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

/** Tween for properties that don’t interpolate well with springs (grid template, height auto). */
const SIDEBAR_LAYOUT_TWEEN = {
  duration: 0.34,
  ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
};

export interface ProjectPageSidebarProps {
  chatStore: ChatStore;
  className?: string;
}

export default function ProjectPageSidebar({
  chatStore,
  className,
}: ProjectPageSidebarProps) {
  const collapsed = usePageTabStore((s) => s.projectSidebarCollapsed);
  const toggleProjectSidebarCollapsed = usePageTabStore(
    (s) => s.toggleProjectSidebarCollapsed
  );
  const setScrollToQueryId = usePageTabStore((s) => s.setScrollToQueryId);
  const activeWorkspaceTab = usePageTabStore((s) => s.activeWorkspaceTab);
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);
  const requestWorkspaceChatFocus = usePageTabStore(
    (s) => s.requestWorkspaceChatFocus
  );
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
  const historySidebarOpen = useSidebarStore((s) => s.isOpen);
  const toggleHistorySidebar = useSidebarStore((s) => s.toggle);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [skillsMenuOpen, setSkillsMenuOpen] = useState(false);
  const [connectorsMenuOpen, setConnectorsMenuOpen] = useState(false);
  const [browserMenuOpen, setBrowserMenuOpen] = useState(false);
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);

  const { skillsHubActive, connectorsHubActive, browserHubActive } =
    useMemo(() => {
      const path = location.pathname.replace(/\/$/, '');
      const onHistory = path === '/history' || path.endsWith('/history');
      const params = new URLSearchParams(location.search);
      const rawTab = params.get('tab');
      const tab = rawTab ? (HISTORY_TAB_ALIASES[rawTab] ?? rawTab) : null;
      const section = params.get('section');
      return {
        skillsHubActive: onHistory && tab === 'agents' && section === 'skills',
        connectorsHubActive: onHistory && tab === 'connectors',
        browserHubActive: onHistory && tab === 'browser',
      };
    }, [location.pathname, location.search]);

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

  const allTaskEntries = useMemo(() => {
    const pid = projectStore.activeProjectId;
    if (!pid) return [];
    const stores = projectStore.getAllChatStores(pid);
    const entries: Array<{
      chatId: string;
      taskId: string;
      task: ChatStore['tasks'][string];
      firstUserMessageId: string | null;
    }> = [];
    for (const { chatId, chatStore: cs } of stores) {
      const state = cs.getState();
      const tid = state.activeTaskId;
      if (!tid || !state.tasks[tid]) continue;
      const task = state.tasks[tid];
      const hasUserMessages = task.messages.some(
        (m) => m.role === 'user' && m.content
      );
      if (!hasUserMessages) continue;
      const firstUser = task.messages.find((m) => m.role === 'user');
      entries.push({
        chatId,
        taskId: tid,
        task,
        firstUserMessageId: firstUser?.id ?? null,
      });
    }
    return entries;
    // `chatStore` updates whenever the active chat store changes (adapter subscription).
    // Do not use `updateCount` alone — it only bumps on task completion, so the list would stay stale while chatting.
  }, [projectStore, activeProjectId, chatStore]);

  const authToken = useAuthStore((s) => s.token);
  const email = useAuthStore((s) => s.email);
  const modelType = useAuthStore((s) => s.modelType);
  const cloud_model_type = useAuthStore((s) => s.cloud_model_type);

  const [resolvedDefaultFolderPath, setResolvedDefaultFolderPath] = useState<
    string | null
  >(null);

  const [credits, setCredits] = useState<number | null>(null);
  const [customPlatformName, setCustomPlatformName] = useState<string | null>(
    null
  );
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
    if (import.meta.env.VITE_USE_LOCAL_PROXY === 'true') {
      setCredits(null);
      return;
    }
    if (modelType !== 'cloud' || !authToken) {
      setCredits(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await proxyFetchGet('/api/v1/user/current_credits');
        if (!cancelled) {
          const c = res?.credits;
          setCredits(typeof c === 'number' ? c : null);
        }
      } catch {
        if (!cancelled) setCredits(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authToken, modelType]);

  useEffect(() => {
    if (modelType !== 'custom') {
      setCustomPlatformName(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await proxyFetchGet('/api/v1/providers', {
          prefer: true,
        });
        const provider = res?.items?.[0];
        const raw =
          typeof provider?.provider_name === 'string'
            ? provider.provider_name.trim()
            : '';
        if (!cancelled) {
          setCustomPlatformName(raw || null);
        }
      } catch {
        if (!cancelled) setCustomPlatformName(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [modelType, authToken]);

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

  const downloadLogs = async () => {
    try {
      const response = await window.electronAPI.exportLog();
      if (!response.success) {
        alert(t('layout.export-cancelled') + response.error);
        return;
      }
      if (response.savedPath) {
        toast.success(t('layout.log-saved') + response.savedPath);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(t('layout.export-error') + msg);
    }
  };

  const reportBugOpenGithub = async () => {
    try {
      const response = await window.electronAPI.exportLog();
      if (!response.success) {
        alert(t('layout.export-cancelled') + response.error);
        return;
      }
      if (response.savedPath) {
        window.location.href = GITHUB_NEW_ISSUE_URL;
        alert(t('layout.log-saved') + response.savedPath);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(t('layout.export-error') + msg);
    }
  };

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

  const modelModeLine = useMemo(() => {
    if (modelType === 'cloud') {
      return t('setting.eigent-cloud');
    }
    if (modelType === 'custom') {
      return t('setting.custom-model');
    }
    return t('setting.local-model');
  }, [modelType, t]);

  const modelDetailLine = useMemo(() => {
    if (modelType === 'cloud') {
      const modelLabel = humanizeCloudModelId(cloud_model_type);
      if (import.meta.env.VITE_USE_LOCAL_PROXY === 'true') {
        return t('layout.sidebar-model-manage-hint', {
          defaultValue: 'Manage in Agents → Models',
        });
      }
      if (credits != null) {
        return `${modelLabel} · ${t('setting.credits')}: ${credits.toLocaleString()}`;
      }
      return `${modelLabel} · ${t('setting.credits')}: …`;
    }
    if (modelType === 'custom') {
      if (customPlatformName) {
        return capitalizeFirstLetter(customPlatformName);
      }
      return t('layout.sidebar-custom-platform-unknown', {
        defaultValue: '—',
      });
    }
    return t('layout.sidebar-model-manage-hint', {
      defaultValue: 'Manage in Agents → Models',
    });
  }, [modelType, credits, customPlatformName, cloud_model_type, t]);

  const summaryTask =
    chatStore.tasks[chatStore.activeTaskId as string]?.summaryTask;
  const activeTaskTitle = useMemo(() => {
    if (chatStore.activeTaskId && summaryTask) {
      return summaryTask.split('|')[0];
    }
    return t('layout.new-project');
  }, [chatStore.activeTaskId, summaryTask, t]);

  const createNewProject = () => {
    projectStore.createProject('new project');
    setActiveWorkspaceTab('workforce');
    navigate('/');
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

      <motion.aside
        initial={false}
        animate={{
          width: collapsed
            ? PROJECT_SIDEBAR_FOLDED_WIDTH_PX
            : PROJECT_SIDEBAR_WIDTH_PX,
          marginRight: SIDEBAR_EDGE_MARGIN_PX,
        }}
        transition={PROJECT_SIDEBAR_SPRING}
        className={cn(
          'min-h-0 flex h-full shrink-0 flex-col overflow-hidden',
          className
        )}
      >
        <div className="min-h-0 min-w-0 flex h-full w-full flex-col overflow-x-hidden">
          <div className="gap-2 flex w-full shrink-0 flex-col">
            <HeaderAction
              collapsed={collapsed}
              onToggleCollapsed={toggleProjectSidebarCollapsed}
              expandAriaLabel={t('layout.expand-sidebar', {
                defaultValue: 'Expand sidebar',
              })}
              expandTooltip={t('layout.expand-sidebar', {
                defaultValue: 'Expand sidebar',
              })}
              collapseAriaLabel={t('layout.collapse-sidebar', {
                defaultValue: 'Collapse sidebar',
              })}
              collapseTooltip={t('layout.collapse-sidebar', {
                defaultValue: 'Collapse sidebar',
              })}
              historySidebarOpen={historySidebarOpen}
              activeTaskTitle={activeTaskTitle}
              onCenterClick={toggleHistorySidebar}
              newProjectAriaLabel={t('layout.new-project')}
              newProjectTooltip={t('layout.new-project')}
              onNewProject={createNewProject}
            />

            <div className="gap-2 min-w-0 flex w-full flex-col">
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
            </div>
          </div>

          <motion.div
            className="bg-surface-tertiary mx-0 rounded-xl shrink-0 overflow-hidden"
            initial={false}
            animate={{
              opacity: collapsed ? 0 : 0.8,
              height: collapsed ? 0 : 1.5,
              marginTop: collapsed ? 0 : 8,
              marginBottom: collapsed ? 0 : 8,
            }}
            transition={SIDEBAR_LAYOUT_TWEEN}
          />

          <TaskList
            collapsed={collapsed}
            entries={allTaskEntries}
            activeTaskId={chatStore.activeTaskId}
            setScrollToQueryId={setScrollToQueryId}
            title={t('layout.task-list-title', { defaultValue: 'Tasks' })}
            emptyLabel={t('layout.no-tasks', { defaultValue: 'No tasks' })}
            addButtonAriaLabel={t('layout.task-list-add-hint', {
              defaultValue: 'Open workspace and focus chat',
            })}
            onAddClick={() => requestWorkspaceChatFocus()}
          />

          <BottomAction
            collapsed={collapsed}
            onOpenModels={() => navigate('/history?tab=agents&section=models')}
            modelsAriaLabel={t('setting.models')}
            modelModeLine={modelModeLine}
            modelDetailLine={modelDetailLine}
            helpMenuOpen={helpMenuOpen}
            onHelpMenuOpenChange={setHelpMenuOpen}
            helpAriaLabel={t('layout.help-and-support', {
              defaultValue: 'Help and support',
            })}
            onContactSupport={() => setSupportDialogOpen(true)}
            onReportBug={() => {
              void reportBugOpenGithub();
            }}
            onDownloadLogs={() => {
              void downloadLogs();
            }}
            contactSupportLabel={t('layout.contact-support')}
            reportBugLabel={t('layout.report-bug')}
            downloadLogsLabel={t('layout.download-logs', {
              defaultValue: 'Download logs',
            })}
          />
        </div>
      </motion.aside>
    </>
  );
}
