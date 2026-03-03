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

interface PageTabState {
  activeTab: 'tasks' | 'trigger';
  setActiveTab: (tab: 'tasks' | 'trigger') => void;
  // Workspace tabs within the Tasks page
  activeWorkspaceTab: 'triggers' | 'workforce' | 'inbox';
  setActiveWorkspaceTab: (tab: 'triggers' | 'workforce' | 'inbox') => void;
  // Panel position for ChatBox
  chatPanelPosition: 'left' | 'right';
  setChatPanelPosition: (position: 'left' | 'right') => void;
  // Track if there are triggers (for dynamic menu toggle visibility)
  hasTriggers: boolean;
  setHasTriggers: (value: boolean) => void;
  // Track if there are files in agent folder (for dynamic menu toggle visibility)
  hasAgentFiles: boolean;
  setHasAgentFiles: (value: boolean) => void;
  // Track unviewed tabs with new content (for red dot indicator)
  unviewedTabs: Set<'triggers' | 'inbox'>;
  markTabAsViewed: (tab: 'triggers' | 'inbox') => void;
  markTabAsUnviewed: (tab: 'triggers' | 'inbox') => void;
}

export const usePageTabStore = create<PageTabState>((set) => ({
  activeTab: 'tasks',
  setActiveTab: (tab) => set({ activeTab: tab }),
  activeWorkspaceTab: 'workforce',
  setActiveWorkspaceTab: (tab) =>
    set((state) => {
      // When switching to a tab with new content, mark it as viewed
      const newUnviewedTabs = new Set(state.unviewedTabs);
      if (tab === 'triggers' || tab === 'inbox') {
        newUnviewedTabs.delete(tab);
      }
      return { activeWorkspaceTab: tab, unviewedTabs: newUnviewedTabs };
    }),
  chatPanelPosition: 'left',
  setChatPanelPosition: (position) => set({ chatPanelPosition: position }),
  // Trigger tracking
  hasTriggers: false,
  setHasTriggers: (value) => set({ hasTriggers: value }),
  // Agent files tracking
  hasAgentFiles: false,
  setHasAgentFiles: (value) => set({ hasAgentFiles: value }),
  // Unviewed tabs tracking
  unviewedTabs: new Set<'triggers' | 'inbox'>(),
  markTabAsViewed: (tab) =>
    set((state) => {
      const newUnviewedTabs = new Set(state.unviewedTabs);
      newUnviewedTabs.delete(tab);
      return { unviewedTabs: newUnviewedTabs };
    }),
  markTabAsUnviewed: (tab) =>
    set((state) => {
      const newUnviewedTabs = new Set(state.unviewedTabs);
      newUnviewedTabs.add(tab);
      return { unviewedTabs: newUnviewedTabs };
    }),
}));
