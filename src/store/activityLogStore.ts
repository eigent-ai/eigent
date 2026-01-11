import { create } from 'zustand';

export enum ActivityType {
    TriggerCreated = 'trigger_created',
    TriggerUpdated = 'trigger_updated',
    TriggerDeleted = 'trigger_deleted',
    TriggerActivated = 'trigger_activated',
    TriggerDeactivated = 'trigger_deactivated',
    TriggerExecuted = 'trigger_executed',
    ExecutionSuccess = 'execution_success',
    ExecutionFailed = 'execution_failed',
    WebhookTriggered = 'webhook_triggered',
    TaskCompleted = 'task_completed',
    AgentStarted = 'agent_started',
    FileGenerated = 'file_generated',
}

export interface ActivityLog {
    id: string;
    type: ActivityType;
    message: string;
    timestamp: Date;
    triggerId?: number;
    triggerName?: string;
    executionId?: string;
    metadata?: Record<string, any>;
}

interface ActivityLogStore {
    logs: ActivityLog[];
    addLog: (log: Omit<ActivityLog, 'id' | 'timestamp'>) => void;
    clearLogs: () => void;
    getRecentLogs: (count?: number) => ActivityLog[];
}

let logIdCounter = 1;

export const useActivityLogStore = create<ActivityLogStore>((set, get) => ({
    logs: [],

    addLog: (logData) => {
        const newLog: ActivityLog = {
            ...logData,
            id: `log_${Date.now()}_${logIdCounter++}`,
            timestamp: new Date(),
        };

        set((state) => ({
            logs: [newLog, ...state.logs].slice(0, 100) // Keep only last 100 logs
        }));
    },

    clearLogs: () => {
        set({ logs: [] });
    },

    getRecentLogs: (count = 10) => {
        return get().logs.slice(0, count);
    },
}));
