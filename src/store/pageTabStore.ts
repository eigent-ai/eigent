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

import { canonicalizeBrowserUrl, normalizeBrowserUrl } from '@/lib/browserUrl';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Identifiers for the right-pane tabs in the workspace shell. Centralized so
 * typos surface as TypeScript errors at call sites that previously passed
 * raw string literals.
 */
export const WorkspaceTab = {
  Workforce: 'workforce',
  Inbox: 'inbox',
  Triggers: 'triggers',
  Runs: 'runs',
  Project: 'project',
  Dispatch: 'dispatch',
  NewProject: 'new-project',
} as const;

export type WorkspaceTabId = (typeof WorkspaceTab)[keyof typeof WorkspaceTab];

export interface SessionBrowserNavigationState {
  url: string;
  title: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface SessionBrowserTab {
  id: string;
  type: 'browser';
  title: string;
  url: string;
  webviewId: string;
  navigation: SessionBrowserNavigationState;
}

export interface SessionFileTab {
  id: string;
  type: 'file';
  title: string;
  file: FileInfo | null;
}

/** Blank starter tab that lets the user pick which content type to open. */
export interface SessionChooserTab {
  id: string;
  type: 'chooser';
  title: string;
}

/** Code/diff review surface (content wired up later). */
export interface SessionReviewTab {
  id: string;
  type: 'review';
  title: string;
}

export interface SessionTerminalTab {
  id: string;
  type: 'terminal';
  title: string;
}

/** Free-form React Flow canvas. */
export interface SessionCanvasTab {
  id: string;
  type: 'canvas';
  title: string;
}

export type SessionPreviewTab =
  | SessionChooserTab
  | SessionBrowserTab
  | SessionFileTab
  | SessionReviewTab
  | SessionTerminalTab
  | SessionCanvasTab;

/**
 * Content types the chooser can open. `chooser` is intentionally excluded —
 * it is the picker itself, not a destination.
 */
export type PreviewTabKind = Exclude<SessionPreviewTab['type'], 'chooser'>;

export interface PreviewBrowserViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Per-project preview panel state. Keyed by project id so switching sessions
 * restores the tabs (and, within an app run, the live webviews behind them).
 */
export interface SessionPreviewSlice {
  open: boolean;
  tabs: SessionPreviewTab[];
  activeTabId: string | null;
}

const EMPTY_SESSION_PREVIEW: SessionPreviewSlice = {
  open: false,
  tabs: [],
  activeTabId: null,
};

/**
 * The preview slice for the currently scoped project. The per-project record
 * is the single source of truth; components derive their view through this
 * selector (e.g. `usePageTabStore((s) => getSessionPreviewSlice(s).tabs)`)
 * instead of reading mirrored flat fields, so state can never drift.
 */
export function getSessionPreviewSlice(state: {
  sessionPreviewProjectId: string | null;
  sessionPreviewByProject: Record<string, SessionPreviewSlice>;
}): SessionPreviewSlice {
  const projectId = state.sessionPreviewProjectId;
  return (
    (projectId ? state.sessionPreviewByProject[projectId] : undefined) ??
    EMPTY_SESSION_PREVIEW
  );
}

let sessionPreviewTabSequence = 0;
// Random per-run seed so ids never collide with tabs restored from persistence.
const sessionPreviewTabIdSeed = Math.random().toString(36).slice(2, 8);

function nextSessionPreviewTabId(type: SessionPreviewTab['type']): string {
  sessionPreviewTabSequence += 1;
  return `${type}-${sessionPreviewTabIdSeed}-${sessionPreviewTabSequence}`;
}

function createBrowserPreviewTab(projectId: string | null): SessionBrowserTab {
  const id = nextSessionPreviewTabId('browser');
  return {
    id,
    type: 'browser',
    title: 'New tab',
    url: '',
    // Project-scoped so each session keeps its own native webviews (and their
    // navigation history) alive while the app runs.
    webviewId: `session-preview:${projectId ?? 'global'}:${id}`,
    navigation: {
      url: '',
      title: '',
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
    },
  };
}

function createFilePreviewTab(file: FileInfo | null = null): SessionFileTab {
  return {
    id: nextSessionPreviewTabId('file'),
    type: 'file',
    title: file?.name || 'Open file',
    file,
  };
}

function createChooserPreviewTab(): SessionChooserTab {
  return {
    id: nextSessionPreviewTabId('chooser'),
    type: 'chooser',
    title: 'New tab',
  };
}

/** Placeholder tab title for a URL until the page reports its real one. */
function browserTabTitleForUrl(url: string): string {
  try {
    return new URL(url).hostname || 'New tab';
  } catch {
    return 'New tab';
  }
}

/** Build a fresh tab of the requested kind. Browser tabs need the project id. */
function createPreviewTabOfKind(
  kind: PreviewTabKind,
  projectId: string | null
): SessionPreviewTab {
  switch (kind) {
    case 'browser':
      return createBrowserPreviewTab(projectId);
    case 'file':
      return createFilePreviewTab();
    case 'review':
      return {
        id: nextSessionPreviewTabId('review'),
        type: 'review',
        title: 'Review',
      };
    case 'terminal':
      return {
        id: nextSessionPreviewTabId('terminal'),
        type: 'terminal',
        title: 'Terminal',
      };
    case 'canvas':
      return {
        id: nextSessionPreviewTabId('canvas'),
        type: 'canvas',
        title: 'Canvas',
      };
  }
}

function createInitialSessionPreviewTabs(): {
  tabs: SessionPreviewTab[];
  activeTabId: string;
} {
  // Open onto the chooser so the user picks what the first tab becomes.
  const chooser = createChooserPreviewTab();
  return { tabs: [chooser], activeTabId: chooser.id };
}

/**
 * Strip runtime-only navigation state before persisting: after an app restart
 * the native webview (and its history) is gone, so only url/title survive.
 */
function sanitizeSessionPreviewForPersist(
  slices: Record<string, SessionPreviewSlice>
): Record<string, SessionPreviewSlice> {
  const result: Record<string, SessionPreviewSlice> = {};
  for (const [projectId, slice] of Object.entries(slices)) {
    result[projectId] = {
      ...slice,
      tabs: slice.tabs.map((tab) =>
        tab.type === 'browser'
          ? {
              ...tab,
              navigation: {
                url: tab.url,
                title: tab.title,
                isLoading: false,
                canGoBack: false,
                canGoForward: false,
              },
            }
          : tab
      ),
    };
  }
  return result;
}

interface PageTabState {
  activeTab: 'tasks' | 'trigger';
  setActiveTab: (tab: 'tasks' | 'trigger') => void;
  // Workspace tabs within the Tasks page (sidebar → main panel)
  activeWorkspaceTab: WorkspaceTabId;
  setActiveWorkspaceTab: (
    tab: WorkspaceTabId,
    /** When switching to the folder tab, pass the active project id to clear its inbox dot. */
    options?: { clearInboxForProjectId?: string | null }
  ) => void;
  // Panel position for ChatBox
  chatPanelPosition: 'left' | 'right';
  setChatPanelPosition: (position: 'left' | 'right') => void;
  /** Project page left sidebar: icon-only rail (labels fade + width collapse). Persisted. */
  projectSidebarFolded: boolean;
  toggleProjectSidebarFolded: () => void;
  setProjectSidebarFolded: (folded: boolean) => void;
  // Track if there are triggers (for dynamic menu toggle visibility)
  hasTriggers: boolean;
  setHasTriggers: (value: boolean) => void;
  // Track if there are files in agent folder (for dynamic menu toggle visibility)
  hasAgentFiles: boolean;
  setHasAgentFiles: (value: boolean) => void;
  // Track unviewed tabs with new content (for red dot indicator)
  unviewedTabs: Set<'triggers' | 'inbox'>;
  /** Projects with new agent-folder files not yet “seen” on the folder tab (dot on Folder nav). */
  inboxUnviewedForProjects: Set<string>;
  markTabAsViewed: (
    tab: 'triggers' | 'inbox',
    /** For inbox: project to clear from the folder dot (optional). */
    inboxProjectId?: string | null
  ) => void;
  markTabAsUnviewed: (
    tab: 'triggers' | 'inbox',
    /** For inbox: required — project that received the new file(s). */
    inboxProjectId?: string
  ) => void;
  /** Set by the sidebar to tell the chat container to scroll to a specific query group */
  scrollToQueryId: string | null;
  setScrollToQueryId: (queryId: string | null) => void;
  /**
   * Bumped when the side-panel Progress section asks the chat to surface
   * the task box: TaskCard expands itself, ProjectChatContainer scrolls
   * the active query group so the task box sits at the top.
   */
  taskBoxFocusRequestId: number;
  taskBoxFocusProjectId: string | null;
  taskBoxFocusTaskId: string | null;
  requestTaskBoxFocus: (
    projectId?: string | null,
    taskId?: string | null
  ) => void;
  /**
   * Optional absolute path override for the agent folder (per project).
   * When unset for a project, the default Eigent project folder is used.
   */
  customAgentFolderPathByProjectId: Record<string, string>;
  setProjectCustomAgentFolderPath: (
    projectId: string,
    path: string | null
  ) => void;
  /**
   * Incremented when UI should switch to the workforce workspace and focus the chat input.
   * ChatBox / Home listen to perform focus and ensure the chat panel is visible.
   */
  workspaceChatFocusRequestId: number;
  requestWorkspaceChatFocus: () => void;
  /** Incremented to open the add-trigger dialog from the sidebar (Home owns dialog state). */
  triggerAddDialogRequestId: number;
  requestOpenTriggerAddDialog: () => void;
  /** Pending trigger to select after navigating to the triggers workspace tab. */
  pendingTriggerSelectId: number | null;
  triggerSelectRequestId: number;
  requestSelectTrigger: (triggerId: number) => void;

