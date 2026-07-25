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
}

const sessions = new Map<string, TerminalSession>();

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
  /(?:^|_)(?:API_KEY|TOKEN|PASSWORD|PASSWD|SECRET|PRIVATE_KEY)(?:$|_)/i;

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
    terminal.onData((data) => {
      if (sessions.get(id) !== session) return;
      const sender = session.sender;
      if (!sender.isDestroyed()) {
        sender.send('terminal-data', { id, data });
      }
    });
    terminal.onExit(({ exitCode }) => {
      // A disposed/restarted PTY can report its exit after a replacement with
      // the same id is already live. Do not mark that replacement as exited.
      if (sessions.get(id) !== session) return;
      sessions.delete(id);
      const sender = session.sender;
      if (!sender.isDestroyed()) {
        sender.send('terminal-exit', { id, exitCode });
      }
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

export function registerTerminalIpcHandlers() {
  ipcMain.handle(
    'terminal-create',
    async (event, options: TerminalCreateOptions) => {
      const { id, cwd, cols, rows } = options ?? {};
      if (!id) return { success: false, error: 'Missing terminal id' };

      const existing = sessions.get(id);
      if (existing) {
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
      sessions.get(payload?.id)?.pty?.write(payload.data);
    }
  );

  ipcMain.on(
    'terminal-resize',
    (_event, payload: { id: string; cols: number; rows: number }) => {
      const terminal = sessions.get(payload?.id)?.pty;
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

  ipcMain.handle('terminal-dispose', (_event, id: string) => {
    const session = sessions.get(id);
    if (!session) return { success: true };
    sessions.delete(id);
    session.disposed = true;
    try {
      session.pty?.kill();
    } catch (error) {
      log.warn(`[TERMINAL] Kill failed for ${id}:`, error);
    }
    return { success: true };
  });
}

/** Kill every live shell (app quit). */
export function disposeAllTerminals() {
  for (const [id, session] of sessions) {
    session.disposed = true;
    try {
      session.pty?.kill();
    } catch (error) {
      log.warn(`[TERMINAL] Kill failed for ${id} during shutdown:`, error);
    }
  }
  sessions.clear();
}
