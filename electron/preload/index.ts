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
import crypto from 'node:crypto';
import {
  APP_COMMAND_CHANNEL,
  APP_COMMAND_HANDLED_CHANNEL,
  APP_SHELL_NOT_READY_CHANNEL,
  APP_SHELL_READY_CHANNEL,
  APP_SHELL_READY_PROBE_CHANNEL,
  isAppCommandRequest,
  type AppCommandId,
} from '../../src/shared/appCommands';
import {
  NATIVE_MENU_LOCALE_CHANNEL,
  type NativeMenuLocale,
} from '../../src/shared/nativeMenu';
import {
  isWindowCloseRequest,
  WINDOW_CLOSE_REQUEST_CHANNEL,
  WINDOW_CLOSE_RESPONSE_CHANNEL,
  type WindowCloseRequest,
  type WindowCloseResponse,
} from '../../src/shared/windowClose';
import type {
  WorkspaceSecretLookup,
  WorkspaceSecretPutRequest,
} from '../main/workspaceSecrets/types';

const appShellEpoch = crypto.randomUUID();
let appCommandListenerCount = 0;
let closeRequestListenerCount = 0;
let appShellReadySent = false;
let readinessRevision = 0;

function updateAppShellReadiness(): void {
  const revision = ++readinessRevision;
  const ready = appCommandListenerCount > 0 && closeRequestListenerCount > 0;
  if (ready) {
    if (appShellReadySent) return;
    appShellReadySent = true;
    ipcRenderer.send(APP_SHELL_READY_CHANNEL, { epoch: appShellEpoch });
    return;
  }
  if (!appShellReadySent) return;

  // React replaces effect listeners synchronously during a commit. Defer the
  // not-ready edge so that a normal callback rebind cannot create a false
  // renderer outage, while a real unmount/error boundary still invalidates the
  // shell before the next task can dispatch an IPC command.
  queueMicrotask(() => {
    if (revision !== readinessRevision) return;
    if (appCommandListenerCount > 0 && closeRequestListenerCount > 0) return;
    appShellReadySent = false;
    ipcRenderer.send(APP_SHELL_NOT_READY_CHANNEL, { epoch: appShellEpoch });
  });
}

