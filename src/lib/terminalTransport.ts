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

export interface TerminalCreateOptions {
  id: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  /** Project terminals must fail instead of silently opening outside cwd. */
  allowHomeFallback?: boolean;
}

export interface TerminalCreateResult {
  success: boolean;
  existing?: boolean;
  error?: string;
}

export interface TerminalTransport {
  readonly kind: 'electron-local' | 'brain';
  create(options: TerminalCreateOptions): Promise<TerminalCreateResult>;
  input(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  dispose(id: string): Promise<{ success: boolean; error?: string }>;
  onData(callback: (payload: { id: string; data: string }) => void): () => void;
  onExit(
    callback: (payload: { id: string; exitCode: number }) => void
  ): () => void;
}

const electronTransports = new WeakMap<object, TerminalTransport>();

/** Adapter for the Desktop-local PTY. A Brain adapter can implement the same contract. */
export function createElectronTerminalTransport(
  api: Window['electronAPI'] | null | undefined
): TerminalTransport | null {
  if (!api?.terminalCreate) return null;
  const key = api as object;
  const cached = electronTransports.get(key);
  if (cached) return cached;
  const transport: TerminalTransport = {
    kind: 'electron-local',
    create: (options) => api.terminalCreate(options),
    input: (id, data) => api.terminalInput(id, data),
    resize: (id, cols, rows) => api.terminalResize(id, cols, rows),
    dispose: (id) => api.terminalDispose(id),
    onData: (callback) => api.onTerminalData(callback),
    onExit: (callback) => api.onTerminalExit(callback),
  };
  electronTransports.set(key, transport);
  return transport;
}
