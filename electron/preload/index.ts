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

import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args;
    return ipcRenderer.on(channel, (event, ...args) =>
      listener(event, ...args)
    );
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args;
    return ipcRenderer.off(channel, ...omit);
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args;
    return ipcRenderer.send(channel, ...omit);
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args;
    return ipcRenderer.invoke(channel, ...omit);
  },
  removeAllListeners: (channel: any) => ipcRenderer.removeAllListeners(channel),
});

contextBridge.exposeInMainWorld('electronAPI', {
  closeWindow: (isForceQuit?: boolean) =>
    ipcRenderer.send('window-close', {
      isForceQuit: isForceQuit ?? false,
    }),
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  toggleMaximizeWindow: () => ipcRenderer.send('window-toggle-maximize'),
  isFullScreen: () => ipcRenderer.invoke('is-fullscreen'),
  selectFile: (options?: any) => ipcRenderer.invoke('select-file', options),
  processDroppedFiles: (fileData: Array<{ name: string; path?: string }>) =>
    ipcRenderer.invoke('process-dropped-files', fileData),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  triggerMenuAction: (action: string) =>
    ipcRenderer.send('menu-action', action),
  onExecuteAction: (callback: (action: string) => void) =>
    ipcRenderer.on('execute-action', (event, action) => callback(action)),
  getPlatform: () => process.platform,
  getHomeDir: () => ipcRenderer.invoke('get-home-dir'),
  createWebView: (id: string, url: string) =>
    ipcRenderer.invoke('create-webview', id, url),
  hideWebView: (id: string) => ipcRenderer.invoke('hide-webview', id),
  changeViewSize: (id: string, size: Size) =>
    ipcRenderer.invoke('change-view-size', id, size),
  onWebviewNavigated: (callback: (id: string, url: string) => void) => {
    const channel = 'webview-navigated';
    const listener = (event: any, id: string, url: string) => callback(id, url);
    ipcRenderer.on(channel, listener);
    // Return cleanup function to remove listener
    return () => {
      ipcRenderer.off(channel, listener);
    };
  },
  showWebview: (id: string) => ipcRenderer.invoke('show-webview', id),
  getActiveWebview: () => ipcRenderer.invoke('get-active-webview'),
  setSize: (size: Size) => ipcRenderer.invoke('set-size', size),
  hideAllWebview: () => ipcRenderer.invoke('hide-all-webview'),
  getShowWebview: () => ipcRenderer.invoke('get-show-webview'),
  webviewDestroy: (webviewId: string) =>
    ipcRenderer.invoke('webview-destroy', webviewId),
  exportLog: () => ipcRenderer.invoke('export-log'),
  uploadLog: (email: string, taskId: string, baseUrl: string, token: string) =>
    ipcRenderer.invoke('upload-log', email, taskId, baseUrl, token),
  // mcp
  mcpInstall: (name: string, mcp: any) =>
    ipcRenderer.invoke('mcp-install', name, mcp),
  mcpRemove: (name: string) => ipcRenderer.invoke('mcp-remove', name),
  mcpUpdate: (name: string, mcp: any) =>
    ipcRenderer.invoke('mcp-update', name, mcp),
  mcpList: () => ipcRenderer.invoke('mcp-list'),
  envWrite: (email: string, kv: { key: string; value: string }) =>
    ipcRenderer.invoke('env-write', email, kv),
  envRemove: (email: string, key: string) =>
    ipcRenderer.invoke('env-remove', email, key),
  getEnvPath: (email: string) => ipcRenderer.invoke('get-env-path', email),
  // command execution
  executeCommand: (command: string, email: string) =>
    ipcRenderer.invoke('execute-command', command, email),
  // file operations
  readFile: (filePath: string) => ipcRenderer.invoke('read-file', filePath),
  readFileAsDataUrl: (path: string) =>
    ipcRenderer.invoke('read-file-dataurl', path),
  getFileAsDataUrl: (path: string, type?: string) =>
    ipcRenderer.invoke('get-file-dataurl', path, type),
  deleteFolder: (email: string) => ipcRenderer.invoke('delete-folder', email),
  getMcpConfigPath: (email: string) =>
    ipcRenderer.invoke('get-mcp-config-path', email),
  // install dependencies related API
  checkAndInstallDepsOnUpdate: () => ipcRenderer.invoke('install-dependencies'),
  checkInstallBrowser: () => ipcRenderer.invoke('check-install-browser'),
  getInstallationStatus: () => ipcRenderer.invoke('get-installation-status'),
  getBackendPort: () => ipcRenderer.invoke('get-backend-port'),
  restartBackend: () => ipcRenderer.invoke('restart-backend'),
  onInstallDependenciesStart: (callback: () => void) => {
    ipcRenderer.on('install-dependencies-start', callback);
  },
  onInstallDependenciesLog: (
    callback: (data: { type: string; data: string }) => void
  ) => {
    ipcRenderer.on('install-dependencies-log', (event, data) => callback(data));
  },
  onInstallDependenciesComplete: (
    callback: (data: {
      success: boolean;
      code?: number;
      error?: string;
    }) => void
  ) => {
    ipcRenderer.on('install-dependencies-complete', (event, data) =>
      callback(data)
    );
  },
  onUpdateNotification: (
    callback: (data: {
      type: string;
      currentVersion: string;
      previousVersion: string;
      reason: string;
    }) => void
  ) => {
    ipcRenderer.on('update-notification', (event, data) => callback(data));
  },
  onBackendReady: (
    callback: (data: {
      success: boolean;
      port?: number;
      error?: string;
    }) => void
  ) => {
    ipcRenderer.on('backend-ready', (event, data) => callback(data));
  },
  startBrowserImport: (args?: any) =>
    ipcRenderer.invoke('start-browser-import', args),
  // remove listeners
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },
  getEmailFolderPath: (email: string) =>
    ipcRenderer.invoke('get-email-folder-path', email),
  restartApp: () => ipcRenderer.invoke('restart-app'),
  readGlobalEnv: (key: string) => ipcRenderer.invoke('read-global-env', key),
  getProjectFolderPath: (email: string, projectId: string) =>
    ipcRenderer.invoke('get-project-folder-path', email, projectId),
  openInIDE: (folderPath: string, ide: string) =>
    ipcRenderer.invoke('open-in-ide', folderPath, ide),
  setBrowserPort: (port: number, isExternal?: boolean) =>
    ipcRenderer.invoke('set-browser-port', port, isExternal),
  getBrowserPort: () => ipcRenderer.invoke('get-browser-port'),
  getCdpBrowsers: () => ipcRenderer.invoke('get-cdp-browsers'),
  addCdpBrowser: (port: number, isExternal: boolean, name?: string) =>
    ipcRenderer.invoke('add-cdp-browser', port, isExternal, name),
  removeCdpBrowser: (browserId: string, closeBrowser?: boolean) =>
    ipcRenderer.invoke('remove-cdp-browser', browserId, closeBrowser ?? true),
  launchCdpBrowser: () => ipcRenderer.invoke('launch-cdp-browser'),
  onCdpPoolChanged: (callback: (browsers: any[]) => void) => {
    const channel = 'cdp-pool-changed';
    const listener = (_event: any, browsers: any[]) => callback(browsers);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.off(channel, listener);
    };
  },
  // Skills
  getSkillsDir: () => ipcRenderer.invoke('get-skills-dir'),
  skillsScan: () => ipcRenderer.invoke('skills-scan'),
  skillWrite: (skillDirName: string, content: string) =>
    ipcRenderer.invoke('skill-write', skillDirName, content),
  skillDelete: (skillDirName: string) =>
    ipcRenderer.invoke('skill-delete', skillDirName),
  skillRead: (filePath: string) => ipcRenderer.invoke('skill-read', filePath),
  skillListFiles: (skillDirName: string) =>
    ipcRenderer.invoke('skill-list-files', skillDirName),
  skillImportZip: (
    zipPathOrBuffer: string | ArrayBuffer,
    replacements?: string[]
  ) => ipcRenderer.invoke('skill-import-zip', zipPathOrBuffer, replacements),
  openSkillFolder: (skillName: string) =>
    ipcRenderer.invoke('open-skill-folder', skillName),
  skillConfigInit: (userId: string) =>
    ipcRenderer.invoke('skill-config-init', userId),
  skillConfigLoad: (userId: string) =>
    ipcRenderer.invoke('skill-config-load', userId),
  skillConfigToggle: (userId: string, skillName: string, enabled: boolean) =>
    ipcRenderer.invoke('skill-config-toggle', userId, skillName, enabled),
  skillConfigUpdate: (userId: string, skillName: string, skillConfig: any) =>
    ipcRenderer.invoke('skill-config-update', userId, skillName, skillConfig),
  skillConfigDelete: (userId: string, skillName: string) =>
    ipcRenderer.invoke('skill-config-delete', userId, skillName),
});

