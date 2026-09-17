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

import { ipcMain, type WebContents } from 'electron';
import log from 'electron-log';
import type { IPty } from 'node-pty';
import fs from 'node:fs';
import os from 'node:os';
import kill from 'tree-kill';
import { TerminalProcessTree } from './terminalProcessTree';

/**
 * Interactive shell sessions for the session page's terminal tabs. Each
 * session is a real PTY running the user's default shell, keyed by an id the
 * renderer generates. Sessions outlive the xterm UI (tab switches unmount the
 * renderer side); they die on explicit dispose or app quit.
 */
interface TerminalCreateResult {
  success: boolean;
  existing?: boolean;
  error?: string;
}

interface TerminalSession {
  /**
   * The renderer currently attached to this shell. This must remain mutable:
   * restored tabs reuse their persisted shell id from a new WebContents.
   */
  sender: WebContents;
  /** Set after node-pty loads and the synchronous spawn completes. */
  pty: IPty | null;
  /** Prevent a pending lazy load from spawning after disposal/app shutdown. */
  disposed: boolean;
  /** Shared by concurrent creates so only one PTY can be spawned per id. */
  creation: Promise<TerminalCreateResult>;
  stop?: Promise<{ success: boolean; error?: string }>;
  disposal?: Promise<{ success: boolean; error?: string }>;
  stopRequested?: boolean;
  processTree?: TerminalProcessTree;
  exitCode?: number;
}

const sessions = new Map<string, TerminalSession>();
let shuttingDown = false;

function publishTerminalExit(id: string, session: TerminalSession) {
  if (sessions.get(id) !== session || session.exitCode === undefined) return;
  sessions.delete(id);
  if (!session.disposed && !session.sender.isDestroyed()) {
    session.sender.send('terminal-exit', { id, exitCode: session.exitCode });
  }
}

/**
 * node-pty is a native module; load it lazily so a missing/broken binary
 * degrades to an error in the terminal tab instead of crashing main startup.
 */
async function loadNodePty(): Promise<typeof import('node-pty') | null> {
  try {
    return await import('node-pty');
  } catch (error) {
    log.error('[TERMINAL] Failed to load node-pty:', error);
    return null;
  }
}

function defaultShell(): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    return { file: 'powershell.exe', args: [] };
  }
  const shell = process.env.SHELL || '/bin/zsh';
  // Login shell so the user's profile (PATH, prompt, aliases) is loaded —
  // the tab should feel exactly like opening the desktop terminal.
  return { file: shell, args: ['-l'] };
}

/**
 * Do not leak credentials held by the Electron main process into an
 * interactive shell where a plain `env` would print them. Keep ordinary
 * desktop environment variables so the shell still inherits PATH, locale,
 * proxy configuration, and toolchain settings.
 */
const SENSITIVE_ENV_NAME =
  /(?:^|_)(?:API_KEY|TOKEN|PASSWORD|PASSWD|SECRET|PRIVATE_KEY|CAPABILITY)(?:$|_)/i;

export function terminalEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !SENSITIVE_ENV_NAME.test(entry[0])
    )
  );
}

export interface TerminalCreateOptions {
  id: string;
  cwd?: string;
  cols?: number;
  rows?: number;
}

