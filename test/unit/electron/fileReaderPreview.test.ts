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
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises';
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
    const fixture = await mkdtemp(path.join(tmpdir(), 'eigent-workspace-'));
    temporaryDirectories.push(fixture);
    const directory = path.join(fixture, 'workspace');
    await mkdir(directory);
    const outsideFile = path.join(fixture, 'outside.txt');
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

  it('keeps an empty manifest empty and excludes escapes and symlinks from requested resolution', async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), 'eigent-workspace-'));
    temporaryDirectories.push(fixture);
    const workspace = path.join(fixture, 'workspace');
    const outside = path.join(fixture, 'outside');
    await mkdir(workspace);
    await mkdir(outside);
    await writeFile(
      path.join(workspace, 'final.mp4'),
      'resolver-only media fixture'
    );
    await writeFile(path.join(workspace, 'scene.blend'), 'BLENDER-v300');
    await writeFile(
      path.join(workspace, 'unregistered.txt'),
      'not an artifact'
    );
    await writeFile(
      path.join(outside, 'secret.txt'),
      'isolated secret fixture'
    );
    await symlink(
      path.join(outside, 'secret.txt'),
      path.join(workspace, 'link.txt')
    );
    await symlink(outside, path.join(workspace, 'linked-directory'));
    await symlink(
      path.join(workspace, 'final.mp4'),
      path.join(workspace, 'alias.mp4')
    );

    const reader = new FileReader(null as never);
    expect(reader.getWorkspaceFileList(workspace, [])).toEqual([]);
    const files = reader.getWorkspaceFileList(workspace, [
      'final.mp4',
      'final.mp4',
      'scene.blend',
      'missing.mp4',
      '../outside/secret.txt',
      path.join(outside, 'secret.txt'),
      'link.txt',
      'linked-directory/secret.txt',
      'alias.mp4',
      'final.mp4\0scene.blend',
      '%2e%2e/outside/secret.txt',
      'https://example.test/final.mp4',
    ]);
    expect(files.map((file) => file.relativePath)).toEqual([
      'final.mp4',
      'scene.blend',
    ]);
    expect(files[0]).toMatchObject({
      path: await realpath(path.join(workspace, 'final.mp4')),
      type: 'mp4',
      mimeType: 'video/mp4',
    });
    expect(files[1]).toMatchObject({
      path: await realpath(path.join(workspace, 'scene.blend')),
      type: 'blend',
    });
  });

  it('does not recover moved paths, discover replacements, or rewrite a manifest', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'eigent-workspace-'));
    temporaryDirectories.push(workspace);
    await mkdir(path.join(workspace, 'frames'));
    await mkdir(path.join(workspace, 'resume_frames'));
    await writeFile(path.join(workspace, 'frames/frame.png'), 'fixture frame');
    const manifest = JSON.stringify({
      artifacts: [
        { artifact_id: 'old-frame', relative_path: 'frames/frame.png' },
      ],
    });
    const manifestPath = path.join(workspace, 'manifest.json');
    await writeFile(manifestPath, manifest);
    const reader = new FileReader(null as never);
    expect(
      reader.getWorkspaceFileList(workspace, ['frames/frame.png'])
    ).toHaveLength(1);
    await rename(
      path.join(workspace, 'frames/frame.png'),
      path.join(workspace, 'resume_frames/frame.png')
    );
    expect(
      reader.getWorkspaceFileList(workspace, ['frames/frame.png'])
    ).toEqual([]);
    expect(await readFile(manifestPath, 'utf8')).toBe(manifest);
    expect(
      reader.getWorkspaceFileList(workspace, ['resume_frames/frame.png'])[0]
        .relativePath
    ).toBe(path.join('resume_frames', 'frame.png'));
  });

  it('omits directory aliases whose real identity differs and retains explicitly requested canonical files', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'eigent-workspace-'));
    temporaryDirectories.push(workspace);
    await mkdir(path.join(workspace, 'archive'));
    await writeFile(path.join(workspace, 'archive/frame.txt'), 'fixture frame');
    await writeFile(path.join(workspace, 'final.mp4'), 'resolver-only fixture');
    await symlink(
      path.join(workspace, 'archive'),
      path.join(workspace, 'frames'),
      'junction'
    );
    const reader = new FileReader(null as never);

    expect(
      reader.getWorkspaceFileList(workspace, ['frames/frame.txt'])
    ).toEqual([]);
    const files = reader.getWorkspaceFileList(workspace, [
      'frames/frame.txt',
      'archive/frame.txt',
      'final.mp4',
    ]);
    expect(files.map((file) => file.relativePath)).toEqual([
      path.join('archive', 'frame.txt'),
      'final.mp4',
    ]);
    expect(files[0].path).toBe(
      await realpath(path.join(workspace, 'archive/frame.txt'))
    );
  });

  it('compares normalized identities while preserving native canonical paths', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'eigent-workspace-'));
    temporaryDirectories.push(workspace);
    await mkdir(path.join(workspace, 'nested'));
    await writeFile(
      path.join(workspace, 'nested/report.txt'),
      'fixture report'
    );
    const reader = new FileReader(null as never);

    for (const relativePath of [
      'nested/report.txt',
      './nested//./report.txt',
      path.join('nested', 'report.txt'),
    ]) {
      const files = reader.getWorkspaceFileList(workspace, [relativePath]);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatchObject({
        relativePath: path.join('nested', 'report.txt'),
        path: await realpath(path.join(workspace, 'nested/report.txt')),
      });
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
