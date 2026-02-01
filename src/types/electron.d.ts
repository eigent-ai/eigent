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

interface IpcRenderer {
  getPlatform: () => string;
  minimizeWindow: () => void;
  toggleMaximizeWindow: () => void;
  closeWindow: () => void;
  triggerMenuAction: (action: string) => void;
  onExecuteAction: (callback: (action: string) => void) => void;
  invoke: (channel: string, ...args: any[]) => Promise<any>;
}

interface ElectronAPI {
  closeWindow: () => void;
  minimizeWindow: () => void;
  toggleMaximizeWindow: () => void;
  isFullScreen: () => Promise<boolean>;
  selectFile: (options?: any) => Promise<{
    success: boolean;
    files?: Array<{
      filePath: string;
      fileName: string;
    }>;
    fileCount?: number;
    canceled?: boolean;
  }>;
  triggerMenuAction: (action: string) => void;
  onExecuteAction: (callback: (action: string) => void) => void;
  getPlatform: () => string;
  getHomeDir: () => Promise<string>;
  createWebView: (id: string, url: string) => Promise<any>;
  hideWebView: (id: string) => Promise<any>;
  changeViewSize: (id: string, size: any) => Promise<any>;
  onWebviewNavigated: (
    callback: (id: string, url: string) => void
  ) => () => void;
  showWebview: (id: string) => Promise<any>;
  getActiveWebview: () => Promise<any>;
  setSize: (size: any) => Promise<any>;
  hideAllWebview: () => Promise<any>;
  getShowWebview: () => Promise<any>;
  webviewDestroy: (webviewId: string) => Promise<any>;
  exportLog: () => Promise<any>;
  mcpInstall: (name: string, mcp: any) => Promise<any>;
  mcpRemove: (name: string) => Promise<any>;
  mcpUpdate: (name: string, mcp: any) => Promise<any>;
  mcpList: () => Promise<any>;
  envWrite: (email: string, kv: { key: string; value: string }) => Promise<any>;
  envRemove: (email: string, key: string) => Promise<any>;
  getEnvPath: (email: string) => Promise<string>;
  executeCommand: (
    command: string,
    email: string
  ) => Promise<{
    success: boolean;
    stdout?: string;
    stderr?: string;
    error?: string;
  }>;
  readFile: (filePath: string) => Promise<any>;
  readFileAsDataUrl: (path: string) => Promise<string>;
  deleteFolder: (email: string) => Promise<any>;
  getMcpConfigPath: (email: string) => Promise<string>;
  uploadLog: (
    email: string,
    taskId: string,
    baseUrl: string,
    token: string
  ) => Promise<any>;
  startBrowserImport: (args?: any) => Promise<any>;
  checkAndInstallDepsOnUpdate: () => Promise<{
    success: boolean;
    error?: string;
  }>;
  checkInstallBrowser: () => Promise<{ data: any[] }>;
  getInstallationStatus: () => Promise<{
    success: boolean;
    isInstalling?: boolean;
    hasLockFile?: boolean;
    installedExists?: boolean;
    timestamp?: number;
    error?: string;
  }>;
  getBackendPort: () => Promise<number | null>;
  restartBackend: () => Promise<{ success: boolean; error?: string }>;
  onInstallDependenciesStart: (callback: () => void) => void;
  onInstallDependenciesLog: (
    callback: (data: { type: string; data: string }) => void
  ) => void;
  onInstallDependenciesComplete: (
    callback: (data: {
      success: boolean;
      code?: number;
      error?: string;
    }) => void
  ) => void;
  onUpdateNotification: (
    callback: (data: {
      type: string;
      currentVersion: string;
      previousVersion: string;
      reason: string;
    }) => void
  ) => void;
  onBackendReady: (
    callback: (data: {
      success: boolean;
      port?: number;
      error?: string;
    }) => void
  ) => void;
  removeAllListeners: (channel: string) => void;
  getEmailFolderPath: (email: string) => Promise<{
    MCP_REMOTE_CONFIG_DIR: string;
    MCP_CONFIG_DIR: string;
    tempEmail: string;
  }>;
  restartApp: () => Promise<void>;
  readGlobalEnv: (key: string) => Promise<{ value: string | null }>;
}

declare global {
  interface Window {
    ipcRenderer: IpcRenderer;
    electronAPI: ElectronAPI;
  }
}
