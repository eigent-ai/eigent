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

/**
 * The `eigent` command-line client ships inside the backend folder and runs
 * on the backend's Python. Neither is on PATH, and both move with every app
 * update (the virtual environment is versioned). The app therefore writes a
 * small launcher to a stable place, `~/.eigent/bin`, on each start, pointing
 * at the Python and backend it is about to use itself.
 *
 * Writing the launcher does not change PATH. The user adds `~/.eigent/bin`
 * once, with `eigent install-path` or by hand.
 */

export type CliLauncherOptions = {
  /** Folder to write into. Defaults to `~/.eigent/bin`. */
  binDir?: string;
  /** The backend virtual environment's Python executable. */
  pythonPath: string;
  /** The backend folder that contains the `eigent_cli` package. */
  backendPath: string;
  platform?: NodeJS.Platform;
};

export function cliLauncherDir(): string {
  return path.join(os.homedir(), '.eigent', 'bin');
}

export function cliLauncherFileName(
  platform: NodeJS.Platform = process.platform
): string {
  return platform === 'win32' ? 'eigent.cmd' : 'eigent';
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Launcher text for macOS and Linux. */
export function posixLauncher(pythonPath: string, backendPath: string): string {
  return [
    '#!/bin/sh',
    '# Written by the Eigent app on every start. Do not edit: changes are lost.',
    `EIGENT_CLI_BACKEND=${shellQuote(backendPath)}`,
    'export PYTHONPATH="$EIGENT_CLI_BACKEND${PYTHONPATH:+:$PYTHONPATH}"',
    `exec ${shellQuote(pythonPath)} -m eigent_cli "$@"`,
    '',
  ].join('\n');
}

/** Launcher text for Windows (`eigent.cmd`). */
export function windowsLauncher(
  pythonPath: string,
  backendPath: string
): string {
  // `%` starts a variable in a batch file; a literal one is written `%%`.
  const escape = (value: string) => value.replace(/%/g, '%%');
  return [
    '@echo off',
    'rem Written by the Eigent app on every start. Do not edit: changes are lost.',
    'setlocal',
    `set "PYTHONPATH=${escape(backendPath)};%PYTHONPATH%"`,
    `"${escape(pythonPath)}" -m eigent_cli %*`,
    'exit /b %ERRORLEVEL%',
    '',
  ].join('\r\n');
}

/**
 * Write (or refresh) the launcher. Returns its path, or null when the backend
 * has no command-line client or the Python is missing.
 */
export function writeCliLauncher(options: CliLauncherOptions): string | null {
  const platform = options.platform ?? process.platform;
  const binDir = options.binDir ?? cliLauncherDir();
  if (
    !fs.existsSync(path.join(options.backendPath, 'eigent_cli')) ||
    !fs.existsSync(options.pythonPath)
  ) {
    return null;
  }
  const content =
    platform === 'win32'
      ? windowsLauncher(options.pythonPath, options.backendPath)
      : posixLauncher(options.pythonPath, options.backendPath);
  const target = path.join(binDir, cliLauncherFileName(platform));
  fs.mkdirSync(binDir, { recursive: true });
  try {
    if (fs.readFileSync(target, 'utf-8') === content) {
      return target;
    }
  } catch {
    // Not there yet, or unreadable: write it.
  }
  // Replace in one step, so a terminal running `eigent` never reads half a file.
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content, { encoding: 'utf-8', mode: 0o755 });
  fs.renameSync(temporary, target);
  return target;
}