  // ── TurnTabs: per-project turn selection ─────────────────────────────────
  /**
   * Which task (turn) is currently highlighted in the side-panel TurnTabs,
   * per project. `null` / absent → default to the chatStore's activeTaskId.
   */
  sidePanelSelectedTurnByProject: Record<string, string>;
  /**
   * Unix-ms timestamp until which a user tab-click overrides the
   * scroll-driven viewport selection, per project.
   */
  sidePanelManualUntilByProject: Record<string, number>;
  /**
   * Task ID currently visible in the chatbox scroll viewport, per project.
   * Written by the IntersectionObserver in ProjectChatContainer.
   */
  sidePanelViewedTurnByProject: Record<string, string>;
  setSidePanelSelectedTurn: (
    projectId: string,
    taskId: string,
    manualDurationMs?: number
  ) => void;
  setSidePanelViewedTurn: (projectId: string, taskId: string) => void;
  /** Set by TurnTabs to tell the matching ProjectChatContainer to scroll. */
  scrollToTurnRequest: { projectId: string; taskId: string } | null;
  setScrollToTurnRequest: (
    request: { projectId: string; taskId: string } | null
  ) => void;

  // ── Inline session preview (project page) ─────────────────────────────────
  /**
   * Project whose preview slice mutations and `getSessionPreviewSlice` reads
   * target. Set by the Session page on mount/switch; while unset, preview
   * mutations are dropped (there is nowhere durable to record them).
   */
  sessionPreviewProjectId: string | null;
  /**
   * Preview panel state per project — the single source of truth, persisted
   * so sessions restore. Read the scoped slice via `getSessionPreviewSlice`.
   */
  sessionPreviewByProject: Record<string, SessionPreviewSlice>;
  /** Point the preview scope at a project; its saved slice becomes current. */
  setSessionPreviewProject: (projectId: string | null) => void;
  /**
   * Window-fixed rect the active embedded browser should occupy, published by
   * the preview panel while a browser tab is visible. `null` parks all guests.
   * The always-mounted PreviewBrowserLayer positions `<webview>` elements from
   * this so guests (and their history) survive panel close / project switch.
   */
  previewBrowserViewport: PreviewBrowserViewport | null;
  setPreviewBrowserViewport: (rect: PreviewBrowserViewport | null) => void;
  /** Toggle the unified preview panel (opens onto the chooser tab). */
  toggleSessionPreview: () => void;
  /** Add and activate a blank chooser tab (the "+" button). */
  addChooserPreviewTab: () => void;
  /**
   * Turn a tab (typically the chooser) into the chosen content kind, in place.
   * Falls back to appending if the target tab no longer exists.
   */
  choosePreviewTabType: (tabId: string, kind: PreviewTabKind) => void;
  /** Open a file in a deduplicated file tab (reuses a blank starter tab). */
  openFilePreview: (file?: FileInfo | null) => void;
  /**
   * Open a URL in this project's preview browser — the default target for
   * links mentioned in chat content, so they stay inside the session instead
   * of jumping to the system browser. Reuses a tab already on that URL, then
   * a blank starter tab (chooser or empty browser); otherwise appends.
   */
  openBrowserPreview: (url: string) => void;
  selectSessionPreviewTab: (tabId: string) => void;
  closeSessionPreviewTab: (tabId: string) => void;
  updateBrowserPreviewTab: (
    tabId: string,
    patch: Partial<Omit<SessionBrowserTab, 'id' | 'type' | 'webviewId'>>
  ) => void;
  /**
   * Same as updateBrowserPreviewTab but addressed to an explicit project —
   * used by the browser layer, whose guests emit navigation events even for
   * projects that are not the current preview scope.
   */
  updateBrowserPreviewTabIn: (
    projectId: string,
    tabId: string,
    patch: Partial<Omit<SessionBrowserTab, 'id' | 'type' | 'webviewId'>>
  ) => void;
  closeSessionPreview: () => void;
  resetSessionPreview: () => void;
}

type SetPageTabState = (
  partial:
    | Partial<PageTabState>
    | ((state: PageTabState) => Partial<PageTabState> | PageTabState)
) => void;

/**
 * Apply a preview mutation to the scoped project's slice. The updater receives
 * the current slice; return `null` to bail without changes. No project scope →
 * no-op (the Session page sets the scope before any preview UI is reachable).
 */
function setSessionPreviewSlice(
  set: SetPageTabState,
  updater: (
    slice: SessionPreviewSlice,
    state: PageTabState
  ) => SessionPreviewSlice | null
) {
  set((state) => {
    const projectId = state.sessionPreviewProjectId;
    if (!projectId) return state;
    const slice = updater(getSessionPreviewSlice(state), state);
    if (!slice) return state;
    return {
      sessionPreviewByProject: {
        ...state.sessionPreviewByProject,
        [projectId]: slice,
      },
    };
  });
}

export const usePageTabStore = create<PageTabState>()(
  persist(
    (set) => ({
      activeTab: 'tasks',
      setActiveTab: (tab) => set({ activeTab: tab }),
      activeWorkspaceTab: 'workforce',
      setActiveWorkspaceTab: (tab, options) =>
        set((state) => {
          const newUnviewedTabs = new Set(state.unviewedTabs);
          let nextInboxProjects = state.inboxUnviewedForProjects;

          if (tab === 'triggers') {
            newUnviewedTabs.delete('triggers');
          }

          if (tab === 'inbox') {
            const pid = options?.clearInboxForProjectId ?? undefined;
            if (pid) {
              nextInboxProjects = new Set(state.inboxUnviewedForProjects);
              nextInboxProjects.delete(pid);
            }
            if (nextInboxProjects.size === 0) {
              newUnviewedTabs.delete('inbox');
            } else {
              newUnviewedTabs.add('inbox');
            }
          }

          return {
            activeWorkspaceTab: tab,
            unviewedTabs: newUnviewedTabs,
            inboxUnviewedForProjects: nextInboxProjects,
          };
        }),
      chatPanelPosition: 'left',
      setChatPanelPosition: (position) => set({ chatPanelPosition: position }),
      projectSidebarFolded: false,
      toggleProjectSidebarFolded: () =>
        set((state) => ({
          projectSidebarFolded: !state.projectSidebarFolded,
        })),
      setProjectSidebarFolded: (folded) =>
        set({ projectSidebarFolded: folded }),
      hasTriggers: false,
      setHasTriggers: (value) => set({ hasTriggers: value }),
      hasAgentFiles: false,
      setHasAgentFiles: (value) => set({ hasAgentFiles: value }),
      unviewedTabs: new Set<'triggers' | 'inbox'>(),
      inboxUnviewedForProjects: new Set<string>(),
      markTabAsViewed: (tab, inboxProjectId) =>
        set((state) => {
          const newUnviewedTabs = new Set(state.unviewedTabs);
          newUnviewedTabs.delete(tab);
          if (tab === 'inbox' && inboxProjectId) {
            const nextInbox = new Set(state.inboxUnviewedForProjects);
            nextInbox.delete(inboxProjectId);
            if (nextInbox.size === 0) newUnviewedTabs.delete('inbox');
            else newUnviewedTabs.add('inbox');
            return {
              unviewedTabs: newUnviewedTabs,
              inboxUnviewedForProjects: nextInbox,
            };
          }
          return { unviewedTabs: newUnviewedTabs };
        }),
      markTabAsUnviewed: (tab, inboxProjectId) =>
        set((state) => {
          if (tab === 'inbox') {
            if (!inboxProjectId) return state;
            const newUnviewedTabs = new Set(state.unviewedTabs);
            newUnviewedTabs.add('inbox');
            const nextInbox = new Set(state.inboxUnviewedForProjects);
            nextInbox.add(inboxProjectId);
            return {
              unviewedTabs: newUnviewedTabs,
              inboxUnviewedForProjects: nextInbox,
            };
          }
          const newUnviewedTabs = new Set(state.unviewedTabs);
          newUnviewedTabs.add(tab);
          return { unviewedTabs: newUnviewedTabs };
        }),
      scrollToQueryId: null,
      setScrollToQueryId: (queryId) => set({ scrollToQueryId: queryId }),
      taskBoxFocusRequestId: 0,
      taskBoxFocusProjectId: null,
      taskBoxFocusTaskId: null,
      requestTaskBoxFocus: (projectId, taskId) =>
        set((state) => ({
          taskBoxFocusRequestId: state.taskBoxFocusRequestId + 1,
          taskBoxFocusProjectId: projectId ?? null,
          taskBoxFocusTaskId: taskId ?? null,
        })),
      customAgentFolderPathByProjectId: {},
      setProjectCustomAgentFolderPath: (projectId, path) =>
        set((state) => {
          const next = { ...state.customAgentFolderPathByProjectId };
          if (path == null || path === '') {
            delete next[projectId];
          } else {
            next[projectId] = path;
          }
          return { customAgentFolderPathByProjectId: next };
        }),
      workspaceChatFocusRequestId: 0,
      requestWorkspaceChatFocus: () =>
        set((state) => {
          const tab = state.activeWorkspaceTab;
          const alreadyOnWorkspaceChat =
            tab === 'workforce' ||
            tab === 'project' ||
            tab === 'runs' ||
            tab === 'new-project';
          return {
            ...(alreadyOnWorkspaceChat
              ? {}
              : { activeWorkspaceTab: 'project' as const }),
            workspaceChatFocusRequestId: state.workspaceChatFocusRequestId + 1,
          };
        }),
      triggerAddDialogRequestId: 0,
      requestOpenTriggerAddDialog: () =>
        set((state) => {
          const newUnviewedTabs = new Set(state.unviewedTabs);
          newUnviewedTabs.delete('triggers');
          return {
            activeWorkspaceTab: 'triggers',
            unviewedTabs: newUnviewedTabs,
            triggerAddDialogRequestId: state.triggerAddDialogRequestId + 1,
          };
        }),
      pendingTriggerSelectId: null,
      triggerSelectRequestId: 0,
      requestSelectTrigger: (triggerId) =>
        set((state) => ({
          pendingTriggerSelectId: triggerId,
          triggerSelectRequestId: state.triggerSelectRequestId + 1,
        })),

      sidePanelSelectedTurnByProject: {},
      sidePanelManualUntilByProject: {},
      sidePanelViewedTurnByProject: {},
      setSidePanelSelectedTurn: (projectId, taskId, manualDurationMs = 1500) =>
        set((state) => ({
          sidePanelSelectedTurnByProject: {
            ...state.sidePanelSelectedTurnByProject,
            [projectId]: taskId,
          },
          sidePanelManualUntilByProject: {
            ...state.sidePanelManualUntilByProject,
            [projectId]: Date.now() + manualDurationMs,
          },
        })),
      setSidePanelViewedTurn: (projectId, taskId) =>
        set((state) => {
          const manualUntil =
            state.sidePanelManualUntilByProject[projectId] ?? 0;
          // Suppress viewport updates during the manual-selection window so a
          // tab click isn't immediately overwritten by an in-flight observer
          // firing while the chatbox is mid-scroll.
          const selectedTaskId =
            state.sidePanelSelectedTurnByProject[projectId];
          if (Date.now() < manualUntil && selectedTaskId !== taskId) {
            return state;
          }
          // Once the window expires, drive both fields so components only need
          // to read `sidePanelSelectedTurnByProject` — no Date.now() in render.
          return {
            sidePanelViewedTurnByProject: {
              ...state.sidePanelViewedTurnByProject,
              [projectId]: taskId,
            },
            sidePanelSelectedTurnByProject: {
              ...state.sidePanelSelectedTurnByProject,
              [projectId]: taskId,
            },
            sidePanelManualUntilByProject: {
              ...state.sidePanelManualUntilByProject,
              [projectId]: 0,
            },
          };
        }),
      scrollToTurnRequest: null,
      setScrollToTurnRequest: (request) =>
        set({ scrollToTurnRequest: request }),

      sessionPreviewProjectId: null,
      sessionPreviewByProject: {},
      previewBrowserViewport: null,
      setPreviewBrowserViewport: (rect) =>
        set({ previewBrowserViewport: rect }),
      setSessionPreviewProject: (projectId) =>
        set((state) =>
          state.sessionPreviewProjectId === projectId
            ? state
            : { sessionPreviewProjectId: projectId }
        ),
      toggleSessionPreview: () =>
        setSessionPreviewSlice(set, (slice) => {
          if (slice.open) return { ...slice, open: false };
          if (slice.tabs.length > 0) return { ...slice, open: true };
          const initial = createInitialSessionPreviewTabs();
          return {
            open: true,
            tabs: initial.tabs,
            activeTabId: initial.activeTabId,
          };
        }),
      addChooserPreviewTab: () =>
        setSessionPreviewSlice(set, (slice) => {
          const tab = createChooserPreviewTab();
          return {
            open: true,
            tabs: [...slice.tabs, tab],
            activeTabId: tab.id,
          };
        }),
      choosePreviewTabType: (tabId, kind) =>
        setSessionPreviewSlice(set, (slice, state) => {
          const tab = createPreviewTabOfKind(
            kind,
            state.sessionPreviewProjectId
          );
          const index = slice.tabs.findIndex(
            (candidate) => candidate.id === tabId
          );
          const tabs = [...slice.tabs];
          if (index >= 0) {
            // Replace the chooser in place so the tab keeps its position.
            tabs[index] = tab;
          } else {
            tabs.push(tab);
          }
          return { open: true, tabs, activeTabId: tab.id };
        }),
      openFilePreview: (file) =>
        setSessionPreviewSlice(set, (slice) => {
          const targetFile = file ?? null;
          const previewTabs = slice.tabs;
          const matchingTab = targetFile
            ? previewTabs.find(
                (tab) =>
                  tab.type === 'file' && tab.file?.path === targetFile.path
              )
            : previewTabs.find(
                (tab) => tab.type === 'file' && tab.file === null
              );
          if (matchingTab) {
            return {
              open: true,
              tabs: previewTabs,
              activeTabId: matchingTab.id,
            };
          }

          // Reuse a "blank" starter tab (empty file, or the chooser) in place —
          // preferring the active one — so opening a file doesn't pile up tabs.
          const isReusable = (tab: SessionPreviewTab) =>
            tab.type === 'chooser' ||
            (tab.type === 'file' && tab.file === null);
          const reuseIndex = (() => {
            const activeIndex = previewTabs.findIndex(
              (tab) => tab.id === slice.activeTabId && isReusable(tab)
            );
            return activeIndex >= 0
              ? activeIndex
              : previewTabs.findIndex(isReusable);
          })();
          if (reuseIndex >= 0) {
            const tabs = [...previewTabs];
            tabs[reuseIndex] = createFilePreviewTab(targetFile);
            return { open: true, tabs, activeTabId: tabs[reuseIndex].id };
          }

          const tab = createFilePreviewTab(targetFile);
          return {
            open: true,
            tabs: [...previewTabs, tab],
            activeTabId: tab.id,
          };
        }),
      openBrowserPreview: (url) =>
        setSessionPreviewSlice(set, (slice, state) => {
          const normalized = normalizeBrowserUrl(url);
          if (!normalized.ok) return null;
          const canonical = canonicalizeBrowserUrl(normalized.url);

          // A tab already showing this URL (live page or pending load) — focus it.
          const existing = slice.tabs.find(
            (tab) =>
              tab.type === 'browser' &&
              canonicalizeBrowserUrl(tab.navigation.url || tab.url) ===
                canonical
          );
          if (existing) {
            return { ...slice, open: true, activeTabId: existing.id };
          }

          const title = browserTabTitleForUrl(normalized.url);

          // Reuse a blank starter tab (empty browser, or the chooser) in
          // place — preferring the active one — so links don't pile up tabs.
          const isReusable = (tab: SessionPreviewTab) =>
            tab.type === 'chooser' || (tab.type === 'browser' && !tab.url);
          const reuseIndex = (() => {
            const activeIndex = slice.tabs.findIndex(
              (tab) => tab.id === slice.activeTabId && isReusable(tab)
            );
            return activeIndex >= 0
              ? activeIndex
              : slice.tabs.findIndex(isReusable);
          })();
          if (reuseIndex >= 0) {
            const reused = slice.tabs[reuseIndex];
            const tabs = [...slice.tabs];
            tabs[reuseIndex] =
              reused.type === 'browser'
                ? // Keep the tab (and its webviewId): setting the URL mounts
                  // its guest in the browser layer.
                  {
                    ...reused,
                    url: normalized.url,
                    title,
                    navigation: { ...reused.navigation, url: normalized.url },
                  }
                : {
                    ...createBrowserPreviewTab(state.sessionPreviewProjectId),
                    url: normalized.url,
                    title,
                  };
            return { open: true, tabs, activeTabId: tabs[reuseIndex].id };
          }

          const tab: SessionBrowserTab = {
            ...createBrowserPreviewTab(state.sessionPreviewProjectId),
            url: normalized.url,
            title,
          };
          return {
            open: true,
            tabs: [...slice.tabs, tab],
            activeTabId: tab.id,
          };
        }),
      selectSessionPreviewTab: (tabId) =>
        setSessionPreviewSlice(set, (slice) =>
          slice.tabs.some((tab) => tab.id === tabId)
            ? { ...slice, activeTabId: tabId }
            : null
        ),
      closeSessionPreviewTab: (tabId) =>
        setSessionPreviewSlice(set, (slice) => {
          const closingIndex = slice.tabs.findIndex((tab) => tab.id === tabId);
          if (closingIndex < 0) return null;
          const tabs = slice.tabs.filter((tab) => tab.id !== tabId);
          if (tabs.length === 0) {
            return { open: false, tabs: [], activeTabId: null };
          }
          if (slice.activeTabId !== tabId) {
            return { ...slice, tabs };
          }
          const nextTab = tabs[Math.min(closingIndex, tabs.length - 1)];
          return { ...slice, tabs, activeTabId: nextTab.id };
        }),
      updateBrowserPreviewTab: (tabId, patch) =>
        setSessionPreviewSlice(set, (slice) => ({
          ...slice,
          tabs: slice.tabs.map((tab) =>
            tab.id === tabId && tab.type === 'browser'
              ? { ...tab, ...patch }
              : tab
          ),
        })),
      updateBrowserPreviewTabIn: (projectId, tabId, patch) =>
        set((state) => {
          const slice = state.sessionPreviewByProject[projectId];
          if (!slice) return state;
          return {
            sessionPreviewByProject: {
              ...state.sessionPreviewByProject,
              [projectId]: {
                ...slice,
                tabs: slice.tabs.map((tab) =>
                  tab.id === tabId && tab.type === 'browser'
                    ? { ...tab, ...patch }
                    : tab
                ),
              },
            },
          };
        }),
      closeSessionPreview: () =>
        setSessionPreviewSlice(set, (slice) => ({ ...slice, open: false })),
      resetSessionPreview: () =>
        setSessionPreviewSlice(set, () => ({
          open: false,
          tabs: [],
          activeTabId: null,
        })),
    }),
    {
      name: 'eigent-page-tab',
      version: 1,
      // v1: Project.mode becomes the source of truth. Drop the legacy global
      // sessionSidePanelMode so mode no longer drifts between Projects.
      migrate: (persistedState, version) => {
        if (
          version < 1 &&
          persistedState &&
          typeof persistedState === 'object'
        ) {
          const next = { ...(persistedState as Record<string, unknown>) };
          delete next.sessionSidePanelMode;
          return next as unknown as PageTabState;
        }
        return persistedState as PageTabState;
      },
      partialize: (state) => ({
        projectSidebarFolded: state.projectSidebarFolded,
        customAgentFolderPathByProjectId:
          state.customAgentFolderPathByProjectId,
        sessionPreviewByProject: sanitizeSessionPreviewForPersist(
          state.sessionPreviewByProject
        ),
      }),
    }
  )
);
