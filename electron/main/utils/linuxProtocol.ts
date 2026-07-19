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

import { spawn } from 'child_process';
import log from 'electron-log';
import fs from 'fs';
import fsp from 'fs/promises';
import { homedir } from 'os';
import path from 'path';

const DESKTOP_FILE_NAME = 'eigent-protocol-handler.desktop';
const MIME_TYPE = 'x-scheme-handler/eigent';

function getDesktopFilePath(): string {
  return path.join(
    homedir(),
    '.local',
    'share',
    'applications',
    DESKTOP_FILE_NAME
  );
}

function getExecPath(): string {
  // Prefer APPIMAGE env var so registration survives AppImage version bumps
  if (process.env.APPIMAGE) {
    return process.env.APPIMAGE;
  }
  // Fallback to process.execPath
  return process.execPath;
}

function generateDesktopEntry(execPath: string): string {
  const escapedExec = execPath.replace(/"/g, '\\"');
  return `[Desktop Entry]
Type=Application
Name=Eigent Protocol Handler
Exec="${escapedExec}" %u
MimeType=${MIME_TYPE};
NoDisplay=true
Terminal=false
Categories=Development;
StartupNotify=false
`;
}

async function ensureDirectory(dir: string): Promise<void> {
  try {
    await fsp.mkdir(dir, { recursive: true });
  } catch (e) {
    log.warn(`[LinuxProtocol] Failed to create directory ${dir}: ${e}`);
  }
}

async function runCommand(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: 'ignore' });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

async function updateDesktopDatabase(): Promise<void> {
  try {
    await runCommand('update-desktop-database', [
      path.join(homedir(), '.local', 'share', 'applications'),
    ]);
  } catch (e) {
    log.warn(`[LinuxProtocol] update-desktop-database failed: ${e}`);
  }
}

async function setDefaultMimeHandler(): Promise<void> {
  try {
    await runCommand('xdg-mime', ['default', DESKTOP_FILE_NAME, MIME_TYPE]);
  } catch (e) {
    log.warn(`[LinuxProtocol] xdg-mime default failed: ${e}`);
  }
}

/**
 * Registers the eigent:// protocol handler on Linux by writing a .desktop file
 * to ~/.local/share/applications/ and updating the desktop database.
 * Skipped in development mode (handled by setupProtocolHandlers dev branch).
 */
export async function registerLinuxProtocolHandler(): Promise<void> {
  if (process.env.NODE_ENV === 'development') {
    log.info('[LinuxProtocol] Skipping registration in development mode');
    return;
  }

  if (process.platform !== 'linux') {
    log.info('[LinuxProtocol] Skipping registration (not on Linux)');
    return;
  }

  try {
    const execPath = getExecPath();
    const desktopPath = getDesktopFilePath();
    const desktopDir = path.dirname(desktopPath);

    log.info(
      `[LinuxProtocol] Registering protocol handler with exec: ${execPath}`
    );

    await ensureDirectory(desktopDir);

    const desktopEntry = generateDesktopEntry(execPath);
    await fsp.writeFile(desktopPath, desktopEntry, 'utf-8');
    log.info(`[LinuxProtocol] Wrote desktop file to ${desktopPath}`);

    await updateDesktopDatabase();
    await setDefaultMimeHandler();

    log.info('[LinuxProtocol] Protocol handler registration complete');
  } catch (error) {
    log.error(`[LinuxProtocol] Registration failed: ${error}`);
  }
}

/**
 * Re-registers the protocol handler (used for self-heal when second-instance fires without URL).
 */
export async function reRegisterLinuxProtocolHandler(): Promise<void> {
  log.info('[LinuxProtocol] Re-registering protocol handler (self-heal)');
  await registerLinuxProtocolHandler();
}

/**
 * Checks if the desktop file exists and has the correct %u placeholder.
 * Returns true if registration appears valid.
 */
export async function isProtocolHandlerRegistered(): Promise<boolean> {
  if (process.platform !== 'linux') return true;

  try {
    const desktopPath = getDesktopFilePath();
    if (!fs.existsSync(desktopPath)) return false;

    const content = await fsp.readFile(desktopPath, 'utf-8');
    return content.includes('%u') && content.includes(MIME_TYPE);
  } catch {
    return false;
  }
}
