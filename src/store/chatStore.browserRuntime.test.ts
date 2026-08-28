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

import { afterEach, describe, expect, it, vi } from 'vitest';

import { injectHost, resolveCdpBrowsersForRequest } from './chatStore';

describe('Electron embedded browser runtime', () => {
  afterEach(() => {
    injectHost(null);
  });

  it('uses exact embedded Electron targets without launching Chromium', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'get-browser-port') return 9222;
      if (channel === 'get-embedded-browser-runtime') {
        return {
          port: 9222,
          targetAvailable: true,
          targets: [
            {
              url: 'about:blank#eigent-browser-toolkit=7',
              webContentsId: 71,
            },
            {
              url: 'about:blank#eigent-browser-toolkit=8',
              webContentsId: 72,
            },
          ],
        };
      }
      throw new Error(`Unexpected IPC channel: ${channel}`);
    });
    injectHost({ ipcRenderer: { invoke } } as any);

    await expect(resolveCdpBrowsersForRequest(true)).resolves.toEqual({
      browser_port: 9222,
      cdp_browsers: [
        {
          id: 'electron-webview-71',
          port: 9222,
          endpoint: 'http://127.0.0.1:9222',
          isExternal: false,
          managedBy: 'electron',
          targetUrl: 'about:blank#eigent-browser-toolkit=7',
        },
        {
          id: 'electron-webview-72',
          port: 9222,
          endpoint: 'http://127.0.0.1:9222',
          isExternal: false,
          managedBy: 'electron',
          targetUrl: 'about:blank#eigent-browser-toolkit=8',
        },
      ],
    });
    expect(invoke).not.toHaveBeenCalledWith('get-cdp-browsers');
    expect(invoke).not.toHaveBeenCalledWith('launch-cdp-browser');
  });

  it('does not reserve or launch a browser for non-browser work', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'get-browser-port') return 9222;
      throw new Error(`Unexpected IPC channel: ${channel}`);
    });
    injectHost({ ipcRenderer: { invoke } } as any);

    await expect(resolveCdpBrowsersForRequest(false)).resolves.toEqual({
      browser_port: 9222,
      cdp_browsers: [],
    });
    expect(invoke).not.toHaveBeenCalledWith('get-embedded-browser-runtime');
    expect(invoke).not.toHaveBeenCalledWith('launch-cdp-browser');
  });
});
