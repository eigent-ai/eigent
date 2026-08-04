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
 * Renderer-side registry for interactive shell sessions (main-process PTYs).
 * The PTY outlives the xterm UI — switching preview tabs unmounts the
 * terminal component — so this module owns the IPC listeners and a rolling
 * output buffer per shell, letting a remounted terminal replay its scrollback
 * and re-attach to the live stream.
 */

type TerminalHostApi = Pick<
  Window['electronAPI'],
  | 'terminalCreate'
  | 'terminalInput'
  | 'terminalResize'
  | 'terminalDispose'
  | 'onTerminalData'
  | 'onTerminalExit'
>;

export interface ShellSessionState {
  /** The PTY was spawned (or confirmed alive) at least once. */
  created: boolean;
  exited: boolean;
  exitCode: number | null;
  error: string | null;
}

interface ShellSessionEntry extends ShellSessionState {
  buffer: string[];
  bufferCodeUnits: number;
  dataListeners: Set<(chunk: string) => void>;
  stateListeners: Set<() => void>;
  createPromise: Promise<ShellSessionState> | null;
}

/** Keep roughly this many UTF-16 code units per shell for replay on remount. */
const MAX_BUFFER_CODE_UNITS = 1_000_000;

const sessions = new Map<string, ShellSessionEntry>();
let ipcBound = false;

function entryFor(id: string): ShellSessionEntry {
  let entry = sessions.get(id);
  if (!entry) {
    entry = {
      created: false,
      exited: false,
      exitCode: null,
      error: null,
      buffer: [],
      bufferCodeUnits: 0,
      dataListeners: new Set(),
      stateListeners: new Set(),
      createPromise: null,
    };
    sessions.set(id, entry);
  }
  return entry;
}

function appendToBuffer(entry: ShellSessionEntry, chunk: string) {
  entry.buffer.push(chunk);
  entry.bufferCodeUnits += chunk.length;
  while (
    entry.bufferCodeUnits > MAX_BUFFER_CODE_UNITS &&
    entry.buffer.length > 1
  ) {
    entry.bufferCodeUnits -= entry.buffer[0].length;
    entry.buffer.shift();
  }
}

function notifyState(entry: ShellSessionEntry) {
  entry.stateListeners.forEach((listener) => listener());
}

/** Attach the global IPC listeners once; they dispatch by shell id. */
function bindIpc(api: TerminalHostApi) {
  if (ipcBound) return;
  ipcBound = true;
  api.onTerminalData(({ id, data }: { id: string; data: string }) => {
    const entry = sessions.get(id);
    if (!entry) return;
    appendToBuffer(entry, data);
    entry.dataListeners.forEach((listener) => listener(data));
  });
  api.onTerminalExit(({ id, exitCode }: { id: string; exitCode: number }) => {
    const entry = sessions.get(id);
    if (!entry) return;
    entry.exited = true;
    entry.exitCode = exitCode;
    notifyState(entry);
  });
}

export interface EnsureShellOptions {
  id: string;
  cwd?: string;
  cols?: number;
  rows?: number;
}

/**
 * Spawn the shell if it isn't already running. Safe to call on every mount:
 * the main process keeps one PTY per id and reports `existing` when alive.
 */
export async function ensureShellSession(
  api: TerminalHostApi,
  options: EnsureShellOptions
): Promise<ShellSessionState> {
  bindIpc(api);
  const entry = entryFor(options.id);
  if (entry.created && !entry.exited) return snapshot(entry);
  if (entry.createPromise) return entry.createPromise;

  const createPromise = api
    .terminalCreate(options)
    .then((result: Awaited<ReturnType<TerminalHostApi['terminalCreate']>>) => {
      // The tab/project may have been disposed while IPC was in flight.
      if (sessions.get(options.id) !== entry) return snapshot(entry);
      if (result.success) {
        entry.created = true;
        entry.exited = false;
        entry.exitCode = null;
        entry.error = null;
      } else {
        entry.error = result.error ?? 'Failed to start shell';
      }
      notifyState(entry);
      return snapshot(entry);
    })
    .catch((error: unknown) => {
      if (sessions.get(options.id) === entry) {
        entry.error =
          error instanceof Error ? error.message : 'Failed to start shell';
        notifyState(entry);
      }
      return snapshot(entry);
    })
    .finally(() => {
      if (entry.createPromise === createPromise) {
        entry.createPromise = null;
      }
    });
  entry.createPromise = createPromise;
  return createPromise;
}

/** Kill the PTY and drop all local state (tab closed). */
export function disposeShellSession(
  api: TerminalHostApi | undefined,
  id: string
) {
  sessions.delete(id);
  void api?.terminalDispose(id);
}

/**
 * Kill any still-live PTY before clearing the renderer state. Creation only
 * starts after the dispose IPC resolves, so an error notice cannot reconnect
 * to the old shell with blank scrollback.
 */
export async function resetShellSession(
  api: TerminalHostApi,
  id: string
): Promise<boolean> {
  try {
    await api.terminalDispose(id);
  } catch {
    return false;
  }
  const entry = entryFor(id);
  entry.createPromise = null;
  entry.created = false;
  entry.exited = false;
  entry.exitCode = null;
  entry.error = null;
  entry.buffer = [];
  entry.bufferCodeUnits = 0;
  notifyState(entry);
  return true;
}

export function writeToShell(api: TerminalHostApi, id: string, data: string) {
  api.terminalInput(id, data);
}

export function resizeShell(
  api: TerminalHostApi,
  id: string,
  cols: number,
  rows: number
) {
  api.terminalResize(id, cols, rows);
}

/** Buffered output for scrollback replay on remount. */
export function getShellBuffer(id: string): string {
  return sessions.get(id)?.buffer.join('') ?? '';
}

function snapshot(entry: ShellSessionEntry): ShellSessionState {
  return {
    created: entry.created,
    exited: entry.exited,
    exitCode: entry.exitCode,
    error: entry.error,
  };
}

export function getShellSessionState(id: string): ShellSessionState {
  const entry = sessions.get(id);
  return entry
    ? snapshot(entry)
    : { created: false, exited: false, exitCode: null, error: null };
}

/** Live output subscription; returns the unsubscribe function. */
export function subscribeShellData(
  id: string,
  listener: (chunk: string) => void
): () => void {
  const entry = entryFor(id);
  entry.dataListeners.add(listener);
  return () => entry.dataListeners.delete(listener);
}

/** Lifecycle subscription (created / exited / error); fires on any change. */
export function subscribeShellState(
  id: string,
  listener: () => void
): () => void {
  const entry = entryFor(id);
  entry.stateListeners.add(listener);
  return () => entry.stateListeners.delete(listener);
}
