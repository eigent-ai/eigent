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
}

export const usePageTabStore = create<PageTabState>((set) => ({
    activeTab: 'tasks',
    setActiveTab: (tab) => set({ activeTab: tab }),
    activeWorkspaceTab: 'workforce',
    setActiveWorkspaceTab: (tab) => set({ activeWorkspaceTab: tab }),
    chatPanelPosition: 'left',
    setChatPanelPosition: (position) => set({ chatPanelPosition: position }),
}))
