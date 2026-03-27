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

import { BrowserWindow, WebContentsView } from 'electron';

interface WebViewInfo {
  id: string;
  view: WebContentsView;
  initialUrl: string;
  currentUrl: string;
  isActive: boolean;
  isShow: boolean;
  isAttached: boolean;
}

interface Size {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class WebViewManager {
  private webViews = new Map<string, WebViewInfo>();
  private win: BrowserWindow | null = null;
  private size: Size = { x: 0, y: 0, width: 0, height: 0 };
  private maxInactiveWebviews = 5;
  private lastCleanupTime = Date.now();

  constructor(window: BrowserWindow) {
    this.win = window;
  }

  // Remove automatic IPC handler registration from constructor
  // IPC handlers should be registered once in the main process

  public async captureWebview(webviewId: string) {
    const webViewInfo = this.webViews.get(webviewId);
    if (!webViewInfo || webViewInfo.view.webContents.isDestroyed()) return null;

    // If the view is attached (visible to user), use the fast capturePage path
    if (webViewInfo.isAttached) {
      const image = await webViewInfo.view.webContents.capturePage();
      const jpegBuffer = image.toJPEG(10);
      return 'data:image/jpeg;base64,' + jpegBuffer.toString('base64');
    }

    // For detached views, use CDP Page.captureScreenshot which works
    // independently of the native view hierarchy
    try {
      webViewInfo.view.webContents.debugger.attach('1.3');
      const result = await webViewInfo.view.webContents.debugger.sendCommand(
        'Page.captureScreenshot',
        { format: 'jpeg', quality: 10 }
      );
      webViewInfo.view.webContents.debugger.detach();
      return 'data:image/jpeg;base64,' + result.data;
    } catch {
      try {
        webViewInfo.view.webContents.debugger.detach();
      } catch {
        // debugger was not attached, ignore
      }
      return null;
    }
  }

  private getHiddenBounds(id: string): Size {
    const numericId = Number.parseInt(id, 10);
    const offset = Number.isFinite(numericId) ? numericId * 10 : 0;

    return {
      x: -10000 - offset,
      y: -10000 - offset,
      width: 1,
      height: 1,
    };
  }

  private hideNativeView(webview: WebViewInfo) {
    // WebContentsView is a native child view and renders above the renderer DOM.
    // Remove it from the child hierarchy entirely so macOS compositor cannot surface it.
    webview.view.setVisible(false);
    webview.view.setBounds(this.getHiddenBounds(webview.id));
    this.detachFromWindow(webview);
  }

  private attachToWindow(webview: WebViewInfo) {
    if (!webview.isAttached && this.win?.contentView) {
      this.win.contentView.addChildView(webview.view);
      webview.isAttached = true;
    }
  }

  private detachFromWindow(webview: WebViewInfo) {
    if (webview.isAttached && this.win?.contentView) {
      this.win.contentView.removeChildView(webview.view);
      webview.isAttached = false;
    }
  }

  public setSize(size: Size) {
    this.size = size;
    this.webViews.forEach((webview) => {
      if (webview.isActive && webview.isShow) {
        this.changeViewSize(webview.id, size);
      }
    });
  }

  public getActiveWebview() {
    const activeWebviews = Array.from(this.webViews.values()).filter(
      (webview) => webview.isActive
    );

    return activeWebviews.map((webview) => webview.id);
  }