ipcRenderer.on(APP_SHELL_READY_PROBE_CHANNEL, () => {
  // READY may race ahead of main's did-finish-load gate. Re-open the edge so
  // the current listeners can announce the same document epoch again. If the
  // listeners are not mounted yet, their normal registration path will send
  // READY later.
  appShellReadySent = false;
  updateAppShellReadiness();
});

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
  selectAgentPluginSource: () =>
    ipcRenderer.invoke('select-agent-plugin-source'),
  processDroppedFiles: (fileData: Array<{ name: string; path?: string }>) =>
    ipcRenderer.invoke('process-dropped-files', fileData),
  savePastedFile: (fileName: string, data: ArrayBuffer) =>
    ipcRenderer.invoke('save-pasted-file', fileName, data),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  onAppCommand: (callback: (command: AppCommandId) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, request: unknown) => {
      if (!isAppCommandRequest(request) || request.epoch !== appShellEpoch) {
        return;
      }
      callback(request.commandId);
      ipcRenderer.send(APP_COMMAND_HANDLED_CHANNEL, request);
    };
    ipcRenderer.on(APP_COMMAND_CHANNEL, listener);
    appCommandListenerCount += 1;
    updateAppShellReadiness();
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      ipcRenderer.off(APP_COMMAND_CHANNEL, listener);
      appCommandListenerCount = Math.max(0, appCommandListenerCount - 1);
      updateAppShellReadiness();
    };
  },
  onCloseRequest: (callback: (request: WindowCloseRequest) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, request: unknown) => {
      if (isWindowCloseRequest(request)) callback(request);
    };
    ipcRenderer.on(WINDOW_CLOSE_REQUEST_CHANNEL, listener);
    closeRequestListenerCount += 1;
    updateAppShellReadiness();
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      ipcRenderer.off(WINDOW_CLOSE_REQUEST_CHANNEL, listener);
      closeRequestListenerCount = Math.max(0, closeRequestListenerCount - 1);
      updateAppShellReadiness();
    };
  },
  respondToCloseRequest: (response: WindowCloseResponse) =>
    ipcRenderer.send(WINDOW_CLOSE_RESPONSE_CHANNEL, response),
  setNativeMenuLocale: (locale: NativeMenuLocale) =>
    ipcRenderer.send(NATIVE_MENU_LOCALE_CHANNEL, locale),
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
  exportCamelLog: (
    email: string,
    taskId?: string,
    projectId?: string,
    userId?: string | number | null
  ) => ipcRenderer.invoke('export-camel-log', email, taskId, projectId, userId),
  getDiagnosticsInfo: () => ipcRenderer.invoke('get-diagnostics-info'),
  exportDiagnosticsZip: (payload: { description: string; steps?: string }) =>
    ipcRenderer.invoke('export-diagnostics-zip', payload),
  openMailto: (url: string) => ipcRenderer.invoke('open-mailto', url),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
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
  workspaceSecretPut: (request: WorkspaceSecretPutRequest) =>
    ipcRenderer.invoke('workspace-secret:put', request),
  workspaceSecretStatus: (request: WorkspaceSecretLookup) =>
    ipcRenderer.invoke('workspace-secret:status', request),
  workspaceSecretDelete: (request: WorkspaceSecretLookup) =>
    ipcRenderer.invoke('workspace-secret:delete', request),
  // command execution
  executeCommand: (command: string, email: string) =>
    ipcRenderer.invoke('execute-command', command, email),
  // file operations
  readFile: (filePath: string) => ipcRenderer.invoke('read-file', filePath),
  readFileAsDataUrl: (path: string) =>
    ipcRenderer.invoke('read-file-dataurl', path),
  reviewListBackups: (filePaths: string[]) =>
    ipcRenderer.invoke('review-list-backups', filePaths),
  deleteFolder: (email: string) => ipcRenderer.invoke('delete-folder', email),
  getMcpConfigPath: (email: string) =>
    ipcRenderer.invoke('get-mcp-config-path', email),
  // install dependencies related API
  checkAndInstallDepsOnUpdate: () => ipcRenderer.invoke('install-dependencies'),
  checkInstallBrowser: () => ipcRenderer.invoke('check-install-browser'),
  getInstallationStatus: () => ipcRenderer.invoke('get-installation-status'),
  getBackendPort: () => ipcRenderer.invoke('get-backend-port'),
  getLocalControlCapability: () =>
    ipcRenderer.invoke('get-local-control-capability'),
  getDesktopInstanceId: (legacyRendererId?: string) =>
    ipcRenderer.invoke('get-desktop-instance-id', legacyRendererId),
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
  codexSubscriptionStatus: (email: string) =>
    ipcRenderer.invoke('subscription-auth:codex-status', email),
  codexSubscriptionLogin: (email: string) =>
    ipcRenderer.invoke('subscription-auth:codex-login', email),
  codexSubscriptionDisconnect: (email: string) =>
    ipcRenderer.invoke('subscription-auth:codex-disconnect', email),
  getProjectFolderPath: (
    email: string,
    projectId: string,
    userId?: string | number | null
  ) => ipcRenderer.invoke('get-project-folder-path', email, projectId, userId),
  revealLocalPath: (targetPath: string) =>
    ipcRenderer.invoke('reveal-local-path', targetPath),
  openLocalFile: (targetPath: string) =>
    ipcRenderer.invoke('open-local-file', targetPath),
  openInIDE: (targetPath: string, ide: 'vscode' | 'cursor' | 'system') =>
    ipcRenderer.invoke('open-in-ide', targetPath, ide),
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
  // interactive terminal (session preview terminal tabs)
  terminalCreate: (options: {
    id: string;
    cwd?: string;
    cols?: number;
    rows?: number;
  }) => ipcRenderer.invoke('terminal-create', options),
  terminalInput: (id: string, data: string) =>
    ipcRenderer.send('terminal-input', { id, data }),
  terminalResize: (id: string, cols: number, rows: number) =>
    ipcRenderer.send('terminal-resize', { id, cols, rows }),
  terminalDispose: (id: string) => ipcRenderer.invoke('terminal-dispose', id),
  onTerminalData: (
    callback: (payload: { id: string; data: string }) => void
  ) => {
    const channel = 'terminal-data';
    const listener = (_event: any, payload: { id: string; data: string }) =>
      callback(payload);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.off(channel, listener);
    };
  },
  onTerminalExit: (
    callback: (payload: { id: string; exitCode: number }) => void
  ) => {
    const channel = 'terminal-exit';
    const listener = (_event: any, payload: { id: string; exitCode: number }) =>
      callback(payload);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.off(channel, listener);
    };
  },
  // Skills: all operations via Brain REST API, no IPC
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
