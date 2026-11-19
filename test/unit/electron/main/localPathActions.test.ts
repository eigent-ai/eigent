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
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  authorizeWorkspaceLocalNode,
  openWorkspaceLocalFile,
  rememberBoundedPathGrant,
  revealUserVisibleLocalNode,
  revealWorkspaceLocalNode,
  type LocalPathShell,
} from '../../../../electron/main/localPathActions';

const temporaryDirectories: string[] = [];

async function temporaryWorkspace(): Promise<string> {
  const directory = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'eigent-path-actions-')
  );
  temporaryDirectories.push(directory);
  return directory;
}

function shellMock() {
  return {
    openPath: vi.fn(async () => ''),
    showItemInFolder: vi.fn(),
  } satisfies LocalPathShell;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fsp.rm(directory, { recursive: true, force: true }))
  );
});

describe('local path actions', () => {
  it('evicts the least-recently-used exact grant at the configured limit', () => {
    const grants = new Set<string>();
    rememberBoundedPathGrant(grants, '/picked/first', 2);
    rememberBoundedPathGrant(grants, '/picked/second', 2);
    rememberBoundedPathGrant(grants, '/picked/first', 2);
    rememberBoundedPathGrant(grants, '/picked/third', 2);

    expect([...grants]).toEqual(['/picked/first', '/picked/third']);
  });

  it('opens an exact selected folder instead of its parent', async () => {
    const workspace = await temporaryWorkspace();
    const selectedFolder = path.join(workspace, 'reports', 'final');
    await fsp.mkdir(selectedFolder, { recursive: true });
    const targetShell = shellMock();

    await expect(
      revealWorkspaceLocalNode(selectedFolder, [workspace], targetShell)
    ).resolves.toEqual({ success: true });
    expect(targetShell.openPath).toHaveBeenCalledWith(
      await fsp.realpath(selectedFolder)
    );
    expect(targetShell.showItemInFolder).not.toHaveBeenCalled();
  });

  it('reveals and highlights an exact selected file', async () => {
    const workspace = await temporaryWorkspace();
    const selectedFile = path.join(workspace, 'reports', 'summary.md');
    await fsp.mkdir(path.dirname(selectedFile), { recursive: true });
    await fsp.writeFile(selectedFile, '# Summary');
    const targetShell = shellMock();

    await expect(
      revealWorkspaceLocalNode(selectedFile, [workspace], targetShell)
    ).resolves.toEqual({ success: true });
    expect(targetShell.showItemInFolder).toHaveBeenCalledWith(
      await fsp.realpath(selectedFile)
    );
    expect(targetShell.openPath).not.toHaveBeenCalled();
  });

  it('opens an exact selected file with its default app', async () => {
    const workspace = await temporaryWorkspace();
    const selectedFile = path.join(workspace, 'report.pdf');
    await fsp.writeFile(selectedFile, 'pdf');
    const targetShell = shellMock();

    await expect(
      openWorkspaceLocalFile(selectedFile, [workspace], targetShell)
    ).resolves.toEqual({ success: true });
    expect(targetShell.openPath).toHaveBeenCalledWith(
      await fsp.realpath(selectedFile)
    );
  });

  it('authorizes both file and folder editor targets as exact real paths', async () => {
    const workspace = await temporaryWorkspace();
    const selectedFolder = path.join(workspace, 'src');
    const selectedFile = path.join(selectedFolder, 'index.ts');
    await fsp.mkdir(selectedFolder);
    await fsp.writeFile(selectedFile, 'export {};');

    await expect(
      authorizeWorkspaceLocalNode(selectedFolder, [workspace])
    ).resolves.toMatchObject({
      success: true,
      path: await fsp.realpath(selectedFolder),
      kind: 'directory',
    });
    await expect(
      authorizeWorkspaceLocalNode(selectedFile, [workspace])
    ).resolves.toMatchObject({
      success: true,
      path: await fsp.realpath(selectedFile),
      kind: 'file',
    });
  });

  it('rejects paths outside the active workspace before opening them', async () => {
    const root = await temporaryWorkspace();
    const workspace = path.join(root, 'workspace');
    const outsideFile = path.join(root, 'secret.txt');
    await fsp.mkdir(workspace);
    await fsp.writeFile(outsideFile, 'secret');
    const targetShell = shellMock();

    await expect(
      revealWorkspaceLocalNode(outsideFile, [workspace], targetShell)
    ).resolves.toEqual({
      success: false,
      error: 'Path is outside the active workspace',
    });
    await expect(
      openWorkspaceLocalFile(outsideFile, [workspace], targetShell)
    ).resolves.toEqual({
      success: false,
      error: 'Path is outside the active workspace',
    });
    expect(targetShell.openPath).not.toHaveBeenCalled();
    expect(targetShell.showItemInFolder).not.toHaveBeenCalled();
  });

  it('blocks executable default-app opens and reveals the file instead', async () => {
    const workspace = await temporaryWorkspace();
    const executableFile = path.join(workspace, 'install.command');
    await fsp.writeFile(executableFile, '#!/bin/sh');
    const targetShell = shellMock();

    await expect(
      openWorkspaceLocalFile(executableFile, [workspace], targetShell)
    ).resolves.toEqual({
      success: false,
      error: 'Executable files cannot be opened from an agent result',
    });
    expect(targetShell.openPath).not.toHaveBeenCalled();
    expect(targetShell.showItemInFolder).toHaveBeenCalledWith(
      await fsp.realpath(executableFile)
    );
  });

  it('reveals an executable bundle directory instead of launching it', async () => {
    const workspace = await temporaryWorkspace();
    const bundle = path.join(workspace, 'Payload.app');
    await fsp.mkdir(path.join(bundle, 'Contents', 'MacOS'), {
      recursive: true,
    });
    const targetShell = shellMock();

    await expect(
      revealWorkspaceLocalNode(bundle, [workspace], targetShell)
    ).resolves.toEqual({ success: true });
    // shell.openPath would execute the bundle rather than browse it.
    expect(targetShell.openPath).not.toHaveBeenCalled();
    expect(targetShell.showItemInFolder).toHaveBeenCalledWith(
      await fsp.realpath(bundle)
    );
  });

  it('still browses an ordinary workspace folder', async () => {
    const workspace = await temporaryWorkspace();
    const plainFolder = path.join(workspace, 'reports.output');
    await fsp.mkdir(plainFolder, { recursive: true });
    const targetShell = shellMock();

    await expect(
      revealWorkspaceLocalNode(plainFolder, [workspace], targetShell)
    ).resolves.toEqual({ success: true });
    expect(targetShell.openPath).toHaveBeenCalledWith(
      await fsp.realpath(plainFolder)
    );
    expect(targetShell.showItemInFolder).not.toHaveBeenCalled();
  });

  it('reveals a user-picked attachment stored outside every Space root', async () => {
    const workspace = await temporaryWorkspace();
    const elsewhere = await temporaryWorkspace();
    const attachment = path.join(elsewhere, 'contract.pdf');
    await fsp.writeFile(attachment, 'pdf');
    const realAttachment = await fsp.realpath(attachment);
    const targetShell = shellMock();

    await expect(
      revealUserVisibleLocalNode(
        attachment,
        [workspace],
        new Set([realAttachment]),
        targetShell
      )
    ).resolves.toEqual({ success: true });
    expect(targetShell.showItemInFolder).toHaveBeenCalledWith(realAttachment);
  });

  it('rejects an outside path the user never picked', async () => {
    const workspace = await temporaryWorkspace();
    const elsewhere = await temporaryWorkspace();
    const secret = path.join(elsewhere, 'id_rsa');
    await fsp.writeFile(secret, 'key');
    const targetShell = shellMock();

    await expect(
      revealUserVisibleLocalNode(secret, [workspace], new Set(), targetShell)
    ).resolves.toEqual({
      success: false,
      error: 'Path is outside the active workspace',
    });
    expect(targetShell.openPath).not.toHaveBeenCalled();
    expect(targetShell.showItemInFolder).not.toHaveBeenCalled();
  });

  it('does not launch a bundle that the user picked in the file dialog', async () => {
    const elsewhere = await temporaryWorkspace();
    const bundle = path.join(elsewhere, 'Installer.app');
    await fsp.mkdir(bundle, { recursive: true });
    const realBundle = await fsp.realpath(bundle);
    const targetShell = shellMock();

    await expect(
      revealUserVisibleLocalNode(bundle, [], new Set([realBundle]), targetShell)
    ).resolves.toEqual({ success: true });
    expect(targetShell.openPath).not.toHaveBeenCalled();
    expect(targetShell.showItemInFolder).toHaveBeenCalledWith(realBundle);
  });
});