  public async createWebview(
    id: string = '1',
    url: string = 'about:blank?use=0'
  ) {
    try {
      // If webview with this id already exists, return error
      if (this.webViews.has(id)) {
        return {
          success: false,
          error: `Webview with id ${id} already exists`,
        };
      }
      const view = new WebContentsView({
        webPreferences: {
          // Use a separate session partition for webviews to isolate storage from main window
          // This ensures clearing webview storage won't affect main window's auth data
          partition: 'persist:user_login',
          nodeIntegration: false,
          contextIsolation: true,
          backgroundThrottling: true,
          offscreen: false,
          sandbox: true,
          disableBlinkFeatures: 'Accelerated2dCanvas,AutomationControlled',
          enableBlinkFeatures: 'IdleDetection',
          autoplayPolicy: 'document-user-activation-required',
        },
      });
      view.webContents.on('did-finish-load', () => {
        // Inject stealth script to avoid bot detection
        view.webContents.executeJavaScript(`
          // Save original values before overriding to maintain consistency
          const originalLanguages = navigator.languages ? [...navigator.languages] : ['en-US', 'en'];
          const originalHardwareConcurrency = navigator.hardwareConcurrency || 8;
          const originalDeviceMemory = navigator.deviceMemory || 8;

          // Hide webdriver property
          Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
            configurable: true
          });

          // Override plugins with proper PluginArray-like behavior
          Object.defineProperty(navigator, 'plugins', {
            get: () => {
              const plugins = {
                length: 3,
                0: { name: 'Chrome PDF Plugin', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
                1: { name: 'Chrome PDF Viewer', description: '', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
                2: { name: 'Native Client', description: '', filename: 'internal-nacl-plugin' },
                item: function(index) { return this[index] || null; },
                namedItem: function(name) {
                  for (let i = 0; i < this.length; i++) {
                    if (this[i].name === name) return this[i];
                  }
                  return null;
                },
                refresh: function() {},
                [Symbol.iterator]: function* () {
                  for (let i = 0; i < this.length; i++) {
                    yield this[i];
                  }
                }
              };
              return plugins;
            },
            configurable: true
          });

          // Use original system languages for consistency with other browser data
          Object.defineProperty(navigator, 'languages', {
            get: () => originalLanguages,
            configurable: true
          });

          // Use original hardwareConcurrency, clamped to common range (4-16) to avoid extreme fingerprints
          Object.defineProperty(navigator, 'hardwareConcurrency', {
            get: () => Math.min(Math.max(originalHardwareConcurrency, 4), 16),
            configurable: true
          });

          // Use original deviceMemory, clamped to common range (4-16) to avoid extreme fingerprints
          Object.defineProperty(navigator, 'deviceMemory', {
            get: () => Math.min(Math.max(originalDeviceMemory, 4), 16),
            configurable: true
          });

          // Fix WebGL vendor/renderer for both WebGL and WebGL2
          const getParameter = WebGLRenderingContext.prototype.getParameter;
          WebGLRenderingContext.prototype.getParameter = function(parameter) {
            if (parameter === 37445) return 'Intel Inc.';
            if (parameter === 37446) return 'Intel(R) Iris(TM) Graphics 6100';
            return getParameter.call(this, parameter);
          };

          // Also patch WebGL2RenderingContext
          if (typeof WebGL2RenderingContext !== 'undefined') {
            const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
            WebGL2RenderingContext.prototype.getParameter = function(parameter) {
              if (parameter === 37445) return 'Intel Inc.';
              if (parameter === 37446) return 'Intel(R) Iris(TM) Graphics 6100';
              return getParameter2.call(this, parameter);
            };
          }

          // Override chrome runtime - real Chrome has window.chrome but runtime is undefined
          if (!window.chrome) {
            window.chrome = {};
          }
          // In real Chrome, runtime exists but is undefined outside extensions
          // Don't set it to an object, that's detectable

          // Hide automation variables
          const automationVars = ['__webdriver_evaluate', '__selenium_evaluate', '__webdriver_script_fn',
            '__driver_evaluate', '__fxdriver_evaluate', '__driver_unwrapped', 'domAutomation', 'domAutomationController'];
          automationVars.forEach(v => {
            Object.defineProperty(window, v, {
              get: () => undefined,
              set: () => {},
              configurable: true,
              enumerable: false
            });
          });

          // Mouse event handler
          window.addEventListener('mousedown', (e) => {
            if (!(e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement)) {
              e.preventDefault();
            }
          }, true);
        `);
      });

      // Set to muted state when created
      view.webContents.audioMuted = true;
      view.setBorderRadius(16);
      view.setVisible(false);
      view.setBounds(this.getHiddenBounds(id));

      await view.webContents.loadURL(url);

      const webViewInfo: WebViewInfo = {
        id,
        view,
        initialUrl: url,
        currentUrl: url,
        isActive: false,
        isShow: false,
        isAttached: false,
      };
      // view.webContents.on("did-navigate", (event, url) => {
      //   const win = BrowserWindow.fromWebContents(event.sender);
      //   win?.webContents.send("url-updated", url);
      // });

      view.webContents.on('did-navigate-in-page', (event, url) => {
        if (
          webViewInfo.isActive &&
          webViewInfo.isShow &&
          url !== 'about:blank?use=0' &&
          url !== 'about:blank'
        ) {
          console.log('did-navigate-in-page', id, url);
          this.win?.webContents.send('url-updated', url);
          return;
        }
      });
      // Listen for URL change events
      view.webContents.on('did-navigate', (event, navigationUrl) => {
        webViewInfo.currentUrl = navigationUrl;
        if (navigationUrl !== webViewInfo.initialUrl) {
          webViewInfo.isActive = true;
        }
        console.log(`Webview ${id} navigated to: ${navigationUrl}`);
        if (
          webViewInfo.isActive &&
          webViewInfo.isShow &&
          navigationUrl !== 'about:blank?use=0' &&
          navigationUrl !== 'about:blank'
        ) {
          console.log('did-navigate', id, navigationUrl);
          this.win?.webContents.send('url-updated', navigationUrl);
          return;
        }
        this.hideNativeView(webViewInfo);
        const activeSize = this.getActiveWebview().length;
        const allSize = Array.from(this.webViews.values()).length;
        const inactiveSize = allSize - activeSize;

        // Clean up inactive webviews if too many
        if (
          inactiveSize > this.maxInactiveWebviews &&
          Date.now() - this.lastCleanupTime > 30000
        ) {
          this.cleanupInactiveWebviews();
          this.lastCleanupTime = Date.now();
        }

        // Create new webviews if needed
        if (inactiveSize <= 2) {
          const existingKeys = Array.from(this.webViews.keys())
            .map(Number)
            .filter((n) => !isNaN(n));
          const maxId = existingKeys.length > 0 ? Math.max(...existingKeys) : 0;
          const startId = maxId + 1;

          // Create only 2 new webviews to reduce memory usage
          for (let i = 0; i < 2; i++) {
            const nextId = (startId + i).toString();
            this.createWebview(nextId, 'about:blank?use=0');
          }
        }

        // setTimeout(() => {
        //   let newId = Number(id)
        //   view.setBounds({ x: -9999 + newId * 100, y: -9999 + newId * 100, width: 100, height: 100 })
        // }, 500)
        // Notify frontend when URL changes
        if (this.win && !this.win.isDestroyed()) {
          this.win.webContents.send('webview-navigated', id, navigationUrl);
        }
      });

      view.webContents.setWindowOpenHandler(({ url }) => {
        view.webContents.loadURL(url);

        return { action: 'deny' };
      });
      // Store in Map but do NOT addChildView here.
      // Views are only attached to the window when explicitly shown (showWebview).
      // This prevents macOS compositor from briefly surfacing hidden native views
      // above the main app UI.
      this.webViews.set(id, webViewInfo);

      return { success: true, id, hidden: true };
    } catch (error: any) {
      console.error(`Failed to create hidden webview ${id}:`, error);
      return { success: false, error: error.message };
    }
  }

