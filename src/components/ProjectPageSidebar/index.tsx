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
import folderIcon from '@/assets/Folder.svg';
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
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { TooltipSimple } from '@/components/ui/tooltip';
import {
  getTaskListShelfTone,
  type TaskListShelfTone,
} from '@/lib/taskLifecycleUi';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import type { ChatStore } from '@/store/chatStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectStore } from '@/store/projectStore';
import { useSidebarStore } from '@/store/sidebarStore';
import {
  useTriggerStore,
  type WebSocketConnectionStatus,
} from '@/store/triggerStore';
import { motion } from 'framer-motion';
import {
  CircleHelp,
  Inbox,
  LayoutGrid,
  PanelLeft,
  PanelLeftClose,
  Plus,
  RefreshCw,
  SquarePen,
  Zap,
  ZapOff,
} from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

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

const PROJECT_HUB_DROPDOWN_CONTENT_CLASS = cn(
  'min-w-[11rem] -mb-2 flex flex-col gap-1 rounded-xl border-0 bg-fill-default p-1 shadow-md'
);

const PROJECT_HUB_DROPDOWN_CONTENT_STYLE: CSSProperties = {
  border: 'none',
  borderRadius: 'var(--borderRadius-rounded-xl, 12px)',
  background: 'var(--fill-default, #FFF)',
};

const PROJECT_HUB_DROPDOWN_ITEM_CLASS = cn(
  'flex h-9 min-h-9 w-full shrink-0 cursor-pointer select-none items-center rounded-xl px-3 py-0 text-body-sm font-medium text-text-label outline-none',
  'hover:bg-surface-secondary hover:text-text-label',
  'data-[highlighted]:bg-surface-secondary data-[highlighted]:text-text-label',
  'focus:bg-surface-secondary focus:text-text-label'
);

function taskUserQueryLabel(task: ChatStore['tasks'][string]): string {
  const firstUser = task.messages.find((m) => m.role === 'user');
  const text = firstUser?.content?.trim() ?? '';
  return text || '…';
}

const SHELF_TONE_ROW_CLASS: Record<TaskListShelfTone, string> = {
  splitting: 'bg-input-bg-spliting hover:brightness-[0.98]',
  running: 'bg-input-bg-confirm hover:brightness-[0.98]',
  default: 'bg-transparent hover:bg-surface-tertiary',
};

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

/** Workspace tabs: layout identical expanded/folded so the leading icon does not jump — text clips as the rail narrows. */
const workspaceTabButtonClass = (active: boolean) =>
  cn(
    'no-drag h-8 min-h-8 w-full min-w-0 shrink-0 rounded-xl cursor-pointer flex items-center justify-start gap-3 px-3 text-left outline-none overflow-hidden',
    'hover:bg-surface-tertiary focus-visible:ring-2 focus-visible:ring-border-secondary focus-visible:outline-none',
    active && 'bg-surface-tertiary'
  );

const workspaceTabLabelClass =
  'min-w-0 flex-1 truncate text-text-label text-body-sm font-medium';

function triggerListenerLeadIconClass(
  status: WebSocketConnectionStatus
): string {
  switch (status) {
    case 'connected':
      return 'text-green-500';
    case 'connecting':
      return 'text-yellow-500 animate-pulse';
    case 'unhealthy':
      return 'text-orange-500';
    case 'disconnected':
    default:
      return 'text-icon-secondary';
  }
}

/** Horizontal drift speed for task query hover (~6px/s, capped) — readable marquee, not a snap. */
const TASK_QUERY_SCROLL_PX_PER_SEC = 16;
const TASK_QUERY_SCROLL_MIN_MS = 10_000;
const TASK_QUERY_SCROLL_MAX_MS = 90_000;

function taskQueryScrollDurationMs(scrollPx: number): number {
  if (scrollPx <= 0) return 300;
  const proportional = (scrollPx / TASK_QUERY_SCROLL_PX_PER_SEC) * 1000;
  return Math.min(
    TASK_QUERY_SCROLL_MAX_MS,
    Math.max(TASK_QUERY_SCROLL_MIN_MS, Math.round(proportional))
  );
}

