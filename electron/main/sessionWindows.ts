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

import fs from 'node:fs';
import path from 'node:path';
import {
  captureWindowState,
  parseWindowState,
  type PersistedWindowStateV2,
  type WindowStateSource,
} from './windowState';

export const SESSION_WINDOWS_FILE_NAME = 'session-windows.json';
const SESSION_WINDOWS_VERSION = 1;
const MAX_SESSION_WINDOWS = 20;
const TARGET_ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;

/** The Session a window shows. */
export interface SessionWindowTarget {
  spaceId: string;
  projectId: string;
}

interface SavedSessionWindow extends SessionWindowTarget {
  state?: PersistedWindowStateV2;
}

/** The subset of BrowserWindow the manager drives. */
export interface SessionWindowLike extends WindowStateSource {
  readonly webContents: { readonly id: number };
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  focus(): void;
  close(): void;
  on(event: 'move' | 'resize' | 'closed', listener: () => void): unknown;
}

export interface SessionWindowManagerOptions<W extends SessionWindowLike> {
  userDataPath: string;
  /** Builds and loads the window. `state` is the saved placement, if any. */
  createWindow: (
    target: SessionWindowTarget,
    state: PersistedWindowStateV2 | null
  ) => W;
  /** Told after a window closed, unless the app is quitting. */
  onClosed?: (target: SessionWindowTarget) => void;
  io?: Pick<typeof fs, 'readFileSync' | 'writeFileSync' | 'mkdirSync'>;
  scheduleSave?: (save: () => void) => void;
}

export function isSessionWindowTarget(
  value: unknown
): value is SessionWindowTarget {
  if (!value || typeof value !== 'object') return false;
  const { spaceId, projectId } = value as Record<string, unknown>;
  return (
    typeof spaceId === 'string' &&
    typeof projectId === 'string' &&
    TARGET_ID_PATTERN.test(spaceId) &&
    TARGET_ID_PATTERN.test(projectId)
  );
}

/** Hash route of the Session window renderer. */
export function sessionWindowRoute({
  spaceId,
  projectId,
}: SessionWindowTarget) {
  return `/session-window/${encodeURIComponent(spaceId)}/${encodeURIComponent(
    projectId
  )}`;
}

function parseSaved(raw: string): SavedSessionWindow[] {
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; windows?: unknown };
    if (parsed?.version !== SESSION_WINDOWS_VERSION) return [];
    if (!Array.isArray(parsed.windows)) return [];
    const seen = new Set<string>();
    const result: SavedSessionWindow[] = [];
    for (const entry of parsed.windows) {
      if (!isSessionWindowTarget(entry) || seen.has(entry.projectId)) continue;
      seen.add(entry.projectId);
      const state = parseWindowState((entry as { state?: unknown }).state);
      result.push({
        spaceId: entry.spaceId,
        projectId: entry.projectId,
        ...(state ? { state } : {}),
      });
      if (result.length >= MAX_SESSION_WINDOWS) break;
    }
    return result;
  } catch {
    return [];
  }
}

/**
 * Session windows: one per Session. Their list and placement are saved so the
 * app reopens them after a restart, exactly as they were when the app quit.
 */
export class SessionWindowManager<W extends SessionWindowLike> {
  private readonly windows = new Map<
    string,
    { target: SessionWindowTarget; window: W }
  >();
  private quitting = false;
  private restored = false;
  private readonly io;
  private readonly filePath: string;

  constructor(private readonly options: SessionWindowManagerOptions<W>) {
    this.io = options.io ?? fs;
    this.filePath = path.join(options.userDataPath, SESSION_WINDOWS_FILE_NAME);
  }

  /** Whether `webContentsId` belongs to a Session window. */
  ownsContents(webContentsId: number): boolean {
    return this.targetForContents(webContentsId) !== null;
  }

  targetForContents(webContentsId: number): SessionWindowTarget | null {
    for (const { target, window } of this.windows.values())
      if (!window.isDestroyed() && window.webContents.id === webContentsId)
        return target;
    return null;
  }

  openProjectIds(): string[] {
    return [...this.windows.keys()];
  }

  allWindows(): W[] {
    return [...this.windows.values()]
      .map(({ window }) => window)
      .filter((window) => !window.isDestroyed());
  }

  /** Opens the Session's window, or focuses it when it is already open. */
  open(
    target: SessionWindowTarget,
    state: PersistedWindowStateV2 | null = null
  ): W {
    const existing = this.windows.get(target.projectId);
    if (existing && !existing.window.isDestroyed()) {
      if (existing.window.isMinimized()) existing.window.restore();
      existing.window.focus();
      return existing.window;
    }
    const window = this.options.createWindow(target, state);
    this.windows.set(target.projectId, { target, window });
    const save = () => this.scheduleSave();
    window.on('move', save);
    window.on('resize', save);
    window.on('closed', () => {
      if (this.windows.get(target.projectId)?.window !== window) return;
      this.windows.delete(target.projectId);
      if (this.quitting) return;
      this.save();
      this.options.onClosed?.(target);
    });
    this.save();
    return window;
  }

  close(projectId: string): void {
    const entry = this.windows.get(projectId);
    if (entry && !entry.window.isDestroyed()) entry.window.close();
  }

  /** Reopens the windows that were open when the app last quit. Runs once. */
  restore(): void {
    if (this.restored) return;
    this.restored = true;
    let raw: string;
    try {
      raw = String(this.io.readFileSync(this.filePath, 'utf8'));
    } catch {
      return;
    }
    for (const saved of parseSaved(raw))
      this.open(
        { spaceId: saved.spaceId, projectId: saved.projectId },
        saved.state ?? null
      );
  }

  /** Keeps the saved list while windows close during quit. */
  markQuitting(): void {
    if (this.quitting) return;
    this.save();
    this.quitting = true;
  }

  private scheduleSave() {
    if (this.quitting) return;
    if (this.options.scheduleSave) this.options.scheduleSave(() => this.save());
    else this.save();
  }

  private save(): void {
    if (this.quitting) return;
    const windows: SavedSessionWindow[] = [];
    for (const { target, window } of this.windows.values()) {
      if (window.isDestroyed()) continue;
      let state: PersistedWindowStateV2 | undefined;
      try {
        state = captureWindowState(window);
      } catch {
        state = undefined;
      }
      windows.push({ ...target, ...(state ? { state } : {}) });
    }
    try {
      this.io.mkdirSync(path.dirname(this.filePath), { recursive: true });
      this.io.writeFileSync(
        this.filePath,
        JSON.stringify({ version: SESSION_WINDOWS_VERSION, windows }),
        'utf8'
      );
    } catch {
      // Placement is a convenience; a failed write must not break the window.
    }
  }
}
