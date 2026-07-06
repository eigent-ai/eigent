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
