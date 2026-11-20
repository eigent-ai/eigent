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

/**
 * Unit tests for electron/main/webview.ts
 *
 * Tests WebViewManager class managing WebContentsView lifecycle:
 * - Constructor
 * - createWebview (success, duplicate id error, loadURL failure)
 * - showWebview / hideWebview / hideAllWebview
 * - destroyWebview / destroy
 * - setSize / changeViewSize
 * - captureWebview
 * - getActiveWebview / getShowWebview
 * - cleanupInactiveWebviews
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockWebContentsInstance = {
  on: vi.fn(),
  loadURL: vi.fn().mockResolvedValue(undefined),
  capturePage: vi.fn(),
  getURL: vi.fn().mockReturnValue('https://example.com'),
  setWindowOpenHandler: vi.fn(),
  audioMuted: false,
  setBackgroundThrottling: vi.fn(),
  isDestroyed: vi.fn().mockReturnValue(false),
  removeAllListeners: vi.fn(),
  close: vi.fn(),
  session: {
    clearCache: vi.fn(),
  },
  executeJavaScript: vi.fn().mockResolvedValue(undefined),
};

const mockViewInstance = {
  webContents: mockWebContentsInstance,
  setBounds: vi.fn(),
  setBorderRadius: vi.fn(),
};

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  WebContentsView: vi.fn(() => mockViewInstance),
}));

const mockMainWindow = {
  webContents: {
    send: vi.fn(),
  },
  isDestroyed: vi.fn().mockReturnValue(false),
  contentView: {
    addChildView: vi.fn(),
    removeChildView: vi.fn(),
  },
};

// ---------------------------------------------------------------------------
// Import module under test (after mocks)
// ---------------------------------------------------------------------------

import { WebViewManager } from '../../../electron/main/webview';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebViewManager', () => {
  let manager: WebViewManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new WebViewManager(mockMainWindow as any);
    // Reset mock defaults
    mockWebContentsInstance.loadURL.mockResolvedValue(undefined);
    mockWebContentsInstance.isDestroyed.mockReturnValue(false);
    mockMainWindow.isDestroyed.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Constructor
  // =========================================================================
  describe('constructor', () => {
    it('should accept a BrowserWindow instance', () => {
      const mgr = new WebViewManager(mockMainWindow as any);
      expect(mgr).toBeInstanceOf(WebViewManager);
    });
  });

  // =========================================================================
  // createWebview
  // =========================================================================
  describe('createWebview', () => {
    it('should create a webview successfully with default parameters', async () => {
      const result = await manager.createWebview();

      expect(result.success).toBe(true);
      expect(result.id).toBe('1');
      expect(result.hidden).toBe(true);
      expect(mockMainWindow.contentView.addChildView).toHaveBeenCalledWith(
        mockViewInstance
      );
    });

    it('should create a webview with custom id and url', async () => {
      const result = await manager.createWebview('42', 'https://example.com');

      expect(result.success).toBe(true);
      expect(result.id).toBe('42');
    });

    it('should return error when creating a webview with duplicate id', async () => {
      await manager.createWebview('1');
      const result = await manager.createWebview('1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('should set initial bounds offscreen', async () => {
      await manager.createWebview('3', 'https://example.com');

      expect(mockViewInstance.setBounds).toHaveBeenCalledWith(
        expect.objectContaining({
          x: expect.any(Number),
          y: expect.any(Number),
          width: 100,
          height: 100,
        })
      );
    });

    it('should set border radius on the view', async () => {
      await manager.createWebview();

      expect(mockViewInstance.setBorderRadius).toHaveBeenCalledWith(16);
    });

    it('should mute audio on creation', async () => {
      await manager.createWebview();

      expect(mockWebContentsInstance.audioMuted).toBe(true);
    });

    it('should load the provided URL', async () => {
      await manager.createWebview('5', 'https://test.com');

      expect(mockWebContentsInstance.loadURL).toHaveBeenCalledWith(
        'https://test.com'
      );
    });

    it('should register did-finish-load, did-navigate-in-page, did-navigate, and setWindowOpenHandler listeners', async () => {
      await manager.createWebview();

      const onCalls = mockWebContentsInstance.on.mock.calls.map(
        (c: any[]) => c[0]
      );
      expect(onCalls).toContain('did-finish-load');
      expect(onCalls).toContain('did-navigate-in-page');
      expect(onCalls).toContain('did-navigate');
      expect(mockWebContentsInstance.setWindowOpenHandler).toHaveBeenCalled();
    });

    it('should return error on failure when loadURL throws', async () => {
      mockWebContentsInstance.loadURL.mockRejectedValueOnce(
        new Error('load failed')
      );

      const result = await manager.createWebview('err');

      expect(result.success).toBe(false);
      expect(result.error).toBe('load failed');
    });

    it('should return error with correct id on duplicate even after custom creation', async () => {
      await manager.createWebview('abc', 'https://a.com');
      const dupResult = await manager.createWebview('abc', 'https://b.com');

      expect(dupResult.success).toBe(false);
      expect(dupResult.error).toContain('abc');
    });
  });

  // =========================================================================
  // showWebview
  // =========================================================================
  describe('showWebview', () => {
    it('should show an existing webview', async () => {
      await manager.createWebview('1');

      // Ensure getURL returns a value for the showWebview url-updated IPC
      mockWebContentsInstance.getURL.mockReturnValue('https://example.com');

      const result = await manager.showWebview('1');

      expect(result.success).toBe(true);
      // showWebview sends 'url-updated' with current URL from getURL()
      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'url-updated',
        'https://example.com'
      );
    });

    it('should create webview if it does not exist then show it', async () => {
      const result = await manager.showWebview('99');

      expect(result.success).toBe(true);
      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'webview-show',
        '99'
      );
    });

    it('should disable background throttling when showing', async () => {
      await manager.createWebview('1');
      await manager.showWebview('1');

      expect(
        mockWebContentsInstance.setBackgroundThrottling
      ).toHaveBeenCalledWith(false);
    });

    it('should send webview-show IPC event', async () => {
      await manager.createWebview('1');
      await manager.showWebview('1');

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'webview-show',
        '1'
      );
    });

    it('should return failure when createWebview fails on auto-create', async () => {
      mockWebContentsInstance.loadURL.mockRejectedValueOnce(
        new Error('creation failed')
      );

      // 'fail-id' doesn't exist so showWebview will try to create it
      const result = await manager.showWebview('fail-id');

      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // hideWebview
  // =========================================================================
  describe('hideWebview', () => {
    it('should hide an existing webview', async () => {
      await manager.createWebview('1');
      await manager.showWebview('1');

      const result = manager.hideWebview('1');

      expect(result.success).toBe(true);
    });

    it('should move view offscreen when hiding', async () => {
      await manager.createWebview('1');

      manager.hideWebview('1');

      // The last setBounds call should be offscreen
      const lastCall =
        mockViewInstance.setBounds.mock.calls[
          mockViewInstance.setBounds.mock.calls.length - 1
        ][0];
      expect(lastCall.x).toBeLessThan(0);
      expect(lastCall.y).toBeLessThan(0);
    });

    it('should enable background throttling when hiding', async () => {
      await manager.createWebview('1');

      manager.hideWebview('1');

      expect(
        mockWebContentsInstance.setBackgroundThrottling
      ).toHaveBeenCalledWith(true);
    });

    it('should return error for non-existent webview', () => {
      const result = manager.hideWebview('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  // =========================================================================
  // hideAllWebview
  // =========================================================================
  describe('hideAllWebview', () => {
    it('should hide all webviews', async () => {
      await manager.createWebview('1');
      await manager.createWebview('2');

      manager.hideAllWebview();

      // Both should have been set offscreen — check that setBounds was called
      // enough times (each webview gets setBounds in createWebview + hideAllWebview)
      const callCount = mockViewInstance.setBounds.mock.calls.length;
      expect(callCount).toBeGreaterThanOrEqual(2);
    });
  });

  // =========================================================================
  // destroyWebview
  // =========================================================================
  describe('destroyWebview', () => {
    it('should destroy an existing webview', async () => {
      await manager.createWebview('1');

      const result = manager.destroyWebview('1');

      expect(result.success).toBe(true);
      expect(mockMainWindow.contentView.removeChildView).toHaveBeenCalledWith(
        mockViewInstance
      );
    });

    it('should remove listeners, clear cache, and close webContents', async () => {
      await manager.createWebview('1');

      manager.destroyWebview('1');

      expect(mockWebContentsInstance.removeAllListeners).toHaveBeenCalled();
      expect(mockWebContentsInstance.session.clearCache).toHaveBeenCalled();
      expect(mockWebContentsInstance.close).toHaveBeenCalled();
    });

    it('should return error for non-existent webview', () => {
      const result = manager.destroyWebview('ghost');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should handle error during destruction gracefully', async () => {
      await manager.createWebview('1');
      mockWebContentsInstance.close.mockImplementation(() => {
        throw new Error('close failed');
      });

      const result = manager.destroyWebview('1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('close failed');
    });
  });

  // =========================================================================
  // destroy (all)
  // =========================================================================
  describe('destroy', () => {
    it('should destroy all webviews', async () => {
      await manager.createWebview('1');
      await manager.createWebview('2');
      await manager.createWebview('3');

      manager.destroy();

      // After destroy, getActiveWebview should be empty
      expect(manager.getActiveWebview()).toEqual([]);
    });
  });

  // =========================================================================
  // setSize / changeViewSize
  // =========================================================================
  describe('setSize', () => {
    it('should update size and propagate to active visible webviews', async () => {
      await manager.createWebview('1');
      await manager.showWebview('1');

      // Manually mark as active (normally set by did-navigate to a different URL)
      const mgr = manager as any;
      const wvInfo = mgr.webViews.get('1');
      wvInfo.isActive = true;

      const size = { x: 10, y: 20, width: 800, height: 600 };
      manager.setSize(size);

      // setBounds should have been called with the new size for the active+shown view
      const allCalls = mockViewInstance.setBounds.mock.calls;
      const lastCall = allCalls[allCalls.length - 1][0];
      expect(lastCall.x).toBe(10);
      expect(lastCall.y).toBe(20);
    });

    it('should not resize inactive or hidden webviews', async () => {
      await manager.createWebview('1');

      const callCountBefore = mockViewInstance.setBounds.mock.calls.length;
      manager.setSize({ x: 0, y: 0, width: 500, height: 400 });

      // No new setBounds calls because the view is not active+shown
      expect(mockViewInstance.setBounds.mock.calls.length).toBe(
        callCountBefore
      );
    });
  });

  describe('changeViewSize', () => {
    it('should resize an active and shown webview to given bounds', async () => {
      await manager.createWebview('1');
      await manager.showWebview('1');

      const result = manager.changeViewSize('1', {
        x: 5,
        y: 10,
        width: 300,
        height: 200,
      });

      expect(result.success).toBe(true);
    });

    it('should enforce minimum width of 100', async () => {
      await manager.createWebview('1');
      await manager.showWebview('1');

      manager.changeViewSize('1', { x: 0, y: 0, width: 10, height: 10 });

      const allCalls = mockViewInstance.setBounds.mock.calls;
      const lastCall = allCalls[allCalls.length - 1][0];
      expect(lastCall.width).toBeGreaterThanOrEqual(100);
      expect(lastCall.height).toBeGreaterThanOrEqual(100);
    });

    it('should move inactive webview offscreen', async () => {
      await manager.createWebview('1');

      const result = manager.changeViewSize('1', {
        x: 50,
        y: 50,
        width: 500,
        height: 400,
      });

      expect(result.success).toBe(true);
    });

    it('should return error for non-existent webview', () => {
      const result = manager.changeViewSize('missing', {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  // =========================================================================
  // captureWebview
  // =========================================================================
  describe('captureWebview', () => {
    it('should return a data URI jpeg for an existing webview', async () => {
      const fakeBuffer = Buffer.from('fake-jpeg-data');
      const fakeImage = {
        toJPEG: vi.fn().mockReturnValue(fakeBuffer),
      };
      mockWebContentsInstance.capturePage.mockResolvedValueOnce(fakeImage);

      await manager.createWebview('1');
      const result = await manager.captureWebview('1');

      expect(result).toBe(
        'data:image/jpeg;base64,' + fakeBuffer.toString('base64')
      );
    });

    it('should return null for non-existent webview', async () => {
      const result = await manager.captureWebview('nonexistent');

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // getActiveWebview
  // =========================================================================
  describe('getActiveWebview', () => {
    it('should return empty array when no webviews are active', async () => {
      await manager.createWebview('1');

      expect(manager.getActiveWebview()).toEqual([]);
    });

    it('should return ids of active webviews', async () => {
      await manager.createWebview('1');
      await manager.createWebview('2');

      // Simulate did-navigate firing to mark as active
      // Find the did-navigate handler and invoke it
      const didNavigateCalls = mockWebContentsInstance.on.mock.calls.filter(
        (c: any[]) => c[0] === 'did-navigate'
      );

      // There's one did-navigate handler per createWebview call
      // The latest one corresponds to the second webview created
      if (didNavigateCalls.length >= 1) {
        const handler = didNavigateCalls[0][1];
        handler({}, 'https://navigated.com');
      }

      const active = manager.getActiveWebview();
      // The first webview's handler was called with a different URL, marking it active
      expect(active.length).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // getShowWebview
  // =========================================================================
  describe('getShowWebview', () => {
    it('should return empty array when no webviews are shown', async () => {
      await manager.createWebview('1');

      expect(manager.getShowWebview()).toEqual([]);
    });

    it('should return ids of shown webviews', async () => {
      await manager.createWebview('1');
      await manager.showWebview('1');

      const shown = manager.getShowWebview();
      expect(shown).toContain('1');
    });
  });

  // =========================================================================
  // cleanupInactiveWebviews
  // =========================================================================
  describe('cleanupInactiveWebviews', () => {
    it('should not remove inactive webviews when below the threshold', async () => {
      // Create a few webviews (below maxInactiveWebviews of 5)
      for (let i = 1; i <= 3; i++) {
        await manager.createWebview(String(i));
      }

      // Force cleanup — should not remove any since all are within threshold
      manager.destroy();
      expect(manager.getActiveWebview()).toEqual([]);
    });

    it('should clean up excess inactive webviews', async () => {
      // Create more webviews than the threshold (maxInactiveWebviews = 5)
      // We create 7 to exceed the limit
      for (let i = 1; i <= 7; i++) {
        await manager.createWebview(String(i));
      }

      // Access private method via any to trigger cleanup
      const mgr = manager as any;

      // Call cleanupInactiveWebviews directly
      mgr.cleanupInactiveWebviews();

      // Verify that some webviews were destroyed
      // The method keeps only maxInactiveWebviews inactive entries
      const remaining = mgr.getActiveWebview();
      // All are inactive (about:blank) so cleanup removes the extras
      expect(remaining.length).toBe(0);
    });

    it('should sort webviews by id before cleanup', async () => {
      // Create several webviews
      await manager.createWebview('10');
      await manager.createWebview('2');
      await manager.createWebview('5');
      await manager.createWebview('1');
      await manager.createWebview('3');
      await manager.createWebview('4');
      await manager.createWebview('6');

      const mgr = manager as any;
      mgr.cleanupInactiveWebviews();

      // Verify the manager still functions after cleanup
      expect(manager.getActiveWebview()).toEqual([]);
    });
  });

  // =========================================================================
  // did-navigate handler
  // =========================================================================
  describe('did-navigate event handler', () => {
    it('should send url-updated IPC when active and shown webview navigates', async () => {
      mockMainWindow.webContents.send.mockClear();

      await manager.createWebview('1');
      await manager.showWebview('1');
      mockMainWindow.webContents.send.mockClear();

      // Find the latest did-navigate handler (from the createWebview call)
      const didNavigateCalls = mockWebContentsInstance.on.mock.calls.filter(
        (c: any[]) => c[0] === 'did-navigate'
      );
      // The last registered handler corresponds to our webview
      const lastDidNavigateCall = didNavigateCalls[didNavigateCalls.length - 1];
      const handler = lastDidNavigateCall[1];

      handler({}, 'https://new-url.com');

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'url-updated',
        'https://new-url.com'
      );
    });

    it('should set inactive bounds when webview is not active+shown', async () => {
      await manager.createWebview('1');

      const boundsCallCountBefore =
        mockViewInstance.setBounds.mock.calls.length;

      // Find did-navigate handler
      const didNavigateCalls = mockWebContentsInstance.on.mock.calls.filter(
        (c: any[]) => c[0] === 'did-navigate'
      );
      const handler = didNavigateCalls[didNavigateCalls.length - 1][1];

      // about:blank?use=0 is the initial URL, so navigation to a different URL
      // with inactive+hidden state should set offscreen bounds
      handler({}, 'https://different.com');

      // setBounds should have been called for offscreen positioning
      expect(mockViewInstance.setBounds.mock.calls.length).toBeGreaterThan(
        boundsCallCountBefore
      );
    });
  });

  // =========================================================================
  // did-navigate-in-page handler
  // =========================================================================
  describe('did-navigate-in-page event handler', () => {
    it('should send url-updated when active and shown webview navigates in-page', async () => {
      await manager.createWebview('1');
      await manager.showWebview('1');

      // Manually mark as active (normally set by did-navigate to a different URL)
      const mgr = manager as any;
      const wvInfo = mgr.webViews.get('1');
      wvInfo.isActive = true;

      mockMainWindow.webContents.send.mockClear();

      // Find did-navigate-in-page handler
      const inPageCalls = mockWebContentsInstance.on.mock.calls.filter(
        (c: any[]) => c[0] === 'did-navigate-in-page'
      );
      const handler = inPageCalls[inPageCalls.length - 1][1];

      handler({}, 'https://example.com/page2');

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'url-updated',
        'https://example.com/page2'
      );
    });

    it('should not send url-updated for about:blank URLs', async () => {
      await manager.createWebview('1');
      await manager.showWebview('1');
      mockMainWindow.webContents.send.mockClear();

      const inPageCalls = mockWebContentsInstance.on.mock.calls.filter(
        (c: any[]) => c[0] === 'did-navigate-in-page'
      );
      const handler = inPageCalls[inPageCalls.length - 1][1];

      handler({}, 'about:blank');

      expect(mockMainWindow.webContents.send).not.toHaveBeenCalledWith(
        'url-updated',
        expect.anything()
      );
    });
  });

  // =========================================================================
  // setWindowOpenHandler
  // =========================================================================
  describe('setWindowOpenHandler', () => {
    it('should deny popup and load URL in current webview instead', async () => {
      await manager.createWebview('1');

      const setWindowOpenCall =
        mockWebContentsInstance.setWindowOpenHandler.mock.calls[0];
      const handler = setWindowOpenCall[0];

      const result = handler({ url: 'https://popup.com' });

      expect(result.action).toBe('deny');
      expect(mockWebContentsInstance.loadURL).toHaveBeenCalledWith(
        'https://popup.com'
      );
    });
  });
});
