import { create } from 'zustand'

interface SidebarState {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
}

export const useSidebarStore = create<SidebarState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
})) 