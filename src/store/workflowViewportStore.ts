import { create } from 'zustand'

interface WorkflowViewportState {
    moveLeft: (() => void) | null;
    moveRight: (() => void) | null;
    setMoveLeft: (fn: (() => void) | null) => void;
    setMoveRight: (fn: (() => void) | null) => void;
}

export const useWorkflowViewportStore = create<WorkflowViewportState>((set) => ({
    moveLeft: null,
    moveRight: null,
    setMoveLeft: (fn) => set({ moveLeft: fn }),
    setMoveRight: (fn) => set({ moveRight: fn }),
}))
