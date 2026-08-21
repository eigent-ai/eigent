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

import { FILE_PREVIEW_LIMITS } from '@/shared/filePreviewContract';
import { mkdir, mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileReader } from '../../../electron/main/fileReader';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => ''),
  },
  BrowserWindow: class BrowserWindow {},
}));

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

async function temporaryFile(name: string, content: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'eigent-preview-'));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, name);
  await writeFile(filePath, content, 'utf-8');
  return filePath;
}

describe('FileReader bounded preview', () => {
  it('returns at most the configured CSV row count', async () => {
    const rows = Array.from({ length: 700 }, (_, index) => `${index},value`);
    const filePath = await temporaryFile(
      'large.csv',
      ['id,name', ...rows].join('\n')
    );
    const reader = new FileReader(null as never);

    const preview = await reader.previewCsvFile(filePath);

    expect(preview.rows).toHaveLength(FILE_PREVIEW_LIMITS.csvRows);
    expect(preview.truncated).toBe(true);
    expect(preview.totalBytes).toBeGreaterThan(0);
  });

  it('enumerates a Space workspace with file-relative identities', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'eigent-workspace-'));
    temporaryDirectories.push(directory);
    const reports = path.join(directory, 'reports');
    await mkdir(reports);
    await writeFile(path.join(directory, 'preview.png'), 'image');
    await writeFile(path.join(reports, 'report.md'), '# report');

    const reader = new FileReader(null as never);
    const files = reader.getWorkspaceFileList(directory);

    expect(files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'preview.png',
          relativePath: 'preview.png',
          path: path.join(directory, 'preview.png'),
        }),
        expect.objectContaining({
          name: 'report.md',
          relativePath: path.join('reports', 'report.md'),
          path: path.join(reports, 'report.md'),
        }),
      ])
    );
  });

  it('resolves only requested files and rejects traversal', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'eigent-workspace-'));
    temporaryDirectories.push(directory);
    const outsideFile = path.join(path.dirname(directory), 'outside.txt');
    await writeFile(path.join(directory, 'preview.png'), 'image');
    await writeFile(outsideFile, 'secret');

    try {
      const reader = new FileReader(null as never);
      const files = reader.getWorkspaceFileList(directory, [
        'preview.png',
        '../outside.txt',
        'missing.txt',
      ]);

      expect(files).toHaveLength(1);
      expect(files[0]).toMatchObject({
        name: 'preview.png',
        relativePath: 'preview.png',
      });
    } finally {
      await rm(outsideFile, { force: true });
    }
  });

  it('fails closed before fully reading oversized rich text', async () => {
    const filePath = await temporaryFile('large.md', '');
    await truncate(filePath, FILE_PREVIEW_LIMITS.textBytes + 1);
    const reader = new FileReader(null as never);

    await expect(reader.openFile('md', filePath, false)).rejects.toThrow(
      'FILE_PREVIEW_REQUIRES_BOUNDED_READER'
    );
  });
});
