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

import { GlobalSearchDialog } from '@/components/GlobalSearch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TooltipSimple } from '@/components/ui/tooltip';
import {
  getTaskListShelfTone,
  type TaskListShelfTone,
} from '@/lib/taskLifecycleUi';
import { cn } from '@/lib/utils';
import type { ChatStore } from '@/store/chatStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectStore } from '@/store/projectStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { motion } from 'framer-motion';
import {
  ChevronRight,
  Compass,
  Files,
  Hammer,
  Search,
  Sparkles,
} from 'lucide-react';
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

/** Match History.tsx tab normalization for sidebar “active hub” styling */
const HISTORY_TAB_ALIASES: Record<string, string> = {
  mcp_tools: 'connectors',
};

const PROJECT_HUB_DROPDOWN_CONTENT_CLASS = cn(
  'min-w-[11rem] -mb-2 flex flex-col gap-1 rounded-xl border-0 bg-fill-default p-1 shadow-md'
);

const PROJECT_HUB_DROPDOWN_CONTENT_STYLE: CSSProperties = {
  border: 'none',
  borderRadius: 'var(--borderRadius-rounded-xl, 12px)',
  background: 'var(--fill-default, #FFF)',
};

const PROJECT_HUB_DROPDOWN_ITEM_CLASS = cn(
  'flex h-9 min-h-9 w-full shrink-0 cursor-pointer select-none items-center rounded-xl px-2.5 py-0 text-body-sm font-medium text-text-label outline-none',
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

/** Collapsed rail width = icon square (Tailwind `h-9` / `w-9` = 36px) */
const PROJECT_SIDEBAR_COLLAPSED_PX = 36;
const PROJECT_SIDEBAR_EXPANDED_PX = 240;

const projectSidebarWidthSpring = {
  type: 'spring' as const,
  stiffness: 260,
  damping: 28,
  mass: 1,
};

const sidebarTextEase: [number, number, number, number] = [0.4, 0, 0.2, 1];

function expandableTextTransition(expanded: boolean) {
  return {
    opacity: {
      duration: 0.28,
      ease: sidebarTextEase,
      delay: expanded ? 0.08 : 0,
    },
    maxWidth: {
      type: 'spring' as const,
      stiffness: 380,
      damping: 36,
      mass: 0.9,
      delay: expanded ? 0.03 : 0,
    },
  };
}

function SidebarExpandableLabel({
  expanded,
  className,
  children,
}: {
  expanded: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <motion.span
      className={cn('min-w-0 overflow-hidden', expanded && 'flex-1', className)}
      initial={false}
      animate={{
        opacity: expanded ? 1 : 0,
        maxWidth: expanded ? 280 : 0,
      }}
      transition={expandableTextTransition(expanded)}
      style={{ whiteSpace: 'nowrap' }}
      aria-hidden={!expanded}
    >
      {children}
    </motion.span>
  );
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
    // Color on wrapper: twMerge drops `text-text-label` when merged with `text-body-sm` on the same node.
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
  expanded,
  task,
  firstUserMessageId,
  active,
  setScrollToQueryId,
}: {
  expanded: boolean;
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
        'no-drag h-9 rounded-xl min-w-0 gap-2 px-2.5 relative flex w-full max-w-full shrink-0 cursor-pointer items-center text-left transition-colors',
        SHELF_TONE_ROW_CLASS[shelfTone]
      )}
      aria-current={active ? 'true' : undefined}
    >
      <SidebarExpandableLabel expanded={expanded}>
        <TaskQueryScrollLabel queryLabel={queryLabel} rowHovered={rowHovered} />
      </SidebarExpandableLabel>
    </button>
  );
}

