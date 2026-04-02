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

/**
 * Connection config for Phase 2: Brain endpoint, channel, session.
 * Used by ConnectionProvider and http.ts getBaseURL.
 */

export type ConnectionChannel =
  | 'desktop'
  | 'web'
  | 'cli'
  | 'whatsapp'
  | 'telegram'
  | 'slack'
  | 'discord'
  | 'lark'
  | 'browser_extension';

export interface ConnectionConfig {
  brainEndpoint: string;
  channel: ConnectionChannel;
  sessionId?: string;
  authToken?: string;
}

const SESSION_STORAGE_KEY = 'eigent_session_id';

function isWebRuntime(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const win = window as Window & {
    electronAPI?: unknown;
    ipcRenderer?: unknown;
  };
  return !win.electronAPI && !win.ipcRenderer;
}

function readStoredSessionId(): string | undefined {
  if (!isWebRuntime()) {
    return undefined;
  }

  try {
    return localStorage.getItem(SESSION_STORAGE_KEY) || undefined;
  } catch {
    return undefined;
  }
}

function persistStoredSessionId(sessionId?: string): void {
  if (!isWebRuntime()) {
    return;
  }

  try {
    if (sessionId) {
      localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures in private mode or restricted environments.
  }
}

let connectionConfig: ConnectionConfig = {
  brainEndpoint: '',
  channel: 'desktop',
  sessionId: readStoredSessionId(),
};

export function setConnectionConfig(config: Partial<ConnectionConfig>): void {
  connectionConfig = { ...connectionConfig, ...config };

  if (connectionConfig.channel === 'web' && 'sessionId' in config) {
    persistStoredSessionId(connectionConfig.sessionId);
  }
}

export function getConnectionConfig(): ConnectionConfig {
  return { ...connectionConfig };
}

export function resetConnectionConfig(): void {
  connectionConfig = {
    brainEndpoint: '',
    channel: 'desktop',
    sessionId: undefined,
  };
  persistStoredSessionId(undefined);
}
