import { create } from 'zustand'

interface PageTabState {
    activeTab: 'tasks' | 'trigger'
    setActiveTab: (tab: 'tasks' | 'trigger') => void
    // Workspace tabs within the Tasks page
    activeWorkspaceTab: 'overview' | 'workforce' | 'inbox'
    setActiveWorkspaceTab: (tab: 'overview' | 'workforce' | 'inbox') => void
    // Panel position for ChatBox
    chatPanelPosition: 'left' | 'right'
    setChatPanelPosition: (position: 'left' | 'right') => void
    // Track if there are triggers (for dynamic menu toggle visibility)
    hasTriggers: boolean
    setHasTriggers: (value: boolean) => void
    // Track if there are files in agent folder (for dynamic menu toggle visibility)
    hasAgentFiles: boolean
    setHasAgentFiles: (value: boolean) => void
    // Track unviewed tabs with new content (for red dot indicator)
    unviewedTabs: Set<'overview' | 'inbox'>
    markTabAsViewed: (tab: 'overview' | 'inbox') => void
    markTabAsUnviewed: (tab: 'overview' | 'inbox') => void
}

export const usePageTabStore = create<PageTabState>((set) => ({
    activeTab: 'tasks',
    setActiveTab: (tab) => set({ activeTab: tab }),
    activeWorkspaceTab: 'workforce',
    setActiveWorkspaceTab: (tab) => set((state) => {
        // When switching to a tab with new content, mark it as viewed
        const newUnviewedTabs = new Set(state.unviewedTabs);
        if (tab === 'overview' || tab === 'inbox') {
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
    unviewedTabs: new Set<'overview' | 'inbox'>(),
    markTabAsViewed: (tab) => set((state) => {
        const newUnviewedTabs = new Set(state.unviewedTabs);
        newUnviewedTabs.delete(tab);
        return { unviewedTabs: newUnviewedTabs };
    }),
    markTabAsUnviewed: (tab) => set((state) => {
        const newUnviewedTabs = new Set(state.unviewedTabs);
        newUnviewedTabs.add(tab);
        return { unviewedTabs: newUnviewedTabs };
    }),
}))