async function createTerminalSession(
  session: TerminalSession,
  options: TerminalCreateOptions
): Promise<TerminalCreateResult> {
  const { id, cwd, cols, rows } = options;
  const pty = await loadNodePty();
  if (!pty) {
    if (sessions.get(id) === session) sessions.delete(id);
    return { success: false, error: 'Terminal backend unavailable' };
  }

  // terminal-dispose and app shutdown may run while node-pty is loading.
  if (session.disposed || sessions.get(id) !== session) {
    return { success: false, error: 'Terminal creation was cancelled' };
  }

  const { file, args } = defaultShell();
  const workingDir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
  try {
    const terminal = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: workingDir,
      env: terminalEnvironment(),
    });
    session.pty = terminal;
    if (process.platform !== 'win32') {
      try {
        session.processTree = new TerminalProcessTree(terminal.pid);
      } catch {
        // Shell use remains available, but Stop must fail closed if ownership
        // could not be established at spawn (never guess from a later PID).
        log.warn('[TERMINAL] Could not capture shell process identity');
      }
    }
    terminal.onData((data) => {
      if (session.disposed || sessions.get(id) !== session) return;
      const sender = session.sender;
      if (!sender.isDestroyed()) {
        sender.send('terminal-data', { id, data });
      }
    });
    terminal.onExit(({ exitCode }) => {
      session.exitCode = exitCode;
      // A disposed/restarted PTY can report its exit after a replacement with
      // the same id is already live. Do not mark that replacement as exited.
      if (sessions.get(id) !== session) return;
      // Stop owns completion until the captured descendants have also exited.
      // Keep failed cleanup addressable even if the PTY parent is gone.
      if (!session.stopRequested) publishTerminalExit(id, session);
    });
    log.info(`[TERMINAL] Created session ${id} (${file}) in ${workingDir}`);
    return { success: true };
  } catch (error) {
    if (sessions.get(id) === session) sessions.delete(id);
    log.error(`[TERMINAL] Failed to spawn shell for ${id}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to spawn shell',
    };
  }
}

async function stopTerminalSession(id: string, session: TerminalSession) {
  if (session.stop) return session.stop;
  session.stopRequested = true;
  const stopping = (async () => {
    await session.creation;
    if (sessions.get(id) !== session || !session.pty) return { success: true };
    const terminal = session.pty;
    const deadline = Date.now() + 5000;
    // Disposal does not need the interactive Stop grace period. An ongoing
    // Stop also observes disposed on its next poll and escalates immediately.
    let forced = session.disposed;
    try {
      if (process.platform === 'win32') {
        // tree-kill already uses taskkill /T /F on Windows. Wait for that
        // tree operation, not only the PTY exit, and never retry a dead PID.
        if (session.exitCode !== undefined) throw new Error('Parent exited');
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Stop timed out')),
            5000
          );
          kill(terminal.pid, 'SIGTERM', (error) => {
            clearTimeout(timer);
            if (error) reject(error);
            else resolve();
          });
        });
      } else {
        if (!session.processTree) throw new Error('Missing process identity');
        await session.processTree.signal(forced ? 'SIGKILL' : 'SIGTERM');
      }
      const forceAt = Date.now() + 1500;
      while (Date.now() < deadline) {
        const running = session.processTree
          ? await session.processTree.isRunning()
          : session.exitCode === undefined;
        if (!running && session.exitCode !== undefined) {
          publishTerminalExit(id, session);
          return { success: true };
        }
        if (!forced && (session.disposed || Date.now() >= forceAt)) {
          forced = true;
          await session.processTree?.signal('SIGKILL');
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return {
        success: false,
        error: 'Terminal did not exit. Try stopping it again.',
      };
    } catch {
      return { success: false, error: 'Could not stop terminal. Try again.' };
    }
  })();
  session.stop = stopping;
  const result = await stopping;
  if (!result.success && session.stop === stopping) session.stop = undefined;
  return result;
}

async function disposeTerminalSession(id: string, session: TerminalSession) {
  if (session.disposal) return session.disposal;
  session.disposed = true;
  const pendingStop = session.stop;
  const disposal = (async () => {
    let result = await stopTerminalSession(id, session);
    // A Stop already in flight may fail while disposal is joining it. Retry
    // once through the same captured identities; never fall back to pty.kill.
    if (!result.success && pendingStop)
      result = await stopTerminalSession(id, session);
    if (result.success) {
      if (sessions.get(id) === session) sessions.delete(id);
    } else {
      // Retain ownership for another dispose or app-quit cleanup attempt.
      log.warn(`[TERMINAL] Cleanup failed for ${id}: ${result.error}`);
    }
    return result;
  })();
  session.disposal = disposal;
  const result = await disposal;
  if (!result.success && session.disposal === disposal)
    session.disposal = undefined;
  return result;
}

export function registerTerminalIpcHandlers() {
  ipcMain.handle(
    'terminal-create',
    async (event, options: TerminalCreateOptions) => {
      const { id, cwd, cols, rows } = options ?? {};
      if (!id) return { success: false, error: 'Missing terminal id' };
      if (shuttingDown)
        return { success: false, error: 'Terminal creation was cancelled' };

      const existing = sessions.get(id);
      if (existing) {
        if (existing.disposed)
          return { success: false, error: 'Terminal cleanup is incomplete' };
        // A restored renderer becomes the owner of all subsequent output.
        existing.sender = event.sender;
        const result = await existing.creation;
        return result.success ? { ...result, existing: true } : result;
      }

      // Reserve the id before the lazy node-pty import yields. React dev
      // double-mounts and other concurrent callers now share this promise.
      const session: TerminalSession = {
        sender: event.sender,
        pty: null,
        disposed: false,
        creation: Promise.resolve({
          success: false,
          error: 'Terminal creation has not started',
        }),
      };
      sessions.set(id, session);
      session.creation = createTerminalSession(session, {
        id,
        cwd,
        cols,
        rows,
      });
      return session.creation;
    }
  );

  ipcMain.on(
    'terminal-input',
    (_event, payload: { id: string; data: string }) => {
      const session = sessions.get(payload?.id);
      if (!session?.disposed) session?.pty?.write(payload.data);
    }
  );

  ipcMain.on(
    'terminal-resize',
    (_event, payload: { id: string; cols: number; rows: number }) => {
      const session = sessions.get(payload?.id);
      const terminal = session?.disposed ? null : session?.pty;
      if (!terminal) return;
      const cols = Math.max(2, Math.floor(payload.cols || 0));
      const rows = Math.max(1, Math.floor(payload.rows || 0));
      try {
        terminal.resize(cols, rows);
      } catch (error) {
        log.warn(`[TERMINAL] Resize failed for ${payload.id}:`, error);
      }
    }
  );

  ipcMain.handle('terminal-stop', async (event, id: string) => {
    const session = sessions.get(id);
    if (!session) return { success: true };
    if (session.sender !== event.sender)
      return { success: false, error: 'Terminal owner mismatch' };
    return stopTerminalSession(id, session);
  });

  ipcMain.handle('terminal-dispose', (_event, id: string) => {
    const session = sessions.get(id);
    if (!session) return { success: true };
    return disposeTerminalSession(id, session);
  });
}

/** Kill every live shell (app quit). */
export async function disposeAllTerminals() {
  shuttingDown = true;
  const results = await Promise.all(
    [...sessions].map(([id, session]) => disposeTerminalSession(id, session))
  );
  return { success: results.every((result) => result.success) };
}
