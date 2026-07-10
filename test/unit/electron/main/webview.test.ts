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

const electronMocks = vi.hoisted(() => {
  class MockWebContents {
    private listeners = new Map<string, Array<(...args: any[]) => void>>();
    private url = 'about:blank?use=0';
    private title = '';
    audioMuted = false;
    executeJavaScript = vi.fn();
    setBackgroundThrottling = vi.fn();
    setWindowOpenHandler = vi.fn();
    close = vi.fn();
    isDestroyed = vi.fn(() => false);
    isLoading = vi.fn(() => false);
    getURL = vi.fn(() => this.url);
    getTitle = vi.fn(() => this.title);
    removeAllListeners = vi.fn();
    session = { clearCache: vi.fn() };
    debugger = {
      isAttached: vi.fn(() => false),
      attach: vi.fn(),
      detach: vi.fn(),
      sendCommand: vi.fn(async () => ({ data: 'preview' })),
    };
    navigationHistory = {
      canGoBack: vi.fn(() => true),
      canGoForward: vi.fn(() => false),
      goBack: vi.fn(),
      goForward: vi.fn(),
    };

    on = vi.fn((event: string, listener: (...args: any[]) => void) => {
      const listeners = this.listeners.get(event) ?? [];
      listeners.push(listener);
      this.listeners.set(event, listeners);
    });

    private emit(event: string, ...args: any[]) {
      this.listeners.get(event)?.forEach((listener) => listener({}, ...args));
    }

    loadURL = vi.fn(async (url: string) => {
      this.emit('did-start-loading');
      this.url = url;
      this.title = url.startsWith('http') ? 'Example page' : '';
      this.emit('did-navigate', url);
      this.emit('page-title-updated', this.title);
      this.emit('did-stop-loading');
      this.emit('did-finish-load');
    });

    capturePage = vi.fn(async () => ({
      toJPEG: vi.fn(() => Buffer.from('image')),
    }));
    reload = vi.fn();
  }

  class MockWebContentsView {
    webContents = new MockWebContents();
    setBounds = vi.fn();
    setBorderRadius = vi.fn();
  }

  return {
    MockWebContentsView,
    views: [] as InstanceType<typeof MockWebContentsView>[],
  };
});

vi.mock('electron', () => ({
  BrowserWindow: class {},
  WebContentsView: class extends electronMocks.MockWebContentsView {
    constructor() {
      super();
      electronMocks.views.push(this);
    }
  },
}));

import {
  isPreviewWebviewId,
  WebViewManager,
} from '../../../../electron/main/webview';

describe('WebViewManager session preview views', () => {
  const windowMock = {
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn() },
    contentView: {
      addChildView: vi.fn(),
      removeChildView: vi.fn(),
    },
  };

  beforeEach(() => {
    electronMocks.views.length = 0;
    vi.clearAllMocks();
  });

  it('validates and navigates preview-owned views without exposing them as agent views', async () => {
    const manager = new WebViewManager(windowMock as any);
    const id = 'session-preview:browser-1';

    expect(isPreviewWebviewId(id)).toBe(true);
    await manager.createWebview(id);
    expect(
      await manager.navigateWebview(id, 'file:///tmp/report.html')
    ).toEqual({
      success: false,
      error: 'Only HTTP and HTTPS URLs are supported',
    });

    await expect(
      manager.navigateWebview(id, 'https://example.com')
    ).resolves.toEqual({
      success: true,
    });
    expect(manager.getActiveWebview()).toEqual([]);
    expect(await manager.captureWebview(id)).toBeNull();
    expect(windowMock.webContents.send).toHaveBeenCalledWith(
      'preview-webview-state-changed',
      id,
      expect.objectContaining({
        url: 'https://example.com',
        title: 'Example page',
      })
    );
  });

  it('supports preview navigation controls without emitting agent show events', async () => {
    const manager = new WebViewManager(windowMock as any);
    const id = 'session-preview:browser-2';
    await manager.createWebview(id);
    await manager.navigateWebview(id, 'https://example.com');

    manager.goBackWebview(id);
    manager.goForwardWebview(id);
    manager.reloadWebview(id);
    await manager.showWebview(id);

    const contents = electronMocks.views[0].webContents;
    expect(contents.navigationHistory.goBack).toHaveBeenCalled();
    expect(contents.navigationHistory.goForward).not.toHaveBeenCalled();
    expect(contents.reload).toHaveBeenCalled();
    expect(windowMock.webContents.send).not.toHaveBeenCalledWith(
      'webview-show',
      id
    );
    expect(manager.getPreviewWebviewNavigationState(id)).toMatchObject({
      url: 'https://example.com',
      title: 'Example page',
      canGoBack: true,
      canGoForward: false,
    });
  });

  it('leaves agent webview capture behavior intact', async () => {
    const manager = new WebViewManager(windowMock as any);
    await manager.createWebview('1');

    expect(await manager.navigateWebview('1', 'https://example.com')).toEqual({
      success: false,
      error: 'Navigation is limited to preview tabs',
    });
    expect(await manager.captureWebview('1')).toBe(
      'data:image/jpeg;base64,preview'
    );
  });
});
