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
    projectId?: string;
    triggerId?: number;
    triggerName?: string;
    executionId?: string;
    metadata?: Record<string, any>;
}

interface ActivityLogStore {
    logs: ActivityLog[];
    addLog: (log: Omit<ActivityLog, 'id' | 'timestamp'>) => void;
    modifyLog: (executionId: string, updates: Partial<Omit<ActivityLog, 'id' | 'timestamp'>>) => boolean;
    clearLogs: () => void;
    clearLogsForProject: (projectId: string) => void;
    getRecentLogs: (count?: number) => ActivityLog[];
    getLogsForProject: (projectId: string, count?: number) => ActivityLog[];
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

    modifyLog: (executionId: string, updates: Partial<Omit<ActivityLog, 'id' | 'timestamp'>>) => {
        const logs = get().logs;
        const logIndex = logs.findIndex(log => log.executionId === executionId);
        
        if (logIndex === -1) {
            return false; // Log not found
        }

        set((state) => ({
            logs: state.logs.map((log, index) => 
                index === logIndex 
                    ? { ...log, ...updates, metadata: { ...log.metadata, ...updates.metadata } }
                    : log
            )
        }));
        
        return true;
    },

    clearLogs: () => {
        set({ logs: [] });
    },

    clearLogsForProject: (projectId: string) => {
        set((state) => ({
            logs: state.logs.filter(log => log.projectId !== projectId)
        }));
    },

    getRecentLogs: (count = 10) => {
        return get().logs.slice(0, count);
    },

    getLogsForProject: (projectId: string, count = 100) => {
        return get().logs.filter(log => log.projectId === projectId).slice(0, count);
    },
}));
