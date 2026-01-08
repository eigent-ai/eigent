import { create } from 'zustand';
import { Trigger, TriggerInput, TriggerStatus, TriggerType, ListenerType } from '@/types';
import { mockTriggers as initialMockTriggers, mockExecutions, createMockTrigger, deleteMockTrigger } from '@/mocks/triggerMockData';

interface TriggerStore {
    // State
    triggers: Trigger[];

    // Actions
    addTrigger: (triggerData: TriggerInput) => Trigger;
    updateTrigger: (triggerId: number, triggerData: Partial<Trigger>) => void;
    deleteTrigger: (triggerId: number) => void;
    duplicateTrigger: (triggerId: number) => Trigger | null;
    getTriggerById: (triggerId: number) => Trigger | undefined;
}

export const useTriggerStore = create<TriggerStore>((set, get) => ({
    // Initialize with mock data
    triggers: [...initialMockTriggers],

    addTrigger: (triggerData: TriggerInput) => {
        const newTrigger = createMockTrigger({
            name: triggerData.name,
            description: triggerData.description,
            trigger_type: triggerData.trigger_type,
            custom_cron_expression: triggerData.custom_cron_expression,
            webhook_url: triggerData.webhook_url,
            listener_type: triggerData.listener_type,
            task_prompt: triggerData.task_prompt,
            agent_model: triggerData.agent_model,
            system_message: triggerData.system_message,
            max_executions_per_hour: triggerData.max_executions_per_hour,
            max_executions_per_day: triggerData.max_executions_per_day,
            is_single_execution: triggerData.is_single_execution,
        });

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
        deleteMockTrigger(triggerId);
        set((state) => ({
            triggers: state.triggers.filter((trigger) => trigger.id !== triggerId)
        }));
    },

    duplicateTrigger: (triggerId: number) => {
        const originalTrigger = get().triggers.find((t) => t.id === triggerId);
        if (!originalTrigger) return null;

        const duplicatedTrigger = createMockTrigger({
            name: `${originalTrigger.name} (Copy)`,
            description: originalTrigger.description,
            trigger_type: originalTrigger.trigger_type,
            custom_cron_expression: originalTrigger.custom_cron_expression,
            webhook_url: originalTrigger.webhook_url,
            listener_type: originalTrigger.listener_type,
            task_prompt: originalTrigger.task_prompt,
            agent_model: originalTrigger.agent_model,
            system_message: originalTrigger.system_message,
            max_executions_per_hour: originalTrigger.max_executions_per_hour,
            max_executions_per_day: originalTrigger.max_executions_per_day,
            is_single_execution: originalTrigger.is_single_execution,
        });

        set((state) => ({
            triggers: [...state.triggers, duplicatedTrigger]
        }));

        return duplicatedTrigger;
    },

    getTriggerById: (triggerId: number) => {
        return get().triggers.find((t) => t.id === triggerId);
    },
}));
