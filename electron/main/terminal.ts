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
  /** Live renderer that owns this shell; a destroyed owner may be replaced. */
  sender: WebContents;
  /** Set after node-pty loads and the synchronous spawn completes. */
  pty: IPty | null;
  /** Prevent a pending lazy load from spawning after disposal/app shutdown. */
  disposed: boolean;
  /** Shared by concurrent creates so only one PTY can be spawned per id. */
  creation: Promise<TerminalCreateResult>;
  /** Short batching window prevents high-volume commands flooding IPC. */
  outputChunks: string[];
  outputCodeUnits: number;
  outputTimer: ReturnType<typeof setTimeout> | null;
}

const sessions = new Map<string, TerminalSession>();
const OUTPUT_BATCH_DELAY_MS = 16;
const OUTPUT_BATCH_MAX_CODE_UNITS = 64 * 1024;

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
 * Explicit environment contract for the local convenience shell.
 *
 * Proxy variables are intentionally excluded: proxy URLs commonly embed
 * credentials, so inheriting them would recreate the secret-leak problem this
 * allowlist prevents. The login shell may still load user-configured proxy
 * values from its own profile, where they are owned by the user rather than
 * the Electron main-process environment.
 */
const SAFE_ENV_NAMES = new Set(
  [
    'HOME',
    'USER',
    'LOGNAME',
    'SHELL',
    'PATH',
    'LANG',
    'TERM',
    'COLORTERM',
    'TMPDIR',
    'TMP',
    'TEMP',
    'SSH_AUTH_SOCK',
    'TERM_PROGRAM',
    'TERM_PROGRAM_VERSION',
    'NO_COLOR',
    'CLICOLOR',
    'CLICOLOR_FORCE',
    // Windows process/shell discovery.
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
    'PATHEXT',
    'USERPROFILE',
    'HOMEDRIVE',
    'HOMEPATH',
    'APPDATA',
    'LOCALAPPDATA',
    'PROGRAMDATA',
    'PROGRAMFILES',
    'PROGRAMFILES(X86)',
    'PROGRAMW6432',
    // Non-secret toolchain locations that a GUI-launched shell may need.
    'NVM_DIR',
    'VOLTA_HOME',
    'PNPM_HOME',
    'BUN_INSTALL',
    'CARGO_HOME',
    'RUSTUP_HOME',
    'GOPATH',
    'GOROOT',
    'JAVA_HOME',
    'PYENV_ROOT',
    'CONDA_PREFIX',
    'VIRTUAL_ENV',
  ].map((name) => name.toUpperCase())
);

function isSafeTerminalEnvironmentName(name: string): boolean {
  const upper = name.toUpperCase();
  return (
    SAFE_ENV_NAMES.has(upper) ||
    upper.startsWith('LC_') ||
    upper.startsWith('XDG_')
  );
}

export function terminalEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && isSafeTerminalEnvironmentName(entry[0])
    )
  );
}

function flushTerminalOutput(id: string, session: TerminalSession) {
  if (session.outputTimer) {
    clearTimeout(session.outputTimer);
    session.outputTimer = null;
  }
  if (sessions.get(id) !== session || session.outputChunks.length === 0) {
    session.outputChunks = [];
    session.outputCodeUnits = 0;
    return;
  }
  const data = session.outputChunks.join('');
  session.outputChunks = [];
  session.outputCodeUnits = 0;
  const sender = session.sender;
  if (!sender.isDestroyed()) {
    sender.send('terminal-data', { id, data });
  }
}

function queueTerminalOutput(
  id: string,
  session: TerminalSession,
  data: string
) {
  session.outputChunks.push(data);
  session.outputCodeUnits += data.length;
  if (session.outputCodeUnits >= OUTPUT_BATCH_MAX_CODE_UNITS) {
    flushTerminalOutput(id, session);
    return;
  }
  if (!session.outputTimer) {
    session.outputTimer = setTimeout(
      () => flushTerminalOutput(id, session),
      OUTPUT_BATCH_DELAY_MS
    );
  }
}