// --------- Preload scripts loading ---------
function domReady(
  condition: DocumentReadyState[] = ['complete', 'interactive']
) {
  return new Promise((resolve) => {
    if (condition.includes(document.readyState)) {
      resolve(true);
    } else {
      document.addEventListener('readystatechange', () => {
        if (condition.includes(document.readyState)) {
          resolve(true);
        }
      });
    }
  });
}

const safeDOM = {
  append(parent: HTMLElement, child: HTMLElement) {
    if (!Array.from(parent.children).find((e) => e === child)) {
      return parent.appendChild(child);
    }
  },
  remove(parent: HTMLElement, child: HTMLElement) {
    if (Array.from(parent.children).find((e) => e === child)) {
      return parent.removeChild(child);
    }
  },
};

/**
 * https://tobiasahlin.com/spinkit
 * https://connoratherton.com/loaders
 * https://projects.lukehaas.me/css-loaders
 * https://matejkustec.github.io/SpinThatShit
 */
function createLoading() {
  const className = `loaders-css__square-spin`;
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
    `;
  const oStyle = document.createElement('style');
  const oDiv = document.createElement('div');

  oStyle.id = 'app-loading-style';
  oStyle.innerHTML = styleContent;
  oDiv.className = 'app-loading-wrap';
  oDiv.innerHTML = `<div class="${className}"><div></div></div>`;

  return {
    appendLoading() {
      safeDOM.append(document.head, oStyle);
      safeDOM.append(document.body, oDiv);
    },
    removeLoading() {
      safeDOM.remove(document.head, oStyle);
      safeDOM.remove(document.body, oDiv);
    },
  };
}

// ----------------------------------------------------------------------

const { appendLoading, removeLoading } = createLoading();
domReady().then(appendLoading);

window.onmessage = (ev) => {
  ev.data.payload === 'removeLoading' && removeLoading();
};

setTimeout(removeLoading, 4999);