  public changeViewSize(id: string, size: Size) {
    try {
      const webViewInfo = this.webViews.get(id);
      if (!webViewInfo) {
        return { success: false, error: `Webview with id ${id} not found` };
      }

      const { x, y, width, height } = size;
      if (webViewInfo.isActive && webViewInfo.isShow) {
        this.attachToWindow(webViewInfo);
        webViewInfo.view.setVisible(true);
        webViewInfo.view.setBounds({
          x,
          y,
          width: Math.max(width, 100),
          height: Math.max(height, 100),
        });
      } else {
        this.hideNativeView(webViewInfo);
      }

      return { success: true };
    } catch (error: any) {
      console.error(`Failed to resize all webviews:`, error);
      return { success: false, error: error.message };
    }
  }

  public hideWebview(id: string) {
    const webViewInfo = this.webViews.get(id);
    if (!webViewInfo) {
      return { success: false, error: `Webview with id ${id} not found` };
    }
    webViewInfo.isShow = false;
    this.hideNativeView(webViewInfo);

    if (
      webViewInfo.view.webContents &&
      !webViewInfo.view.webContents.isDestroyed()
    ) {
      webViewInfo.view.webContents.setBackgroundThrottling(true);
    }

    return { success: true };
  }
  public hideAllWebview() {
    this.webViews.forEach((webview) => {
      webview.isShow = false;
      this.hideNativeView(webview);

      if (webview.view.webContents && !webview.view.webContents.isDestroyed()) {
        webview.view.webContents.setBackgroundThrottling(true);
      }
    });
  }

