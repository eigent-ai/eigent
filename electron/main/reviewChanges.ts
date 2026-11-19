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
import fs from 'node:fs';
import path from 'node:path';

/**
 * The agent file toolkit backs a file up as `<name>.<YYYYMMDD_HHMMSS>.bak`
 * next to it before overwriting. Those backups are the "before" side of the
 * review tab's diffs.
 */
const BACKUP_TIMESTAMP_PATTERN = /^\d{8}_\d{6}$/;

/** One backup file, with the size the renderer needs to skip huge diffs. */
export interface ReviewBackup {
  path: string;
  size: number;
}

export interface ReviewBackupEntry {
  /** The absolute path that was asked about. */
  path: string;
  /** Whether the file currently exists on disk. */
  exists: boolean;
  /** Size of the current on-disk file; null when it does not exist. */
  size: number | null;
  /**
   * This file's backups, sorted oldest-first (the first entry is the content
   * from before the earliest recorded write).
   */
  backups: ReviewBackup[];
}

async function backupsFor(
  filePath: string,
  directoryEntries: Map<string, Promise<string[]>>
): Promise<ReviewBackup[]> {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  let namesPromise = directoryEntries.get(dir);
  if (!namesPromise) {
    namesPromise = fs.promises.readdir(dir).catch(() => []);
    directoryEntries.set(dir, namesPromise);
  }
  const names = await namesPromise;
  const prefix = `${base}.`;
  const backups = names.filter((name) => {
    if (!name.startsWith(prefix) || !name.endsWith('.bak')) return false;
    const stamp = name.slice(prefix.length, -'.bak'.length);
    return BACKUP_TIMESTAMP_PATTERN.test(stamp);
  });
  backups.sort();
  return Promise.all(
    backups.map(async (name) => {
      const backupPath = path.join(dir, name);
      const size = await fs.promises
        .stat(backupPath)
        .then((stats) => stats.size)
        .catch(() => 0);
      return { path: backupPath, size };
    })
  );
}

export function registerReviewChangesIpcHandlers(): void {
  ipcMain.handle(
    'review-list-backups',
    async (_event, filePaths: string[]): Promise<ReviewBackupEntry[]> => {
      try {
        const directoryEntries = new Map<string, Promise<string[]>>();
        return await Promise.all(
          (filePaths ?? []).map(async (filePath) => {
            const stats = await fs.promises
              .stat(filePath)
              .then((result) => (result.isFile() ? result : null))
              .catch(() => null);
            const backups = await backupsFor(filePath, directoryEntries);
            return {
              path: filePath,
              exists: Boolean(stats),
              size: stats ? stats.size : null,
              backups,
            };
          })
        );
      } catch (error) {
        log.error('review-list-backups failed', error);
        return [];
      }
    }
  );
}
