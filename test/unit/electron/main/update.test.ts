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

import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handles: new Map<string, (...args: any[]) => any>(),
  autoUpdater: null as any,
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('electron', () => ({
  app: {
    getVersion: () => '1.0.0',
    getPath: () => '/tmp/eigent-test-user-data',
    isPackaged: false,
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      mocks.handles.set(channel, handler);
    }),
  },
}));

vi.mock('electron-log', () => ({ default: mocks.log }));

vi.mock('node:module', () => {
  const createRequire = () => (id: string) => {
    if (id !== 'electron-updater') throw new Error(`unexpected ${id}`);
    return { autoUpdater: mocks.autoUpdater };
  };
  return { createRequire, default: { createRequire } };
});

vi.mock('../../../../electron/main/githubReleaseCdnProvider', () => ({
  DEFAULT_CDN_RELEASE_BASE_URL: 'https://cdn.example.test/releases',
  GitHubReleaseCdnProvider: class {},
  getGitHubReleaseChannel: () => 'latest',
  getUpdatePlatformDirectory: () => 'win-x64',
}));

function createAutoUpdater() {
  const updater = new EventEmitter() as EventEmitter & Record<string, any>;
  updater.currentVersion = { version: '1.0.0' };
  updater.getUpdateConfigPath = () => 'app-update.yml';
  updater.setFeedURL = vi.fn();
  updater.checkForUpdates = vi.fn().mockResolvedValue(null);
  updater.checkForUpdatesAndNotify = vi.fn().mockResolvedValue(null);
  updater.downloadUpdate = vi.fn().mockResolvedValue([]);
  updater.quitAndInstall = vi.fn();
  return updater;
}

function createSender() {
  return { send: vi.fn(), isDestroyed: () => false };
}

function createWindow(sender = createSender()) {
  return { isDestroyed: () => false, webContents: sender };
}

async function loadUpdateModule() {
  vi.resetModules();
  mocks.handles.clear();
  mocks.autoUpdater = createAutoUpdater();
  const module = await import('../../../../electron/main/update');
  return { ...module, autoUpdater: mocks.autoUpdater };
}

function sentChannels(sender: { send: ReturnType<typeof vi.fn> }) {
  return sender.send.mock.calls.map(([channel]) => channel);
}

describe('desktop auto-updater main process', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes electron-updater logs to the app log', async () => {
    const { update, autoUpdater } = await loadUpdateModule();

    update(createWindow() as any);

    expect(autoUpdater.logger).toBe(mocks.log);
  });

  it('registers download listeners once across repeated downloads', async () => {
    const { update, registerUpdateIpcHandlers, autoUpdater } =
      await loadUpdateModule();
    const sender = createSender();
    update(createWindow(sender) as any);
    update(createWindow(sender) as any);
    registerUpdateIpcHandlers();
    const startDownload = mocks.handles.get('start-download')!;

    startDownload({ sender });
    startDownload({ sender });
    startDownload({ sender });

    expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(3);
    expect(autoUpdater.listenerCount('download-progress')).toBe(1);
    expect(autoUpdater.listenerCount('update-downloaded')).toBe(1);
    expect(autoUpdater.listenerCount('update-available')).toBe(1);
    expect(autoUpdater.listenerCount('error')).toBe(1);

    autoUpdater.emit('download-progress', { percent: 100 });
    autoUpdater.emit('update-downloaded', {});
    expect(sentChannels(sender)).toEqual([
      'download-progress',
      'update-downloaded',
    ]);
  });

  it('reports a failed install launch so the UI can offer Retry', async () => {
    const { update, registerUpdateIpcHandlers, autoUpdater } =
      await loadUpdateModule();
    const sender = createSender();
    const beforeQuit = vi.fn();
    update(createWindow(sender) as any);
    registerUpdateIpcHandlers(beforeQuit);
    autoUpdater.quitAndInstall.mockImplementation(() => {
      autoUpdater.emit('error', new Error('Cannot run installer'));
    });

    mocks.handles.get('quit-and-install')!({ sender });

    expect(beforeQuit).toHaveBeenCalledOnce();
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(sender.send).toHaveBeenCalledWith(
      'update-error',
      expect.objectContaining({ message: 'Cannot run installer' })
    );
  });

  it('keeps background check errors out of the update UI', async () => {
    const { update, registerUpdateIpcHandlers, autoUpdater } =
      await loadUpdateModule();
    const sender = createSender();
    update(createWindow(sender) as any);
    registerUpdateIpcHandlers();

    mocks.handles.get('start-download')!({ sender });
    autoUpdater.emit('update-downloaded', {});
    sender.send.mockClear();
    autoUpdater.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'));

    expect(sender.send).not.toHaveBeenCalled();
    expect(mocks.log.error).toHaveBeenCalled();
  });
});
