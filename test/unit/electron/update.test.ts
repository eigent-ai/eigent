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

import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Shared mock objects (hoisted so vi.mock factories can reference them)
// ---------------------------------------------------------------------------
const {
  mockAutoUpdater,
  eventHandlers,
  mockGetUpdatePlatformDirectory,
  mockGetGitHubReleaseChannel,
} = vi.hoisted(() => {
  const handlers = new Map<string, Function[]>();

  const autoUpdater = {
    verifyUpdateCodeSignature: true,
    autoDownload: true,
    disableWebInstaller: true,
    allowDowngrade: true,
    forceDevUpdateConfig: false,
    currentVersion: { version: '1.0.0' },
    getUpdateConfigPath: vi.fn(() => '/fake/update-config.yml'),
    setFeedURL: vi.fn(),
    checkForUpdatesAndNotify: vi.fn<() => Promise<any>>(() =>
      Promise.resolve(null)
    ),
    checkForUpdates: vi.fn<() => Promise<any>>(() => Promise.resolve(null)),
    on: vi.fn((event: string, handler: Function) => {
      const list = handlers.get(event) || [];
      list.push(handler);
      handlers.set(event, list);
    }),
    downloadUpdate: vi.fn(() => Promise.resolve([])),
    quitAndInstall: vi.fn(),
  };

  const getUpdatePlatformDirectory = vi.fn<
    (platform: string, arch: string) => string | null
  >(() => 'mac-arm64');
  const getGitHubReleaseChannel = vi.fn(() => 'latest');

  return {
    mockAutoUpdater: autoUpdater,
    eventHandlers: handlers,
    mockGetUpdatePlatformDirectory: getUpdatePlatformDirectory,
    mockGetGitHubReleaseChannel: getGitHubReleaseChannel,
  };
});

// ---------------------------------------------------------------------------
// vi.mock for ESM imports
// ---------------------------------------------------------------------------
vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '1.0.0'),
    getPath: vi.fn(() => '/fake/userData'),
    isPackaged: false,
  },
  ipcMain: {
    handle: vi.fn(),
  },
}));

