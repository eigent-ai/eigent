import { ipcMain, WebContentsView, BrowserWindow } from 'electron'

interface WebViewInfo {
  id: string
  view: WebContentsView
  initialUrl: string
  currentUrl: string
  isActive: boolean
  isShow: boolean
}

interface Size {
  x: number
  y: number
  width: number
  height: number
}

export class WebViewManager {
  private webViews = new Map<string, WebViewInfo>()
  private win: BrowserWindow | null = null
  private size: Size = { x: 0, y: 0, width: 0, height: 0 }
  private maxInactiveWebviews = 5
  private lastCleanupTime = Date.now()
  
  constructor(window: BrowserWindow) {
    this.win = window
  }

  // Remove automatic IPC handler registration from constructor
  // IPC handlers should be registered once in the main process

  public async captureWebview(webviewId: string) {
    const webContents = this.webViews.get(webviewId);
    if (!webContents) return null;

    const image = await webContents.view.webContents.capturePage();
    const jpegBuffer = image.toJPEG(10);
    return 'data:image/jpeg;base64,' + jpegBuffer.toString('base64');
  }

  public setSize(size: Size) {
    this.size = size
    this.webViews.forEach((webview) => {
      if (webview.isActive && webview.isShow) {
        this.changeViewSize(webview.id, size)
      }
    })
  }

  public getActiveWebview() {
    const activeWebviews = Array.from(this.webViews.values()).filter(webview => webview.isActive)

    return activeWebviews.map(webview => webview.id)
  }



  public async createWebview(id: string = '1', url: string = 'about:blank?use=0') {
    try {
      // If webview with this id already exists, return error
      if (this.webViews.has(id)) {
        return { success: false, error: `Webview with id ${id} already exists` }
      }
      const view = new WebContentsView({
        webPreferences: {
          // Use a separate session partition for webviews to isolate storage from main window
          // This ensures clearing webview storage won't affect main window's auth data
          partition: 'persist:agent-webview',
          nodeIntegration: false,
          contextIsolation: true,
          backgroundThrottling: true,
          offscreen: false,
          sandbox: true,
          disableBlinkFeatures: 'Accelerated2dCanvas',
          enableBlinkFeatures: 'IdleDetection',
          autoplayPolicy: 'document-user-activation-required',
        },
      })
      view.webContents.on('did-finish-load', () => {
        view.webContents.executeJavaScript(`
          window.addEventListener('mousedown', (e) => {
            if (!(e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement)) {
              e.preventDefault();
            }
          }, true);
        `);
      });

      // Set to muted state when created
      view.webContents.audioMuted = true
      let newId = Number(id)
      view.setBounds({ x: -9999 + newId * 100, y: -9999 + newId * 100, width: 100, height: 100 })
      view.setBorderRadius(16)

      await view.webContents.loadURL(url)

      const webViewInfo: WebViewInfo = {
        id,
        view,
        initialUrl: url,
        currentUrl: url,
        isActive: false,
        isShow: false,
      }
      // view.webContents.on("did-navigate", (event, url) => {
      //   const win = BrowserWindow.fromWebContents(event.sender);
      //   win?.webContents.send("url-updated", url);
      // });

      view.webContents.on("did-navigate-in-page", (event, url) => {
        if (webViewInfo.isActive && webViewInfo.isShow && url !== 'about:blank?use=0' && url !== 'about:blank') {
          console.log("did-navigate-in-page", id, url)
          this.win?.webContents.send("url-updated", url);
          return
        }
      });
      // Listen for URL change events
      view.webContents.on('did-navigate', (event, navigationUrl) => {

        webViewInfo.currentUrl = navigationUrl
        if (navigationUrl !== webViewInfo.initialUrl) {
          webViewInfo.isActive = true
        }
        console.log(`Webview ${id} navigated to: ${navigationUrl}`)
        if (webViewInfo.isActive && webViewInfo.isShow && navigationUrl !== 'about:blank?use=0' && navigationUrl !== 'about:blank') {
          console.log("did-navigate", id, navigationUrl)
          this.win?.webContents.send("url-updated", navigationUrl);
          return
        }
        webViewInfo.view.setBounds({ x: -1919, y: -1079, width: 1920, height: 1080 })
        const activeSize = this.getActiveWebview().length
        const allSize = Array.from(this.webViews.values()).length
        const inactiveSize = allSize - activeSize
        
        // Clean up inactive webviews if too many
        if (inactiveSize > this.maxInactiveWebviews && Date.now() - this.lastCleanupTime > 30000) {
          this.cleanupInactiveWebviews()
          this.lastCleanupTime = Date.now()
        }
        
        // Create new webviews if needed
        if (inactiveSize <= 2) {
          const existingKeys = Array.from(this.webViews.keys()).map(Number).filter(n => !isNaN(n))
          const maxId = existingKeys.length > 0 ? Math.max(...existingKeys) : 0
          const startId = maxId + 1

          // Create only 2 new webviews to reduce memory usage
          for (let i = 0; i < 2; i++) {
            const nextId = (startId + i).toString()
            this.createWebview(nextId, 'about:blank?use=0')
          }
        }

        // setTimeout(() => {
        //   let newId = Number(id)
        //   view.setBounds({ x: -9999 + newId * 100, y: -9999 + newId * 100, width: 100, height: 100 })
        // }, 500)
        // Notify frontend when URL changes
        if (this.win && !this.win.isDestroyed()) {
          this.win.webContents.send('webview-navigated', id, navigationUrl)
        }
      })


      view.webContents.setWindowOpenHandler(({ url }) => {
        view.webContents.loadURL(url)

        return { action: 'deny' }
      })
      // Store in Map
      this.webViews.set(id, webViewInfo)

      this.win?.contentView.addChildView(view)
      return { success: true, id, hidden: true }
    } catch (error: any) {
      console.error(`Failed to create hidden webview ${id}:`, error)
      return { success: false, error: error.message }
    }
  }


