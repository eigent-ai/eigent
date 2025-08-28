import { app, ipcMain } from 'electron'
import { createRequire } from 'node:module'
import type {
  ProgressInfo,
  UpdateDownloadedEvent,
  UpdateInfo,
} from 'electron-updater'

const { autoUpdater } = createRequire(import.meta.url)('electron-updater');

export function update(win: Electron.BrowserWindow) {

  // When set to false, the update download will be triggered through the API
  autoUpdater.verifyUpdateCodeSignature = false;
  autoUpdater.autoDownload = false
  autoUpdater.disableWebInstaller = false
  autoUpdater.allowDowngrade = false

  autoUpdater.forceDevUpdateConfig = true

  // start check
  autoUpdater.on('checking-for-update', function () { })
  // update available
  autoUpdater.on('update-available', (arg: UpdateInfo) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-can-available', { update: true, version: app.getVersion(), newVersion: arg?.version })
    }
  })
  // update not available
  autoUpdater.on('update-not-available', (arg: UpdateInfo) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-can-available', { update: false, version: app.getVersion(), newVersion: arg?.version })
    }
  })
  console.log('Current version:', autoUpdater.currentVersion.version)
  console.log('Update config path:', autoUpdater.getUpdateConfigPath?.())
  console.log('User data path (where config lives):', app.getPath('userData'))
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify()
  }
  const feed = {
    provider: 'github',
    owner: 'eigent-ai',
    repo: 'eigent',
    releaseType: 'release',
    channel: process.platform === 'darwin' ? (process.arch === 'arm64' ? 'latest-arm64' : 'latest-x64') : 'latest'
  }

  autoUpdater.setFeedURL(feed)
  if (!app.isPackaged) {
    console.log('[DEV] setFeedURL:', feed)
    autoUpdater.checkForUpdates()
  }

}

/**
 * Registers update-related IPC handlers
 * Should be called once when the app starts
 */
export function registerUpdateIpcHandlers() {
  // Checking for updates
  ipcMain.handle('check-update', async () => {


    try {
      return await autoUpdater.checkForUpdatesAndNotify()
    } catch (error) {
      return { message: 'Network error', error }
    }
  })

  // Start downloading and feedback on progress
  ipcMain.handle('start-download', (event: Electron.IpcMainInvokeEvent) => {
    startDownload(
      (error, progressInfo) => {
        if (error) {
          // feedback download error message
          if (!event.sender.isDestroyed()) {
            event.sender.send('update-error', { message: error.message, error })
          }
        } else {
          // feedback update progress message
          if (!event.sender.isDestroyed()) {
            event.sender.send('download-progress', progressInfo)
          }
        }
      },
      () => {
        // feedback update downloaded message
        if (!event.sender.isDestroyed()) {
          event.sender.send('update-downloaded')
        }
      }
    )
  })

  // Install now
  ipcMain.handle('quit-and-install', () => {
    autoUpdater.quitAndInstall(false, true)
  })
}

function startDownload(
  callback: (error: Error | null, info: ProgressInfo | null) => void,
  complete: (event: UpdateDownloadedEvent) => void,
) {
  autoUpdater.on('download-progress', (info: ProgressInfo) => callback(null, info))
  autoUpdater.on('error', (error: Error) => callback(error, null))
  autoUpdater.on('update-downloaded', complete)
  autoUpdater.downloadUpdate()
}
