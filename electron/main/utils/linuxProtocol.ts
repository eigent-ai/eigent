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

import { app } from 'electron';
import log from 'electron-log';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PROTOCOL_SCHEME = 'eigent';
const DESKTOP_FILE_NAME = 'eigent-protocol-handler.desktop';

function runCommandDetached(command: string, args: string[]): void {
  try {
    const child = spawn(command, args, {
      stdio: 'ignore',
      detached: true,
    });
    child.on('error', (err) => {
      log.warn(`[linuxProtocol] ${command} failed:`, err.message);
    });
    child.unref();
  } catch (err) {
    log.warn(`[linuxProtocol] failed to spawn ${command}:`, err);
  }
}

/**
 * Resolve the command that should be invoked when a deep link fires.
 *
 * Order of preference:
 *   1. $APPIMAGE — set automatically when the user runs an AppImage; this is
 *      the canonical entry point that survives version bumps.
 *   2. process.execPath — the actual binary currently running (extracted
 *      AppImage, dev electron, etc.).
 */
function resolveExecCommand(): string | null {
  const appImage = process.env.APPIMAGE;
  if (appImage && fs.existsSync(appImage)) {
    return appImage;
  }
  if (process.execPath && fs.existsSync(process.execPath)) {
    return process.execPath;
  }
  return null;
}

function buildDesktopFileContents(execCommand: string): string {
  // %u is required so xdg-open passes the eigent:// URL into argv. Without it
  // the second-instance event fires with no URL and login hangs at
  // "Logging in......." — see https://github.com/eigent-ai/eigent/issues/1525
  const escapedExec = execCommand.replace(/"/g, '\\"');
  return [
    '[Desktop Entry]',
    'Version=1.0',
    'Type=Application',
    'Name=Eigent',
    'GenericName=Eigent Protocol Handler',
    'Comment=Handles eigent:// deep links for authentication callbacks',
    `Exec="${escapedExec}" %u`,
    'Terminal=false',
    'NoDisplay=true',
    'StartupNotify=false',
    `MimeType=x-scheme-handler/${PROTOCOL_SCHEME};`,
    'Categories=Network;',
    'X-GNOME-SingleWindow=true',
    '',
  ].join('\n');
}

/**
 * Ensure a desktop entry exists that routes eigent:// URLs back into the app.
 *
 * Electron's `app.setAsDefaultProtocolClient` on Linux only invokes
 * `xdg-mime default <desktop> <scheme>` — it does NOT create the .desktop
 * file. AppImage builds in particular have no .desktop on disk unless the
 * user installed via appimaged, so the protocol callback either fails or
 * (worse) lands on a user-authored .desktop that lacks `%u` and silently
 * drops the URL. We write our own handler file with `%u` to guarantee the
 * URL reaches the second-instance event.
 */
export function ensureLinuxProtocolHandler(): void {
  if (process.platform !== 'linux') return;
  // In dev mode `process.execPath` is the bare electron binary, which can't
  // launch the app on its own — and the dev branch of setupProtocolHandlers
  // already registers a protocol client that knows how to relaunch with the
  // entry script. Skip writing a desktop file in that case.
  if (!app.isPackaged) return;

  const execCommand = resolveExecCommand();
  if (!execCommand) {
    log.warn(
      '[linuxProtocol] could not resolve executable path, skipping desktop file registration'
    );
    return;
  }

  const applicationsDir = path.join(
    os.homedir(),
    '.local',
    'share',
    'applications'
  );
  const desktopFilePath = path.join(applicationsDir, DESKTOP_FILE_NAME);
  const desktopContents = buildDesktopFileContents(execCommand);

  try {
    fs.mkdirSync(applicationsDir, { recursive: true });

    let needsWrite = true;
    if (fs.existsSync(desktopFilePath)) {
      try {
        const existing = fs.readFileSync(desktopFilePath, 'utf-8');
        needsWrite = existing !== desktopContents;
      } catch {
        needsWrite = true;
      }
    }

    if (needsWrite) {
      fs.writeFileSync(desktopFilePath, desktopContents, { mode: 0o644 });
      log.info(
        `[linuxProtocol] wrote desktop entry to ${desktopFilePath} (exec=${execCommand})`
      );
    } else {
      log.info(
        `[linuxProtocol] desktop entry already up to date at ${desktopFilePath}`
      );
    }

    // Refresh the desktop database so the new MIME association is picked up,
    // then tell xdg-mime that our file owns the eigent:// scheme. Both are
    // best-effort — failures shouldn't block app startup.
    runCommandDetached('update-desktop-database', [applicationsDir]);
    runCommandDetached('xdg-mime', [
      'default',
      DESKTOP_FILE_NAME,
      `x-scheme-handler/${PROTOCOL_SCHEME}`,
    ]);
  } catch (err) {
    log.warn('[linuxProtocol] failed to register desktop entry:', err);
  }
}