  public changeViewSize(id: string, size: Size) {
    try {
      const webViewInfo = this.webViews.get(id)
      if (!webViewInfo) {
        return { success: false, error: `Webview with id ${id} not found` }
      }

      const { x, y, width, height } = size
      if (webViewInfo.isActive && webViewInfo.isShow) {
        webViewInfo.view.setBounds({ x, y, width: Math.max(width, 100), height: Math.max(height, 100) })
      } else {
        let newId = Number(id)
        webViewInfo.view.setBounds({ x: -9999 + newId * 100, y: -9999 + newId * 100, width: Math.max(width, 100), height: Math.max(height, 100) })
      }

      return { success: true }
    } catch (error: any) {
      console.error(`Failed to resize all webviews:`, error)
      return { success: false, error: error.message }
    }
  }


  public hideWebview(id: string) {
    const webViewInfo = this.webViews.get(id)
    if (!webViewInfo) {
      return { success: false, error: `Webview with id ${id} not found` }
    }
    let newId = Number(id)
    webViewInfo.view.setBounds({ x: -9999 + newId * 100, y: -9999 + newId * 100, width: 100, height: 100 })
    webViewInfo.isShow = false
    
    if (webViewInfo.view.webContents && !webViewInfo.view.webContents.isDestroyed()) {
      webViewInfo.view.webContents.setBackgroundThrottling(true)
    }

    return { success: true }
  }
  public hideAllWebview() {
    this.webViews.forEach(webview => {
      let newId = Number(webview.id)
      webview.view.setBounds({ x: -9999 + newId * 100, y: -9999 + newId * 100, width: 100, height: 100 })
      webview.isShow = false
      
      if (webview.view.webContents && !webview.view.webContents.isDestroyed()) {
        webview.view.webContents.setBackgroundThrottling(true)
      }
    })
  }

  public async showWebview(id: string) {
    let webViewInfo = this.webViews.get(id)
    
    // If webview doesn't exist, create it
    if (!webViewInfo) {
      console.log(`Webview ${id} not found, creating new one`)
      const createResult = await this.createWebview(id, 'about:blank?use=0')
      if (!createResult.success) {
        return { success: false, error: `Failed to create webview ${id}` }
      }
      webViewInfo = this.webViews.get(id)!
    }
    
    const currentUrl = webViewInfo.view.webContents.getURL();
    this.win?.webContents.send("url-updated", currentUrl);
    webViewInfo.isShow = true
    this.changeViewSize(id, this.size)
    console.log("showWebview", id, this.size)
    
    if (webViewInfo.view.webContents && !webViewInfo.view.webContents.isDestroyed()) {
      webViewInfo.view.webContents.setBackgroundThrottling(false)
    }
    
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send('webview-show', id)
    }

    return { success: true }
  }
  public getShowWebview() {
    return JSON.parse(JSON.stringify(Array.from(this.webViews.values()).filter(webview => webview.isShow).map(webview => webview.id)))
  }

  public destroyWebview(id: string) {
    try {
      const webViewInfo = this.webViews.get(id)
      if (!webViewInfo) {
        return { success: false, error: `Webview with id ${id} not found` }
      }

      if (!webViewInfo.view.webContents.isDestroyed()) {
        webViewInfo.view.webContents.removeAllListeners()
        // Now safe to clear all storage since webviews use separate partition
        webViewInfo.view.webContents.session.clearCache()
        webViewInfo.view.webContents.session.clearStorageData({
          storages: ['cookies', 'localstorage', 'websql', 'indexdb', 'serviceworkers', 'cachestorage']
        })
      }

      // remove webview from parent container
      if (this.win?.contentView) {
        this.win.contentView.removeChildView(webViewInfo.view)
      }

      // destroy webview
      webViewInfo.view.webContents.close()

      // remove from Map
      this.webViews.delete(id)

      console.log(`Webview ${id} destroyed successfully`)
      return { success: true }
    } catch (error: any) {
      console.error(`Failed to destroy webview ${id}:`, error)
      return { success: false, error: error.message }
    }
  }

  public destroy() {
    // Destroy all webviews
    Array.from(this.webViews.keys()).forEach(id => {
      this.destroyWebview(id)
    })
    this.webViews.clear()
  }
  
  private cleanupInactiveWebviews() {
    const inactiveWebviews = Array.from(this.webViews.entries())
      .filter(([id, info]) => !info.isActive && !info.isShow && info.currentUrl === 'about:blank?use=0')
      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
    
    const toRemove = inactiveWebviews.slice(this.maxInactiveWebviews)
    
    toRemove.forEach(([id, _]) => {
      console.log(`Cleaning up inactive webview: ${id}`)
      this.destroyWebview(id)
    })
  }
}

