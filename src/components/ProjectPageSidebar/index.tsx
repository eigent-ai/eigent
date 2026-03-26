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
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  getTaskListShelfTone,
  type TaskListShelfTone,
} from '@/lib/taskLifecycleUi';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import type { ChatStore } from '@/store/chatStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectStore } from '@/store/projectStore';
import { motion } from 'framer-motion';
import {
  CircleHelp,
  Compass,
  Hammer,
  House,
  Inbox,
  Search,
  WandSparkles,
  Zap,
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

const PROJECT_HUB_DROPDOWN_CONTENT_CLASS = cn(
  'min-w-[11rem] -mb-2 flex flex-col gap-3 rounded-xl border-0 bg-fill-default p-1 shadow-md'
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
/** Matches Home main panel layout animation */
const PROJECT_SIDEBAR_SPRING = {
  type: 'spring' as const,
  stiffness: 380,
  damping: 38,
  mass: 0.85,
};

const SIDEBAR_EDGE_MARGIN_PX = 8;

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
  const setScrollToQueryId = usePageTabStore((s) => s.setScrollToQueryId);
  const projectStore = useProjectStore();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [skillsMenuOpen, setSkillsMenuOpen] = useState(false);
  const [connectorsMenuOpen, setConnectorsMenuOpen] = useState(false);
  const [browserMenuOpen, setBrowserMenuOpen] = useState(false);
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);

  const {
    dashboardActive,
    skillsHubActive,
    connectorsHubActive,
    browserHubActive,
  } = useMemo(() => {
    const path = location.pathname.replace(/\/$/, '');
    const onHistory = path === '/history' || path.endsWith('/history');
    const params = new URLSearchParams(location.search);
    const rawTab = params.get('tab');
    const tab = rawTab ? (HISTORY_TAB_ALIASES[rawTab] ?? rawTab) : null;
    const section = params.get('section');
    return {
      dashboardActive: onHistory,
      skillsHubActive: onHistory && tab === 'agents' && section === 'skills',
      connectorsHubActive: onHistory && tab === 'connectors',
      browserHubActive: onHistory && tab === 'browser',
    };
  }, [location.pathname, location.search]);

  const activeUpdateCount = chatStore.updateCount;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectStore, activeUpdateCount]);

  const rowButtonClass =
    'no-drag h-8 rounded-xl hover:bg-surface-tertiary min-w-0 gap-3 px-3 w-full flex shrink-0 items-center text-left transition-colors';

  const hubIconTabClass = (active: boolean) =>
    cn(
      'no-drag h-8 w-full min-w-0 rounded-xl bg-surface-primary',
      'hover:bg-surface-tertiary flex cursor-pointer items-center justify-center transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-secondary',
      active && 'bg-surface-tertiary'
    );

  const authToken = useAuthStore((s) => s.token);
  const modelType = useAuthStore((s) => s.modelType);
  const cloud_model_type = useAuthStore((s) => s.cloud_model_type);

  const [credits, setCredits] = useState<number | null>(null);
  const [customPlatformName, setCustomPlatformName] = useState<string | null>(
    null
  );
  const [supportDialogOpen, setSupportDialogOpen] = useState(false);

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

  return (
    <>
      <GlobalSearchDialog
        open={globalSearchOpen}
        onOpenChange={setGlobalSearchOpen}
      />

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
          width: collapsed ? 0 : PROJECT_SIDEBAR_WIDTH_PX,
          marginRight: collapsed ? 0 : SIDEBAR_EDGE_MARGIN_PX,
        }}
        transition={PROJECT_SIDEBAR_SPRING}
        className={cn(
          'min-h-0 flex h-full shrink-0 flex-col overflow-hidden',
          className
        )}
        style={{ pointerEvents: collapsed ? 'none' : 'auto' }}
        aria-hidden={collapsed}
      >
        <motion.div
          className="min-h-0 flex h-full w-[240px] min-w-[240px] flex-col overflow-x-hidden"
          initial={false}
          animate={{
            x: collapsed ? -18 : 0,
            opacity: collapsed ? 0 : 1,
          }}
          transition={PROJECT_SIDEBAR_SPRING}
        >
          <div className="gap-2 flex shrink-0 flex-col">
            <button
              type="button"
              onClick={() => navigate('/history')}
              className={cn(
                rowButtonClass,
                'bg-surface-primary',
                dashboardActive && 'bg-surface-tertiary'
              )}
              aria-label={t('layout.dashboard')}
              aria-current={dashboardActive ? 'page' : undefined}
            >
              <House
                className="h-4 w-4 text-icon-primary shrink-0"
                aria-hidden
              />
              <span className="min-w-0 text-text-label text-body-sm font-medium flex-1 truncate">
                {t('layout.dashboard')}
              </span>
            </button>

            <div className="gap-1 grid w-full grid-cols-3">
              <DropdownMenu
                open={skillsMenuOpen}
                onOpenChange={setSkillsMenuOpen}
              >
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={hubIconTabClass(
                      skillsHubActive || skillsMenuOpen
                    )}
                    aria-label={t('agents.skills')}
                    aria-haspopup="menu"
                  >
                    <WandSparkles
                      className="h-4 w-4 text-icon-primary shrink-0"
                      aria-hidden
                    />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="right"
                  align="start"
                  sideOffset={8}
                  alignOffset={0}
                  className={PROJECT_HUB_DROPDOWN_CONTENT_CLASS}
                  style={PROJECT_HUB_DROPDOWN_CONTENT_STYLE}
                >
                  <DropdownMenuItem
                    className={PROJECT_HUB_DROPDOWN_ITEM_CLASS}
                    onSelect={() =>
                      navigate(
                        '/history?tab=agents&section=skills&skillAction=create'
                      )
                    }
                  >
                    {t('agents.create-skill')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={PROJECT_HUB_DROPDOWN_ITEM_CLASS}
                    onSelect={() =>
                      navigate(
                        '/history?tab=agents&section=skills&skillAction=upload'
                      )
                    }
                  >
                    {t('agents.upload-skill')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={PROJECT_HUB_DROPDOWN_ITEM_CLASS}
                    onSelect={() =>
                      navigate('/history?tab=agents&section=skills')
                    }
                  >
                    {t('agents.browse-skills')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu
                open={connectorsMenuOpen}
                onOpenChange={setConnectorsMenuOpen}
              >
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={hubIconTabClass(
                      connectorsHubActive || connectorsMenuOpen
                    )}
                    aria-label={t('layout.connectors')}
                    aria-haspopup="menu"
                  >
                    <Hammer
                      className="h-4 w-4 text-icon-primary shrink-0"
                      aria-hidden
                    />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="right"
                  align="start"
                  sideOffset={8}
                  alignOffset={0}
                  className={PROJECT_HUB_DROPDOWN_CONTENT_CLASS}
                  style={PROJECT_HUB_DROPDOWN_CONTENT_STYLE}
                >
                  <DropdownMenuItem
                    className={PROJECT_HUB_DROPDOWN_ITEM_CLASS}
                    onSelect={() =>
                      navigate('/history?tab=connectors&connectorAction=add')
                    }
                  >
                    {t('layout.add-new-mcp')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={PROJECT_HUB_DROPDOWN_ITEM_CLASS}
                    onSelect={() =>
                      navigate(
                        '/history?tab=connectors&connectorSection=mcp-tools'
                      )
                    }
                  >
                    {t('layout.browse-mcps')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu
                open={browserMenuOpen}
                onOpenChange={setBrowserMenuOpen}
              >
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={hubIconTabClass(
                      browserHubActive || browserMenuOpen
                    )}
                    aria-label={t('layout.browser')}
                    aria-haspopup="menu"
                  >
                    <Compass
                      className="h-4 w-4 text-icon-primary shrink-0"
                      aria-hidden
                    />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="right"
                  align="start"
                  sideOffset={8}
                  alignOffset={0}
                  className={PROJECT_HUB_DROPDOWN_CONTENT_CLASS}
                  style={PROJECT_HUB_DROPDOWN_CONTENT_STYLE}
                >
                  <DropdownMenuItem
                    className={PROJECT_HUB_DROPDOWN_ITEM_CLASS}
                    onSelect={() =>
                      navigate('/history?tab=browser&browserAction=launch')
                    }
                  >
                    {t('layout.open-new-browser')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={PROJECT_HUB_DROPDOWN_ITEM_CLASS}
                    onSelect={() =>
                      navigate('/history?tab=browser&browserSection=cdp')
                    }
                  >
                    {t('layout.browser-settings')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="gap-2 flex flex-col">
              <button
                type="button"
                onClick={() => setGlobalSearchOpen(true)}
                className={rowButtonClass}
                aria-label={t('dashboard.search')}
              >
                <Search
                  className="h-4 w-4 text-icon-primary shrink-0"
                  aria-hidden
                />
                <span className="min-w-0 text-text-label text-body-sm font-medium flex-1 truncate">
                  {t('layout.search')}
                </span>
              </button>
              <button
                type="button"
                disabled
                className={cn(
                  rowButtonClass,
                  'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50'
                )}
                aria-label={t('layout.folder')}
              >
                <Inbox
                  className="h-4 w-4 text-icon-primary shrink-0"
                  aria-hidden
                />
                <span className="min-w-0 text-text-label text-body-sm font-medium flex-1 truncate">
                  {t('layout.folder')}
                </span>
              </button>
              <button
                type="button"
                disabled
                className={cn(
                  rowButtonClass,
                  'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50'
                )}
                aria-label={t('layout.triggers')}
              >
                <Zap
                  className="h-4 w-4 text-icon-primary shrink-0"
                  aria-hidden
                />
                <span className="min-w-0 text-text-label text-body-sm font-medium flex-1 truncate">
                  {t('layout.triggers')}
                </span>
              </button>
            </div>
          </div>

          <div className="bg-surface-tertiary mx-2 my-2 rounded-xl h-[1.5px] flex-col overflow-hidden opacity-80"></div>

          <div className="min-h-0 flex flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
              {allTaskEntries.length === 0 ? (
                <p className="text-text-label text-xs px-3">
                  {t('layout.no-tasks', { defaultValue: 'No tasks' })}
                </p>
              ) : (
                <div className="gap-2 flex flex-col">
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

          <div className="border-border-secondary pt-2 mt-auto shrink-0 border-t">
            <div className="gap-1 grid grid-cols-4">
              <button
                type="button"
                onClick={() => navigate('/history?tab=settings')}
                title={`${modelModeLine}\n${modelDetailLine}`}
                className={cn(
                  rowButtonClass,
                  'h-12 min-h-12 bg-surface-primary col-span-3',
                  'focus-visible:ring-border-secondary focus-visible:ring-2 focus-visible:outline-none'
                )}
                aria-label={t('layout.settings')}
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
              <DropdownMenu open={helpMenuOpen} onOpenChange={setHelpMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      hubIconTabClass(helpMenuOpen),
                      'h-12 min-h-12'
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
        </motion.div>
      </motion.aside>
    </>
  );
}
