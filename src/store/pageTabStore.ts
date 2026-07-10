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

export type SessionPreviewTab = SessionBrowserTab | SessionFileTab;

let sessionPreviewTabSequence = 0;

function nextSessionPreviewTabId(type: SessionPreviewTab['type']): string {
  sessionPreviewTabSequence += 1;
  return `${type}-${sessionPreviewTabSequence}`;
}

function createBrowserPreviewTab(): SessionBrowserTab {
  const id = nextSessionPreviewTabId('browser');
  return {
    id,
    type: 'browser',
    title: 'New tab',
    url: '',
    webviewId: `session-preview:${id}`,
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

function createInitialSessionPreviewTabs(): {
  tabs: SessionPreviewTab[];
  activeTabId: string;
} {
  const browserTab = createBrowserPreviewTab();
  const fileTab = createFilePreviewTab();
  return { tabs: [browserTab, fileTab], activeTabId: browserTab.id };
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
  sessionPreviewOpen: boolean;
  sessionPreviewTabs: SessionPreviewTab[];
  activeSessionPreviewTabId: string | null;
  /** Toggle the unified browser/file preview panel. */
  toggleSessionPreview: () => void;
  /** Add and activate a blank browser tab. */
  addBrowserPreviewTab: () => void;
  /** Add and activate an empty file tab. */
  addFilePreviewTab: () => void;
  /** Open a file in a deduplicated file tab. */
  openFilePreview: (file?: FileInfo | null) => void;
  selectSessionPreviewTab: (tabId: string) => void;
  closeSessionPreviewTab: (tabId: string) => void;
  updateBrowserPreviewTab: (
    tabId: string,
    patch: Partial<Omit<SessionBrowserTab, 'id' | 'type' | 'webviewId'>>
  ) => void;
  closeSessionPreview: () => void;
  resetSessionPreview: () => void;
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

      sessionPreviewOpen: false,
      sessionPreviewTabs: [],
      activeSessionPreviewTabId: null,
      toggleSessionPreview: () =>
        set((state) => {
          if (state.sessionPreviewOpen) {
            return { sessionPreviewOpen: false };
          }
          if (state.sessionPreviewTabs.length > 0) {
            return { sessionPreviewOpen: true };
          }
          const initial = createInitialSessionPreviewTabs();
          return {
            sessionPreviewOpen: true,
            sessionPreviewTabs: initial.tabs,
            activeSessionPreviewTabId: initial.activeTabId,
          };
        }),
      addBrowserPreviewTab: () =>
        set((state) => {
          const tab = createBrowserPreviewTab();
          return {
            sessionPreviewOpen: true,
            sessionPreviewTabs: [...state.sessionPreviewTabs, tab],
            activeSessionPreviewTabId: tab.id,
          };
        }),
      addFilePreviewTab: () =>
        set((state) => {
          const tab = createFilePreviewTab();
          return {
            sessionPreviewOpen: true,
            sessionPreviewTabs: [...state.sessionPreviewTabs, tab],
            activeSessionPreviewTabId: tab.id,
          };
        }),
      openFilePreview: (file) =>
        set((state) => {
          const targetFile = file ?? null;
          const initial =
            state.sessionPreviewTabs.length === 0
              ? createInitialSessionPreviewTabs()
              : null;
          const previewTabs = initial?.tabs ?? state.sessionPreviewTabs;
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
              sessionPreviewOpen: true,
              sessionPreviewTabs: previewTabs,
              activeSessionPreviewTabId: matchingTab.id,
            };
          }

          const emptyFileTabIndex = targetFile
            ? (() => {
                const activeIndex = previewTabs.findIndex(
                  (tab) =>
                    tab.id === state.activeSessionPreviewTabId &&
                    tab.type === 'file' &&
                    tab.file === null
                );
                return activeIndex >= 0
                  ? activeIndex
                  : previewTabs.findIndex(
                      (tab) => tab.type === 'file' && tab.file === null
                    );
              })()
            : -1;
          if (emptyFileTabIndex >= 0) {
            const tabs = [...previewTabs];
            const current = tabs[emptyFileTabIndex] as SessionFileTab;
            const replacement: SessionFileTab = {
              ...current,
              title: targetFile?.name || 'Open file',
              file: targetFile,
            };
            tabs[emptyFileTabIndex] = replacement;
            return {
              sessionPreviewOpen: true,
              sessionPreviewTabs: tabs,
              activeSessionPreviewTabId: replacement.id,
            };
          }

          const tab = createFilePreviewTab(targetFile);
          return {
            sessionPreviewOpen: true,
            sessionPreviewTabs: [...previewTabs, tab],
            activeSessionPreviewTabId: tab.id,
          };
        }),
      selectSessionPreviewTab: (tabId) =>
        set((state) =>
          state.sessionPreviewTabs.some((tab) => tab.id === tabId)
            ? { activeSessionPreviewTabId: tabId }
            : state
        ),
      closeSessionPreviewTab: (tabId) =>
        set((state) => {
          const closingIndex = state.sessionPreviewTabs.findIndex(
            (tab) => tab.id === tabId
          );
          if (closingIndex < 0) return state;
          const tabs = state.sessionPreviewTabs.filter(
            (tab) => tab.id !== tabId
          );
          if (tabs.length === 0) {
            return {
              sessionPreviewOpen: false,
              sessionPreviewTabs: [],
              activeSessionPreviewTabId: null,
            };
          }
          if (state.activeSessionPreviewTabId !== tabId) {
            return { sessionPreviewTabs: tabs };
          }
          const nextTab = tabs[Math.min(closingIndex, tabs.length - 1)];
          return {
            sessionPreviewTabs: tabs,
            activeSessionPreviewTabId: nextTab.id,
          };
        }),
      updateBrowserPreviewTab: (tabId, patch) =>
        set((state) => ({
          sessionPreviewTabs: state.sessionPreviewTabs.map((tab) =>
            tab.id === tabId && tab.type === 'browser'
              ? { ...tab, ...patch }
              : tab
          ),
        })),
      closeSessionPreview: () => set({ sessionPreviewOpen: false }),
      resetSessionPreview: () =>
        set({
          sessionPreviewOpen: false,
          sessionPreviewTabs: [],
          activeSessionPreviewTabId: null,
        }),
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
      }),
    }
  )
);
