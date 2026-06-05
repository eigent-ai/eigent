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

import { Trigger, TriggerType } from '@/types';
import { create } from 'zustand';

export interface WebSocketEvent {
  triggerId: number;
  triggerName: string;
  taskPrompt: string;
  executionId: string;
  timestamp: number;
  /** Type of trigger: webhook or scheduled */
  triggerType: TriggerType;
  /**
   * Target project ID where this task should run.
   * Future: triggers will be associated with specific projects.
   */
  projectId: string | null;
  /** Target Space ID for the project, when supplied by the backend event. */
  spaceId?: string | null;
  /** Input data from webhook request or scheduled context */
  inputData: Record<string, any>;
}

export type WebSocketConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'unhealthy';

export interface RemoteControlSession {
  sessionId: string;
  url: string;
  title: string;
  expiresAt?: string;
}

export type RemoteControlLogStatus = 'created' | 'stopped' | 'expired';

export interface RemoteControlLogEntry {
  id: string;
  time: string;
  name: string;
  status: RemoteControlLogStatus;
}

interface TriggerStore {
  // State
  triggers: Trigger[];
  webSocketEvent: WebSocketEvent | null;
  wsConnectionStatus: WebSocketConnectionStatus;
  lastPongTimestamp: number | null;
  wsReconnectCallback: (() => void) | null;
  activeRemoteControlSessions: RemoteControlSession[];
  remoteControlLogs: RemoteControlLogEntry[];

  // Actions
  setTriggers: (triggers: Trigger[]) => void;
  setWsConnectionStatus: (status: WebSocketConnectionStatus) => void;
  setLastPongTimestamp: (timestamp: number | null) => void;
  setWsReconnectCallback: (callback: (() => void) | null) => void;
  triggerReconnect: () => void;
  addTrigger: (triggerData: Partial<Trigger>) => Trigger;
  updateTrigger: (triggerId: number, triggerData: Partial<Trigger>) => void;
  deleteTrigger: (triggerId: number) => void;
  duplicateTrigger: (triggerId: number) => Trigger | null;
  getTriggerById: (triggerId: number) => Trigger | undefined;
  emitWebSocketEvent: (event: WebSocketEvent) => void;
  clearWebSocketEvent: () => void;
  addRemoteControlSession: (session: RemoteControlSession) => void;
  removeRemoteControlSession: (sessionId: string) => void;
  clearRemoteControlSessions: () => void;
  addRemoteControlLog: (
    entry: Omit<RemoteControlLogEntry, 'id' | 'time'>
  ) => void;
}

export const useTriggerStore = create<TriggerStore>((set, get) => ({
  // Initialize with mock data
  triggers: [],
  webSocketEvent: null,
  wsConnectionStatus: 'disconnected' as WebSocketConnectionStatus,
  lastPongTimestamp: null,
  wsReconnectCallback: null,
  activeRemoteControlSessions: [],
  remoteControlLogs: [],

  setTriggers: (triggers: Trigger[]) => {
    set({ triggers });
  },

  setWsConnectionStatus: (status: WebSocketConnectionStatus) => {
    set({ wsConnectionStatus: status });
  },

  setLastPongTimestamp: (timestamp: number | null) => {
    set({ lastPongTimestamp: timestamp });
  },

  setWsReconnectCallback: (callback: (() => void) | null) => {
    set({ wsReconnectCallback: callback });
  },

  triggerReconnect: () => {
    const callback = get().wsReconnectCallback;
    if (callback) {
      callback();
    }
  },

  addTrigger: (triggerData: Partial<Trigger>) => {
    const newTrigger: Trigger = {
      id: triggerData.id,
      ...triggerData,
    } as Trigger;

    set((state) => ({
      triggers: [...state.triggers, newTrigger],
    }));

    return newTrigger;
  },

  updateTrigger: (triggerId: number, triggerData: Partial<Trigger>) => {
    set((state) => ({
      triggers: state.triggers.map((trigger) =>
        trigger.id === triggerId
          ? { ...trigger, ...triggerData, updated_at: new Date().toISOString() }
          : trigger
      ),
    }));
  },

  deleteTrigger: (triggerId: number) => {
    set((state) => ({
      triggers: state.triggers.filter((trigger) => trigger.id !== triggerId),
    }));
  },

  duplicateTrigger: (triggerId: number) => {
    const originalTrigger = get().triggers.find((t) => t.id === triggerId);
    if (!originalTrigger) return null;

    set((state) => ({
      triggers: [...state.triggers, originalTrigger],
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

  addRemoteControlSession: (session: RemoteControlSession) => {
    set((state) => ({
      activeRemoteControlSessions: [
        ...state.activeRemoteControlSessions,
        session,
      ],
    }));
  },

  removeRemoteControlSession: (sessionId: string) => {
    set((state) => ({
      activeRemoteControlSessions: state.activeRemoteControlSessions.filter(
        (s) => s.sessionId !== sessionId
      ),
    }));
  },

  clearRemoteControlSessions: () => {
    set({ activeRemoteControlSessions: [] });
  },

  addRemoteControlLog: (entry) => {
    const newEntry: RemoteControlLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      time: new Date().toISOString(),
      ...entry,
    };
    set((state) => ({
      remoteControlLogs: [...state.remoteControlLogs, newEntry],
    }));
  },
}));
