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

import {
  APP_COMMAND,
  APP_COMMAND_CHANNEL,
  APP_COMMAND_HANDLED_CHANNEL,
  APP_SHELL_NOT_READY_CHANNEL,
  APP_SHELL_READY_CHANNEL,
  APP_SHELL_READY_PROBE_CHANNEL,
} from '@/shared/appCommands';
import { NATIVE_MENU_LOCALE_CHANNEL } from '@/shared/nativeMenu';
import {
  WINDOW_CLOSE_REQUEST_CHANNEL,
  WINDOW_CLOSE_RESPONSE_CHANNEL,
} from '@/shared/windowClose';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  off: vi.fn(),
  on: vi.fn(),
  removeAllListeners: vi.fn(),
  send: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mocks.exposeInMainWorld },
  ipcRenderer: {
    invoke: mocks.invoke,
    off: mocks.off,
    on: mocks.on,
    removeAllListeners: mocks.removeAllListeners,
    send: mocks.send,
  },
  webUtils: { getPathForFile: vi.fn() },
}));

type ExposedElectronAPI = {
  onAppCommand: (callback: (command: string) => void) => () => void;
  onCloseRequest: (
    callback: (request: { intent: 'close-window' | 'quit-app' }) => void
  ) => () => void;
  respondToCloseRequest: (response: {
    intent: 'close-window' | 'quit-app';
    action: 'acknowledge' | 'confirm' | 'cancel';
  }) => void;
  setNativeMenuLocale: (locale: 'en-US' | 'zh-Hans') => void;
};

let electronAPI: ExposedElectronAPI;

beforeAll(async () => {
  await import('../../../../electron/preload/index');
  const exposure = mocks.exposeInMainWorld.mock.calls.find(
    ([name]) => name === 'electronAPI'
  );
  electronAPI = exposure?.[1] as ExposedElectronAPI;
});

describe('preload app shell bridge', () => {
  it('re-announces READY when the first announcement preceded did-finish-load', async () => {
    mocks.send.mockClear();
    const unsubscribeCommand = electronAPI.onAppCommand(vi.fn());
    const unsubscribeClose = electronAPI.onCloseRequest(vi.fn());
    const probeListener = mocks.on.mock.calls.find(
      ([channel]) => channel === APP_SHELL_READY_PROBE_CHANNEL
    )?.[1];
    const initialReady = mocks.send.mock.calls.find(
      ([channel]) => channel === APP_SHELL_READY_CHANNEL
    )?.[1] as { epoch: string } | undefined;

    expect(initialReady?.epoch).toEqual(expect.any(String));
    expect(probeListener).toEqual(expect.any(Function));

    // Main rejects the first READY until did-finish-load, then sends this
    // probe. The renderer must repeat READY for the same document epoch.
    probeListener({});
    const readyMessages = mocks.send.mock.calls.filter(
      ([channel]) => channel === APP_SHELL_READY_CHANNEL
    );
    expect(readyMessages).toEqual([
      [APP_SHELL_READY_CHANNEL, initialReady],
      [APP_SHELL_READY_CHANNEL, initialReady],
    ]);

    unsubscribeCommand();
    unsubscribeClose();
    await Promise.resolve();
  });

  it('handshakes after both listeners, filters epochs, and sends handled receipts', async () => {
    mocks.send.mockClear();
    const callback = vi.fn();
    const closeCallback = vi.fn();
    const unsubscribeCommand = electronAPI.onAppCommand(callback);
    const unsubscribeClose = electronAPI.onCloseRequest(closeCallback);
    const commandListener = mocks.on.mock.calls
      .filter(([channel]) => channel === APP_COMMAND_CHANNEL)
      .at(-1)?.[1];
    const ready = mocks.send.mock.calls.find(
      ([channel]) => channel === APP_SHELL_READY_CHANNEL
    )?.[1] as { epoch: string } | undefined;

    expect(ready?.epoch).toEqual(expect.any(String));
    expect(commandListener).toEqual(expect.any(Function));
    const request = {
      commandId: APP_COMMAND.newProject,
      requestId: 'request-1',
      epoch: ready!.epoch,
    };
    commandListener({}, request);
    commandListener({}, { ...request, epoch: 'stale-epoch' });
    commandListener({}, APP_COMMAND.newProject);

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(APP_COMMAND.newProject);
    expect(mocks.send).toHaveBeenCalledWith(
      APP_COMMAND_HANDLED_CHANNEL,
      request
    );

    unsubscribeCommand();
    const unsubscribeReplacement = electronAPI.onAppCommand(vi.fn());
    await Promise.resolve();
    expect(mocks.send).not.toHaveBeenCalledWith(
      APP_SHELL_NOT_READY_CHANNEL,
      expect.anything()
    );

    unsubscribeReplacement();
    unsubscribeClose();
    await Promise.resolve();
    expect(mocks.off).toHaveBeenCalledWith(
      APP_COMMAND_CHANNEL,
      commandListener
    );
    expect(mocks.send).toHaveBeenCalledWith(APP_SHELL_NOT_READY_CHANNEL, {
      epoch: ready!.epoch,
    });
  });

  it('sends typed close responses on the shared response channel', () => {
    const response = { intent: 'quit-app', action: 'cancel' } as const;

    electronAPI.respondToCloseRequest(response);

    expect(mocks.send).toHaveBeenCalledWith(
      WINDOW_CLOSE_RESPONSE_CHANNEL,
      response
    );
  });

  it('sends native-menu locale updates on their dedicated channel', () => {
    electronAPI.setNativeMenuLocale('zh-Hans');

    expect(mocks.send).toHaveBeenCalledWith(
      NATIVE_MENU_LOCALE_CHANNEL,
      'zh-Hans'
    );
  });

  it('filters close requests and removes the exact listener on cleanup', () => {
    const callback = vi.fn();
    const unsubscribe = electronAPI.onCloseRequest(callback);
    const listener = mocks.on.mock.calls
      .filter(([channel]) => channel === WINDOW_CLOSE_REQUEST_CHANNEL)
      .at(-1)?.[1];

    expect(listener).toEqual(expect.any(Function));
    listener({}, { intent: 'quit-app' });
    listener({}, { intent: 'not-a-close-intent' });

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith({ intent: 'quit-app' });

    unsubscribe();
    expect(mocks.off).toHaveBeenCalledWith(
      WINDOW_CLOSE_REQUEST_CHANNEL,
      listener
    );
  });
});
