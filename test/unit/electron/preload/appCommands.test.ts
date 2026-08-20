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

import { APP_COMMAND, APP_COMMAND_CHANNEL } from '@/shared/appCommands';
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
  it('filters unknown commands and removes the exact listener on cleanup', () => {
    const callback = vi.fn();
    const unsubscribe = electronAPI.onAppCommand(callback);
    const listener = mocks.on.mock.calls.find(
      ([channel]) => channel === APP_COMMAND_CHANNEL
    )?.[1];

    expect(listener).toEqual(expect.any(Function));
    listener({}, APP_COMMAND.newProject);
    listener({}, 'not-an-app-command');

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(APP_COMMAND.newProject);

    unsubscribe();
    expect(mocks.off).toHaveBeenCalledWith(APP_COMMAND_CHANNEL, listener);
  });

  it('sends typed close responses on the shared response channel', () => {
    const response = { intent: 'quit-app', action: 'cancel' } as const;

    electronAPI.respondToCloseRequest(response);

    expect(mocks.send).toHaveBeenCalledWith(
      WINDOW_CLOSE_RESPONSE_CHANNEL,
      response
    );
  });

  it('filters close requests and removes the exact listener on cleanup', () => {
    const callback = vi.fn();
    const unsubscribe = electronAPI.onCloseRequest(callback);
    const listener = mocks.on.mock.calls.find(
      ([channel]) => channel === WINDOW_CLOSE_REQUEST_CHANNEL
    )?.[1];

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
