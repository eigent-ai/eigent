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
import {
  readUpdateChannel,
  readUpdateCheckConfig,
  selectUpdateFeedBaseUrl,
} from './updateChannel';

const { autoUpdater } = createRequire(import.meta.url)('electron-updater');

export function update(win: Electron.BrowserWindow) {
  // When set to false, the update download will be triggered through the API
  autoUpdater.verifyUpdateCodeSignature = false;
  autoUpdater.autoDownload = false;
  autoUpdater.disableWebInstaller = false;
  autoUpdater.allowDowngrade = false;

  autoUpdater.forceDevUpdateConfig = true;

  // start check
  autoUpdater.on('checking-for-update', function () {});
  // update available
  autoUpdater.on('update-available', (arg: UpdateInfo) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-can-available', {
        update: true,
        version: app.getVersion(),
        newVersion: arg?.version,
      });
    }
  });
  // update not available
  autoUpdater.on('update-not-available', (arg: UpdateInfo) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-can-available', {
        update: false,
        version: app.getVersion(),
        newVersion: arg?.version,
      });
    }
  });
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

  const updateChannel = readUpdateChannel({
    userDataPath: app.getPath('userData'),
  });
  // This feed has no pre-release lane, so a pre-release install stays on
  // stable here; builds that publish one pass it as `prereleaseBaseUrl`.
  const cdnBaseUrl = selectUpdateFeedBaseUrl({
    channel: updateChannel,
    stableBaseUrl:
      process.env.EIGENT_UPDATER_CDN_BASE_URL || DEFAULT_CDN_RELEASE_BASE_URL,
  });
  console.log('[AutoUpdater] update channel:', updateChannel);
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

  // Handle errors globally to prevent crashes
  autoUpdater.on('error', (error: Error) => {
    console.error('[AutoUpdater] Update error:', error.message);
    // Don't crash the app on update errors
  });
}

/**
 * Registers update-related IPC handlers
 * Should be called once when the app starts
 */
export function registerUpdateIpcHandlers(beforeQuitAndInstall?: () => void) {
  // Checking for updates - errors are silent since users can't act on them
  ipcMain.handle('check-update', async () => {
    try {
      const result = await autoUpdater.checkForUpdatesAndNotify();
      // A plain summary: the raw result holds a cancellation token that does
      // not need to cross IPC. `null` means no check ran.
      if (!result) return null;
      return {
        updateAvailable: Boolean(result.isUpdateAvailable),
        version: result.updateInfo?.version ?? null,
      };
    } catch (error) {
      console.log(
        '[AutoUpdater] Update check failed:',
        (error as Error).message
      );
      return null;
    }
  });

  // Background check schedule; the renderer owns the timer.
  ipcMain.handle('get-update-check-config', () => readUpdateCheckConfig());

  // Start downloading and feedback on progress
  ipcMain.handle('start-download', (event: Electron.IpcMainInvokeEvent) => {
    startDownload(
      (error, progressInfo) => {
        if (error) {
          // feedback download error message
          if (!event.sender.isDestroyed()) {
            event.sender.send('update-error', {
              message: error.message,
              error,
            });
          }
        } else {
          // feedback update progress message
          if (!event.sender.isDestroyed()) {
            event.sender.send('download-progress', progressInfo);
          }
        }
      },
      () => {
        // feedback update downloaded message
        if (!event.sender.isDestroyed()) {
          event.sender.send('update-downloaded');
        }
      }
    );
  });

  // Install now
  ipcMain.handle('quit-and-install', () => {
    beforeQuitAndInstall?.();
    autoUpdater.quitAndInstall(false, true);
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

function startDownload(
  callback: (error: Error | null, info: ProgressInfo | null) => void,
  complete: (event: UpdateDownloadedEvent) => void
) {
  const nativeMacUpdater =
    process.platform === 'darwin'
      ? ((autoUpdater as { nativeUpdater?: NodeJS.EventEmitter })
          .nativeUpdater ?? null)
      : null;

  autoUpdater.on('download-progress', (info: ProgressInfo) =>
    callback(null, info)
  );
  autoUpdater.on('error', (error: Error) => callback(error, null));

  if (nativeMacUpdater) {
    nativeMacUpdater.once('update-downloaded', () =>
      complete({} as UpdateDownloadedEvent)
    );
  } else {
    autoUpdater.on('update-downloaded', complete);
  }

  autoUpdater.downloadUpdate();
}
