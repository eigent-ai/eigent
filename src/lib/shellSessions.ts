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

import i18next from 'i18next';

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
  stopping?: boolean;
  stopError?: string | null;
  url?: string;
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
  disposeView?: () => void;
}

/** Keep roughly this many UTF-16 code units per shell for replay on remount. */
const MAX_BUFFER_CODE_UNITS = 1_000_000;
// Covers CSI styling used by uvicorn/Vite and OSC hyperlinks emitted by shells.
const ANSI_SEQUENCE =
  /\u001b(?:\][^\u0007]*(?:\u0007|\u001b\\)|\[[0-?]*[ -/]*[@-~])/g;
const LOCAL_SERVER_URL =
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d+[^\s<>]*/;

const sessions = new Map<string, ShellSessionEntry>();
let ipcBound = false;
let revision = 0;
const registryListeners = new Set<() => void>();
export const subscribeShellRegistry = (listener: () => void) => {
  registryListeners.add(listener);
  return () => {
    registryListeners.delete(listener);
  };
};
export const getShellRegistryRevision = () => revision;
function notifyRegistry() {
  revision += 1;
  registryListeners.forEach((listener) => listener());
}
export function retainShellView(id: string, dispose: () => void) {
  entryFor(id).disposeView = dispose;
}

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
  notifyRegistry();
}

/** Attach the global IPC listeners once; they dispatch by shell id. */
function bindIpc(api: TerminalHostApi) {
  if (ipcBound) return;
  ipcBound = true;
  api.onTerminalData(({ id, data }: { id: string; data: string }) => {
    const entry = sessions.get(id);
    if (!entry) return;
    appendToBuffer(entry, data);
    const url = entry.buffer
      .slice(-8)
      .join('')
      .replace(ANSI_SEQUENCE, '')
      .match(LOCAL_SERVER_URL)?.[0];
    if (url && url !== entry.url) {
      entry.url = url.replace('0.0.0.0', '127.0.0.1').replace(/[),.;]+$/, '');
      notifyState(entry);
    }
    entry.dataListeners.forEach((listener) => listener(data));
  });
  api.onTerminalExit(({ id, exitCode }: { id: string; exitCode: number }) => {
    const entry = sessions.get(id);
    if (!entry) return;
    entry.exited = true;
    entry.exitCode = exitCode;
    entry.url = undefined;
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
  if (entry.created || entry.exited) return snapshot(entry);
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
        entry.error =
          result.error ??
          i18next.t('layout.shell-start-failed', {
            defaultValue: 'Failed to start shell',
          });
      }
      notifyState(entry);
      return snapshot(entry);
    })
    .catch((error: unknown) => {
      if (sessions.get(options.id) === entry) {
        entry.error =
          error instanceof Error
            ? error.message
            : i18next.t('layout.shell-start-failed', {
                defaultValue: 'Failed to start shell',
              });
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
  sessions.get(id)?.disposeView?.();
  sessions.delete(id);
  notifyRegistry();
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
  entry.disposeView?.();
  entry.disposeView = undefined;
  entry.url = undefined;
  entry.stopError = null;
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
  const entry = sessions.get(id);
  if (entry?.url && /[\r\n]/.test(data)) {
    entry.url = undefined;
    notifyState(entry);
  }
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
    stopping: entry.stopping,
    stopError: entry.stopError,
    url: entry.url,
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

/** Stop preserves both the parsed screen and output; closing a tab disposes them. */
export async function stopShellSession(api: Window['electronAPI'], id: string) {
  const entry = sessions.get(id);
  if (!entry || entry.exited || entry.stopping) return;
  entry.stopping = true;
  entry.stopError = null;
  notifyState(entry);
  try {
    const result = await api.terminalStop(id);
    if (!result.success)
      throw new Error(result.error || 'Could not stop shell');
    entry.exited = true;
  } catch (error) {
    entry.stopError = error instanceof Error ? error.message : String(error);
  } finally {
    entry.stopping = false;
    notifyState(entry);
  }
}
