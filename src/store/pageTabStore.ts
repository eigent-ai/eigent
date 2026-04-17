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

import type { SessionModeType } from '@/types/constants';
import { SessionMode } from '@/types/constants';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface PageTabState {
  activeTab: 'tasks' | 'trigger';
  setActiveTab: (tab: 'tasks' | 'trigger') => void;
  // Workspace tabs within the Tasks page (sidebar → main panel)
  activeWorkspaceTab:
    | 'workforce'
    | 'inbox'
    | 'triggers'
    | 'sessions'
    | 'session';
  setActiveWorkspaceTab: (
    tab: 'workforce' | 'inbox' | 'triggers' | 'sessions' | 'session',
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
  /** Session view: workforce vs single-agent side panel (Workspace toggle + Session). */
  sessionSidePanelMode: SessionModeType;
  setSessionSidePanelMode: (mode: SessionModeType) => void;
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
            tab === 'workforce' || tab === 'session' || tab === 'sessions';
          return {
            ...(alreadyOnWorkspaceChat
              ? {}
              : { activeWorkspaceTab: 'session' as const }),
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
      sessionSidePanelMode: SessionMode.WORKFORCE,
      setSessionSidePanelMode: (mode) => set({ sessionSidePanelMode: mode }),
    }),
    {
      name: 'eigent-page-tab',
      partialize: (state) => ({
        projectSidebarFolded: state.projectSidebarFolded,
        customAgentFolderPathByProjectId:
          state.customAgentFolderPathByProjectId,
        sessionSidePanelMode: state.sessionSidePanelMode,
      }),
    }
  )
);
