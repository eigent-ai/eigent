import { ipcRenderer, contextBridge } from 'electron'


contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  }, 
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },
  removeAllListeners: (channel:any) => ipcRenderer.removeAllListeners(channel),


})

contextBridge.exposeInMainWorld('electronAPI', {
  closeWindow: (isForceQuit?: boolean) => ipcRenderer.send('window-close', {
    isForceQuit: isForceQuit ?? false
  }),
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  toggleMaximizeWindow: () => ipcRenderer.send('window-toggle-maximize'),
  isFullScreen: () => ipcRenderer.invoke('is-fullscreen'),
  selectFile: (options?: any) => ipcRenderer.invoke('select-file', options),
  triggerMenuAction: (action: string) => ipcRenderer.send('menu-action', action),
  onExecuteAction: (callback: (action: string) => void) => ipcRenderer.on('execute-action', (event, action) => callback(action)),
  getPlatform: () => process.platform,
  getHomeDir: () => ipcRenderer.invoke('get-home-dir'),
  createWebView: (id: string, url: string) => ipcRenderer.invoke('create-webview', id, url),
  hideWebView: (id: string) => ipcRenderer.invoke('hide-webview', id),
  changeViewSize: (id: string, size: Size) => ipcRenderer.invoke('change-view-size', id, size),
  onWebviewNavigated: (callback: (id: string, url: string) => void) => ipcRenderer.on('webview-navigated', (event, id, url) => callback(id, url)),
  showWebview: (id: string) => ipcRenderer.invoke('show-webview', id),
  getActiveWebview: () => ipcRenderer.invoke('get-active-webview'),
  setSize: (size: Size) => ipcRenderer.invoke('set-size', size),
  hideAllWebview: () => ipcRenderer.invoke('hide-all-webview'),
  getShowWebview: () => ipcRenderer.invoke('get-show-webview'),
  webviewDestroy: (webviewId: string) => ipcRenderer.invoke('webview-destroy', webviewId),
  exportLog: () => ipcRenderer.invoke('export-log'),
  uploadLog: (email: string, taskId: string, baseUrl: string, token: string) => ipcRenderer.invoke('upload-log', email, taskId, baseUrl, token),
  // mcp
  mcpInstall: (name: string, mcp: any) => ipcRenderer.invoke('mcp-install', name, mcp),
  mcpRemove: (name: string) => ipcRenderer.invoke('mcp-remove', name),
  mcpUpdate: (name: string, mcp: any) => ipcRenderer.invoke('mcp-update', name, mcp),
  mcpList: () => ipcRenderer.invoke('mcp-list'),
  envWrite: (email: string, kv: { key: string, value: string }) => ipcRenderer.invoke('env-write', email, kv),
  envRemove: (email: string, key: string) => ipcRenderer.invoke('env-remove', email, key),
  getEnvPath: (email: string) => ipcRenderer.invoke('get-env-path', email),
  // command execution
  executeCommand: (command: string,email:string) => ipcRenderer.invoke('execute-command', command,email),
  // file operations
  readFile: (filePath: string) => ipcRenderer.invoke('read-file', filePath),
  deleteFolder: (email: string) => ipcRenderer.invoke('delete-folder', email),
  getMcpConfigPath: (email: string) => ipcRenderer.invoke('get-mcp-config-path', email),
  // install dependencies related API
  checkAndInstallDepsOnUpdate: () => ipcRenderer.invoke('install-dependencies'),
  checkInstallBrowser: () => ipcRenderer.invoke('check-install-browser'),
  getInstallationStatus: () => ipcRenderer.invoke('get-installation-status'),
  onInstallDependenciesStart: (callback: () => void) => {
    ipcRenderer.on('install-dependencies-start', callback);
  },
  onInstallDependenciesLog: (callback: (data: { type: string, data: string }) => void) => {
    ipcRenderer.on('install-dependencies-log', (event, data) => callback(data));
  },
  onInstallDependenciesComplete: (callback: (data: { success: boolean, code?: number, error?: string }) => void) => {
    ipcRenderer.on('install-dependencies-complete', (event, data) => callback(data));
  },
  onUpdateNotification: (callback: (data: { 
    type: string; 
    currentVersion: string; 
    previousVersion: string; 
    reason: string; 
  }) => void) => {
    ipcRenderer.on('update-notification', (event, data) => callback(data));
  },
  startBrowserImport: (args?: any) => ipcRenderer.invoke('start-browser-import', args),
  // remove listeners
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },
  getEmailFolderPath: (email: string) => ipcRenderer.invoke('get-email-folder-path', email),
});



// --------- Preload scripts loading ---------
function domReady(condition: DocumentReadyState[] = ['complete', 'interactive']) {
  return new Promise(resolve => {
    if (condition.includes(document.readyState)) {
      resolve(true)
    } else {
      document.addEventListener('readystatechange', () => {
        if (condition.includes(document.readyState)) {
          resolve(true)
        }
      })
    }
  })
}

const safeDOM = {
  append(parent: HTMLElement, child: HTMLElement) {
    if (!Array.from(parent.children).find(e => e === child)) {
      return parent.appendChild(child)
    }
  },
  remove(parent: HTMLElement, child: HTMLElement) {
    if (Array.from(parent.children).find(e => e === child)) {
      return parent.removeChild(child)
    }
  },
}

/**
 * https://tobiasahlin.com/spinkit
 * https://connoratherton.com/loaders
 * https://projects.lukehaas.me/css-loaders
 * https://matejkustec.github.io/SpinThatShit
 */
function useLoading() {
  const className = `loaders-css__square-spin`
  const styleContent = `
@keyframes square-spin {
  25% { transform: perspective(100px) rotateX(180deg) rotateY(0); }
  50% { transform: perspective(100px) rotateX(180deg) rotateY(180deg); }
  75% { transform: perspective(100px) rotateX(0) rotateY(180deg); }
  100% { transform: perspective(100px) rotateX(0) rotateY(0); }
}
.${className} > div {
  animation-fill-mode: both;
  width: 50px;
  height: 50px;
  background: #fff;
  animation: square-spin 3s 0s cubic-bezier(0.09, 0.57, 0.49, 0.9) infinite;
}
.app-loading-wrap {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #282c34;
  z-index: 9;
}
    `
  const oStyle = document.createElement('style')
  const oDiv = document.createElement('div')

  oStyle.id = 'app-loading-style'
  oStyle.innerHTML = styleContent
  oDiv.className = 'app-loading-wrap'
  oDiv.innerHTML = `<div class="${className}"><div></div></div>`

  return {
    appendLoading() {
      safeDOM.append(document.head, oStyle)
      safeDOM.append(document.body, oDiv)
    },
    removeLoading() {
      safeDOM.remove(document.head, oStyle)
      safeDOM.remove(document.body, oDiv)
    },
  }
}

// ----------------------------------------------------------------------

const { appendLoading, removeLoading } = useLoading()
domReady().then(appendLoading)

window.onmessage = (ev) => {
  ev.data.payload === 'removeLoading' && removeLoading()
}

setTimeout(removeLoading, 4999)