function terminalOwnedBy(
  session: TerminalSession,
  sender: WebContents
): boolean {
  if (session.sender === sender) return true;
  // macOS keeps the app and its PTYs alive after the last window closes. A
  // Dock reopen creates a new WebContents, so a restored tab must be able to
  // adopt an orphaned session. A second live renderer is still rejected.
  if (session.sender.isDestroyed()) {
    session.sender = sender;
    return true;
  }
  return false;
}

function dropQueuedOutput(session: TerminalSession) {
  if (session.outputTimer) clearTimeout(session.outputTimer);
  session.outputTimer = null;
  session.outputChunks = [];
  session.outputCodeUnits = 0;
}

export interface TerminalCreateOptions {
  id: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  allowHomeFallback?: boolean;
}

async function createTerminalSession(
  session: TerminalSession,
  options: TerminalCreateOptions
): Promise<TerminalCreateResult> {
  const { id, cwd, cols, rows, allowHomeFallback = true } = options;
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
  let workingDir: string;
  try {
    if (cwd && fs.statSync(cwd).isDirectory()) {
      workingDir = cwd;
    } else if (allowHomeFallback) {
      workingDir = os.homedir();
    } else {
      throw new Error('Project working directory is unavailable');
    }
  } catch {
    if (allowHomeFallback) {
      workingDir = os.homedir();
    } else {
      if (sessions.get(id) === session) sessions.delete(id);
      return {
        success: false,
        error: 'Project working directory is unavailable',
      };
    }
  }
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
      queueTerminalOutput(id, session, data);
    });
    terminal.onExit(({ exitCode }) => {
      // A disposed/restarted PTY can report its exit after a replacement with
      // the same id is already live. Do not mark that replacement as exited.
      if (sessions.get(id) !== session) return;
      flushTerminalOutput(id, session);
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
      const { id, cwd, cols, rows, allowHomeFallback } = options ?? {};
      if (!id) return { success: false, error: 'Missing terminal id' };

      const existing = sessions.get(id);
      if (existing) {
        if (!terminalOwnedBy(existing, event.sender)) {
          return {
            success: false,
            error: 'Terminal session is owned by another renderer',
          };
        }
        const result = await existing.creation;
        return result.success ? { ...result, existing: true } : result;
      }

      // Reserve the id before the lazy node-pty import yields. React dev
      // double-mounts and other concurrent callers now share this promise.
      const session: TerminalSession = {
        sender: event.sender,
        pty: null,
        disposed: false,
        outputChunks: [],
        outputCodeUnits: 0,
        outputTimer: null,
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
        allowHomeFallback,
      });
      return session.creation;
    }
  );

  ipcMain.on(
    'terminal-input',
    (event, payload: { id: string; data: string }) => {
      const session = sessions.get(payload?.id);
      if (!session || !terminalOwnedBy(session, event.sender)) return;
      session.pty?.write(payload.data);
    }
  );

  ipcMain.on(
    'terminal-resize',
    (event, payload: { id: string; cols: number; rows: number }) => {
      const session = sessions.get(payload?.id);
      if (!session || !terminalOwnedBy(session, event.sender)) return;
      const terminal = session.pty;
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

  ipcMain.handle('terminal-dispose', (event, id: string) => {
    const session = sessions.get(id);
    if (!session) return { success: true };
    if (!terminalOwnedBy(session, event.sender)) {
      return {
        success: false,
        error: 'Terminal session is owned by another renderer',
      };
    }
    sessions.delete(id);
    session.disposed = true;
    dropQueuedOutput(session);
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
    dropQueuedOutput(session);
    try {
      session.pty?.kill();
    } catch (error) {
      log.warn(`[TERMINAL] Kill failed for ${id} during shutdown:`, error);
    }
  }
  sessions.clear();
}