function TaskQueryScrollLabel({
  queryLabel,
  rowHovered,
}: {
  queryLabel: string;
  rowHovered: boolean;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const [scrollPx, setScrollPx] = useState(0);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    const measure = () => {
      setScrollPx(Math.max(0, inner.scrollWidth - outer.clientWidth));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    return () => ro.disconnect();
  }, [queryLabel]);

  const slide = rowHovered && scrollPx > 0;
  const slideMs = taskQueryScrollDurationMs(scrollPx);

  return (
    <div
      ref={outerRef}
      className={cn('text-text-label min-w-0 w-full overflow-hidden')}
    >
      <span
        ref={innerRef}
        title={queryLabel}
        className={cn(
          'text-body-sm font-normal inline-block whitespace-nowrap first-letter:uppercase',
          'transition-[transform]',
          slide ? 'ease-linear' : 'ease-out duration-300'
        )}
        style={{
          transform: slide ? `translateX(-${scrollPx}px)` : 'translateX(0)',
          transitionDuration: slide ? `${slideMs}ms` : undefined,
        }}
      >
        {queryLabel}
      </span>
    </div>
  );
}

function ProjectSidebarTaskListRow({
  task,
  firstUserMessageId,
  active,
  setScrollToQueryId,
}: {
  task: ChatStore['tasks'][string];
  firstUserMessageId: string | null;
  active: boolean;
  setScrollToQueryId: (id: string) => void;
}) {
  const [rowHovered, setRowHovered] = useState(false);
  const queryLabel = taskUserQueryLabel(task);
  const shelfTone = getTaskListShelfTone(task);

  return (
    <button
      type="button"
      onClick={() => {
        if (firstUserMessageId) {
          setScrollToQueryId(firstUserMessageId);
        }
      }}
      onMouseEnter={() => setRowHovered(true)}
      onMouseLeave={() => setRowHovered(false)}
      className={cn(
        'no-drag h-8 rounded-xl min-w-0 gap-3 px-3 relative flex w-full max-w-full shrink-0 cursor-pointer items-center text-left transition-colors',
        SHELF_TONE_ROW_CLASS[shelfTone]
      )}
      aria-current={active ? 'true' : undefined}
    >
      <TaskQueryScrollLabel queryLabel={queryLabel} rowHovered={rowHovered} />
    </button>
  );
}

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
  const wsConnectionStatus = useTriggerStore((s) => s.wsConnectionStatus);
  const triggerReconnect = useTriggerStore((s) => s.triggerReconnect);
  const triggersListenerConnected = wsConnectionStatus === 'connected';
  const showTriggersDisconnectedTag =
    wsConnectionStatus === 'disconnected' || wsConnectionStatus === 'unhealthy';
  const projectStore = useProjectStore();
  const activeProjectId = projectStore.activeProjectId;
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

  const rowButtonBaseClass =
    'no-drag h-8 rounded-xl hover:bg-surface-tertiary min-w-0 flex shrink-0 items-center text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-secondary';
  const rowButtonClass = cn(rowButtonBaseClass, 'gap-3 px-3 w-full');

  const hubIconTabClass = (active: boolean) =>
    cn(
      'no-drag h-8 w-full min-w-0 rounded-xl bg-surface-primary',
      'hover:bg-surface-tertiary flex cursor-pointer items-center justify-center transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-secondary',
      active && 'bg-surface-tertiary'
    );

  /** Hub tile shell without whole-area hover (split controls handle their own hover). */
  const hubIconTabShellClass = (active: boolean) =>
    cn(
      'no-drag w-full min-w-0 rounded-xl bg-surface-primary transition-colors',
      active && 'bg-surface-tertiary'
    );

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
            {!collapsed ? (
              <div className="min-w-0 flex items-stretch">
                <div
                  className={cn(
                    hubIconTabShellClass(historySidebarOpen),
                    'h-8 min-h-8 min-w-0 flex flex-1 flex-row overflow-hidden'
                  )}
                >
                  <TooltipSimple
                    content={t('layout.collapse-sidebar', {
                      defaultValue: 'Collapse sidebar',
                    })}
                    side="bottom"
                    align="start"
                  >
                    <button
                      type="button"
                      className={cn(
                        'no-drag min-h-0 w-10 flex h-full shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent transition-colors',
                        historySidebarOpen
                          ? 'hover:brightness-[0.98]'
                          : 'hover:bg-surface-tertiary',
                        'focus-visible:ring-border-secondary focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none'
                      )}
                      onClick={toggleProjectSidebarCollapsed}
                      aria-label={t('layout.collapse-sidebar', {
                        defaultValue: 'Collapse sidebar',
                      })}
                    >
                      <PanelLeftClose
                        className="h-4 w-4 text-icon-primary shrink-0"
                        aria-hidden
                      />
                    </button>
                  </TooltipSimple>
                  <TooltipSimple
                    content={activeTaskTitle}
                    side="bottom"
                    align="center"
                  >
                    <button
                      id="sidebar-active-task-title-btn"
                      type="button"
                      className={cn(
                        'no-drag min-h-0 min-w-0 border-border-tertiary flex h-full flex-1 cursor-pointer items-center border-x border-t border-b-0 border-solid bg-transparent text-left transition-colors',
                        historySidebarOpen
                          ? 'hover:brightness-[0.98]'
                          : 'hover:bg-surface-tertiary',
                        'focus-visible:ring-border-secondary focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none'
                      )}
                      onClick={toggleHistorySidebar}
                      aria-expanded={historySidebarOpen}
                      aria-haspopup="dialog"
                    >
                      <span className="min-w-0 text-text-body text-body-sm font-bold flex-1 truncate">
                        {activeTaskTitle}
                      </span>
                    </button>
                  </TooltipSimple>
                  <TooltipSimple
                    content={t('layout.new-project')}
                    side="bottom"
                    align="end"
                  >
                    <button
                      type="button"
                      className={cn(
                        'no-drag w-10 flex h-full shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent transition-colors',
                        historySidebarOpen
                          ? 'hover:brightness-[0.98]'
                          : 'hover:bg-surface-tertiary',
                        'focus-visible:ring-border-secondary focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none'
                      )}
                      onClick={createNewProject}
                      aria-label={t('layout.new-project')}
                    >
                      <Plus
                        className="h-4 w-4 text-icon-primary shrink-0"
                        aria-hidden
                      />
                    </button>
                  </TooltipSimple>
                </div>
              </div>
            ) : (
              <TooltipSimple
                content={t('layout.expand-sidebar', {
                  defaultValue: 'Expand sidebar',
                })}
                side="right"
                align="center"
              >
                <button
                  type="button"
                  className={cn(
                    'no-drag h-8 min-h-8 rounded-xl flex w-full shrink-0 cursor-pointer items-center justify-start',
                    'hover:bg-surface-tertiary border-0 bg-transparent',
                    'focus-visible:ring-border-secondary focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none',
                    'px-3'
                  )}
                  onClick={toggleProjectSidebarCollapsed}
                  aria-label={t('layout.expand-sidebar', {
                    defaultValue: 'Expand sidebar',
                  })}
                >
                  <PanelLeft
                    className="h-4 w-4 text-icon-primary shrink-0"
                    aria-hidden
                  />
                </button>
              </TooltipSimple>
            )}

            <div className="gap-2 min-w-0 flex w-full flex-col">
              <TooltipSimple
                content={t('triggers.workspace')}
                side="right"
                align="center"
                enabled={collapsed}
              >
                <button
                  type="button"
                  onClick={() => setActiveWorkspaceTab('workforce')}
                  className={workspaceTabButtonClass(
                    activeWorkspaceTab === 'workforce'
                  )}
                  aria-label={t('triggers.workspace')}
                  aria-current={
                    activeWorkspaceTab === 'workforce' ? 'page' : undefined
                  }
                >
                  <LayoutGrid
                    className="h-4 w-4 text-icon-primary shrink-0"
                    aria-hidden
                  />
                  <span className={workspaceTabLabelClass}>
                    {t('triggers.workspace')}
                  </span>
                </button>
              </TooltipSimple>
              <TooltipSimple
                content={
                  collapsed
                    ? `${t('layout.folder')} · ${folderSettingTagLabel}`
                    : t('layout.folder')
                }
                side="right"
                align="center"
                enabled={collapsed}
              >
                <button
                  type="button"
                  onClick={() => setActiveWorkspaceTab('inbox')}
                  className={cn(
                    workspaceTabButtonClass(activeWorkspaceTab === 'inbox'),
                    'relative'
                  )}
                  aria-label={`${t('layout.folder')}, ${folderSettingTagLabel}`}
                  aria-current={
                    activeWorkspaceTab === 'inbox' ? 'page' : undefined
                  }
                >
                  <Inbox
                    className="h-4 w-4 text-icon-primary shrink-0"
                    aria-hidden
                  />
                  <span className={workspaceTabLabelClass}>
                    {t('layout.folder')}
                  </span>
                  {!collapsed && (
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
                  )}
                  {unviewedTabs.has('inbox') && (
                    <span
                      className={cn(
                        'bg-red-500 shrink-0 rounded-full transition-all duration-300',
                        collapsed ? 'top-1 right-1 h-2 w-2 absolute' : 'h-2 w-2'
                      )}
                      aria-hidden
                    />
                  )}
                </button>
              </TooltipSimple>
              <TooltipSimple
                content={triggersTabTooltip}
                side="right"
                align="center"
                enabled={collapsed}
              >
                <div
                  className={cn(
                    workspaceTabButtonClass(activeWorkspaceTab === 'triggers'),
                    'min-w-0 gap-0 !p-0 relative flex items-stretch overflow-visible'
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setActiveWorkspaceTab('triggers')}
                    className={cn(
                      'no-drag min-h-8 min-w-0 gap-3 rounded-xl py-0 pl-3 pr-1 relative flex flex-1 items-center text-left outline-none',
                      'focus-visible:ring-border-secondary hover:bg-transparent focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none'
                    )}
                    aria-label={triggersTabAriaLabel}
                    aria-current={
                      activeWorkspaceTab === 'triggers' ? 'page' : undefined
                    }
                  >
                    {triggersListenerConnected ? (
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
                    )}
                    <span className={workspaceTabLabelClass}>
                      {t('layout.triggers')}
                    </span>
                    {!collapsed && showTriggersDisconnectedTag && (
                      <span className="bg-surface-secondary text-text-error rounded-md px-1.5 font-medium leading-tight max-w-[5.5rem] shrink-0 truncate py-px text-[10px]">
                        {t('layout.triggers-disconnected')}
                      </span>
                    )}
                    {unviewedTabs.has('triggers') && (
                      <span
                        className={cn(
                          'bg-text-error shrink-0 rounded-full transition-all duration-300',
                          collapsed
                            ? 'top-1 right-1 h-2 w-2 absolute'
                            : 'h-2 w-2'
                        )}
                        aria-hidden
                      />
                    )}
                  </button>
                  {wsConnectionStatus !== 'connected' && !collapsed && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            'no-drag text-icon-secondary hover:bg-surface-tertiary h-8 w-8 rounded-xl flex shrink-0 items-center justify-center transition-colors outline-none',
                            'focus-visible:ring-border-secondary focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none'
                          )}
                          aria-label={t('layout.triggers-reconnect-hint')}
                        >
                          <RefreshCw
                            className={cn(
                              'h-3.5 w-3.5',
                              wsConnectionStatus === 'connecting' &&
                                'animate-spin'
                            )}
                            aria-hidden
                          />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        className="w-64 p-4"
                        side="right"
                        align="start"
                      >
                        <div className="gap-3 flex flex-col">
                          <p className="text-body-sm text-text-body">
                            {t('layout.triggers-reconnect-hint')}
                          </p>
                          <Button
                            variant="primary"
                            size="sm"
                            className="w-full items-center justify-center"
                            onClick={triggerReconnect}
                          >
                            <RefreshCw
                              className={cn(
                                'mr-2 h-4 w-4',
                                wsConnectionStatus === 'connecting' &&
                                  'animate-spin'
                              )}
                              aria-hidden
                            />
                            {t('layout.triggers-listener-reconnect')}
                          </Button>
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              </TooltipSimple>
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

          {/* Task List */}
          <div
            className={cn(
              'min-h-0 min-w-0 flex w-full flex-col overflow-hidden',
              collapsed
                ? 'max-h-0 pointer-events-none flex-none'
                : 'min-h-0 flex-1'
            )}
            style={{ minHeight: 0 }}
          >
            <div
              className={cn(
                'gap-2 pl-3 pr-1.5 pb-1.5 pt-0 flex w-full shrink-0 items-center justify-between',
                collapsed && 'hidden'
              )}
            >
              <span className="text-text-label min-w-0 text-xs font-semibold truncate">
                {t('layout.task-list-title', { defaultValue: 'Tasks' })}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                buttonContent="icon-only"
                className="text-icon-primary shrink-0"
                aria-label={t('layout.task-list-add-hint', {
                  defaultValue: 'Open workspace and focus chat',
                })}
                onClick={() => requestWorkspaceChatFocus()}
              >
                <SquarePen className="size-3.5" aria-hidden />
              </Button>
            </div>
            <div className="min-h-0 min-w-0 w-full flex-1 overflow-x-hidden overflow-y-auto">
              {allTaskEntries.length === 0 ? (
                <p className="text-text-label px-3 text-xs w-full">
                  {t('layout.no-tasks', { defaultValue: 'No tasks' })}
                </p>
              ) : (
                <div className="gap-2 min-w-0 flex w-full flex-col">
                  {allTaskEntries.map(
                    ({ chatId, taskId, task, firstUserMessageId }) => (
                      <ProjectSidebarTaskListRow
                        key={`${chatId}-${taskId}`}
                        task={task}
                        firstUserMessageId={firstUserMessageId}
                        active={chatStore.activeTaskId === taskId}
                        setScrollToQueryId={setScrollToQueryId}
                      />
                    )
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Bottom section - Profile and Help */}
          <div className="border-border-secondary pt-2 mt-auto w-full shrink-0 border-t">
            <div
              className={cn(
                'min-w-0 gap-1 grid w-full overflow-hidden',
                collapsed
                  ? 'grid-cols-1'
                  : 'grid-cols-[minmax(0,3fr)_minmax(0,1fr)]'
              )}
            >
              <div
                className={cn(
                  'min-h-0 min-w-0 overflow-hidden',
                  collapsed &&
                    'max-h-0 pointer-events-none overflow-hidden opacity-0'
                )}
              >
                <button
                  type="button"
                  onClick={() => navigate('/history?tab=agents&section=models')}
                  title={`${modelModeLine}\n${modelDetailLine}`}
                  className={cn(
                    rowButtonClass,
                    'bg-surface-primary w-full',
                    'focus-visible:ring-border-secondary focus-visible:ring-2 focus-visible:outline-none'
                  )}
                  aria-label={t('setting.models')}
                >
                  <span
                    className="h-7 w-7 flex shrink-0 items-center justify-center"
                    aria-hidden
                  >
                    <img
                      src={folderIcon}
                      alt=""
                      className="h-7 w-7 mt-1 shrink-0 object-contain"
                      draggable={false}
                    />
                  </span>
                  <div className="min-w-0 flex flex-1 flex-col justify-center leading-none">
                    <div className="bg-surface-information rounded-md px-1 w-fit">
                      <span className="text-text-information text-label-xs font-semibold leading-tight truncate text-nowrap">
                        {modelModeLine}
                      </span>
                    </div>
                    <span className="text-text-secondary leading-tight px-1 truncate text-[10px]">
                      {modelDetailLine}
                    </span>
                  </div>
                </button>
              </div>
              <div className="min-h-0 min-w-0 flex w-full">
                <DropdownMenu
                  open={helpMenuOpen}
                  onOpenChange={setHelpMenuOpen}
                >
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        hubIconTabClass(helpMenuOpen),
                        collapsed && 'px-3 justify-start'
                      )}
                      aria-label={t('layout.help-and-support', {
                        defaultValue: 'Help and support',
                      })}
                      aria-haspopup="menu"
                    >
                      <CircleHelp
                        className="h-4 w-4 text-icon-primary shrink-0"
                        aria-hidden
                      />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    side="right"
                    align="end"
                    sideOffset={8}
                    alignOffset={8}
                    className={PROJECT_HUB_DROPDOWN_CONTENT_CLASS}
                    style={PROJECT_HUB_DROPDOWN_CONTENT_STYLE}
                  >
                    <DropdownMenuItem
                      className={PROJECT_HUB_DROPDOWN_ITEM_CLASS}
                      onSelect={() => setSupportDialogOpen(true)}
                    >
                      {t('layout.contact-support')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className={PROJECT_HUB_DROPDOWN_ITEM_CLASS}
                      onSelect={() => {
                        void reportBugOpenGithub();
                      }}
                    >
                      {t('layout.report-bug')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className={PROJECT_HUB_DROPDOWN_ITEM_CLASS}
                      onSelect={() => {
                        void downloadLogs();
                      }}
                    >
                      {t('layout.download-logs', {
                        defaultValue: 'Download logs',
                      })}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </div>
      </motion.aside>
    </>
  );
}
