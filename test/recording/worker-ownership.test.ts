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

import { describe, expect, it, vi } from 'vitest';
import { RecordingAdapter } from '../../electron/main/recording/adapter';
vi.mock('electron', () => ({
  app: {},
  BrowserWindow: class {},
  WebContentsView: class {},
  ipcMain: {},
  powerMonitor: {},
  session: {},
  dialog: {},
}));

describe('isolated recording worker ownership', () => {
  it('rejects a guest or subframe before any media write', async () => {
    const mainFrame = {};
    const contents = { mainFrame };
    const write = vi.fn();
    const adapter = Object.create(RecordingAdapter.prototype) as any;
    adapter.worker = { isDestroyed: () => false, webContents: contents };
    adapter.file = { writeFile: write };
    adapter.command = {
      recording_id: 'a'.repeat(32),
      lease_expires_at: Date.now() / 1000 + 10,
    };
    const chunk = { sequence: 0, bytes: new ArrayBuffer(10) };
    await expect(
      adapter.chunk({ sender: {}, senderFrame: mainFrame }, chunk)
    ).rejects.toThrow('unauthorized');
    await expect(
      adapter.chunk({ sender: contents, senderFrame: {} }, chunk)
    ).rejects.toThrow('unauthorized');
    expect(write).not.toHaveBeenCalled();
  });
  it('rejects forged completion reports before contacting the Brain', async () => {
    const contents = { mainFrame: {} };
    const request = vi.fn();
    const adapter = Object.create(RecordingAdapter.prototype) as any;
    adapter.worker = { isDestroyed: () => false, webContents: contents };
    adapter.command = { recording_id: 'a'.repeat(32) };
    adapter.request = request;
    adapter.reportQueue = Promise.resolve();
    await expect(
      adapter.report({ sender: {}, senderFrame: {} }, { state: 'completed' })
    ).rejects.toThrow('unauthorized');
    expect(request).not.toHaveBeenCalled();
  });
});
