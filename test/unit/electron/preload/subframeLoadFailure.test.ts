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
  SUBFRAME_LOAD_FAILED_CHANNEL,
  type SubframeLoadFailure,
} from '@/shared/subframeLoadFailure';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  off: vi.fn(),
  on: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mocks.exposeInMainWorld },
  ipcRenderer: {
    invoke: vi.fn(),
    off: mocks.off,
    on: mocks.on,
    removeAllListeners: vi.fn(),
    send: vi.fn(),
  },
  webUtils: { getPathForFile: vi.fn() },
}));

let electronAPI: {
  onSubframeLoadFailed: (
    callback: (failure: SubframeLoadFailure) => void
  ) => () => void;
};

beforeAll(async () => {
  await import('../../../../electron/preload/index');
  electronAPI = mocks.exposeInMainWorld.mock.calls.find(
    ([name]) => name === 'electronAPI'
  )?.[1];
});

describe('preload subframe load failure bridge', () => {
  it('forwards valid failures and removes its own listener', () => {
    const callback = vi.fn();
    const unsubscribe = electronAPI.onSubframeLoadFailed(callback);
    const listener = mocks.on.mock.calls.find(
      ([channel]) => channel === SUBFRAME_LOAD_FAILED_CHANNEL
    )?.[1];
    expect(listener).toEqual(expect.any(Function));

    const failure = {
      url: 'http://localhost:5001/files/stream?path=report.pdf',
      errorCode: -27,
    };
    listener({}, failure);
    listener({}, { url: failure.url });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(failure);

    unsubscribe();
    expect(mocks.off).toHaveBeenCalledWith(
      SUBFRAME_LOAD_FAILED_CHANNEL,
      listener
    );
  });
});