  public async showWebview(id: string) {
    let webViewInfo = this.webViews.get(id);

    // If webview doesn't exist, create it
    if (!webViewInfo) {
      console.log(`Webview ${id} not found, creating new one`);
      const createResult = await this.createWebview(id, 'about:blank?use=0');
      if (!createResult.success) {
        return { success: false, error: `Failed to create webview ${id}` };
      }
      webViewInfo = this.webViews.get(id)!;
    }

    const currentUrl = webViewInfo.view.webContents.getURL();
    this.win?.webContents.send('url-updated', currentUrl);
    webViewInfo.isShow = true;
    // Attach to window BEFORE making visible so the view can render
    this.attachToWindow(webViewInfo);
    this.changeViewSize(id, this.size);
    console.log('showWebview', id, this.size);

    if (
      webViewInfo.view.webContents &&
      !webViewInfo.view.webContents.isDestroyed()
    ) {
      webViewInfo.view.webContents.setBackgroundThrottling(false);
    }

    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send('webview-show', id);
    }

    return { success: true };
  }
  public getShowWebview() {
    return JSON.parse(
      JSON.stringify(
        Array.from(this.webViews.values())
          .filter((webview) => webview.isShow)
          .map((webview) => webview.id)
      )
    );
  }

  public destroyWebview(id: string) {
    try {
      const webViewInfo = this.webViews.get(id);
      if (!webViewInfo) {
        return { success: false, error: `Webview with id ${id} not found` };
      }

      if (!webViewInfo.view.webContents.isDestroyed()) {
        webViewInfo.view.webContents.removeAllListeners();
        // DO NOT clear storage data here!
        // Multiple webviews share the same partition 'persist:user_login'
        // Clearing storage would affect ALL webviews and remove login cookies
        // Only clear cache which is per-webContents
        webViewInfo.view.webContents.session.clearCache();
      }

      // remove webview from parent container (if attached)
      this.detachFromWindow(webViewInfo);

      // destroy webview
      webViewInfo.view.webContents.close();

      // remove from Map
      this.webViews.delete(id);

      console.log(`Webview ${id} destroyed successfully`);
      return { success: true };
    } catch (error: any) {
      console.error(`Failed to destroy webview ${id}:`, error);
      return { success: false, error: error.message };
    }
  }

  public destroy() {
    // Destroy all webviews
    Array.from(this.webViews.keys()).forEach((id) => {
      this.destroyWebview(id);
    });
    this.webViews.clear();
  }

  private cleanupInactiveWebviews() {
    const inactiveWebviews = Array.from(this.webViews.entries())
      .filter(
        ([_id, info]) =>
          !info.isActive &&
          !info.isShow &&
          info.currentUrl === 'about:blank?use=0'
      )
      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]));

    const toRemove = inactiveWebviews.slice(this.maxInactiveWebviews);

    toRemove.forEach(([id, _]) => {
      console.log(`Cleaning up inactive webview: ${id}`);
      this.destroyWebview(id);
    });
  }
}
