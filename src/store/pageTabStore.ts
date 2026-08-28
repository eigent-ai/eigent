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

import { createHost } from '@/host';
import { canonicalizeBrowserUrl, normalizeBrowserUrl } from '@/lib/browserUrl';
import { disposeShellSession } from '@/lib/shellSessions';
import {
  DEFAULT_CHAT_TIMELINE_DETAIL_LEVEL,
  normalizeChatTimelineDetailLevel,
  type ChatTimelineDetailLevel,
} from '@/types/chatTimeline';
import i18next from 'i18next';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Identifiers for the right-pane tabs in the workspace shell. Centralized so
 * typos surface as TypeScript errors at call sites that previously passed
 * raw string literals.
 */
export const WorkspaceTab = {
  Workforce: 'workforce',
  Files: 'files',
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

export interface SessionReviewTarget {
  scope: 'project' | 'run';
  runId?: string;
  focusPath?: string;
  focusRequestId: number;
}

export interface SessionReviewIdentity {
  baseCommit: string;
  targetCommit: string;
}

export type ReviewCommentSide = 'original' | 'modified';

export interface ReviewLineSelection {
  side: ReviewCommentSide;
  startLine: number;
  endLine: number;
  text: string;
}

/** A user-authored review draft. It becomes canonical only after Chat sends it. */
export interface SessionReviewComment {
  id: string;
  fileId: string;
  path: string;
  selection: ReviewLineSelection | null;
  body: string;
  createdAt: number;
  /** Missing on older persisted drafts and therefore treated as pending. */
  status?: 'pending' | 'sent';
  sentAt?: number;
  /** Exact Git revision on which the line selection was authored. */
  reviewIdentity?: SessionReviewIdentity;
}

/** Code/diff review surface for a Project aggregate or one finalized Run. */
export interface SessionReviewTab {
  id: string;
  type: 'review';
  title: string;
  /** Optional only for tabs restored from storage before Run review existed. */
  reviewTarget?: SessionReviewTarget;
  /** Local review drafts, persisted with this Project's preview tabs. */
  reviewComments?: SessionReviewComment[];
  /** First successfully loaded base/target pair; immutable for this tab. */
  reviewIdentity?: SessionReviewIdentity;
  /**
   * First successfully loaded base/target pair per task target the tab has
   * shown, keyed by `reviewTargetIdentityKey`. A generic Review tab follows
   * the latest Run, so each Run needs its own pin for the out-of-date guard.
   */
  reviewIdentities?: Record<string, SessionReviewIdentity>;
}

export interface WorkspaceChatDraftRequest {
  requestId: number;
  projectId: string;
  content: string;
  reviewHandoffIds: string[];
}

export interface WorkspaceReviewHandoff {
  handoffId: string;
  requestId: number;
  projectId: string;
  reviewTabId: string;
  commentIds: string[];
  content: string;
}

export interface WorkspaceReviewHandoffSource {
  reviewTabId: string;
  commentIds: string[];
}

export interface OpenReviewPreviewInput {
  runId?: string;
  path?: string;
}

export interface SessionTerminalTab {
  id: string;
  type: 'terminal';
  title: string;
  /**
   * Backing PTY id for an interactive local shell (the default terminal tab).
   * Project-scoped so the shell survives tab switches within an app run.
   */
  shellId?: string;
  /**
   * When set, the tab shows this agent terminal stream (read-only) instead of
   * a local shell. Ids come from `collectTerminalSources`.
   */
  agentSourceId?: string;
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

function nextReviewHandoffId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  return (
    randomUuid ?? `review-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function createBrowserPreviewTab(projectId: string | null): SessionBrowserTab {
  const id = nextSessionPreviewTabId('browser');
  return {
    id,
    type: 'browser',
    title: i18next.t('layout.preview-new-tab', {
      defaultValue: 'New tab',
    }),
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
    title:
      file?.name ||
      i18next.t('layout.preview-open-file', {
        defaultValue: 'Open file',
      }),
    file,
  };
}

function filePreviewIdentity(file: FileInfo): string | null {
  const artifactId = file.artifactId?.trim();
  if (artifactId) return `artifact:${artifactId}`;
  const chatFileId = file.assetRef?.chatFileId;
  if (typeof chatFileId === 'number') return `chat-file:${chatFileId}`;
  const path = file.path?.trim();
  if (path) return `path:${path}`;
  const relativePath = file.relativePath?.trim();
  return relativePath ? `relative:${relativePath}` : null;
}

function isSameFilePreview(left: FileInfo, right: FileInfo): boolean {
  const leftIdentity = filePreviewIdentity(left);
  return leftIdentity !== null && leftIdentity === filePreviewIdentity(right);
}

function createChooserPreviewTab(): SessionChooserTab {
  return {
    id: nextSessionPreviewTabId('chooser'),
    type: 'chooser',
    title: i18next.t('layout.preview-new-tab', {
      defaultValue: 'New tab',
    }),
  };
}

function normalizeReviewPath(path: string | undefined): string | undefined {
  const normalized = path?.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  return normalized || undefined;
}

function createReviewTarget(
  input?: OpenReviewPreviewInput
): SessionReviewTarget {
  const runId = input?.runId?.trim();
  return {
    scope: runId ? 'run' : 'project',
    ...(runId ? { runId } : {}),
    ...(normalizeReviewPath(input?.path)
      ? { focusPath: normalizeReviewPath(input?.path) }
      : {}),
    focusRequestId: 0,
  };
}

/**
 * Cache key for one review target. A Run target without an id is still pending
 * (no task has started yet) and must not share the Project pin, so it keys to
 * its own slot rather than falling back to `project`.
 */
export function reviewTargetIdentityKey(target: SessionReviewTarget): string {
  return target.scope === 'run' ? `run:${target.runId ?? ''}` : 'project';
}

function createReviewPreviewTab(
  input?: OpenReviewPreviewInput
): SessionReviewTab {
  const reviewTarget = createReviewTarget(input);
  return {
    id: nextSessionPreviewTabId('review'),
    type: 'review',
    title: i18next.t('layout.preview-task-review', {
      defaultValue: 'Task review',
    }),
    reviewTarget,
    reviewComments: [],
  };
}

/** Placeholder tab title for a URL until the page reports its real one. */
function browserTabTitleForUrl(url: string): string {
  try {
    return (
      new URL(url).hostname ||
      i18next.t('layout.preview-new-tab', { defaultValue: 'New tab' })
    );
  } catch {
    return i18next.t('layout.preview-new-tab', { defaultValue: 'New tab' });
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
      return createReviewPreviewTab();
    case 'terminal': {
      const id = nextSessionPreviewTabId('terminal');
      return {
        id,
        type: 'terminal',
        title: i18next.t('layout.preview-terminal', {
          defaultValue: 'Terminal',
        }),
        // Stable per-tab PTY id: the shell keeps running while the user
        // switches preview tabs, and dies when the tab is closed.
        shellId: `session-shell:${projectId ?? 'global'}:${id}`,
      };
    }
    case 'canvas':
      return {
        id: nextSessionPreviewTabId('canvas'),
        type: 'canvas',
        title: i18next.t('layout.preview-canvas', {
          defaultValue: 'Canvas',
        }),
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

/** Normalize Review tabs created before the task-focused title contract. */
function normalizeReviewPreviewTab(tab: SessionPreviewTab): SessionPreviewTab {
  if (tab.type !== 'review') return tab;
  const normalized = {
    ...tab,
    title: i18next.t('layout.preview-task-review', {
      defaultValue: 'Task review',
    }),
  } as SessionReviewTab & { reviewScope?: unknown };
  delete normalized.reviewScope;
  return normalized;
}

/**
 * Strip runtime-only navigation state before persisting: after an app restart
 * the native webview (and its history) is gone, so only url/title survive.
 * Review tabs are also normalized so retired scope state cannot return.
 */
function sanitizeSessionPreviewForPersist(
  slices: Record<string, SessionPreviewSlice>
): Record<string, SessionPreviewSlice> {
  const result: Record<string, SessionPreviewSlice> = {};
  for (const [projectId, slice] of Object.entries(slices)) {
    result[projectId] = {
      ...slice,
      tabs: slice.tabs.map((tab) => {
        const normalizedTab = normalizeReviewPreviewTab(tab);
        return normalizedTab.type === 'browser'
          ? {
              ...normalizedTab,
              navigation: {
                url: normalizedTab.url,
                title: normalizedTab.title,
                isLoading: false,
                canGoBack: false,
                canGoForward: false,
              },
            }
          : normalizedTab;
      }),
    };
  }
  return result;
}

function disposePreviewShellTabs(tabs: SessionPreviewTab[]) {
  const api = createHost().electronAPI ?? undefined;
  for (const tab of tabs) {
    if (tab.type === 'terminal' && tab.shellId) {
      disposeShellSession(api, tab.shellId);
    }
  }
}

interface PageTabState {
  activeTab: 'tasks' | 'trigger';
  setActiveTab: (tab: 'tasks' | 'trigger') => void;
  // Workspace tabs within the Tasks page (sidebar → main panel)
  activeWorkspaceTab: WorkspaceTabId;
  setActiveWorkspaceTab: (
    tab: WorkspaceTabId,
    /** When switching to Files, pass the active project id to clear its unread-files dot. */
    options?: { clearFilesForProjectId?: string | null }
  ) => void;
  /**
   * Workspace rail visibility, toggled from the title bar. Only the workspace
   * shell honours this — Home and Settings always show their rail.
   */
  workspaceSidebarHidden: boolean;
  toggleWorkspaceSidebar: () => void;
  // Panel position for ChatBox
  chatPanelPosition: 'left' | 'right';
  setChatPanelPosition: (position: 'left' | 'right') => void;
  /** Event-native ChatBox presentation density. Persisted across Projects. */
  chatTimelineDetailLevel: ChatTimelineDetailLevel;
  setChatTimelineDetailLevel: (level: ChatTimelineDetailLevel) => void;
  /** One-shot request consumed by the active Project session panel. */
  sessionSidePanelToggleRequestId: number;
  requestToggleSessionSidePanel: () => void;
  // Track if there are triggers (for dynamic menu toggle visibility)
  hasTriggers: boolean;
  setHasTriggers: (value: boolean) => void;
  // Track if there are files in agent folder (for dynamic menu toggle visibility)
  hasAgentFiles: boolean;
  setHasAgentFiles: (value: boolean) => void;
  // Track unviewed tabs with new content (for red dot indicator)
  unviewedTabs: Set<'triggers' | 'files'>;
  /** Projects with new agent-folder files not yet seen on the Files tab. */
  filesUnviewedForProjects: Set<string>;
  markTabAsViewed: (
    tab: 'triggers' | 'files',
    /** For Files: project to clear from the unread-files dot (optional). */
    filesProjectId?: string | null
  ) => void;
  markTabAsUnviewed: (
    tab: 'triggers' | 'files',
    /** For Files: required — project that received the new file(s). */
    filesProjectId?: string
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
  /** One-shot handoff that appends review feedback to the matching Chat draft. */
  workspaceChatDraftRequest: WorkspaceChatDraftRequest | null;
  workspaceChatDraftRequestSequence: number;
  /** Review handoffs stay pending until Chat confirms their content was sent. */
  workspaceReviewHandoffs: WorkspaceReviewHandoff[];
  requestWorkspaceChatDraft: (
    content: string,
    reviewSource?: WorkspaceReviewHandoffSource
  ) => void;
  consumeWorkspaceChatDraft: (requestId: number) => void;
  acknowledgeWorkspaceReviewHandoffs: (
    projectId: string,
    handoffIds: readonly string[]
  ) => void;
  /** Drop edited-away handoffs without marking their review comments sent. */
  discardWorkspaceReviewHandoffs: (
    projectId: string,
    handoffIds: readonly string[]
  ) => void;
  /** Incremented to open the add-trigger dialog from the sidebar (Home owns dialog state). */
  triggerAddDialogRequestId: number;
  requestOpenTriggerAddDialog: () => void;
  /** Pending trigger to select after navigating to the triggers workspace tab. */
  pendingTriggerSelectId: number | null;
  triggerSelectRequestId: number;
  requestSelectTrigger: (triggerId: number) => void;

  /** One-shot command used by historical rows in the Session side panel. */
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
  /** Open and select a preview tab of the requested kind. */
  openPreviewTab: (kind: PreviewTabKind) => void;
  /** Add and activate a blank chooser tab (the "+" button). */
  addChooserPreviewTab: () => void;
  /**
   * Turn a tab (typically the chooser) into the chosen content kind, in place.
   * Falls back to appending if the target tab no longer exists.
   */
  choosePreviewTabType: (tabId: string, kind: PreviewTabKind) => void;
  /** Open a file in a deduplicated file tab (reuses a blank starter tab). */
  openFilePreview: (file?: FileInfo | null) => void;
  /** Open a task-focused Git review and optionally focus one changed path. */
  openReviewPreview: (input?: OpenReviewPreviewInput) => void;
  /** Replace the local comment drafts owned by one Review tab. */
  updateReviewComments: (
    tabId: string,
    comments: SessionReviewComment[]
  ) => void;
  setReviewIdentity: (
    tabId: string,
    identity: SessionReviewIdentity,
    targetKey?: string
  ) => void;
  /**
   * Open a URL in this project's preview browser — the default target for
   * links mentioned in chat content, so they stay inside the session instead
   * of jumping to the system browser. Reuses a tab already on that URL, then
   * a blank starter tab (chooser or empty browser); otherwise appends.
   */
  openBrowserPreview: (url: string) => void;
  /**
   * Open an agent terminal stream (read-only) in a terminal tab. Reuses a tab
   * already showing that stream; otherwise converts `fromTabId` (the chooser
   * row the user clicked) in place, falling back to appending.
   */
  openAgentTerminalPreview: (
    sourceId: string,
    title: string,
    fromTabId?: string
  ) => void;
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
  /**
   * Drop a deleted project's persisted preview state and terminate every
   * interactive shell it owned, even when no preview component is mounted.
   */
  removeSessionPreviewProject: (projectId: string) => void;
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
    (set, get) => ({
      activeTab: 'tasks',
      setActiveTab: (tab) => set({ activeTab: tab }),
      activeWorkspaceTab: 'workforce',
      setActiveWorkspaceTab: (tab, options) =>
        set((state) => {
          const newUnviewedTabs = new Set(state.unviewedTabs);
          let nextFilesProjects = state.filesUnviewedForProjects;

          if (tab === 'triggers') {
            newUnviewedTabs.delete('triggers');
          }

          if (tab === 'files') {
            const pid = options?.clearFilesForProjectId ?? undefined;
            if (pid) {
              nextFilesProjects = new Set(state.filesUnviewedForProjects);
              nextFilesProjects.delete(pid);
            }
            if (nextFilesProjects.size === 0) {
              newUnviewedTabs.delete('files');
            } else {
              newUnviewedTabs.add('files');
            }
          }

          return {
            activeWorkspaceTab: tab,
            unviewedTabs: newUnviewedTabs,
            filesUnviewedForProjects: nextFilesProjects,
          };
        }),
      workspaceSidebarHidden: false,
      toggleWorkspaceSidebar: () =>
        set((state) => ({
          workspaceSidebarHidden: !state.workspaceSidebarHidden,
        })),
      chatPanelPosition: 'left',
      setChatPanelPosition: (position) => set({ chatPanelPosition: position }),
      chatTimelineDetailLevel: DEFAULT_CHAT_TIMELINE_DETAIL_LEVEL,
      setChatTimelineDetailLevel: (level) =>
        set({
          chatTimelineDetailLevel: normalizeChatTimelineDetailLevel(level),
        }),
      sessionSidePanelToggleRequestId: 0,
      requestToggleSessionSidePanel: () =>
        set((state) => ({
          sessionSidePanelToggleRequestId:
            state.sessionSidePanelToggleRequestId + 1,
        })),
      hasTriggers: false,
      setHasTriggers: (value) => set({ hasTriggers: value }),
      hasAgentFiles: false,
      setHasAgentFiles: (value) => set({ hasAgentFiles: value }),
      unviewedTabs: new Set<'triggers' | 'files'>(),
      filesUnviewedForProjects: new Set<string>(),
      markTabAsViewed: (tab, filesProjectId) =>
        set((state) => {
          const newUnviewedTabs = new Set(state.unviewedTabs);
          newUnviewedTabs.delete(tab);
          if (tab === 'files' && filesProjectId) {
            const nextFiles = new Set(state.filesUnviewedForProjects);
            nextFiles.delete(filesProjectId);
            if (nextFiles.size === 0) newUnviewedTabs.delete('files');
            else newUnviewedTabs.add('files');
            return {
              unviewedTabs: newUnviewedTabs,
              filesUnviewedForProjects: nextFiles,
            };
          }
          return { unviewedTabs: newUnviewedTabs };
        }),
      markTabAsUnviewed: (tab, filesProjectId) =>
        set((state) => {
          if (tab === 'files') {
            if (!filesProjectId) return state;
            const newUnviewedTabs = new Set(state.unviewedTabs);
            newUnviewedTabs.add('files');
            const nextFiles = new Set(state.filesUnviewedForProjects);
            nextFiles.add(filesProjectId);
            return {
              unviewedTabs: newUnviewedTabs,
              filesUnviewedForProjects: nextFiles,
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
      workspaceChatDraftRequest: null,
      workspaceChatDraftRequestSequence: 0,
      workspaceReviewHandoffs: [],
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
      requestWorkspaceChatDraft: (content, reviewSource) => {
        const normalized = content.trim();
        const projectId = get().sessionPreviewProjectId;
        if (!normalized || !projectId) return;
        set((state) => {
          const requestId = state.workspaceChatDraftRequestSequence + 1;
          const commentIds = [
            ...new Set(
              reviewSource?.commentIds.map((commentId) => commentId.trim()) ??
                []
            ),
          ].filter(Boolean);
          const reviewHandoff =
            reviewSource?.reviewTabId && commentIds.length > 0
              ? {
                  handoffId: nextReviewHandoffId(),
                  requestId,
                  projectId,
                  reviewTabId: reviewSource.reviewTabId,
                  commentIds,
                  content: normalized,
                }
              : null;
          return {
            workspaceChatDraftRequestSequence: requestId,
            workspaceChatDraftRequest: {
              requestId,
              projectId,
              content: normalized,
              reviewHandoffIds: reviewHandoff ? [reviewHandoff.handoffId] : [],
            },
            ...(reviewHandoff
              ? {
                  workspaceReviewHandoffs: [
                    ...state.workspaceReviewHandoffs,
                    reviewHandoff,
                  ],
                }
              : {}),
          };
        });
        get().requestWorkspaceChatFocus();
      },
      consumeWorkspaceChatDraft: (requestId) =>
        set((state) =>
          state.workspaceChatDraftRequest?.requestId === requestId
            ? { workspaceChatDraftRequest: null }
            : state
        ),
      acknowledgeWorkspaceReviewHandoffs: (projectId, handoffIds) => {
        const acknowledged = new Set(
          handoffIds.map((handoffId) => handoffId.trim()).filter(Boolean)
        );
        if (!projectId || acknowledged.size === 0) return;
        set((state) => {
          const matched = state.workspaceReviewHandoffs.filter(
            (handoff) =>
              handoff.projectId === projectId &&
              acknowledged.has(handoff.handoffId)
          );
          if (matched.length === 0) return state;

          const matchedRequestIds = new Set(
            matched.map((handoff) => handoff.requestId)
          );
          const commentIdsByTab = new Map<string, Set<string>>();
          for (const handoff of matched) {
            const ids =
              commentIdsByTab.get(handoff.reviewTabId) ?? new Set<string>();
            handoff.commentIds.forEach((commentId) => ids.add(commentId));
            commentIdsByTab.set(handoff.reviewTabId, ids);
          }

          const slice = state.sessionPreviewByProject[projectId];
          const sentAt = Date.now();
          const tabs = slice?.tabs.map((tab) => {
            if (tab.type !== 'review') return tab;
            const commentIds = commentIdsByTab.get(tab.id);
            if (!commentIds) return tab;
            return {
              ...tab,
              reviewComments: (tab.reviewComments ?? []).map((comment) =>
                commentIds.has(comment.id)
                  ? { ...comment, status: 'sent' as const, sentAt }
                  : comment
              ),
            };
          });

          return {
            workspaceReviewHandoffs: state.workspaceReviewHandoffs.filter(
              (handoff) => !matchedRequestIds.has(handoff.requestId)
            ),
            ...(slice && tabs
              ? {
                  sessionPreviewByProject: {
                    ...state.sessionPreviewByProject,
                    [projectId]: { ...slice, tabs },
                  },
                }
              : {}),
          };
        });
      },
      discardWorkspaceReviewHandoffs: (projectId, handoffIds) => {
        const discarded = new Set(
          handoffIds.map((handoffId) => handoffId.trim()).filter(Boolean)
        );
        if (!projectId || discarded.size === 0) return;
        set((state) => ({
          workspaceReviewHandoffs: state.workspaceReviewHandoffs.filter(
            (handoff) =>
              handoff.projectId !== projectId ||
              !discarded.has(handoff.handoffId)
          ),
        }));
      },
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
      openPreviewTab: (kind) =>
        setSessionPreviewSlice(set, (slice, state) => {
          const existing = slice.tabs.find(
            (tab) =>
              tab.type === kind &&
              (kind !== 'terminal' ||
                (tab.type === 'terminal' && !tab.agentSourceId))
          );
          if (existing) {
            return { ...slice, open: true, activeTabId: existing.id };
          }

          const reusableIndex = slice.tabs.findIndex(
            (tab) => tab.type === 'chooser'
          );
          const tab = createPreviewTabOfKind(
            kind,
            state.sessionPreviewProjectId
          );
          const tabs = [...slice.tabs];
          if (reusableIndex >= 0) tabs[reusableIndex] = tab;
          else tabs.push(tab);
          return { open: true, tabs, activeTabId: tab.id };
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
          const matchingIndex = targetFile
            ? previewTabs.findIndex(
                (tab) =>
                  tab.type === 'file' &&
                  tab.file !== null &&
                  isSameFilePreview(tab.file, targetFile)
              )
            : previewTabs.findIndex(
                (tab) => tab.type === 'file' && tab.file === null
              );
          if (matchingIndex >= 0) {
            const matchingTab = previewTabs[matchingIndex] as SessionFileTab;
            const tabs = [...previewTabs];
            // Durable Artifact identity intentionally deduplicates the tab,
            // but its preview source may change after workspace restoration
            // (for example from a signed Cloud URL to a local Space path).
            // Refresh the tab payload so a persisted remote source cannot win.
            tabs[matchingIndex] = {
              ...matchingTab,
              title: targetFile?.name || matchingTab.title,
              file: targetFile,
            };
            return {
              open: true,
              tabs,
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
      openReviewPreview: (input) =>
        setSessionPreviewSlice(set, (slice) => {
          const requestedTarget = createReviewTarget(input);
          const sameScope = (tab: SessionPreviewTab) => {
            if (tab.type !== 'review') return false;
            const currentTarget = tab.reviewTarget ?? createReviewTarget();
            return (
              currentTarget.scope === requestedTarget.scope &&
              currentTarget.runId === requestedTarget.runId
            );
          };
          const existingIndex = slice.tabs.findIndex(sameScope);
          if (existingIndex >= 0) {
            const current = slice.tabs[existingIndex] as SessionReviewTab;
            const currentTarget = current.reviewTarget ?? createReviewTarget();
            const tabs = [...slice.tabs];
            tabs[existingIndex] = {
              ...current,
              reviewTarget: {
                ...currentTarget,
                ...(requestedTarget.focusPath
                  ? { focusPath: requestedTarget.focusPath }
                  : {}),
                focusRequestId: currentTarget.focusRequestId + 1,
              },
            };
            return { open: true, tabs, activeTabId: current.id };
          }

          const tab = createReviewPreviewTab(input);
          const reusableIndex = slice.tabs.findIndex(
            (candidate) => candidate.type === 'chooser'
          );
          const tabs = [...slice.tabs];
          if (reusableIndex >= 0) tabs[reusableIndex] = tab;
          else tabs.push(tab);
          return { open: true, tabs, activeTabId: tab.id };
        }),
      updateReviewComments: (tabId, comments) =>
        setSessionPreviewSlice(set, (slice) => {
          const index = slice.tabs.findIndex(
            (tab) => tab.id === tabId && tab.type === 'review'
          );
          if (index < 0) return null;
          const current = slice.tabs[index] as SessionReviewTab;
          const tabs = [...slice.tabs];
          tabs[index] = { ...current, reviewComments: comments };
          return { ...slice, tabs };
        }),
      setReviewIdentity: (tabId, identity, targetKey) =>
        setSessionPreviewSlice(set, (slice) => {
          const index = slice.tabs.findIndex(
            (tab) => tab.id === tabId && tab.type === 'review'
          );
          if (index < 0) return null;
          const current = slice.tabs[index] as SessionReviewTab;
          const ownKey = reviewTargetIdentityKey(
            current.reviewTarget ?? createReviewTarget()
          );
          const key = targetKey ?? ownKey;
          // The tab's own scope keeps mirroring into `reviewIdentity` so tabs
          // persisted before per-scope pins existed still resolve.
          const mirrors = key === ownKey;
          // First write wins: the pin is what the out-of-date guard compares
          // against, so it must not drift onto each newly fetched revision.
          const pinned =
            current.reviewIdentities?.[key] ??
            (mirrors ? current.reviewIdentity : undefined) ??
            identity;
          const needsPin = current.reviewIdentities?.[key] !== pinned;
          const needsMirror = mirrors && current.reviewIdentity !== pinned;
          if (!needsPin && !needsMirror) return null;
          const tabs = [...slice.tabs];
          tabs[index] = {
            ...current,
            ...(needsMirror ? { reviewIdentity: pinned } : {}),
            ...(needsPin
              ? {
                  reviewIdentities: {
                    ...current.reviewIdentities,
                    [key]: pinned,
                  },
                }
              : {}),
          };
          return { ...slice, tabs };
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
      openAgentTerminalPreview: (sourceId, title, fromTabId) =>
        setSessionPreviewSlice(set, (slice) => {
          const existing = slice.tabs.find(
            (tab) => tab.type === 'terminal' && tab.agentSourceId === sourceId
          );
          if (existing) {
            return { ...slice, open: true, activeTabId: existing.id };
          }
          const tab: SessionTerminalTab = {
            id: nextSessionPreviewTabId('terminal'),
            type: 'terminal',
            title: title || 'Terminal',
            agentSourceId: sourceId,
          };
          const replaceIndex = fromTabId
            ? slice.tabs.findIndex(
                (candidate) =>
                  candidate.id === fromTabId && candidate.type === 'chooser'
              )
            : -1;
          const tabs = [...slice.tabs];
          if (replaceIndex >= 0) {
            tabs[replaceIndex] = tab;
          } else {
            tabs.push(tab);
          }
          return { open: true, tabs, activeTabId: tab.id };
        }),
      selectSessionPreviewTab: (tabId) =>
        setSessionPreviewSlice(set, (slice) =>
          slice.tabs.some((tab) => tab.id === tabId)
            ? { ...slice, activeTabId: tabId }
            : null
        ),
      closeSessionPreviewTab: (tabId) => {
        const closingTab = getSessionPreviewSlice(get()).tabs.find(
          (tab) => tab.id === tabId
        );
        if (closingTab) disposePreviewShellTabs([closingTab]);
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
        });
      },
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
      resetSessionPreview: () => {
        disposePreviewShellTabs(getSessionPreviewSlice(get()).tabs);
        setSessionPreviewSlice(set, () => ({
          open: false,
          tabs: [],
          activeTabId: null,
        }));
      },
      removeSessionPreviewProject: (projectId) => {
        const slice = get().sessionPreviewByProject[projectId];
        if (slice) disposePreviewShellTabs(slice.tabs);
        set((state) => {
          if (!state.sessionPreviewByProject[projectId]) return state;
          const sessionPreviewByProject = {
            ...state.sessionPreviewByProject,
          };
          delete sessionPreviewByProject[projectId];
          return {
            sessionPreviewByProject,
            ...(state.sessionPreviewProjectId === projectId
              ? {
                  sessionPreviewProjectId: null,
                  previewBrowserViewport: null,
                }
              : {}),
          };
        });
      },
    }),
    {
      name: 'eigent-page-tab',
      version: 5,
      // v1: Project.mode becomes the source of truth. Drop the legacy global
      // sessionSidePanelMode so mode no longer drifts between Projects.
      // v2: Project sidebar fold was removed; drop persisted fold state.
      // v5: Review tabs are task-focused; normalize their title and remove the
      // retired change-scope selection.
      migrate: (persistedState, version) => {
        if (persistedState && typeof persistedState === 'object') {
          const next = { ...(persistedState as Record<string, unknown>) };
          if (version < 1) {
            delete next.sessionSidePanelMode;
          }
          if (version < 2) {
            delete next.projectSidebarFolded;
          }
          if (version < 3) {
            // Summarised was retired; the density knob became a two-mode
            // switch between the narrative and trajectory renderers.
            next.chatTimelineDetailLevel = normalizeChatTimelineDetailLevel(
              next.chatTimelineDetailLevel
            );
          }
          if (version < 4) {
            next.workspaceReviewHandoffs = [];
          }
          if (
            version < 5 &&
            next.sessionPreviewByProject &&
            typeof next.sessionPreviewByProject === 'object'
          ) {
            next.sessionPreviewByProject = sanitizeSessionPreviewForPersist(
              next.sessionPreviewByProject as Record<
                string,
                SessionPreviewSlice
              >
            );
          }
          return next as unknown as PageTabState;
        }
        return persistedState as PageTabState;
      },
      partialize: (state) => ({
        workspaceSidebarHidden: state.workspaceSidebarHidden,
        chatTimelineDetailLevel: state.chatTimelineDetailLevel,
        customAgentFolderPathByProjectId:
          state.customAgentFolderPathByProjectId,
        workspaceReviewHandoffs: state.workspaceReviewHandoffs,
        sessionPreviewByProject: sanitizeSessionPreviewForPersist(
          state.sessionPreviewByProject
        ),
      }),
    }
  )
);
