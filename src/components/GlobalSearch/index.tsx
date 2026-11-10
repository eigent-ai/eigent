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

import { useHomeHubProjects } from '@/components/Home/hooks/useHomeHubProjects';
import { useHomeHubTriggers } from '@/components/Home/hooks/useHomeHubTriggers';
import { useAppCommand } from '@/components/Layout/AppCommandProvider';
import { getChoosableSpaces } from '@/components/Layout/AppRail/pinnedSpaces';
import { SpaceGlyph } from '@/components/SpaceSidebar/SpaceGlyph';
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { DsIcon } from '@/components/ui/ds-icon';
import { useDesktopShortcutPlatform } from '@/hooks/useDesktopShortcutPlatform';
import { useSpaceSwitch } from '@/hooks/useSpaceSwitch';
import { useHost } from '@/host';
import { parseServerTimestamp } from '@/lib/serverTimestamp';
import { openSessionInShell, shouldListSession } from '@/lib/sessionOpen';
import { spaceEmoji } from '@/lib/spaceEmoji';
import {
  getActiveSpaceTriggerLabel,
  getSessionMetaDisplayName,
} from '@/lib/spaceLabel';
import { AUTOMATION_ICON } from '@/lib/triggerIcon';
import { cn } from '@/lib/utils';
import { runAfterWorkspaceConfigurationSave } from '@/lib/workspaceConfigurationNavigationGuard';
import { APP_COMMAND } from '@/shared/appCommands';
import { getKeyboardShortcutById } from '@/shared/keyboardShortcuts';
import { useAuthStore } from '@/store/authStore';
import { usePageTabStore, WorkspaceTab } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSettingsStore } from '@/store/settingsStore';
import {
  getVisibleProjectMetasForSpace,
  useSpaceStore,
} from '@/store/spaceStore';
import { useTriggerStore } from '@/store/triggerStore';
import { Command as CommandPrimitive } from 'cmdk';
import {
  Cast,
  File,
  ListChecks,
  MessageCircle,
  Plus,
  Search,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useGlobalSearchStore } from './globalSearchStore';
import {
  GLOBAL_SEARCH_TYPES,
  searchGlobalItems,
  stepGlobalSearchType,
  type GlobalSearchItem,
  type GlobalSearchItemType,
  type GlobalSearchType,
} from './searchModel';

const TYPE_LABEL_KEYS: Record<GlobalSearchType, string> = {
  all: 'layout.global-search-all',
  spaces: 'layout.spaces',
  sessions: 'layout.sessions-heading',
  tasks: 'layout.tasks-heading',
  files: 'layout.files-tab',
  automations: 'layout.triggers',
  dispatch: 'layout.dispatch-tab',
};

const TYPE_ICONS: Record<
  Exclude<GlobalSearchItemType, 'spaces'>,
  LucideIcon
> = {
  sessions: MessageCircle,
  tasks: ListChecks,
  files: File,
  automations: AUTOMATION_ICON,
  dispatch: Cast,
};

const ITEM_TYPES = GLOBAL_SEARCH_TYPES.filter(
  (type): type is GlobalSearchItemType => type !== 'all'
);

const timeOf = (value?: string | null) => {
  const time = value ? parseServerTimestamp(value) : Number.NaN;
  return Number.isFinite(time) ? time : 0;
};

