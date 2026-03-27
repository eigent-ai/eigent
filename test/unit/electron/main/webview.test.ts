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

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createdViews } = vi.hoisted(() => ({
  createdViews: [] as any[],
}));

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  WebContentsView: class MockWebContentsView {
    public handlers: Record<string, (...args: any[]) => void> = {};
    public url = 'about:blank?use=0';
    public setBounds = vi.fn();
    public setVisible = vi.fn();
    public setBorderRadius = vi.fn();
    public webContents = {
      audioMuted: false,
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        this.handlers[event] = handler;
      }),
      executeJavaScript: vi.fn(),
      loadURL: vi.fn(async (url: string) => {
        this.url = url;
      }),
      getURL: vi.fn(() => this.url),
      setWindowOpenHandler: vi.fn(),
      capturePage: vi.fn(async () => ({
        toJPEG: vi.fn(() => Buffer.from('mock')),
      })),
      isDestroyed: vi.fn(() => false),
      setBackgroundThrottling: vi.fn(),
      removeAllListeners: vi.fn(),
      close: vi.fn(),
      session: {
        clearCache: vi.fn(),
      },
    };

    constructor() {
      createdViews.push(this);
    }
  },
}));

import { WebViewManager } from '../../../../electron/main/webview';

describe('WebViewManager', () => {
  beforeEach(() => {
    createdViews.length = 0;
    vi.clearAllMocks();
  });

  it('keeps a hidden webview explicitly invisible after navigation', async () => {
    const win = {
      webContents: {
        send: vi.fn(),
      },
      contentView: {
        addChildView: vi.fn(),
        removeChildView: vi.fn(),
      },
      isDestroyed: vi.fn(() => false),
    } as any;

    const manager = new WebViewManager(win);
    await manager.createWebview('7', 'about:blank?use=0');

    const view = createdViews[0];
    view.handlers['did-navigate']?.({}, 'https://example.com');

    expect(view.setVisible).toHaveBeenCalledWith(false);
    expect(view.setBounds).toHaveBeenLastCalledWith({
      x: -10070,
      y: -10070,
      width: 1,
      height: 1,
    });
  });

  it('only makes an active webview visible when shown, then hides it explicitly again', async () => {
    const win = {
      webContents: {
        send: vi.fn(),
      },
      contentView: {
        addChildView: vi.fn(),
        removeChildView: vi.fn(),
      },
      isDestroyed: vi.fn(() => false),
    } as any;

    const manager = new WebViewManager(win);
    await manager.createWebview('3', 'about:blank?use=0');

    const view = createdViews[0];
    view.handlers['did-navigate']?.({}, 'https://example.com');

    manager.setSize({ x: 12, y: 34, width: 500, height: 320 });
    await manager.showWebview('3');

    expect(view.setVisible).toHaveBeenLastCalledWith(true);
    expect(view.setBounds).toHaveBeenLastCalledWith({
      x: 12,
      y: 34,
      width: 500,
      height: 320,
    });

    manager.hideWebview('3');

    expect(view.setVisible).toHaveBeenLastCalledWith(false);
    expect(view.setBounds).toHaveBeenLastCalledWith({
      x: -10030,
      y: -10030,
      width: 1,
      height: 1,
    });
  });
});
