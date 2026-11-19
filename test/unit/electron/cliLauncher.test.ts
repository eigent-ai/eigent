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

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cliLauncherFileName,
  posixLauncher,
  windowsLauncher,
  writeCliLauncher,
} from '../../../electron/main/utils/cliLauncher';

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-cli-'));
  temporaryDirectories.push(directory);
  return directory;
}

/** A backend folder with the CLI package and a Python next to it. */
function install(root: string): { backendPath: string; pythonPath: string } {
  const backendPath = path.join(root, 'backend');
  fs.mkdirSync(path.join(backendPath, 'eigent_cli'), { recursive: true });
  const pythonPath = path.join(root, 'venv', 'python');
  fs.mkdirSync(path.dirname(pythonPath), { recursive: true });
  fs.writeFileSync(pythonPath, '');
  return { backendPath, pythonPath };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('eigent command-line launcher', () => {
  it('writes a launcher that runs the CLI on the backend Python', () => {
    const root = temporaryDirectory();
    const { backendPath, pythonPath } = install(root);
    const binDir = path.join(root, 'bin');

    const written = writeCliLauncher({
      binDir,
      pythonPath,
      backendPath,
      platform: 'linux',
    });

    expect(written).toBe(path.join(binDir, 'eigent'));
    const content = fs.readFileSync(written as string, 'utf-8');
    expect(content.startsWith('#!/bin/sh\n')).toBe(true);
    expect(content).toContain(`EIGENT_CLI_BACKEND='${backendPath}'`);
    expect(content).toContain(`exec '${pythonPath}' -m eigent_cli "$@"`);
    expect(fs.readdirSync(binDir)).toEqual(['eigent']);
  });

  it('writes a .cmd launcher on Windows that passes arguments and the exit code', () => {
    const root = temporaryDirectory();
    const { backendPath, pythonPath } = install(root);

    const written = writeCliLauncher({
      binDir: path.join(root, 'bin'),
      pythonPath,
      backendPath,
      platform: 'win32',
    });

    expect(path.basename(written as string)).toBe('eigent.cmd');
    const lines = fs.readFileSync(written as string, 'utf-8').split('\r\n');
    expect(lines[0]).toBe('@echo off');
    expect(lines).toContain(`set "PYTHONPATH=${backendPath};%PYTHONPATH%"`);
    expect(lines).toContain(`"${pythonPath}" -m eigent_cli %*`);
    expect(lines).toContain('exit /b %ERRORLEVEL%');
  });

  it('points at the new version after an update', () => {
    const root = temporaryDirectory();
    const first = install(path.join(root, 'v1'));
    const second = install(path.join(root, 'v2'));
    const binDir = path.join(root, 'bin');

    writeCliLauncher({ binDir, ...first, platform: 'linux' });
    const target = writeCliLauncher({ binDir, ...second, platform: 'linux' });

    const content = fs.readFileSync(target as string, 'utf-8');
    expect(content).toContain(second.pythonPath);
    expect(content).not.toContain(first.pythonPath);
  });

  it('leaves an up-to-date launcher untouched', () => {
    const root = temporaryDirectory();
    const options = {
      binDir: path.join(root, 'bin'),
      ...install(root),
      platform: 'linux' as const,
    };
    const target = writeCliLauncher(options) as string;
    const before = fs.statSync(target).mtimeMs;
    fs.utimesSync(target, new Date(0), new Date(0));

    writeCliLauncher(options);

    expect(fs.statSync(target).mtimeMs).not.toBe(before);
    expect(fs.statSync(target).mtimeMs).toBe(0);
  });

  it('writes nothing when the backend has no CLI or the Python is missing', () => {
    const root = temporaryDirectory();
    const { backendPath, pythonPath } = install(root);
    const binDir = path.join(root, 'bin');

    fs.rmSync(path.join(backendPath, 'eigent_cli'), { recursive: true });
    expect(writeCliLauncher({ binDir, pythonPath, backendPath })).toBeNull();

    fs.mkdirSync(path.join(backendPath, 'eigent_cli'));
    expect(
      writeCliLauncher({
        binDir,
        pythonPath: path.join(root, 'missing', 'python'),
        backendPath,
      })
    ).toBeNull();
    expect(fs.existsSync(binDir)).toBe(false);
  });

  it('quotes paths that a shell or a batch file would misread', () => {
    const posix = posixLauncher(
      "/Users/o'neil/venv/bin/python",
      "/Applications/Eigent's App/backend"
    );
    expect(posix).toContain(
      `EIGENT_CLI_BACKEND='/Applications/Eigent'\\''s App/backend'`
    );
    expect(posix).toContain(`exec '/Users/o'\\''neil/venv/bin/python' -m`);

    const windows = windowsLauncher(
      'C:\\Users\\100%me\\venv\\Scripts\\python.exe',
      'C:\\Program Files\\Eigent\\resources\\backend'
    );
    expect(windows).toContain(
      '"C:\\Users\\100%%me\\venv\\Scripts\\python.exe"'
    );
    expect(windows).toContain(
      'set "PYTHONPATH=C:\\Program Files\\Eigent\\resources\\backend;%PYTHONPATH%"'
    );
  });

  it('names the launcher for the platform', () => {
    expect(cliLauncherFileName('win32')).toBe('eigent.cmd');
    expect(cliLauncherFileName('darwin')).toBe('eigent');
    expect(cliLauncherFileName('linux')).toBe('eigent');
  });
});