/** The active Session's files; other Sessions' files load when opened. */
function useActiveSessionFiles(): GlobalSearchItem[] {
  const ipcRenderer = useHost()?.ipcRenderer;
  const email = useAuthStore((state) => state.email);
  const userId = useAuthStore((state) => state.user_id);
  const activeProjectId = useProjectRuntimeStore(
    (state) => state.activeProjectId
  );
  const activeSpaceId = useSpaceStore((state) => state.activeSpaceId);
  const [files, setFiles] = useState<GlobalSearchItem[]>([]);

  useEffect(() => {
    // The last Session's files must not stand in while these load.
    setFiles((current) => (current.length > 0 ? [] : current));
    if (!ipcRenderer || !activeProjectId) return;
    let cancelled = false;
    void Promise.resolve(
      ipcRenderer.invoke(
        'get-project-file-list',
        email,
        activeProjectId,
        userId
      )
    )
      .then((list: unknown) => {
        if (cancelled || !Array.isArray(list)) return;
        setFiles(
          (list as { name: string; path: string; isFolder?: boolean }[])
            .filter((file) => !file.isFolder)
            .map((file) => ({
              id: `file:${file.path}`,
              type: 'files',
              title: file.name,
              time: 0,
              spaceId: activeSpaceId ?? undefined,
              projectId: activeProjectId,
            }))
        );
      })
      .catch((error: unknown) => {
        console.warn('[GlobalSearch] Failed to read Session files:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, activeSpaceId, email, ipcRenderer, userId]);

  return activeProjectId ? files : [];
}

function useSearchItems(): GlobalSearchItem[] {
  const { t } = useTranslation();
  const { projects } = useHomeHubProjects();
  const { triggers } = useHomeHubTriggers();
  const spaces = useSpaceStore((state) => state.spaces);
  const projectsBySpaceId = useSpaceStore((state) => state.projectsBySpaceId);
  const projectIdIndex = useSpaceStore((state) => state.projectIdIndex);
  const activeSpaceId = useSpaceStore((state) => state.activeSpaceId);
  const dispatchLinks = useTriggerStore(
    (state) => state.activeRemoteControlSessions
  );
  const files = useActiveSessionFiles();

  return useMemo(() => {
    const spaceName = (spaceId?: string) =>
      spaceId && spaces[spaceId]
        ? getActiveSpaceTriggerLabel(spaces[spaceId].name, t)
        : undefined;
    const items: GlobalSearchItem[] = [];

    for (const space of getChoosableSpaces(
      spaces,
      projectsBySpaceId,
      activeSpaceId
    )) {
      items.push({
        id: `space:${space.id}`,
        type: 'spaces',
        title: getActiveSpaceTriggerLabel(space.name, t),
        time: space.updatedAt,
        spaceId: space.id,
        emoji: spaceEmoji(space),
      });
      for (const session of getVisibleProjectMetasForSpace(
        projectsBySpaceId,
        space.id
      ).filter(shouldListSession)) {
        items.push({
          id: `session:${session.id}`,
          type: 'sessions',
          title: getSessionMetaDisplayName(session, t),
          detail: spaceName(space.id),
          time: session.updatedAt,
          spaceId: space.id,
          projectId: session.id,
        });
      }
    }

    for (const project of projects) {
      const spaceId = projectIdIndex[project.project_id] ?? project.space_id;
      if (!spaceId || !spaces[spaceId]) continue;
      for (const task of project.tasks ?? []) {
        if (!task.question?.trim()) continue;
        items.push({
          id: `task:${project.project_id}:${task.task_id}`,
          type: 'tasks',
          title: task.question.trim(),
          detail: spaceName(spaceId),
          time: timeOf(project.latest_task_date),
          spaceId,
          projectId: project.project_id,
        });
      }
    }

    for (const trigger of triggers) {
      const spaceId =
        trigger.space_id ??
        (trigger.project_id ? projectIdIndex[trigger.project_id] : undefined);
      items.push({
        id: `automation:${trigger.id}`,
        type: 'automations',
        title: trigger.name,
        detail: spaceName(spaceId),
        time: 0,
        spaceId,
        projectId: trigger.project_id,
        triggerId: trigger.id,
      });
    }

    for (const link of dispatchLinks) {
      items.push({
        id: `dispatch:${link.sessionId}`,
        type: 'dispatch',
        title: link.title,
        time: 0,
        spaceId: activeSpaceId ?? undefined,
      });
    }

    return [...items, ...files];
  }, [
    activeSpaceId,
    dispatchLinks,
    files,
    projectIdIndex,
    projects,
    projectsBySpaceId,
    spaces,
    t,
    triggers,
  ]);
}

/** Opens what a result points at, staying in Home or the Space view. */
function useOpenSearchItem() {
  const navigate = useNavigate();
  const location = useLocation();
  const executeAppCommand = useAppCommand();
  const closeSettings = useSettingsStore((state) => state.closeSettings);
  const { openSpaceView, switchToSpace } = useSpaceSwitch();

  return useCallback(
    (item: GlobalSearchItem) => {
      if (item.type === 'spaces') {
        if (item.spaceId) openSpaceView(item.spaceId);
        return;
      }
      void runAfterWorkspaceConfigurationSave(async () => {
        const pages = usePageTabStore.getState();
        if (
          item.spaceId &&
          item.spaceId !== useSpaceStore.getState().activeSpaceId
        ) {
          const switched = await switchToSpace(item.spaceId, {
            project: item.projectId ?? 'last',
            tab: null,
            hydrate: !(
              item.projectId &&
              (item.type === 'sessions' || item.type === 'tasks')
            ),
          });
          if (!switched) return;
        }
        closeSettings();
        if (location.pathname !== '/') navigate('/');
        if (item.type === 'sessions' || item.type === 'tasks') {
          if (item.projectId) await openSessionInShell(item.projectId);
        } else if (item.type === 'files') {
          executeAppCommand(APP_COMMAND.navigateFiles);
        } else if (item.type === 'automations') {
          pages.setActiveWorkspaceTab(WorkspaceTab.Triggers);
          if (item.triggerId != null)
            pages.requestSelectTrigger(item.triggerId);
        } else {
          pages.setActiveWorkspaceTab(WorkspaceTab.Dispatch);
        }
      });
    },
    [
      closeSettings,
      executeAppCommand,
      location.pathname,
      navigate,
      openSpaceView,
      switchToSpace,
    ]
  );
}

function ResultRow({
  item,
  onSelect,
}: {
  item: GlobalSearchItem;
  onSelect: (item: GlobalSearchItem) => void;
}) {
  return (
    <CommandItem
      value={item.id}
      onSelect={() => onSelect(item)}
      data-global-search-item={item.type}
      className="flex h-9 cursor-pointer items-center gap-ds-8 rounded-ds-menu-row px-ds-8"
    >
      {item.type === 'spaces' ? (
        <span
          aria-hidden
          className="flex size-ds-icon-md shrink-0 items-center justify-center rounded-ds-4 bg-ds-neutral-muted-default text-ds-ink-default-default"
        >
          <SpaceGlyph name={item.title} emoji={item.emoji ?? null} size="sm" />
        </span>
      ) : (
        <DsIcon
          icon={TYPE_ICONS[item.type]}
          className="shrink-0 text-ds-ink-muted-default"
          aria-hidden
        />
      )}
      <span className="min-w-0 flex-1 truncate text-ds-text-base text-ds-ink-default-default">
        {item.title}
      </span>
      {item.detail ? (
        <span className="max-w-40 shrink-0 truncate text-ds-text-meta text-ds-ink-muted-default">
          {item.detail}
        </span>
      ) : null}
    </CommandItem>
  );
}

function KeyHint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="flex items-center gap-ds-4">
      {label}
      {keys.map((key) => (
        <kbd
          key={key}
          className="rounded-ds-4 border border-x border-y border-solid border-ds-hairline-subtle-default px-ds-4 font-text text-ds-text-meta text-ds-ink-muted-default"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}

function GlobalSearchDialog() {
  const { t } = useTranslation();
  const setOpen = useGlobalSearchStore((state) => state.setOpen);
  const executeAppCommand = useAppCommand();
  const items = useSearchItems();
  const openItem = useOpenSearchItem();
  const [query, setQuery] = useState('');
  const [type, setType] = useState<GlobalSearchType>('all');
  const results = useMemo(
    () => searchGlobalItems(items, type, query),
    [items, query, type]
  );
  const searching = query.trim().length > 0;
  const showRecents = type === 'all' && !searching;

  const close = () => setOpen(false);
  const select = (item: GlobalSearchItem) => {
    close();
    openItem(item);
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const { selectionStart, selectionEnd, value } = event.currentTarget;
    const atEdge =
      selectionStart === selectionEnd &&
      (event.key === 'ArrowLeft'
        ? selectionStart === 0
        : selectionEnd === value.length);
    if (!atEdge) return;
    event.preventDefault();
    setType((current) =>
      stepGlobalSearchType(current, event.key === 'ArrowLeft' ? -1 : 1)
    );
  };

  const groupsForAll = ITEM_TYPES.flatMap((itemType) => {
    const rows = results.filter((item) => item.type === itemType);
    return rows.length > 0 ? [{ itemType, rows }] : [];
  });

  return (
    <Dialog open onOpenChange={(next) => !next && close()}>
      <DialogContent
        size="md"
        showCloseButton={false}
        className="overflow-hidden p-0"
        overlayClassName="backdrop-blur-none"
      >
        <DialogTitle className="sr-only">
          {t('layout.global-search')}
        </DialogTitle>
        <Command shouldFilter={false} className="bg-transparent">
          <div className="flex items-center gap-ds-8 px-ds-16 pt-ds-12">
            <CommandPrimitive.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              onKeyDown={onInputKeyDown}
              placeholder={t('layout.global-search')}
              className="h-ds-control-md min-w-0 flex-1 rounded-ds-compact-control border-0 border-x-0 border-y-0 bg-transparent text-ds-text-body-large text-ds-ink-default-default outline-none placeholder:text-ds-ink-subtle-default focus-visible:ring-2 focus-visible:ring-ds-ring-focus"
            />
            <button
              type="button"
              aria-label={t('layout.global-search-close')}
              onClick={close}
              className="flex size-ds-control-xs cursor-pointer items-center justify-center rounded-full border-0 border-x-0 border-y-0 bg-transparent text-ds-ink-muted-default outline-none hover:bg-ds-neutral-default-default focus-visible:ring-2 focus-visible:ring-ds-ring-focus"
            >
              <DsIcon icon={X} aria-hidden />
            </button>
          </div>
          <div
            role="group"
            aria-label={t('layout.global-search')}
            className="flex flex-wrap items-center gap-ds-2 border-x-0 border-t-0 border-b border-solid border-ds-hairline-subtle-default px-ds-12 py-ds-8"
          >
            {GLOBAL_SEARCH_TYPES.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={option === type}
                onClick={() => setType(option)}
                className={cn(
                  'h-ds-control-sm cursor-pointer rounded-ds-compact-control border-0 border-x-0 border-y-0 px-ds-8 text-ds-text-base text-ds-ink-default-default outline-none hover:bg-ds-neutral-default-default focus-visible:ring-2 focus-visible:ring-ds-ring-focus',
                  option === type
                    ? 'bg-ds-neutral-muted-default'
                    : 'bg-transparent'
                )}
              >
                {t(TYPE_LABEL_KEYS[option])}
              </button>
            ))}
          </div>
          <CommandList className="scrollbar-always-visible h-100 max-h-[60vh] overflow-y-auto p-ds-8">
            {results.length === 0 && !showRecents ? (
              <div className="px-ds-8 py-ds-16 text-center text-ds-text-base text-ds-ink-muted-default">
                {t('layout.search-no-results')}
              </div>
            ) : null}
            {showRecents ? (
              <>
                {results.length > 0 ? (
                  <CommandGroup heading={t('layout.global-search-recents')}>
                    {results.map((item) => (
                      <ResultRow key={item.id} item={item} onSelect={select} />
                    ))}
                  </CommandGroup>
                ) : null}
                <CommandGroup heading={t('layout.global-search-actions')}>
                  <CommandItem
                    value="action:new-session"
                    onSelect={() => {
                      close();
                      executeAppCommand(APP_COMMAND.newProject);
                    }}
                    className="flex h-9 cursor-pointer items-center gap-ds-8 rounded-ds-menu-row px-ds-8"
                  >
                    <DsIcon
                      icon={Plus}
                      className="shrink-0 text-ds-ink-muted-default"
                      aria-hidden
                    />
                    <span className="text-ds-text-base text-ds-ink-default-default">
                      {t('layout.new-project')}
                    </span>
                  </CommandItem>
                </CommandGroup>
              </>
            ) : type === 'all' ? (
              groupsForAll.map(({ itemType, rows }) => (
                <CommandGroup
                  key={itemType}
                  heading={t(TYPE_LABEL_KEYS[itemType])}
                >
                  {rows.map((item) => (
                    <ResultRow key={item.id} item={item} onSelect={select} />
                  ))}
                </CommandGroup>
              ))
            ) : (
              <CommandGroup>
                {results.map((item) => (
                  <ResultRow key={item.id} item={item} onSelect={select} />
                ))}
              </CommandGroup>
            )}
          </CommandList>
          <div className="flex items-center justify-between gap-ds-12 border-x-0 border-t border-b-0 border-solid border-ds-hairline-subtle-default px-ds-16 py-ds-8 text-ds-text-meta text-ds-ink-muted-default">
            <span className="flex items-center gap-ds-12">
              <KeyHint keys={['Esc']} label={t('layout.global-search-close')} />
              <KeyHint
                keys={['←', '→']}
                label={t('layout.global-search-change-type')}
              />
            </span>
            <KeyHint keys={['↵']} label={t('layout.global-search-open')} />
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

/** Mount once: ⌘K opens search, and the dialog loads its data while open. */
export function GlobalSearchHost({
  enabled = true,
}: {
  /** False while the install or onboarding screen covers the app. */
  enabled?: boolean;
} = {}): ReactNode {
  const open = useGlobalSearchStore((state) => state.open);
  const setOpen = useGlobalSearchStore((state) => state.setOpen);

  // The search button can still take focus behind the install screen, so
  // close whatever opens while search is off.
  useEffect(() => {
    if (!enabled && open) setOpen(false);
  }, [enabled, open, setOpen]);

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, setOpen]);

  return enabled && open ? <GlobalSearchDialog /> : null;
}

/** The top bar's search control, as wide as its content; opens the dialog. */
export function GlobalSearchButton() {
  const { t } = useTranslation();
  const setOpen = useGlobalSearchStore((state) => state.setOpen);
  const shortcut = getKeyboardShortcutById(
    useDesktopShortcutPlatform(),
    'global-search'
  );

  return (
    <button
      type="button"
      data-global-search-button
      onClick={() => setOpen(true)}
      className="no-drag ml-ds-8 flex h-7 w-fit max-w-full min-w-0 cursor-pointer items-center justify-start gap-ds-6 rounded-full border-0 border-x-0 border-y-0 bg-transparent px-ds-10 text-left text-ds-ink-muted-default transition-colors outline-none hover:bg-ds-neutral-subtle-default focus-visible:ring-2 focus-visible:ring-ds-ring-focus"
    >
      <DsIcon icon={Search} className="shrink-0" aria-hidden />
      <span className="min-w-0 truncate text-ds-text-base">
        {t('layout.global-search')}
      </span>
      {shortcut ? (
        <span className="shrink-0 text-ds-text-meta text-ds-ink-subtle-default">
          {shortcut.keys.join('')}
        </span>
      ) : null}
    </button>
  );
}
