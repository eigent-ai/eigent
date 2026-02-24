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

export type ModifyLogOptions = {
  matchTypes?: ActivityType[];
  addIfNotFound?: boolean;
};

interface ActivityLogStore {
  logs: ActivityLog[];
  addLog: (log: Omit<ActivityLog, 'id' | 'timestamp'>) => void;
  modifyLog: (
    executionId: string,
    updates: Partial<Omit<ActivityLog, 'id' | 'timestamp'>>,
    options?: ModifyLogOptions
  ) => boolean;
  hasCompletionLog: (executionId: string) => boolean;
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
      logs: [newLog, ...state.logs].slice(0, 100), // Keep only last 100 logs
    }));
  },

  modifyLog: (
    executionId: string,
    updates: Partial<Omit<ActivityLog, 'id' | 'timestamp'>>,
    options?: ModifyLogOptions
  ) => {
    const { matchTypes, addIfNotFound } = options ?? {};
    const logs = get().logs;

    const logIndex = logs.findIndex((log) => {
      if (log.executionId !== executionId) return false;
      if (matchTypes?.length) return matchTypes.includes(log.type);
      return true;
    });

    if (logIndex >= 0) {
      const definedUpdates: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined && key !== 'metadata') {
          definedUpdates[key] = value;
        }
      }
      set((state) => ({
        logs: state.logs.map((log, index) =>
          index === logIndex
            ? {
                ...log,
                ...definedUpdates,
                metadata:
                  updates.metadata !== undefined
                    ? { ...log.metadata, ...updates.metadata }
                    : log.metadata,
              }
            : log
        ),
      }));
      return true;
    }

    if (addIfNotFound) {
      get().addLog({ ...updates, executionId });
      return true;
    }
    return false;
  },

  clearLogs: () => {
    set({ logs: [] });
  },

  clearLogsForProject: (projectId: string) => {
    set((state) => ({
      logs: state.logs.filter((log) => log.projectId !== projectId),
    }));
  },

  getRecentLogs: (count = 10) => {
    return get().logs.slice(0, count);
  },

  getLogsForProject: (projectId: string, count = 100) => {
    return get()
      .logs.filter((log) => log.projectId === projectId)
      .slice(0, count);
  },

  hasCompletionLog: (executionId: string) => {
    return get().logs.some(
      (log) =>
        log.executionId === executionId &&
        (log.type === ActivityType.ExecutionSuccess ||
          log.type === ActivityType.ExecutionFailed)
    );
  },
}));
