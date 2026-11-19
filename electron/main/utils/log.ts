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

import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
// @ts-ignore
import archiver from 'archiver';
import log from 'electron-log';

export function zipFolder(
  folderPath: string,
  outputZipPath: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputZipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve(outputZipPath));

    archive.on('error', (err: any) => {
      log.error('Archive error:', err);
      reject(err);
    });

    archive.pipe(output);
    archive.directory(folderPath, false);
    archive.finalize();
  });
}

export type DiagnosticsLogFile = { src: string; destName: string };

export type LogDirectoryEntry = { src: string; destName: string };

/**
 * Zips multiple directories into one archive, each under its destName.
 */
export function zipDirectories(
  outputZipPath: string,
  dirs: LogDirectoryEntry[]
): Promise<string> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputZipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve(outputZipPath));

    archive.on('error', (err: any) => {
      log.error('Archive error:', err);
      reject(err);
    });

    archive.pipe(output);
    for (const dir of dirs) {
      archive.directory(dir.src, dir.destName);
    }
    archive.finalize();
  });
}

/**
 * Finds directories named `dirName` under `rootDir`. Camel logs live at
 * `~/.eigent/<email>/[project_<id>/]task_<taskId>/camel_logs`, so a shallow
 * bounded walk is enough.
 */
export function findDirectoriesByName(
  rootDir: string,
  dirName: string,
  maxDepth = 3
): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.name === dirName) {
        found.push(fullPath);
      } else if (depth < maxDepth) {
        walk(fullPath, depth + 1);
      }
    }
  };
  if (fs.existsSync(rootDir)) {
    walk(rootDir, 0);
  }
  return found;
}

/**
 * Stages log files and bug_report.txt into a temp directory, zips to outputZipPath, then removes the staging dir.
 */
export async function createDiagnosticsZip(
  outputZipPath: string,
  bugReportText: string,
  logFiles: DiagnosticsLogFile[]
): Promise<void> {
  if (logFiles.length === 0) {
    throw new Error('no log files to include');
  }
  const id = randomBytes(8).toString('hex');
  const staging = path.join(os.tmpdir(), `eigent-diagnostics-${id}`);
  await fsp.mkdir(staging, { recursive: true });
  try {
    for (const f of logFiles) {
      if (!fs.existsSync(f.src)) {
        log.warn(`[diagnostics] skip missing log: ${f.src}`);
        continue;
      }
      await fsp.copyFile(f.src, path.join(staging, f.destName));
    }
    await fsp.writeFile(
      path.join(staging, 'bug_report.txt'),
      bugReportText,
      'utf-8'
    );
    const entries = await fsp.readdir(staging);
    if (entries.length === 0) {
      throw new Error('no log files to include');
    }
    await zipFolder(staging, outputZipPath);
  } finally {
    await fsp.rm(staging, { recursive: true, force: true });
  }
}