vi.mock('../../../electron/main/githubReleaseCdnProvider', () => ({
  DEFAULT_CDN_RELEASE_BASE_URL: 'https://default.cdn.example.com/releases',
  getGitHubReleaseChannel: mockGetGitHubReleaseChannel,
  getUpdatePlatformDirectory: mockGetUpdatePlatformDirectory,
  GitHubReleaseCdnProvider: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Inject mock autoUpdater into Node's native require cache.
//
// update.ts loads electron-updater via createRequire()('electron-updater'),
// which bypasses Vitest's vi.mock.  Since electron-updater is CommonJS we can
// pre-populate require.cache so the CJS require returns our mock immediately.
// ---------------------------------------------------------------------------
import { app, ipcMain } from 'electron';
import { createRequire } from 'node:module';

const localRequire = createRequire(import.meta.url);
const electronUpdaterPath = localRequire.resolve('electron-updater');

localRequire.cache[electronUpdaterPath] = {
  id: electronUpdaterPath,
  filename: electronUpdaterPath,
  loaded: true,
  exports: { autoUpdater: mockAutoUpdater },
} as any;

// Dynamic import — runs AFTER require.cache is populated
const { update, registerUpdateIpcHandlers } =
  await import('../../../electron/main/update');

// ---------------------------------------------------------------------------
// Typed references to mocked electron modules
// ---------------------------------------------------------------------------
const mockApp = app as typeof app & {
  getVersion: Mock;
  getPath: Mock;
  isPackaged: boolean;
};
const mockIpcMain = ipcMain as typeof ipcMain & { handle: Mock };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock BrowserWindow with a stubbed webContents.send */
function createMockWindow(overrides?: { isDestroyed?: boolean }) {
  return {
    isDestroyed: vi.fn(() => overrides?.isDestroyed ?? false),
    webContents: {
      send: vi.fn(),
    },
  } as unknown as Electron.BrowserWindow;
}

/** Retrieve the last handler registered for a given event name */
function getLastHandler(event: string): Function | undefined {
  const list = eventHandlers.get(event);
  return list ? list[list.length - 1] : undefined;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventHandlers.clear();

    // Reset mutable properties to sensible defaults
    mockAutoUpdater.verifyUpdateCodeSignature = true;
    mockAutoUpdater.autoDownload = true;
    mockAutoUpdater.disableWebInstaller = true;
    mockAutoUpdater.allowDowngrade = true;
    mockAutoUpdater.forceDevUpdateConfig = false;
    mockApp.isPackaged = false;

    mockGetUpdatePlatformDirectory.mockReturnValue('mac-arm64');
    mockGetGitHubReleaseChannel.mockReturnValue('latest');
  });

  // -----------------------------------------------------------------------
  // update(win) — autoUpdater configuration
  // -----------------------------------------------------------------------
  describe('update(win)', () => {
    it('sets autoUpdater configuration properties', () => {
      const win = createMockWindow();
      update(win);

      expect(mockAutoUpdater.verifyUpdateCodeSignature).toBe(false);
      expect(mockAutoUpdater.autoDownload).toBe(false);
      expect(mockAutoUpdater.disableWebInstaller).toBe(false);
      expect(mockAutoUpdater.allowDowngrade).toBe(false);
      expect(mockAutoUpdater.forceDevUpdateConfig).toBe(true);
    });

    it('registers checking-for-update event handler', () => {
      update(createMockWindow());

      expect(mockAutoUpdater.on).toHaveBeenCalledWith(
        'checking-for-update',
        expect.any(Function)
      );
    });

    it('sends update-can-available with update=true on update-available', () => {
      const win = createMockWindow();
      update(win);

      const handler = getLastHandler('update-available');
      expect(handler).toBeDefined();

      handler!({ version: '2.0.0' } as any);

      expect(win.webContents.send).toHaveBeenCalledWith(
        'update-can-available',
        {
          update: true,
          version: '1.0.0',
          newVersion: '2.0.0',
        }
      );
    });

    it('sends update-can-available with update=false on update-not-available', () => {
      const win = createMockWindow();
      update(win);

      const handler = getLastHandler('update-not-available');
      expect(handler).toBeDefined();

      handler!({ version: '1.0.0' } as any);

      expect(win.webContents.send).toHaveBeenCalledWith(
        'update-can-available',
        {
          update: false,
          version: '1.0.0',
          newVersion: '1.0.0',
        }
      );
    });

    it('does not send IPC on update-available when window is destroyed', () => {
      const win = createMockWindow({ isDestroyed: true });
      update(win);

      const handler = getLastHandler('update-available');
      handler!({ version: '2.0.0' } as any);

      expect(win.webContents.send).not.toHaveBeenCalled();
    });

    it('does not send IPC on update-not-available when window is destroyed', () => {
      const win = createMockWindow({ isDestroyed: true });
      update(win);

      const handler = getLastHandler('update-not-available');
      handler!({ version: '1.0.0' } as any);

      expect(win.webContents.send).not.toHaveBeenCalled();
    });

    it('returns early when platform directory is not supported', () => {
      mockGetUpdatePlatformDirectory.mockReturnValue(null);
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      update(createMockWindow());

      expect(mockAutoUpdater.setFeedURL).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('not configured')
      );

      consoleSpy.mockRestore();
    });

    it('sets feed URL with correct configuration', () => {
      update(createMockWindow());

      expect(mockAutoUpdater.setFeedURL).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'custom',
          owner: 'eigent-ai',
          repo: 'eigent',
          channel: 'latest',
          cdnBaseUrl: 'https://default.cdn.example.com/releases',
          platformDir: 'mac-arm64',
        })
      );
    });

    it('uses EIGENT_UPDATER_CDN_BASE_URL env variable when set', () => {
      const originalEnv = process.env.EIGENT_UPDATER_CDN_BASE_URL;
      process.env.EIGENT_UPDATER_CDN_BASE_URL =
        'https://custom.cdn.example.com';

      update(createMockWindow());

      expect(mockAutoUpdater.setFeedURL).toHaveBeenCalledWith(
        expect.objectContaining({
          cdnBaseUrl: 'https://custom.cdn.example.com',
        })
      );

      if (originalEnv === undefined) {
        delete process.env.EIGENT_UPDATER_CDN_BASE_URL;
      } else {
        process.env.EIGENT_UPDATER_CDN_BASE_URL = originalEnv;
      }
    });

    it('checks for updates when app is packaged', () => {
      mockApp.isPackaged = true;
      mockAutoUpdater.checkForUpdatesAndNotify.mockResolvedValue(null);

      update(createMockWindow());

      expect(mockAutoUpdater.checkForUpdatesAndNotify).toHaveBeenCalled();
    });

    it('checks for updates when app is not packaged', () => {
      mockApp.isPackaged = false;
      mockAutoUpdater.checkForUpdates.mockResolvedValue(null);

      update(createMockWindow());

      expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalled();
    });

    it('registers a global error handler that logs errors', () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      update(createMockWindow());

      const handler = getLastHandler('error');
      expect(handler).toBeDefined();

      handler!(new Error('network failure'));

      expect(consoleSpy).toHaveBeenCalledWith(
        '[AutoUpdater] Update error:',
        'network failure'
      );

      consoleSpy.mockRestore();
    });
  });

  // -----------------------------------------------------------------------
  // registerUpdateIpcHandlers()
  // -----------------------------------------------------------------------
  describe('registerUpdateIpcHandlers()', () => {
    it('registers check-update IPC handler', () => {
      registerUpdateIpcHandlers();

      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        'check-update',
        expect.any(Function)
      );
    });

    it('registers start-download IPC handler', () => {
      registerUpdateIpcHandlers();

      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        'start-download',
        expect.any(Function)
      );
    });

    it('registers quit-and-install IPC handler', () => {
      registerUpdateIpcHandlers();

      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        'quit-and-install',
        expect.any(Function)
      );
    });

    it('check-update returns result on success', async () => {
      const fakeResult = { updateInfo: { version: '2.0.0' } };
      mockAutoUpdater.checkForUpdatesAndNotify.mockResolvedValue(fakeResult);

      registerUpdateIpcHandlers();

      const handler = mockIpcMain.handle.mock.calls.find(
        (c: any[]) => c[0] === 'check-update'
      )?.[1] as Function;

      const result = await handler();

      expect(result).toBe(fakeResult);
    });

    it('check-update returns null on error', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockAutoUpdater.checkForUpdatesAndNotify.mockRejectedValue(
        new Error('offline')
      );

      registerUpdateIpcHandlers();

      const handler = mockIpcMain.handle.mock.calls.find(
        (c: any[]) => c[0] === 'check-update'
      )?.[1] as Function;

      const result = await handler();

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(
        '[AutoUpdater] Update check failed:',
        'offline'
      );

      consoleSpy.mockRestore();
    });

    it('quit-and-install calls autoUpdater.quitAndInstall', () => {
      registerUpdateIpcHandlers();

      const handler = mockIpcMain.handle.mock.calls.find(
        (c: any[]) => c[0] === 'quit-and-install'
      )?.[1] as Function;

      handler();

      expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
    });

    it('start-download triggers autoUpdater.downloadUpdate', () => {
      registerUpdateIpcHandlers();

      const handler = mockIpcMain.handle.mock.calls.find(
        (c: any[]) => c[0] === 'start-download'
      )?.[1] as Function;

      const mockSender = {
        isDestroyed: vi.fn(() => false),
        send: vi.fn(),
      };

      handler({ sender: mockSender });

      expect(mockAutoUpdater.downloadUpdate).toHaveBeenCalled();
    });

    it('start-download sends download-progress to sender', () => {
      registerUpdateIpcHandlers();

      const handler = mockIpcMain.handle.mock.calls.find(
        (c: any[]) => c[0] === 'start-download'
      )?.[1] as Function;

      const mockSender = {
        isDestroyed: vi.fn(() => false),
        send: vi.fn(),
      };

      handler({ sender: mockSender });

      const downloadProgressCalls = mockAutoUpdater.on.mock.calls.filter(
        (c: any[]) => c[0] === 'download-progress'
      );
      expect(downloadProgressCalls.length).toBeGreaterThanOrEqual(1);

      const progressHandler =
        downloadProgressCalls[downloadProgressCalls.length - 1][1];
      const progressInfo = { percent: 50, bytesPerSecond: 1000 };
      progressHandler(progressInfo);

      expect(mockSender.send).toHaveBeenCalledWith(
        'download-progress',
        progressInfo
      );
    });

    it('start-download sends update-error to sender on download error', () => {
      registerUpdateIpcHandlers();

      const handler = mockIpcMain.handle.mock.calls.find(
        (c: any[]) => c[0] === 'start-download'
      )?.[1] as Function;

      const mockSender = {
        isDestroyed: vi.fn(() => false),
        send: vi.fn(),
      };

      handler({ sender: mockSender });

      const errorCalls = mockAutoUpdater.on.mock.calls.filter(
        (c: any[]) => c[0] === 'error'
      );
      expect(errorCalls.length).toBeGreaterThanOrEqual(1);

      const errorHandler = errorCalls[errorCalls.length - 1][1];
      const downloadError = new Error('download failed');
      errorHandler(downloadError);

      expect(mockSender.send).toHaveBeenCalledWith('update-error', {
        message: 'download failed',
        error: downloadError,
      });
    });

    it('start-download does not send to destroyed sender', () => {
      registerUpdateIpcHandlers();

      const handler = mockIpcMain.handle.mock.calls.find(
        (c: any[]) => c[0] === 'start-download'
      )?.[1] as Function;

      const mockSender = {
        isDestroyed: vi.fn(() => true),
        send: vi.fn(),
      };

      handler({ sender: mockSender });

      const errorCalls = mockAutoUpdater.on.mock.calls.filter(
        (c: any[]) => c[0] === 'error'
      );
      const errorHandler = errorCalls[errorCalls.length - 1][1];
      errorHandler(new Error('fail'));

      expect(mockSender.send).not.toHaveBeenCalled();
    });

    it('start-download sends update-downloaded when download completes', () => {
      registerUpdateIpcHandlers();

      const handler = mockIpcMain.handle.mock.calls.find(
        (c: any[]) => c[0] === 'start-download'
      )?.[1] as Function;

      const mockSender = {
        isDestroyed: vi.fn(() => false),
        send: vi.fn(),
      };

      handler({ sender: mockSender });

      const downloadedCalls = mockAutoUpdater.on.mock.calls.filter(
        (c: any[]) => c[0] === 'update-downloaded'
      );
      expect(downloadedCalls.length).toBeGreaterThanOrEqual(1);

      const completeHandler = downloadedCalls[downloadedCalls.length - 1][1];
      completeHandler({});

      expect(mockSender.send).toHaveBeenCalledWith('update-downloaded');
    });
  });
});