function SidebarExpandableRow({
  expanded,
  children,
}: {
  expanded: boolean;
  children: ReactNode;
}) {
  return (
    <motion.div
      className={cn(
        'min-w-0 gap-2 flex items-center overflow-hidden',
        expanded && 'flex-1'
      )}
      initial={false}
      animate={{
        opacity: expanded ? 1 : 0,
        maxWidth: expanded ? 560 : 0,
      }}
      transition={expandableTextTransition(expanded)}
      aria-hidden={!expanded}
      style={{ pointerEvents: expanded ? 'auto' : 'none' }}
    >
      {children}
    </motion.div>
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
  const historySidebarOpen = useSidebarStore((s) => s.isOpen);
  const toggle = useSidebarStore((s) => s.toggle);
  const projectStore = useProjectStore();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [skillsMenuOpen, setSkillsMenuOpen] = useState(false);
  const [connectorsMenuOpen, setConnectorsMenuOpen] = useState(false);
  const [browserMenuOpen, setBrowserMenuOpen] = useState(false);

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

  const summaryTask =
    chatStore.tasks[chatStore.activeTaskId as string]?.summaryTask;

  const activeTaskTitle = useMemo(() => {
    if (chatStore.activeTaskId && summaryTask) {
      return summaryTask.split('|')[0];
    }
    return t('layout.new-project');
  }, [chatStore.activeTaskId, summaryTask, t]);

  // Signal to recompute when the active chatStore mutates
  const activeUpdateCount = chatStore.updateCount;

  /** Collect tasks from ALL chatStores in the active project so follow-up tasks appear in the sidebar. */
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

  const expanded = !collapsed;

  return (
    <motion.aside
      initial={false}
      animate={{
        width: collapsed
          ? PROJECT_SIDEBAR_COLLAPSED_PX
          : PROJECT_SIDEBAR_EXPANDED_PX,
      }}
      transition={projectSidebarWidthSpring}
      className={cn(
        'min-h-0 mr-2 flex h-full shrink-0 flex-col overflow-x-hidden',
        className
      )}
    >
      <div className="bg-surface-primary mx-2 mb-1 rounded-xl h-[1.5px] flex-col overflow-hidden opacity-50"></div>
      <div className="gap-1 flex shrink-0 flex-col">
        <TooltipSimple
          content={activeTaskTitle}
          side="right"
          enabled={collapsed}
        >
          <button
            id="active-task-title-btn"
            type="button"
            onClick={toggle}
            className={cn(
              'no-drag rounded-xl h-9 flex shrink-0 cursor-pointer items-center text-left transition-colors duration-300',
              historySidebarOpen
                ? 'bg-surface-tertiary'
                : SHELF_TONE_ROW_CLASS.default,
              collapsed
                ? 'w-9 gap-0 px-2.5 justify-center'
                : 'min-w-0 gap-2 px-2.5 w-full'
            )}
            aria-expanded={historySidebarOpen}
            aria-haspopup="dialog"
          >
            <Sparkles
              className="h-4 w-4 text-icon-information shrink-0"
              aria-hidden
            />
            <SidebarExpandableRow expanded={expanded}>
              <span className="text-text-body min-w-0 text-body-sm font-bold flex-1 truncate">
                {activeTaskTitle}
              </span>
              <ChevronRight
                className="h-4 w-4 text-icon-label shrink-0"
                aria-hidden
              />
            </SidebarExpandableRow>
          </button>
        </TooltipSimple>

        <TooltipSimple
          content={t('dashboard.search')}
          side="right"
          enabled={collapsed}
        >
          <button
            type="button"
            onClick={() => setGlobalSearchOpen(true)}
            className={cn(
              'no-drag h-9 rounded-xl hover:bg-surface-tertiary flex shrink-0 items-center text-left transition-colors',
              collapsed
                ? 'w-9 gap-0 px-2.5 justify-center'
                : 'min-w-0 gap-2 px-2.5 w-full'
            )}
            aria-label={t('dashboard.search')}
          >
            <Search
              className="h-4 w-4 text-icon-primary shrink-0"
              aria-hidden
            />
            <SidebarExpandableLabel expanded={expanded}>
              <span className="min-w-0 text-text-label text-body-sm font-medium block truncate">
                {t('layout.search')}
              </span>
            </SidebarExpandableLabel>
          </button>
        </TooltipSimple>
      </div>

      <GlobalSearchDialog
        open={globalSearchOpen}
        onOpenChange={setGlobalSearchOpen}
      />

      {!collapsed && (
        <div className="min-h-0 my-2 border-border-secondary flex flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
            {allTaskEntries.length === 0 ? (
              <p className="text-text-label text-xs px-2.5">
                {t('layout.no-tasks', { defaultValue: 'No tasks' })}
              </p>
            ) : (
              <div className="gap-1 flex flex-col">
                {allTaskEntries.map(
                  ({ chatId, taskId, task, firstUserMessageId }) => (
                    <ProjectSidebarTaskListRow
                      key={`${chatId}-${taskId}`}
                      expanded={expanded}
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
      )}

      <div className="gap-1 mt-auto flex w-full shrink-0 flex-col">
        <DropdownMenu open={skillsMenuOpen} onOpenChange={setSkillsMenuOpen}>
          <TooltipSimple
            content={t('agents.skills')}
            side="right"
            enabled={collapsed}
          >
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  'no-drag h-9 rounded-xl hover:bg-surface-tertiary flex shrink-0 items-center text-left transition-colors',
                  (skillsHubActive || skillsMenuOpen) && 'bg-surface-tertiary',
                  collapsed
                    ? 'w-9 gap-0 px-2.5 justify-center'
                    : 'min-w-0 gap-2 px-2.5 w-full'
                )}
                aria-label={t('agents.skills')}
                aria-haspopup="menu"
              >
                <Files
                  className="h-4 w-4 text-icon-primary shrink-0"
                  aria-hidden
                />
                <SidebarExpandableRow expanded={expanded}>
                  <span className="text-text-label min-w-0 text-body-sm font-medium flex-1 truncate">
                    {t('agents.skills')}
                  </span>
                  <ChevronRight
                    className="h-4 w-4 text-icon-label shrink-0"
                    aria-hidden
                  />
                </SidebarExpandableRow>
              </button>
            </DropdownMenuTrigger>
          </TooltipSimple>
          <DropdownMenuContent
            side="right"
            align="end"
            sideOffset={8}
            alignOffset={4}
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
              onSelect={() => navigate('/history?tab=agents&section=skills')}
            >
              {t('agents.browse-skills')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu
          open={connectorsMenuOpen}
          onOpenChange={setConnectorsMenuOpen}
        >
          <TooltipSimple
            content={t('layout.connectors')}
            side="right"
            enabled={collapsed}
          >
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  'no-drag h-9 rounded-xl hover:bg-surface-tertiary flex shrink-0 items-center text-left transition-colors',
                  (connectorsHubActive || connectorsMenuOpen) &&
                    'bg-surface-tertiary',
                  collapsed
                    ? 'w-9 gap-0 px-2.5 justify-center'
                    : 'min-w-0 gap-2 px-2.5 w-full'
                )}
                aria-label={t('layout.connectors')}
                aria-haspopup="menu"
              >
                <Hammer
                  className="h-4 w-4 text-icon-primary shrink-0"
                  aria-hidden
                />
                <SidebarExpandableRow expanded={expanded}>
                  <span className="text-text-label min-w-0 text-body-sm font-medium flex-1 truncate">
                    {t('layout.connectors')}
                  </span>
                  <ChevronRight
                    className="h-4 w-4 text-icon-label shrink-0"
                    aria-hidden
                  />
                </SidebarExpandableRow>
              </button>
            </DropdownMenuTrigger>
          </TooltipSimple>
          <DropdownMenuContent
            side="right"
            align="end"
            sideOffset={8}
            alignOffset={4}
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
                navigate('/history?tab=connectors&connectorSection=mcp-tools')
              }
            >
              {t('layout.browse-mcps')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu open={browserMenuOpen} onOpenChange={setBrowserMenuOpen}>
          <TooltipSimple
            content={t('layout.browser')}
            side="right"
            enabled={collapsed}
          >
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  'no-drag h-9 rounded-xl hover:bg-surface-tertiary flex shrink-0 items-center text-left transition-colors',
                  (browserHubActive || browserMenuOpen) &&
                    'bg-surface-tertiary',
                  collapsed
                    ? 'w-9 gap-0 px-2.5 justify-center'
                    : 'min-w-0 gap-2 px-2.5 w-full'
                )}
                aria-label={t('layout.browser')}
                aria-haspopup="menu"
              >
                <Compass
                  className="h-4 w-4 text-icon-primary shrink-0"
                  aria-hidden
                />
                <SidebarExpandableRow expanded={expanded}>
                  <span className="text-text-label min-w-0 text-body-sm font-medium flex-1 truncate">
                    {t('layout.browser')}
                  </span>
                  <ChevronRight
                    className="h-4 w-4 text-icon-label shrink-0"
                    aria-hidden
                  />
                </SidebarExpandableRow>
              </button>
            </DropdownMenuTrigger>
          </TooltipSimple>
          <DropdownMenuContent
            side="right"
            align="end"
            sideOffset={8}
            alignOffset={4}
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
    </motion.aside>
  );
}
