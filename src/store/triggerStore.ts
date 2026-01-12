import { create } from 'zustand';
import { Trigger, TriggerInput } from '@/types';

export interface WebSocketEvent {
    triggerId: number;
    triggerName: string;
    taskPrompt: string;
    executionId: string;
    timestamp: number;
    /** Type of trigger: webhook or scheduled */
    triggerType: 'webhook' | 'schedule';
    /** 
     * Target project ID where this task should run.
     * Future: triggers will be associated with specific projects.
     */
    projectId: string | null;
    /** Input data from webhook request or scheduled context */
    inputData: Record<string, any>;
}

interface TriggerStore {
    // State
    triggers: Trigger[];
    webSocketEvent: WebSocketEvent | null;

    // Actions
    setTriggers: (triggers: Trigger[]) => void;
    addTrigger: (triggerData: Partial<Trigger>) => Trigger;
    updateTrigger: (triggerId: number, triggerData: Partial<Trigger>) => void;
    deleteTrigger: (triggerId: number) => void;
    duplicateTrigger: (triggerId: number) => Trigger | null;
    getTriggerById: (triggerId: number) => Trigger | undefined;
    emitWebSocketEvent: (event: WebSocketEvent) => void;
    clearWebSocketEvent: () => void;
}

export const useTriggerStore = create<TriggerStore>((set, get) => ({
    // Initialize with mock data
    triggers: [],
    webSocketEvent: null,

    setTriggers: (triggers: Trigger[]) => {
        set({ triggers });
    },

    addTrigger: (triggerData: Partial<Trigger>) => {
        const newTrigger: Trigger = {
            id: triggerData.id || Date.now(),
            ...triggerData,
        } as Trigger;

        set((state) => ({
            triggers: [...state.triggers, newTrigger]
        }));

        return newTrigger;
    },

    updateTrigger: (triggerId: number, triggerData: Partial<Trigger>) => {
        set((state) => ({
            triggers: state.triggers.map((trigger) =>
                trigger.id === triggerId
                    ? { ...trigger, ...triggerData, updated_at: new Date().toISOString() }
                    : trigger
            )
        }));
    },

    deleteTrigger: (triggerId: number) => {
        set((state) => ({
            triggers: state.triggers.filter((trigger) => trigger.id !== triggerId)
        }));
    },

    duplicateTrigger: (triggerId: number) => {
        const originalTrigger = get().triggers.find((t) => t.id === triggerId);
        if (!originalTrigger) return null;

        set((state) => ({
            triggers: [...state.triggers, originalTrigger]
        }));

        return originalTrigger;
    },

    getTriggerById: (triggerId: number) => {
        return get().triggers.find((t) => t.id === triggerId);
    },

    emitWebSocketEvent: (event: WebSocketEvent) => {
        set({ webSocketEvent: event });
    },

    clearWebSocketEvent: () => {
        set({ webSocketEvent: null });
    },
}));
