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
  onWebviewNavigated: (callback: (id: string, url: string) => void) => void;
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
  envWrite: (email: string, kv: { key: string, value: string }) => Promise<any>;
  envRemove: (email: string, key: string) => Promise<any>;
  getEnvPath: (email: string) => Promise<string>;
  executeCommand: (command: string,email:string) => Promise<{ success: boolean; stdout?: string; stderr?: string; error?: string }>;
  checkAndInstallDepsOnUpdate: () => Promise<{ success: boolean; error?: string }>;
  checkInstallBrowser: () => Promise<{ data:any[] }>;
  getInstallationStatus: () => Promise<{ 
    success: boolean; 
    isInstalling?: boolean; 
    hasLockFile?: boolean;
    installedExists?: boolean;
    timestamp?: number;
    error?: string 
  }>;
  onInstallDependenciesStart: (callback: () => void) => void;
  onInstallDependenciesLog: (callback: (data: { type: string; data: string }) => void) => void;
  onInstallDependenciesComplete: (callback: (data: { success: boolean; code?: number; error?: string }) => void) => void;
  onUpdateNotification: (callback: (data: { 
    type: string; 
    currentVersion: string; 
    previousVersion: string; 
    reason: string; 
  }) => void) => void;
  removeAllListeners: (channel: string) => void;
  getEmailFolderPath: (email: string) => Promise<{
    MCP_REMOTE_CONFIG_DIR: string;
    MCP_CONFIG_DIR: string;
    tempEmail: string;
  }>;
}

declare global {
  interface Window {
    ipcRenderer: IpcRenderer;
    electronAPI: ElectronAPI;
  }
} 
