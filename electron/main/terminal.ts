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

import { ipcMain } from 'electron';
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
const sessions = new Map<string, IPty>();

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

export interface TerminalCreateOptions {
  id: string;
  cwd?: string;
  cols?: number;
  rows?: number;
}

export function registerTerminalIpcHandlers() {
  ipcMain.handle(
    'terminal-create',
    async (event, options: TerminalCreateOptions) => {
      const { id, cwd, cols, rows } = options ?? {};
      if (!id) return { success: false, error: 'Missing terminal id' };
      if (sessions.has(id)) return { success: true, existing: true };

      const pty = await loadNodePty();
      if (!pty) {
        return { success: false, error: 'Terminal backend unavailable' };
      }

      const { file, args } = defaultShell();
      const workingDir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
      try {
        const session = pty.spawn(file, args, {
          name: 'xterm-256color',
          cols: cols || 80,
          rows: rows || 24,
          cwd: workingDir,
          env: process.env as Record<string, string>,
        });
        const sender = event.sender;
        session.onData((data) => {
          if (!sender.isDestroyed()) {
            sender.send('terminal-data', { id, data });
          }
        });
        session.onExit(({ exitCode }) => {
          sessions.delete(id);
          if (!sender.isDestroyed()) {
            sender.send('terminal-exit', { id, exitCode });
          }
        });
        sessions.set(id, session);
        log.info(`[TERMINAL] Created session ${id} (${file}) in ${workingDir}`);
        return { success: true };
      } catch (error) {
        log.error(`[TERMINAL] Failed to spawn shell for ${id}:`, error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : 'Failed to spawn shell',
        };
      }
    }
  );

  ipcMain.on(
    'terminal-input',
    (_event, payload: { id: string; data: string }) => {
      sessions.get(payload?.id)?.write(payload.data);
    }
  );

  ipcMain.on(
    'terminal-resize',
    (_event, payload: { id: string; cols: number; rows: number }) => {
      const session = sessions.get(payload?.id);
      if (!session) return;
      const cols = Math.max(2, Math.floor(payload.cols || 0));
      const rows = Math.max(1, Math.floor(payload.rows || 0));
      try {
        session.resize(cols, rows);
      } catch (error) {
        log.warn(`[TERMINAL] Resize failed for ${payload.id}:`, error);
      }
    }
  );

  ipcMain.handle('terminal-dispose', (_event, id: string) => {
    const session = sessions.get(id);
    if (!session) return { success: true };
    sessions.delete(id);
    try {
      session.kill();
    } catch (error) {
      log.warn(`[TERMINAL] Kill failed for ${id}:`, error);
    }
    return { success: true };
  });
}

/** Kill every live shell (app quit). */
export function disposeAllTerminals() {
  for (const [id, session] of sessions) {
    try {
      session.kill();
    } catch (error) {
      log.warn(`[TERMINAL] Kill failed for ${id} during shutdown:`, error);
    }
  }
  sessions.clear();
}
