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

import { app, ipcMain } from 'electron';
import log from 'electron-log';
import type {
  ProgressInfo,
  UpdateDownloadedEvent,
  UpdateInfo,
} from 'electron-updater';
import { createRequire } from 'node:module';
import {
  DEFAULT_CDN_RELEASE_BASE_URL,
  getGitHubReleaseChannel,
  getUpdatePlatformDirectory,
  GitHubReleaseCdnProvider,
} from './githubReleaseCdnProvider';

const { autoUpdater } = createRequire(import.meta.url)('electron-updater');

// autoUpdater is a process-wide singleton, so its listeners are registered
// once and forward to whichever window currently owns the update UI. Adding
// listeners per window or per download duplicated every event and kept
// forwarding to windows that had started an earlier attempt.
let updateWindow: Electron.BrowserWindow | null = null;
const updateClients = new Set<Electron.WebContents>();
let updateOperation: 'download' | 'install' | null = null;
let checkListenersRegistered = false;
let operationListenersRegistered = false;

function sendToUpdateWindow(channel: string, payload: unknown) {
  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.webContents.send(channel, payload);
  }
}

function sendToUpdateClients(channel: string, payload?: unknown) {
  for (const client of updateClients) {
    if (client.isDestroyed()) {
      updateClients.delete(client);
    } else {
      client.send(channel, payload);
    }
  }
}

function registerCheckListeners() {
  if (checkListenersRegistered) return;
  checkListenersRegistered = true;

  autoUpdater.on('update-available', (arg: UpdateInfo) => {
    sendToUpdateWindow('update-can-available', {
      update: true,
      version: app.getVersion(),
      newVersion: arg?.version,
    });
  });
  autoUpdater.on('update-not-available', (arg: UpdateInfo) => {
    sendToUpdateWindow('update-can-available', {
      update: false,
      version: app.getVersion(),
      newVersion: arg?.version,
    });
  });
  // Handle errors globally to prevent crashes. Errors from a background
  // check stay in the log; errors during a download or install reach the UI.
  autoUpdater.on('error', (error: Error) => {
    log.error('[AutoUpdater] Update error:', error?.message ?? error);
    if (!updateOperation) return;
    updateOperation = null;
    sendToUpdateClients('update-error', {
      message: error?.message,
      error,
    });
  });
}

function registerOperationListeners() {
  if (operationListenersRegistered) return;
  operationListenersRegistered = true;

  const finishDownload = () => {
    if (updateOperation === 'download') updateOperation = null;
    sendToUpdateClients('update-downloaded');
  };

  autoUpdater.on('download-progress', (info: ProgressInfo) =>
    sendToUpdateClients('download-progress', info)
  );

  const nativeMacUpdater =
    process.platform === 'darwin'
      ? ((autoUpdater as { nativeUpdater?: NodeJS.EventEmitter })
          .nativeUpdater ?? null)
      : null;
  if (nativeMacUpdater) {
    // Squirrel.Mac finishes staging after electron-updater's own event.
    nativeMacUpdater.on('update-downloaded', finishDownload);
  } else {
    autoUpdater.on('update-downloaded', (_event: UpdateDownloadedEvent) =>
      finishDownload()
    );
  }
}

export function update(win: Electron.BrowserWindow) {
  // Without a logger electron-updater only writes to the console, which a
  // packaged app does not keep; route it to the app log for diagnostics.
  autoUpdater.logger = log;
  // When set to false, the update download will be triggered through the API
  autoUpdater.verifyUpdateCodeSignature = false;
  autoUpdater.autoDownload = false;
  autoUpdater.disableWebInstaller = false;
  autoUpdater.allowDowngrade = false;

  autoUpdater.forceDevUpdateConfig = true;

  updateWindow = win;
  registerCheckListeners();
  console.log('Current version:', autoUpdater.currentVersion.version);
  console.log('Update config path:', autoUpdater.getUpdateConfigPath?.());
  console.log('User data path (where config lives):', app.getPath('userData'));
  const platformDir = getUpdatePlatformDirectory(
    process.platform,
    process.arch
  );

  if (!platformDir) {
    console.warn(
      `[AutoUpdater] Updates are not configured for ${process.platform}/${process.arch}`
    );
    return;
  }

  const cdnBaseUrl =
    process.env.EIGENT_UPDATER_CDN_BASE_URL || DEFAULT_CDN_RELEASE_BASE_URL;
  const channel = getGitHubReleaseChannel(process.platform, process.arch);
  const feed = {
    provider: 'custom' as const,
    updateProvider: GitHubReleaseCdnProvider,
    owner: 'eigent-ai',
    repo: 'eigent',
    releaseType: 'release' as const,
    channel,
    cdnBaseUrl,
    platformDir,
  };

  autoUpdater.setFeedURL(feed);
  console.log('[AutoUpdater] setFeedURL:', feed);

  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch((err: Error) => {
      console.log('[AutoUpdater] Initial update check failed:', err.message);
    });
  }

  if (!app.isPackaged) {
    // In development, check for updates but don't fail if it errors
    autoUpdater.checkForUpdates().catch((err: Error) => {
      console.log(
        '[DEV] Update check failed (expected in dev environment):',
        err.message
      );
    });
  }
}

/**
 * Registers update-related IPC handlers
 * Should be called once when the app starts
 */
export function registerUpdateIpcHandlers(beforeQuitAndInstall?: () => void) {
  // Checking for updates - errors are silent since users can't act on them
  ipcMain.handle('check-update', async () => {
    try {
      return await autoUpdater.checkForUpdatesAndNotify();
    } catch (error) {
      console.log(
        '[AutoUpdater] Update check failed:',
        (error as Error).message
      );
      return null;
    }
  });

  // Start downloading and feedback on progress
  ipcMain.handle('start-download', (event: Electron.IpcMainInvokeEvent) => {
    registerCheckListeners();
    registerOperationListeners();
    updateClients.add(event.sender);
    updateOperation = 'download';
    // Errors are delivered through the 'error' listener above.
    autoUpdater.downloadUpdate().catch(() => undefined);
  });

  // Install now. A failed installer launch is reported as 'update-error' so
  // the UI offers Retry instead of waiting on an install that never starts.
  ipcMain.handle('quit-and-install', (event: Electron.IpcMainInvokeEvent) => {
    registerCheckListeners();
    updateClients.add(event.sender);
    updateOperation = 'install';
    log.info('[AutoUpdater] Quit and install requested');
    beforeQuitAndInstall?.();
    try {
      autoUpdater.quitAndInstall(false, true);
    } catch (error) {
      updateOperation = null;
      log.error('[AutoUpdater] Quit and install failed:', error);
      throw error;
    }
  });

  // Dev-only: replay updater events from DevTools to exercise the top-bar
  // update UI, e.g.
  //   window.ipcRenderer.invoke('debug-update-event', 'download-progress', { percent: 40 })
  if (!app.isPackaged) {
    const allowedChannels = [
      'update-can-available',
      'download-progress',
      'update-downloaded',
      'update-error',
    ];
    ipcMain.handle(
      'debug-update-event',
      (
        event: Electron.IpcMainInvokeEvent,
        channel: string,
        payload?: unknown
      ) => {
        if (!allowedChannels.includes(channel)) return false;
        event.sender.send(channel, payload);
        return true;
      }
    );
  }
}
