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

import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  authorizeLocalFilePath,
  authorizeLocalPreviewPath,
  isExecutableExternalOpenPath,
  isMainRendererSender,
} from '../../../electron/main/localFileSecurity';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'eigent-local-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fsp.rm(directory, { recursive: true, force: true }))
  );
});

describe('local file security', () => {
  it('keeps the main renderer web security and frame-navigation guard enabled', async () => {
    const mainSource = await fsp.readFile(
      path.resolve(process.cwd(), 'electron/main/index.ts'),
      'utf8'
    );

    expect(mainSource).toContain('webSecurity: true');
    expect(mainSource).not.toContain('webSecurity: false');
    expect(mainSource).toContain("'will-frame-navigate'");
  });

  it('allows files inside the active workspace and rejects traversal outside it', async () => {
    const root = await temporaryDirectory();
    const workspace = path.join(root, 'workspace');
    const outside = path.join(root, 'credentials');
    await fsp.mkdir(workspace);
    await fsp.writeFile(path.join(workspace, 'report.html'), '<h1>safe</h1>');
    await fsp.writeFile(outside, 'secret');
    const realReportPath = await fsp.realpath(
      path.join(workspace, 'report.html')
    );

    await expect(
      authorizeLocalFilePath(path.join(workspace, 'report.html'), [workspace])
    ).resolves.toEqual({
      allowed: true,
      filePath: realReportPath,
    });
    await expect(
      authorizeLocalFilePath(path.join(workspace, '..', 'credentials'), [
        workspace,
      ])
    ).resolves.toEqual({ allowed: false, reason: 'outside-roots' });
  });

  it('rejects a symlink that escapes the active workspace', async () => {
    const root = await temporaryDirectory();
    const workspace = path.join(root, 'workspace');
    const secret = path.join(root, 'secret.txt');
    const link = path.join(workspace, 'linked-secret.txt');
    await fsp.mkdir(workspace);
    await fsp.writeFile(secret, 'secret');
    await fsp.symlink(secret, link);

    await expect(authorizeLocalFilePath(link, [workspace])).resolves.toEqual({
      allowed: false,
      reason: 'outside-roots',
    });
  });

  it('resolves relative preview paths only inside an active workspace root', async () => {
    const root = await temporaryDirectory();
    const workspace = path.join(root, 'workspace');
    const outside = path.join(root, 'secret.txt');
    const report = path.join(workspace, 'reports', 'summary.md');
    await fsp.mkdir(path.dirname(report), { recursive: true });
    await fsp.writeFile(report, '# Summary');
    await fsp.writeFile(outside, 'secret');

    await expect(
      authorizeLocalPreviewPath('reports/summary.md', [workspace])
    ).resolves.toEqual({
      allowed: true,
      filePath: await fsp.realpath(report),
    });
    await expect(
      authorizeLocalPreviewPath('../secret.txt', [workspace])
    ).resolves.toEqual({ allowed: false, reason: 'outside-roots' });
    await expect(
      authorizeLocalPreviewPath('reports/summary.md', [])
    ).resolves.toEqual({ allowed: false, reason: 'invalid' });
  });

  it('blocks executable files from external-open actions', () => {
    expect(isExecutableExternalOpenPath('/workspace/install.command')).toBe(
      true
    );
    expect(isExecutableExternalOpenPath('C:\\workspace\\payload.BAT')).toBe(
      true
    );
    expect(isExecutableExternalOpenPath('/workspace/no-extension', 0o755)).toBe(
      true
    );
    expect(isExecutableExternalOpenPath('/workspace/report.pdf')).toBe(false);
  });

  it('accepts IPC only from the main renderer', () => {
    expect(isMainRendererSender(7, 7)).toBe(true);
    expect(isMainRendererSender(8, 7)).toBe(false);
    expect(isMainRendererSender(7, null)).toBe(false);
  });
});
