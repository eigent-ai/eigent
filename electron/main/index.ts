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

import axios from 'axios';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  protocol,
  session,
  shell,
} from 'electron';
import log from 'electron-log';
import FormData from 'form-data';
import fsp from 'fs/promises';
import mime from 'mime';
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import fs, { existsSync } from 'node:fs';
import os, { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import kill from 'tree-kill';
import * as unzipper from 'unzipper';
import { copyBrowserData } from './copy';
import { FileReader } from './fileReader';
import {
  checkToolInstalled,
  findAvailablePort,
  killProcessOnPort,
  startBackend,
} from './init';
import {
  checkAndInstallDepsOnUpdate,
  getInstallationStatus,
  PromiseReturnType,
} from './install-deps';
import { registerUpdateIpcHandlers, update } from './update';
import {
  getEmailFolderPath,
  getEnvPath,
  maskProxyUrl,
  readGlobalEnvKey,
  removeEnvKey,
  updateEnvBlock,
} from './utils/envUtil';
import { zipFolder } from './utils/log';
import { addMcp, readMcpConfig, removeMcp, updateMcp } from './utils/mcpConfig';
import {
  checkVenvExistsForPreCheck,
  getBackendPath,
  isBinaryExists,
} from './utils/process';
import { WebViewManager } from './webview';

const userData = app.getPath('userData');

// ==================== constants ====================
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAIN_DIST = path.join(__dirname, '../..');
const RENDERER_DIST = path.join(MAIN_DIST, 'dist');
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(MAIN_DIST, 'public')
  : RENDERER_DIST;

// ==================== global variables ====================
let win: BrowserWindow | null = null;
let webViewManager: WebViewManager | null = null;
let fileReader: FileReader | null = null;
let python_process: ChildProcessWithoutNullStreams | null = null;
let backendPort: number = 5001;
let browser_port = 9222;
let proxyUrl: string | null = null;

// Protocol URL queue for handling URLs before window is ready
let protocolUrlQueue: string[] = [];
let isWindowReady = false;

// ==================== path config ====================
const preload = path.join(__dirname, '../preload/index.mjs');
const indexHtml = path.join(RENDERER_DIST, 'index.html');
const logPath = log.transports.file.getFile().path;

// Profile initialization promise
let profileInitPromise: Promise<void>;

// Set remote debugging port
// Storage strategy:
// 1. Main window: partition 'persist:main_window' in app userData → Eigent account (persistent)
// 2. WebView: partition 'persist:user_login' in app userData → will import cookies from tool_controller via session API
// 3. tool_controller: ~/.eigent/browser_profiles/profile_user_login → source of truth for login cookies
// 4. CDP browser: uses separate profile (doesn't share with main app)
profileInitPromise = findAvailablePort(browser_port).then(async (port) => {
  browser_port = port;
  app.commandLine.appendSwitch('remote-debugging-port', port + '');

  // Create isolated profile for CDP browser only
  const browserProfilesBase = path.join(
    os.homedir(),
    '.eigent',
    'browser_profiles'
  );
  const cdpProfile = path.join(browserProfilesBase, `cdp_profile_${port}`);

  try {
    await fsp.mkdir(cdpProfile, { recursive: true });
    log.info(`[CDP BROWSER] Created CDP profile directory at ${cdpProfile}`);
  } catch (error) {
    log.error(`[CDP BROWSER] Failed to create directory: ${error}`);
  }

  // Set user-data-dir for Chrome DevTools Protocol only
  app.commandLine.appendSwitch('user-data-dir', cdpProfile);

  log.info(`[CDP BROWSER] Chrome DevTools Protocol enabled on port ${port}`);
  log.info(`[CDP BROWSER] CDP profile directory: ${cdpProfile}`);
  log.info(`[STORAGE] Main app userData: ${app.getPath('userData')}`);
});

// Memory optimization settings
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');
app.commandLine.appendSwitch('force-gpu-mem-available-mb', '512');
app.commandLine.appendSwitch('max_old_space_size', '4096');
app.commandLine.appendSwitch('enable-features', 'MemoryPressureReduction');
app.commandLine.appendSwitch('renderer-process-limit', '8');

// ==================== Proxy configuration ====================
// Read proxy from global .env file on startup
proxyUrl = readGlobalEnvKey('HTTP_PROXY');
if (proxyUrl) {
  log.info(`[PROXY] Applying proxy configuration: ${maskProxyUrl(proxyUrl)}`);
  app.commandLine.appendSwitch('proxy-server', proxyUrl);
} else {
  log.info('[PROXY] No proxy configured');
}

// ==================== Anti-fingerprint settings ====================
// Disable automation controlled indicator to avoid detection
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

// Override User Agent to remove Electron/eigent identifiers
// Dynamically generate User Agent based on actual platform and Chrome version
const getPlatformUA = () => {
  // Use actual Chrome version from Electron instead of hardcoded value
  const chromeVersion = process.versions.chrome || '131.0.0.0';
  switch (process.platform) {
    case 'darwin':
      return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
    case 'win32':
      return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
    case 'linux':
      return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
    default:
      return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
  }
};
const normalUserAgent = getPlatformUA();
app.userAgentFallback = normalUserAgent;

// ==================== protocol privileges ====================
// Register custom protocol privileges before app ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'localfile',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
      bypassCSP: false,
    },
  },
]);

// ==================== app config ====================
process.env.APP_ROOT = MAIN_DIST;
process.env.VITE_PUBLIC = VITE_PUBLIC;

// Respect system theme on Windows, keep light theme on macOS for consistency
const isWindows = process.platform === 'win32';
if (isWindows) {
  nativeTheme.themeSource = 'system'; // Respect Windows dark/light mode
} else {
  nativeTheme.themeSource = 'light'; // Keep existing behavior for macOS
}

// Set log level
log.transports.console.level = 'info';
log.transports.file.level = 'info';
log.transports.console.format = '[{level}]{text}';
log.transports.file.format = '[{level}]{text}';

// Disable GPU Acceleration for Windows 7
if (os.release().startsWith('6.1')) app.disableHardwareAcceleration();

// Set application name for Windows 10+ notifications
if (process.platform === 'win32') app.setAppUserModelId(app.getName());

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// ==================== protocol config ====================
const setupProtocolHandlers = () => {
  if (process.env.NODE_ENV === 'development') {
    const isDefault = app.isDefaultProtocolClient('eigent', process.execPath, [
      path.resolve(process.argv[1]),
    ]);
    if (!isDefault) {
      app.setAsDefaultProtocolClient('eigent', process.execPath, [
        path.resolve(process.argv[1]),
      ]);
    }
  } else {
    app.setAsDefaultProtocolClient('eigent');
  }
};

// ==================== protocol url handle ====================
function handleProtocolUrl(url: string) {
  log.info('enter handleProtocolUrl', url);

  // If window is not ready, queue the URL
  if (!isWindowReady || !win || win.isDestroyed()) {
    log.info('Window not ready, queuing protocol URL:', url);
    protocolUrlQueue.push(url);
    return;
  }

  processProtocolUrl(url);
}

// Process a single protocol URL
function processProtocolUrl(url: string) {
  const urlObj = new URL(url);
  const code = urlObj.searchParams.get('code');
  const share_token = urlObj.searchParams.get('share_token');

  log.info('urlObj', urlObj);
  log.info('code', code);
  log.info('share_token', share_token);

  if (win && !win.isDestroyed()) {
    log.info('urlObj.pathname', urlObj.pathname);

    if (urlObj.pathname === '/oauth') {
      log.info('oauth');
      const provider = urlObj.searchParams.get('provider');
      const code = urlObj.searchParams.get('code');
      log.info('protocol oauth', provider, code);
      win.webContents.send('oauth-authorized', { provider, code });
      return;
    }

    if (code) {
      log.error('protocol code:', code);
      win.webContents.send('auth-code-received', code);
    }

    if (share_token) {
      win.webContents.send('auth-share-token-received', share_token);
    }
  } else {
    log.error('window not available');
  }
}

// Process all queued protocol URLs
function processQueuedProtocolUrls() {
  if (protocolUrlQueue.length > 0) {
    log.info('Processing queued protocol URLs:', protocolUrlQueue.length);

    // Verify window is ready before processing
    if (!win || win.isDestroyed() || !isWindowReady) {
      log.warn(
        'Window not ready for processing queued URLs, keeping URLs in queue'
      );
      return;
    }

    const urls = [...protocolUrlQueue];
    protocolUrlQueue = [];

    urls.forEach((url) => {
      processProtocolUrl(url);
    });
  }
}

// ==================== single instance lock ====================
const setupSingleInstanceLock = () => {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    log.info('no-lock');
    app.quit();
  } else {
    app.on('second-instance', (event, argv) => {
      log.info('second-instance', argv);
      const url = argv.find((arg) => arg.startsWith('eigent://'));
      if (url) handleProtocolUrl(url);
      if (win) win.show();
    });

    app.on('open-url', (event, url) => {
      log.info('open-url');
      event.preventDefault();
      handleProtocolUrl(url);
    });
  }
};

// ==================== initialize config ====================
const initializeApp = () => {
  setupProtocolHandlers();
  setupSingleInstanceLock();
};

/**
 * Registers all IPC handlers once when the app starts
 * This prevents "Attempted to register a second handler" errors
 * when windows are reopened
 */
// Get backup log path
const getBackupLogPath = () => {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'logs', 'main.log');
};
// Constants define
const BROWSER_PATHS = {
  win32: {
    chrome: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    edge: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    firefox: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
    qq: 'C:\\Program Files\\Tencent\\QQBrowser\\QQBrowser.exe',
    '360': path.join(
      homedir(),
      'AppData\\Local\\360Chrome\\Chrome\\Application\\360chrome.exe'
    ),
    arc: path.join(homedir(), 'AppData\\Local\\Arc\\User Data\\Arc.exe'),
    dia: path.join(homedir(), 'AppData\\Local\\Dia\\Application\\dia.exe'),
    fellou: path.join(
      homedir(),
      'AppData\\Local\\Fellou\\Application\\fellou.exe'
    ),
  },
  darwin: {
    chrome: '/Applications/Google Chrome.app',
    edge: '/Applications/Microsoft Edge.app',
    firefox: '/Applications/Firefox.app',
    safari: '/Applications/Safari.app',
    arc: '/Applications/Arc.app',
    dia: '/Applications/Dia.app',
    fellou: '/Applications/Fellou.app',
  },
} as const;

// Tool function
const getSystemLanguage = async () => {
  const locale = app.getLocale();
  return locale === 'zh-CN' ? 'zh-cn' : 'en';
};

const checkManagerInstance = (manager: any, name: string) => {
  if (!manager) {
    throw new Error(`${name} not initialized`);
  }
  return manager;
};

function registerIpcHandlers() {
  // ==================== basic info handler ====================
  ipcMain.handle('get-browser-port', () => {
    log.info('Getting browser port');
    return browser_port;
  });
  ipcMain.handle('get-app-version', () => app.getVersion());
  ipcMain.handle('get-backend-port', () => backendPort);

  // ==================== restart app handler ====================
  ipcMain.handle('restart-app', async () => {
    log.info('[RESTART] Restarting app to apply user profile changes');

    // Clean up Python process first
    await cleanupPythonProcess();

    // Schedule relaunch after a short delay
    setTimeout(() => {
      app.relaunch();
      app.quit();
    }, 100);
  });

  ipcMain.handle('restart-backend', async () => {
    try {
      if (backendPort) {
        log.info('Restarting backend service...');
        await cleanupPythonProcess();
        await checkAndStartBackend();
        log.info('Backend restart completed successfully');
        return { success: true };
      } else {
        log.warn('No backend port found, starting fresh backend');
        await checkAndStartBackend();
        return { success: true };
      }
    } catch (error) {
      log.error('Failed to restart backend:', error);
      return { success: false, error: String(error) };
    }
  });
  ipcMain.handle('get-system-language', getSystemLanguage);
  ipcMain.handle('is-fullscreen', () => win?.isFullScreen() || false);
  ipcMain.handle('get-home-dir', () => {
    const platform = process.platform;
    return platform === 'win32' ? process.env.USERPROFILE : process.env.HOME;
  });

  // ==================== command execution handler ====================
  ipcMain.handle('get-email-folder-path', async (event, email: string) => {
    return getEmailFolderPath(email);
  });
  ipcMain.handle(
    'execute-command',
    async (event, command: string, email: string) => {
      log.info('execute-command', command);
      const { MCP_REMOTE_CONFIG_DIR } = getEmailFolderPath(email);

      try {
        const { spawn } = await import('child_process');

        // Add --host parameter
        const commandWithHost = `${command} --debug --host dev.eigent.ai/api/oauth/notion/callback?code=1`;
        // const commandWithHost = `${command}`;

        log.info(' start execute command:', commandWithHost);

        // Parse command and arguments
        const [cmd, ...args] = commandWithHost.split(' ');
        log.info('start execute command:', commandWithHost.split(' '));
        console.log(cmd, args);
        return new Promise((resolve) => {
          const child = spawn(cmd, args, {
            cwd: process.cwd(),
            env: { ...process.env, MCP_REMOTE_CONFIG_DIR },
            stdio: ['pipe', 'pipe', 'pipe'],
          });

          let stdout = '';
          let stderr = '';

          // Realtime listen standard output
          child.stdout.on('data', (data) => {
            const output = data.toString();
            stdout += output;
            log.info('Real-time output:', output.trim());
          });

          // Realtime listen error output
          child.stderr.on('data', (data) => {
            const output = data.toString();
            stderr += output;
            if (output.includes('OAuth callback server running at')) {
              const url = output
                .split('OAuth callback server running at')[1]
                .trim();
              log.info('detect OAuth callback URL:', url);

              // Notify frontend to callback URL
              if (win && !win.isDestroyed()) {
                const match = url.match(/^https?:\/\/[^:\n]+:\d+/);
                const cleanedUrl = match ? match[0] : null;
                log.info('cleanedUrl', cleanedUrl);
                win.webContents.send('oauth-callback-url', {
                  url: cleanedUrl,
                  provider: 'notion', // TODO: can be set dynamically according to actual situation
                });
              }
            }
            if (output.includes('Press Ctrl+C to exit')) {
              child.kill();
            }
            log.info(' real-time error output:', output.trim());
          });

          // Listen process exit
          child.on('close', (code) => {
            log.info(` command execute complete, exit code: ${code}`);
            resolve({ success: code === null, stdout, stderr });
          });

          // Listen process error
          child.on('error', (error) => {
            log.error(' command execute error:', error);
            resolve({ success: false, error: error.message });
          });
        });
      } catch (error: any) {
        log.error(' command execute failed:', error);
        return { success: false, error: error.message };
      }
    }
  );

  ipcMain.handle('read-file-dataurl', async (event, filePath) => {
    try {
      const file = fs.readFileSync(filePath);
      const mimeType =
        mime.getType(path.extname(filePath)) || 'application/octet-stream';
      return `data:${mimeType};base64,${file.toString('base64')}`;
    } catch (error: any) {
      log.error('Failed to read file as data URL:', filePath, error);
      throw new Error(`Failed to read file: ${error.message}`);
    }
  });

  // ==================== log export handler ====================
  ipcMain.handle('export-log', async () => {
    try {
      let targetLogPath = logPath;
      if (!fs.existsSync(targetLogPath)) {
        const backupPath = getBackupLogPath();
        if (fs.existsSync(backupPath)) {
          targetLogPath = backupPath;
        } else {
          return { success: false, error: 'no log file' };
        }
      }

      await fsp.access(targetLogPath, fs.constants.R_OK);
      const stats = await fsp.stat(targetLogPath);
      if (stats.size === 0) {
        return { success: true, data: 'log file is empty' };
      }

      const logContent = await fsp.readFile(targetLogPath, 'utf-8');

      // Get app version and system version
      const appVersion = app.getVersion();
      const platform = process.platform;
      const arch = process.arch;
      const systemVersion = `${platform}-${arch}`;
      const defaultFileName = `eigent-${appVersion}-${systemVersion}-${Date.now()}.log`;

      // Show save dialog
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'save log file',
        defaultPath: defaultFileName,
        filters: [{ name: 'log file', extensions: ['log', 'txt'] }],
      });

      if (canceled || !filePath) {
        return { success: false, error: '' };
      }

      await fsp.writeFile(filePath, logContent, 'utf-8');
      return { success: true, savedPath: filePath };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    'upload-log',
    async (
      event,
      email: string,
      taskId: string,
      baseUrl: string,
      token: string
    ) => {
      let zipPath: string | null = null;

      try {
        // Validate required parameters
        if (!email || !taskId || !baseUrl || !token) {
          return { success: false, error: 'Missing required parameters' };
        }

        // Sanitize taskId to prevent path traversal attacks
        const sanitizedTaskId = taskId.replace(/[^a-zA-Z0-9_-]/g, '');
        if (!sanitizedTaskId) {
          return { success: false, error: 'Invalid task ID' };
        }

        const { MCP_REMOTE_CONFIG_DIR } = getEmailFolderPath(email);
        const logFolderName = `task_${sanitizedTaskId}`;
        const logFolderPath = path.join(MCP_REMOTE_CONFIG_DIR, logFolderName);

        // Check if log folder exists
        if (!fs.existsSync(logFolderPath)) {
          return { success: false, error: 'Log folder not found' };
        }

        zipPath = path.join(MCP_REMOTE_CONFIG_DIR, `${logFolderName}.zip`);
        await zipFolder(logFolderPath, zipPath);

        // Create form data with file stream
        const formData = new FormData();
        const fileStream = fs.createReadStream(zipPath);
        formData.append('file', fileStream);
        formData.append('task_id', sanitizedTaskId);

        // Upload with timeout
        const response = await axios.post(
          baseUrl + '/api/chat/logs',
          formData,
          {
            headers: {
              'Content-Type': 'multipart/form-data',
              Authorization: `Bearer ${token}`,
            },
            timeout: 60000, // 60 second timeout
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
          }
        );

        fileStream.destroy();

        if (response.status === 200) {
          return { success: true, data: response.data };
        } else {
          return { success: false, error: response.data };
        }
      } catch (error: any) {
        log.error('Failed to upload log:', error);
        return { success: false, error: error.message || 'Upload failed' };
      } finally {
        // Clean up zip file
        if (zipPath && fs.existsSync(zipPath)) {
          try {
            fs.unlinkSync(zipPath);
          } catch (cleanupError) {
            log.error('Failed to clean up zip file:', cleanupError);
          }
        }
      }
    }
  );

  // ==================== MCP manage handler ====================
  ipcMain.handle('mcp-install', async (event, name, mcp) => {
    // Convert args from JSON string to array if needed
    if (mcp.args && typeof mcp.args === 'string') {
      try {
        mcp.args = JSON.parse(mcp.args);
      } catch (_error) {
        // If parsing fails, split by comma as fallback
        mcp.args = mcp.args
          .split(',')
          .map((arg: string) => arg.trim())
          .filter((arg: string) => arg !== '');
      }
    }
    addMcp(name, mcp);
    return { success: true };
  });

  ipcMain.handle('mcp-remove', async (event, name) => {
    removeMcp(name);
    return { success: true };
  });

  ipcMain.handle('mcp-update', async (event, name, mcp) => {
    // Convert args from JSON string to array if needed
    if (mcp.args && typeof mcp.args === 'string') {
      try {
        mcp.args = JSON.parse(mcp.args);
      } catch (_error) {
        // If parsing fails, split by comma as fallback
        mcp.args = mcp.args
          .split(',')
          .map((arg: string) => arg.trim())
          .filter((arg: string) => arg !== '');
      }
    }
    updateMcp(name, mcp);
    return { success: true };
  });

  ipcMain.handle('mcp-list', async () => {
    return readMcpConfig();
  });

  // ==================== browser related handler ====================
  // TODO: next version implement
  ipcMain.handle('check-install-browser', async () => {
    try {
      const platform = process.platform;
      const results: Record<string, boolean> = {};
      const paths = BROWSER_PATHS[platform as keyof typeof BROWSER_PATHS];

      if (!paths) {
        log.warn(`not support current platform: ${platform}`);
        return {};
      }

      for (const [browser, execPath] of Object.entries(paths)) {
        results[browser] = existsSync(execPath);
      }

      return results;
    } catch (error: any) {
      log.error('Failed to check browser installation:', error);
      return {};
    }
  });

  ipcMain.handle('start-browser-import', async (event, args) => {
    const isWin = process.platform === 'win32';
    const localAppData = process.env.LOCALAPPDATA || '';
    const appData = process.env.APPDATA || '';
    const home = os.homedir();

    const candidates: Record<string, string> = {
      chrome: isWin
        ? `${localAppData}\\Google\\Chrome\\User Data\\Default`
        : `${home}/Library/Application Support/Google/Chrome/Default`,
      edge: isWin
        ? `${localAppData}\\Microsoft\\Edge\\User Data\\Default`
        : `${home}/Library/Application Support/Microsoft Edge/Default`,
      firefox: isWin
        ? `${appData}\\Mozilla\\Firefox\\Profiles`
        : `${home}/Library/Application Support/Firefox/Profiles`,
      qq: `${localAppData}\\Tencent\\QQBrowser\\User Data\\Default`,
      '360': `${localAppData}\\360Chrome\\Chrome\\User Data\\Default`,
      arc: isWin
        ? `${localAppData}\\Arc\\User Data\\Default`
        : `${home}/Library/Application Support/Arc/Default`,
      dia: `${localAppData}\\Dia\\User Data\\Default`,
      fellou: `${localAppData}\\Fellou\\User Data\\Default`,
      safari: `${home}/Library/Safari`,
    };

    // Filter unchecked browser
    Object.keys(candidates).forEach((key) => {
      const browser = args.find((item: any) => item.browserId === key);
      if (!browser || !browser.checked) {
        delete candidates[key];
      }
    });

    const result: Record<string, string | null> = {};
    for (const [name, p] of Object.entries(candidates)) {
      result[name] = fs.existsSync(p) ? p : null;
    }

    const electronUserDataPath = app.getPath('userData');

    for (const [browserName, browserPath] of Object.entries(result)) {
      if (!browserPath) continue;
      await copyBrowserData(browserName, browserPath, electronUserDataPath);
    }

    return { success: true };
  });

  // ==================== window control handler ====================
  ipcMain.on('window-close', (_, data) => {
    if (data.isForceQuit) {
      return app?.quit();
    }
    return win?.close();
  });
  ipcMain.on('window-minimize', () => win?.minimize());
  ipcMain.on('window-toggle-maximize', () => {
    if (win?.isMaximized()) {
      win?.unmaximize();
    } else {
      win?.maximize();
    }
  });

  // ==================== file operation handler ====================
  ipcMain.handle('select-file', async (event, options = {}) => {
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
      ...options,
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const files = result.filePaths.map((filePath) => ({
        filePath,
        fileName: filePath.split(/[/\\]/).pop() || '',
      }));

      return {
        success: true,
        files,
        fileCount: files.length,
      };
    }

    return {
      success: false,
      canceled: result.canceled,
    };
  });

  ipcMain.handle('reveal-in-folder', async (event, filePath: string) => {
    try {
      const stats = await fs.promises
        .stat(filePath.replace(/\/$/, ''))
        .catch(() => null);
      if (stats && stats.isDirectory()) {
        shell.openPath(filePath);
      } else {
        shell.showItemInFolder(filePath);
      }
    } catch (e) {
      log.error('reveal in folder failed', e);
    }
  });

  // ======================== skills ========================
  // SKILLS_ROOT, SKILL_FILE, seedDefaultSkillsIfEmpty are defined at module level (used at startup too).
  function parseSkillFrontmatter(
    content: string
  ): { name: string; description: string } | null {
    if (!content.startsWith('---')) return null;
    const end = content.indexOf('\n---', 3);
    const block = end > 0 ? content.slice(4, end) : content.slice(4);
    const nameMatch = block.match(/^\s*name\s*:\s*(.+)$/m);
    const descMatch = block.match(/^\s*description\s*:\s*(.+)$/m);
    const name = nameMatch?.[1]?.trim()?.replace(/^['"]|['"]$/g, '');
    const desc = descMatch?.[1]?.trim()?.replace(/^['"]|['"]$/g, '');
    if (name && desc) return { name, description: desc };
    return null;
  }

  ipcMain.handle('get-skills-dir', async () => {
    try {
      if (!existsSync(SKILLS_ROOT)) {
        await fsp.mkdir(SKILLS_ROOT, { recursive: true });
      }
      await seedDefaultSkillsIfEmpty();
      return { success: true, path: SKILLS_ROOT };
    } catch (error: any) {
      log.error('get-skills-dir failed', error);
      return { success: false, error: error?.message };
    }
  });

  ipcMain.handle('skills-scan', async () => {
    try {
      if (!existsSync(SKILLS_ROOT)) {
        return { success: true, skills: [] };
      }
      await seedDefaultSkillsIfEmpty();
      const entries = await fsp.readdir(SKILLS_ROOT, { withFileTypes: true });
      const skills: Array<{
        name: string;
        description: string;
        path: string;
        scope: string;
        skillDirName: string;
      }> = [];
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('.')) continue;
        const skillPath = path.join(SKILLS_ROOT, e.name, SKILL_FILE);
        try {
          const raw = await fsp.readFile(skillPath, 'utf-8');
          const meta = parseSkillFrontmatter(raw);
          if (meta) {
            skills.push({
              name: meta.name,
              description: meta.description,
              path: skillPath,
              scope: 'user',
              skillDirName: e.name,
            });
          }
        } catch (_) {
          // skip invalid or unreadable skill
        }
      }
      return { success: true, skills };
    } catch (error: any) {
      log.error('skills-scan failed', error);
      return { success: false, error: error?.message, skills: [] };
    }
  });

  ipcMain.handle(
    'skill-write',
    async (_event, skillDirName: string, content: string) => {
      try {
        const dir = path.join(SKILLS_ROOT, skillDirName);
        await fsp.mkdir(dir, { recursive: true });
        await fsp.writeFile(path.join(dir, SKILL_FILE), content, 'utf-8');
        return { success: true };
      } catch (error: any) {
        log.error('skill-write failed', error);
        return { success: false, error: error?.message };
      }
    }
  );

  ipcMain.handle('skill-delete', async (_event, skillDirName: string) => {
    try {
      const dir = path.join(SKILLS_ROOT, skillDirName);
      if (!existsSync(dir)) return { success: true };
      await fsp.rm(dir, { recursive: true, force: true });
      return { success: true };
    } catch (error: any) {
      log.error('skill-delete failed', error);
      return { success: false, error: error?.message };
    }
  });

  ipcMain.handle('skill-read', async (_event, filePath: string) => {
    try {
      const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(SKILLS_ROOT, filePath, SKILL_FILE);
      const content = await fsp.readFile(fullPath, 'utf-8');
      return { success: true, content };
    } catch (error: any) {
      log.error('skill-read failed', error);
      return { success: false, error: error?.message };
    }
  });

  ipcMain.handle('skill-list-files', async (_event, skillDirName: string) => {
    try {
      const dir = path.join(SKILLS_ROOT, skillDirName);
      if (!existsSync(dir))
        return { success: false, error: 'Skill folder not found', files: [] };
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      const files = entries.map((e) =>
        e.isDirectory() ? `${e.name}/` : e.name
      );
      return { success: true, files };
    } catch (error: any) {
      log.error('skill-list-files failed', error);
      return { success: false, error: error?.message, files: [] };
    }
  });

  ipcMain.handle('open-skill-folder', async (_event, skillName: string) => {
    try {
      const name = String(skillName || '').trim();
      if (!name) return { success: false, error: 'Skill name is required' };
      if (!existsSync(SKILLS_ROOT))
        return { success: false, error: 'Skills dir not found' };
      const entries = await fsp.readdir(SKILLS_ROOT, { withFileTypes: true });
      const nameLower = name.toLowerCase();
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('.')) continue;
        const skillPath = path.join(SKILLS_ROOT, e.name, SKILL_FILE);
        try {
          const raw = await fsp.readFile(skillPath, 'utf-8');
          const meta = parseSkillFrontmatter(raw);
          if (meta && meta.name.toLowerCase().trim() === nameLower) {
            const dirPath = path.join(SKILLS_ROOT, e.name);
            await shell.openPath(dirPath);
            return { success: true };
          }
        } catch (_) {
          continue;
        }
      }
      return { success: false, error: `Skill not found: ${name}` };
    } catch (error: any) {
      log.error('open-skill-folder failed', error);
      return { success: false, error: error?.message };
    }
  });

  // ======================== skills-config.json handlers ========================

  function getSkillConfigPath(userId: string): string {
    return path.join(os.homedir(), '.eigent', userId, 'skills-config.json');
  }

  async function loadSkillConfig(userId: string): Promise<any> {
    const configPath = getSkillConfigPath(userId);

    // Auto-create config file if it doesn't exist
    if (!existsSync(configPath)) {
      const defaultConfig = { version: 1, skills: {} };
      try {
        await fsp.mkdir(path.dirname(configPath), { recursive: true });
        await fsp.writeFile(
          configPath,
          JSON.stringify(defaultConfig, null, 2),
          'utf-8'
        );
        log.info(`Auto-created skills config at ${configPath}`);
        return defaultConfig;
      } catch (error) {
        log.error('Failed to create default skills config', error);
        return defaultConfig;
      }
    }

    try {
      const content = await fsp.readFile(configPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      log.error('Failed to load skill config', error);
      return { version: 1, skills: {} };
    }
  }

  async function saveSkillConfig(userId: string, config: any): Promise<void> {
    const configPath = getSkillConfigPath(userId);
    await fsp.mkdir(path.dirname(configPath), { recursive: true });
    await fsp.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  ipcMain.handle('skill-config-load', async (_event, userId: string) => {
    try {
      const config = await loadSkillConfig(userId);
      return { success: true, config };
    } catch (error: any) {
      log.error('skill-config-load failed', error);
      return { success: false, error: error?.message };
    }
  });

  ipcMain.handle(
    'skill-config-toggle',
    async (_event, userId: string, skillName: string, enabled: boolean) => {
      try {
        const config = await loadSkillConfig(userId);
        if (!config.skills[skillName]) {
          // Use SkillScope object format
          config.skills[skillName] = {
            enabled,
            scope: {
              isGlobal: true,
              selectedAgents: [],
            },
            addedAt: Date.now(),
            isExample: false,
          };
        } else {
          config.skills[skillName].enabled = enabled;
        }
        await saveSkillConfig(userId, config);
        return { success: true, config: config.skills[skillName] };
      } catch (error: any) {
        log.error('skill-config-toggle failed', error);
        return { success: false, error: error?.message };
      }
    }
  );

  ipcMain.handle(
    'skill-config-update',
    async (_event, userId: string, skillName: string, skillConfig: any) => {
      try {
        const config = await loadSkillConfig(userId);
        config.skills[skillName] = { ...skillConfig };
        await saveSkillConfig(userId, config);
        return { success: true };
      } catch (error: any) {
        log.error('skill-config-update failed', error);
        return { success: false, error: error?.message };
      }
    }
  );

  ipcMain.handle(
    'skill-config-delete',
    async (_event, userId: string, skillName: string) => {
      try {
        const config = await loadSkillConfig(userId);
        delete config.skills[skillName];
        await saveSkillConfig(userId, config);
        return { success: true };
      } catch (error: any) {
        log.error('skill-config-delete failed', error);
        return { success: false, error: error?.message };
      }
    }
  );

  // Initialize skills config for a user (ensures config file exists)
  ipcMain.handle('skill-config-init', async (_event, userId: string) => {
    try {
      log.info(`[SKILLS-CONFIG] Initializing config for user: ${userId}`);
      const config = await loadSkillConfig(userId);

      try {
        const exampleSkillsDir = getExampleSkillsSourceDir();
        const defaultConfigPath = path.join(
          exampleSkillsDir,
          'default-config.json'
        );

        if (existsSync(defaultConfigPath)) {
          const defaultConfigContent = await fsp.readFile(
            defaultConfigPath,
            'utf-8'
          );
          const defaultConfig = JSON.parse(defaultConfigContent);

          if (defaultConfig.skills) {
            let addedCount = 0;
            // Merge default skills config with user's existing config
            for (const [skillName, skillConfig] of Object.entries(
              defaultConfig.skills
            )) {
              if (!config.skills[skillName]) {
                // Add new skill config with current timestamp
                config.skills[skillName] = {
                  ...(skillConfig as any),
                  addedAt: Date.now(),
                };
                addedCount++;
                log.info(
                  `[SKILLS-CONFIG] Initialized config for example skill: ${skillName}`
                );
              }
            }

            if (addedCount > 0) {
              await saveSkillConfig(userId, config);
              log.info(
                `[SKILLS-CONFIG] Added ${addedCount} example skill configs`
              );
            }
          }
        } else {
          log.warn(
            `[SKILLS-CONFIG] Default config not found at: ${defaultConfigPath}`
          );
        }
      } catch (err) {
        log.error(
          '[SKILLS-CONFIG] Failed to load default config template:',
          err
        );
        // Continue anyway - user config is still valid
      }

      log.info(
        `[SKILLS-CONFIG] Config initialized with ${Object.keys(config.skills || {}).length} skills`
      );
      return { success: true, config };
    } catch (error: any) {
      log.error('skill-config-init failed', error);
      return { success: false, error: error?.message };
    }
  });

  ipcMain.handle(
    'skill-import-zip',
    async (
      _event,
      zipPathOrBuffer: string | Buffer | ArrayBuffer | Uint8Array,
      replacements?: string[]
    ) =>
      withImportLock(async () => {
        // Use typeof check instead of instanceof to handle cross-realm objects
        // from Electron IPC (instanceof can fail across context boundaries)
        const replacementsSet = replacements
          ? new Set(replacements)
          : undefined;
        const isBufferLike = typeof zipPathOrBuffer !== 'string';
        if (isBufferLike) {
          const buf = Buffer.isBuffer(zipPathOrBuffer)
            ? zipPathOrBuffer
            : Buffer.from(
                zipPathOrBuffer instanceof ArrayBuffer
                  ? zipPathOrBuffer
                  : (zipPathOrBuffer as any)
              );
          const tempPath = path.join(
            os.tmpdir(),
            `eigent-skill-import-${Date.now()}.zip`
          );
          try {
            await fsp.writeFile(tempPath, buf);
            const result = await importSkillsFromZip(tempPath, replacementsSet);
            return result;
          } finally {
            await fsp.unlink(tempPath).catch(() => {});
          }
        }
        return importSkillsFromZip(zipPathOrBuffer as string, replacementsSet);
      })
  );

  // ==================== read file handler ====================
  ipcMain.handle('read-file', async (event, filePath: string) => {
    try {
      log.info('Reading file:', filePath);

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        log.error('File does not exist:', filePath);
        return { success: false, error: 'File does not exist' };
      }

      // Check if it's a directory
      const stats = await fsp.stat(filePath);
      if (stats.isDirectory()) {
        log.error('Path is a directory, not a file:', filePath);
        return { success: false, error: 'Path is a directory, not a file' };
      }

      // Read file content
      const fileContent = await fsp.readFile(filePath);
      log.info('File read successfully:', filePath);

      return {
        success: true,
        data: fileContent,
        size: fileContent.length,
      };
    } catch (error: any) {
      log.error('Failed to read file:', filePath, error);
      return {
        success: false,
        error: error.message || 'Failed to read file',
      };
    }
  });

  // ==================== delete folder handler ====================
  ipcMain.handle('delete-folder', async (event, email: string) => {
    const { MCP_REMOTE_CONFIG_DIR } = getEmailFolderPath(email);
    try {
      log.info('Deleting folder:', MCP_REMOTE_CONFIG_DIR);

      // Check if folder exists
      if (!fs.existsSync(MCP_REMOTE_CONFIG_DIR)) {
        log.error('Folder does not exist:', MCP_REMOTE_CONFIG_DIR);
        return { success: false, error: 'Folder does not exist' };
      }

      // Check if it's actually a directory
      const stats = await fsp.stat(MCP_REMOTE_CONFIG_DIR);
      if (!stats.isDirectory()) {
        log.error('Path is not a directory:', MCP_REMOTE_CONFIG_DIR);
        return { success: false, error: 'Path is not a directory' };
      }

      // Delete folder recursively
      await fsp.rm(MCP_REMOTE_CONFIG_DIR, { recursive: true, force: true });
      log.info('Folder deleted successfully:', MCP_REMOTE_CONFIG_DIR);

      return {
        success: true,
        message: 'Folder deleted successfully',
      };
    } catch (error: any) {
      log.error('Failed to delete folder:', MCP_REMOTE_CONFIG_DIR, error);
      return {
        success: false,
        error: error.message || 'Failed to delete folder',
      };
    }
  });

  // ==================== get MCP config path handler ====================
  ipcMain.handle('get-mcp-config-path', async (event, email: string) => {
    try {
      const { MCP_REMOTE_CONFIG_DIR, tempEmail } = getEmailFolderPath(email);
      log.info('Getting MCP config path for email:', email);
      log.info('MCP config path:', MCP_REMOTE_CONFIG_DIR);
      return {
        success: MCP_REMOTE_CONFIG_DIR,
        path: MCP_REMOTE_CONFIG_DIR,
        tempEmail: tempEmail,
      };
    } catch (error: any) {
      log.error('Failed to get MCP config path:', error);
      return {
        success: false,
        error: error.message || 'Failed to get MCP config path',
      };
    }
  });

  // ==================== IDE integration handler ====================
  ipcMain.handle(
    'get-project-folder-path',
    async (_event, email: string, projectId: string) => {
      const manager = checkManagerInstance(fileReader, 'FileReader');
      const result = manager.createProjectStructure(email, projectId);
      return result.path;
    }
  );

  ipcMain.handle(
    'open-in-ide',
    async (_event, folderPath: string, ide: string) => {
      const getIDECommand = (): string => {
        const platform = process.platform;
        const homeDir = homedir();

        if (ide === 'vscode') {
          if (platform === 'darwin') {
            // macOS: Check common VS Code CLI paths
            const vscodePaths = [
              '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
              '/usr/local/bin/code',
            ];
            for (const p of vscodePaths) {
              if (existsSync(p)) return p;
            }
            log.warn(
              '[IDE] VS Code not found on macOS, using system file manager'
            );
            return '';
          } else if (platform === 'win32') {
            // Windows: Check common VS Code paths
            const vscodePaths = [
              path.join(
                homeDir,
                'AppData',
                'Local',
                'Programs',
                'Microsoft VS Code',
                'bin',
                'code.cmd'
              ),
              path.join(
                homeDir,
                'AppData',
                'Local',
                'Programs',
                'Microsoft VS Code',
                'Code.exe'
              ),
              'C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd',
              'C:\\Program Files\\Microsoft VS Code\\Code.exe',
            ];
            for (const p of vscodePaths) {
              if (existsSync(p)) return p;
            }
            log.warn(
              '[IDE] VS Code not found on Windows, using system file manager'
            );
            return '';
          }
          return 'code'; // Linux
        } else if (ide === 'cursor') {
          if (platform === 'darwin') {
            // macOS: Check common Cursor CLI paths
            const cursorPaths = [
              '/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
              '/usr/local/bin/cursor',
            ];
            for (const p of cursorPaths) {
              if (existsSync(p)) return p;
            }
            log.warn(
              '[IDE] Cursor not found on macOS, using system file manager'
            );
            return '';
          } else if (platform === 'win32') {
            // Windows: Check common Cursor paths
            const cursorPaths = [
              path.join(
                homeDir,
                'AppData',
                'Local',
                'Programs',
                'Cursor',
                'resources',
                'app',
                'bin',
                'cursor.cmd'
              ),
              path.join(
                homeDir,
                'AppData',
                'Local',
                'Programs',
                'Cursor',
                'Cursor.exe'
              ),
              path.join(homeDir, 'AppData', 'Local', 'Cursor', 'Cursor.exe'),
            ];
            for (const p of cursorPaths) {
              if (existsSync(p)) return p;
            }
            log.warn(
              '[IDE] Cursor not found on Windows, using system file manager'
            );
            return '';
          }
          return 'cursor'; // Linux
        }
        return '';
      };

      const cmd = getIDECommand();
      if (!cmd) {
        // IDE not found or 'system' selected - open with system file manager
        const errorMsg = await shell.openPath(folderPath);
        if (errorMsg) {
          log.error('[IDE] shell.openPath error:', errorMsg);
          return { success: false, error: errorMsg };
        }
        return { success: true };
      }

      return new Promise<{ success: boolean; error?: string }>((resolve) => {
        // Use shell: true so .cmd/.bat wrappers work on Windows
        const child = spawn(cmd, [folderPath], {
          shell: true,
          stdio: 'ignore',
          detached: true,
        });
        child.unref();

        child.on('error', (error) => {
          log.warn(
            `[IDE] ${cmd} not found, falling back to system file manager:`,
            error.message
          );
          shell.openPath(folderPath).then((errorMsg) => {
            resolve(
              errorMsg ? { success: false, error: errorMsg } : { success: true }
            );
          });
        });

        child.on('spawn', () => {
          resolve({ success: true });
        });
      });
    }
  );

  // ==================== env handler ====================

  ipcMain.handle('get-env-path', async (_event, email) => {
    return getEnvPath(email);
  });

  ipcMain.handle('get-env-has-key', async (_event, email, key) => {
    const ENV_PATH = getEnvPath(email);
    let content = '';
    try {
      content = fs.existsSync(ENV_PATH)
        ? fs.readFileSync(ENV_PATH, 'utf-8')
        : '';
    } catch (error) {
      log.error('env-remove error:', error);
    }
    let lines = content.split(/\r?\n/);
    return { success: lines.some((line) => line.startsWith(key + '=')) };
  });

  ipcMain.handle('env-write', async (_event, email, { key, value }) => {
    const ENV_PATH = getEnvPath(email);
    let content = '';
    try {
      content = fs.existsSync(ENV_PATH)
        ? fs.readFileSync(ENV_PATH, 'utf-8')
        : '';
    } catch (error) {
      log.error('env-write error:', error);
    }
    let lines = content.split(/\r?\n/);
    lines = updateEnvBlock(lines, { [key]: value });
    fs.writeFileSync(ENV_PATH, lines.join('\n'), 'utf-8');

    // Also write to global .env file for backend process to read
    const GLOBAL_ENV_PATH = path.join(os.homedir(), '.eigent', '.env');
    let globalContent = '';
    try {
      globalContent = fs.existsSync(GLOBAL_ENV_PATH)
        ? fs.readFileSync(GLOBAL_ENV_PATH, 'utf-8')
        : '';
    } catch (error) {
      log.error('global env-write read error:', error);
    }
    let globalLines = globalContent.split(/\r?\n/);
    globalLines = updateEnvBlock(globalLines, { [key]: value });
    try {
      fs.writeFileSync(GLOBAL_ENV_PATH, globalLines.join('\n'), 'utf-8');
      log.info(`env-write: wrote ${key} to both user and global .env files`);
    } catch (error) {
      log.error('global env-write error:', error);
    }

    return { success: true };
  });

  ipcMain.handle('env-remove', async (_event, email, key) => {
    log.info('env-remove', key);
    const ENV_PATH = getEnvPath(email);
    let content = '';
    try {
      content = fs.existsSync(ENV_PATH)
        ? fs.readFileSync(ENV_PATH, 'utf-8')
        : '';
    } catch (error) {
      log.error('env-remove error:', error);
    }
    let lines = content.split(/\r?\n/);
    lines = removeEnvKey(lines, key);
    fs.writeFileSync(ENV_PATH, lines.join('\n'), 'utf-8');
    log.info('env-remove success', ENV_PATH);

    // Also remove from global .env file
    const GLOBAL_ENV_PATH = path.join(os.homedir(), '.eigent', '.env');
    try {
      let globalContent = fs.existsSync(GLOBAL_ENV_PATH)
        ? fs.readFileSync(GLOBAL_ENV_PATH, 'utf-8')
        : '';
      let globalLines = globalContent.split(/\r?\n/);
      globalLines = removeEnvKey(globalLines, key);
      fs.writeFileSync(GLOBAL_ENV_PATH, globalLines.join('\n'), 'utf-8');
      log.info(
        `env-remove: removed ${key} from both user and global .env files`
      );
    } catch (error) {
      log.error('global env-remove error:', error);
    }

    return { success: true };
  });

  // ==================== read global env handler ====================
  const ALLOWED_GLOBAL_ENV_KEYS = new Set(['HTTP_PROXY', 'HTTPS_PROXY']);
  ipcMain.handle('read-global-env', async (_event, key: string) => {
    if (!ALLOWED_GLOBAL_ENV_KEYS.has(key)) {
      log.warn(`[ENV] Blocked read of disallowed global env key: ${key}`);
      return { value: null };
    }
    return { value: readGlobalEnvKey(key) };
  });

  // ==================== new window handler ====================
  ipcMain.handle('open-win', (_, arg) => {
    const childWindow = new BrowserWindow({
      webPreferences: {
        preload,
        nodeIntegration: true,
        contextIsolation: false,
      },
    });

    if (VITE_DEV_SERVER_URL) {
      childWindow.loadURL(`${VITE_DEV_SERVER_URL}#${arg}`);
    } else {
      childWindow.loadFile(indexHtml, { hash: arg });
    }
  });

  // ==================== FileReader handler ====================
  ipcMain.handle(
    'open-file',
    async (_, type: string, filePath: string, isShowSourceCode: boolean) => {
      const manager = checkManagerInstance(fileReader, 'FileReader');
      return manager.openFile(type, filePath, isShowSourceCode);
    }
  );

  ipcMain.handle('download-file', async (_, url: string) => {
    try {
      const https = await import('https');
      const http = await import('http');

      // extract file name from URL
      const urlObj = new URL(url);
      const fileName = urlObj.pathname.split('/').pop() || 'download';

      // get download directory
      const downloadPath = path.join(app.getPath('downloads'), fileName);

      // create write stream
      const fileStream = fs.createWriteStream(downloadPath);

      // choose module according to protocol
      const client = url.startsWith('https:') ? https : http;

      return new Promise((resolve, reject) => {
        const request = client.get(url, (response) => {
          if (response.statusCode !== 200) {
            reject(new Error(`HTTP ${response.statusCode}`));
            return;
          }

          response.pipe(fileStream);

          fileStream.on('finish', () => {
            fileStream.close();
            shell.showItemInFolder(downloadPath);
            resolve({ success: true, path: downloadPath });
          });

          fileStream.on('error', (err) => {
            reject(err);
          });
        });

        request.on('error', (err) => {
          reject(err);
        });
      });
    } catch (error: any) {
      log.error('Download file error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    'get-file-list',
    async (_, email: string, taskId: string, projectId?: string) => {
      const manager = checkManagerInstance(fileReader, 'FileReader');
      return manager.getFileList(email, taskId, projectId);
    }
  );

  ipcMain.handle(
    'delete-task-files',
    async (_, email: string, taskId: string, projectId?: string) => {
      const manager = checkManagerInstance(fileReader, 'FileReader');
      return manager.deleteTaskFiles(email, taskId, projectId);
    }
  );

  // New project management handlers
  ipcMain.handle(
    'create-project-structure',
    async (_, email: string, projectId: string) => {
      const manager = checkManagerInstance(fileReader, 'FileReader');
      return manager.createProjectStructure(email, projectId);
    }
  );

  ipcMain.handle('get-project-list', async (_, email: string) => {
    const manager = checkManagerInstance(fileReader, 'FileReader');
    return manager.getProjectList(email);
  });

  ipcMain.handle(
    'get-tasks-in-project',
    async (_, email: string, projectId: string) => {
      const manager = checkManagerInstance(fileReader, 'FileReader');
      return manager.getTasksInProject(email, projectId);
    }
  );

  ipcMain.handle(
    'move-task-to-project',
    async (_, email: string, taskId: string, projectId: string) => {
      const manager = checkManagerInstance(fileReader, 'FileReader');
      return manager.moveTaskToProject(email, taskId, projectId);
    }
  );

  ipcMain.handle(
    'get-project-file-list',
    async (_, email: string, projectId: string) => {
      const manager = checkManagerInstance(fileReader, 'FileReader');
      return manager.getProjectFileList(email, projectId);
    }
  );

  ipcMain.handle('get-log-folder', async (_, email: string) => {
    const manager = checkManagerInstance(fileReader, 'FileReader');
    return manager.getLogFolder(email);
  });

  // ==================== WebView handler ====================
  const webviewHandlers = [
    { name: 'capture-webview', method: 'captureWebview' },
    { name: 'create-webview', method: 'createWebview' },
    { name: 'hide-webview', method: 'hideWebview' },
    { name: 'show-webview', method: 'showWebview' },
    { name: 'change-view-size', method: 'changeViewSize' },
    { name: 'hide-all-webview', method: 'hideAllWebview' },
    { name: 'get-active-webview', method: 'getActiveWebview' },
    { name: 'set-size', method: 'setSize' },
    { name: 'get-show-webview', method: 'getShowWebview' },
    { name: 'webview-destroy', method: 'destroyWebview' },
  ];

  webviewHandlers.forEach(({ name, method }) => {
    ipcMain.handle(name, async (_, ...args) => {
      const manager = checkManagerInstance(webViewManager, 'WebViewManager');
      return manager[method as keyof typeof manager](...args);
    });
  });

  // ==================== dependency install handler ====================
  ipcMain.handle('install-dependencies', async () => {
    try {
      if (win === null) throw new Error('Window is null');

      // Prevent concurrent installations
      if (isInstallationInProgress) {
        log.info('[DEPS INSTALL] Installation already in progress, waiting...');
        await installationLock;
        return {
          success: true,
          message: 'Installation completed by another process',
        };
      }

      log.info('[DEPS INSTALL] Manual installation/retry triggered');

      // Set lock
      isInstallationInProgress = true;
      installationLock = checkAndInstallDepsOnUpdate({
        win,
        forceInstall: true,
      }).finally(() => {
        isInstallationInProgress = false;
      });

      const result = await installationLock;

      if (!result.success) {
        log.error('[DEPS INSTALL] Manual installation failed:', result.message);
        // Note: Failure event already sent by installDependencies function
        return { success: false, error: result.message };
      }

      log.info('[DEPS INSTALL] Manual installation succeeded');

      // IMPORTANT: Send install-dependencies-complete success event
      if (!win.isDestroyed()) {
        win.webContents.send('install-dependencies-complete', {
          success: true,
          code: 0,
        });
        log.info(
          '[DEPS INSTALL] Sent install-dependencies-complete event after retry'
        );
      }

      // Start backend after retry with cleanup
      await startBackendAfterInstall();

      return { success: true, isInstalled: result.success };
    } catch (error) {
      log.error('[DEPS INSTALL] Manual installation error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('check-tool-installed', async () => {
    try {
      const isInstalled = await checkToolInstalled();
      return { success: true, isInstalled: isInstalled.success };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('get-installation-status', async () => {
    try {
      const { isInstalling, hasLockFile } = await getInstallationStatus();
      return {
        success: true,
        isInstalling,
        hasLockFile,
        timestamp: Date.now(),
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // ==================== register update related handler ====================
  registerUpdateIpcHandlers();
}

// ==================== ensure eigent directories ====================
const ensureEigentDirectories = () => {
  const eigentBase = path.join(os.homedir(), '.eigent');
  const requiredDirs = [
    eigentBase,
    path.join(eigentBase, 'bin'),
    path.join(eigentBase, 'cache'),
    path.join(eigentBase, 'venvs'),
    path.join(eigentBase, 'runtime'),
    path.join(eigentBase, 'skills'),
  ];

  for (const dir of requiredDirs) {
    if (!fs.existsSync(dir)) {
      log.info(`Creating directory: ${dir}`);
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  log.info('.eigent directory structure ensured');
};

// ==================== skills (used at startup and by IPC) ====================
const SKILLS_ROOT = path.join(os.homedir(), '.eigent', 'skills');
const SKILL_FILE = 'SKILL.md';

const getExampleSkillsSourceDir = (): string =>
  app.isPackaged
    ? path.join(process.resourcesPath, 'example-skills')
    : path.join(app.getAppPath(), 'resources', 'example-skills');

async function copyDirRecursive(src: string, dst: string): Promise<void> {
  await fsp.mkdir(dst, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    // Skip symlinks to prevent copying files from outside the source tree
    if (entry.isSymbolicLink()) continue;
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, dstPath);
    } else {
      await fsp.copyFile(srcPath, dstPath);
    }
  }
}

async function seedDefaultSkillsIfEmpty(): Promise<void> {
  if (!existsSync(SKILLS_ROOT)) return;
  const entries = await fsp.readdir(SKILLS_ROOT, { withFileTypes: true });
  const hasAnySkill = entries.some(
    (e) => e.isDirectory() && !e.name.startsWith('.')
  );
  if (hasAnySkill) return;
  const exampleDir = getExampleSkillsSourceDir();
  if (!existsSync(exampleDir)) {
    log.warn('Example skills source dir missing:', exampleDir);
    return;
  }
  const sourceEntries = await fsp.readdir(exampleDir, { withFileTypes: true });
  for (const e of sourceEntries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const skillMd = path.join(exampleDir, e.name, SKILL_FILE);
    if (!existsSync(skillMd)) continue;
    const srcDir = path.join(exampleDir, e.name);
    const destDir = path.join(SKILLS_ROOT, e.name);
    await copyDirRecursive(srcDir, destDir);
  }
  log.info('Seeded default skills to ~/.eigent/skills from', exampleDir);
}

/** Truncate a single path component to fit within the 255-byte filesystem limit. */
function safePathComponent(name: string, maxBytes = 200): string {
  // 200 leaves headroom for suffixes the OS or future logic may add
  if (Buffer.byteLength(name, 'utf-8') <= maxBytes) return name;
  // Trim from the end, character by character, until it fits
  let trimmed = name;
  while (Buffer.byteLength(trimmed, 'utf-8') > maxBytes) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed.replace(/-+$/, '') || 'skill';
}

// Simple mutex to prevent concurrent skill imports
let _importLock: Promise<void> = Promise.resolve();
function withImportLock<T>(fn: () => Promise<T>): Promise<T> {
  let release: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const prev = _importLock;
  _importLock = next;
  return prev.then(fn).finally(() => release!());
}

async function importSkillsFromZip(
  zipPath: string,
  replacements?: Set<string>
): Promise<{
  success: boolean;
  error?: string;
  conflicts?: Array<{ folderName: string; skillName: string }>;
}> {
  // Extract to a temp directory, then find SKILL.md files and copy their
  // parent skill directories into SKILLS_ROOT.  This handles any zip
  // structure: wrapping directories, SKILL.md at root, or multiple skills.
  const tempDir = path.join(os.tmpdir(), `eigent-skill-extract-${Date.now()}`);
  try {
    if (!existsSync(zipPath)) {
      return { success: false, error: 'Zip file does not exist' };
    }
    const ext = path.extname(zipPath).toLowerCase();
    if (ext !== '.zip') {
      return { success: false, error: 'Only .zip files are supported' };
    }
    if (!existsSync(SKILLS_ROOT)) {
      await fsp.mkdir(SKILLS_ROOT, { recursive: true });
    }

    // Step 1: Extract zip into temp directory
    await fsp.mkdir(tempDir, { recursive: true });
    const directory = await unzipper.Open.file(zipPath);
    for (const file of directory.files as any[]) {
      if (file.type === 'Directory') continue;
      const destPath = path.join(tempDir, file.path);
      const destDir = path.dirname(destPath);
      await fsp.mkdir(destDir, { recursive: true });
      const content = await file.buffer();
      await fsp.writeFile(destPath, content);
    }

    // Step 2: Recursively find all SKILL.md files
    const skillFiles: string[] = [];
    async function findSkillMdFiles(dir: string) {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await findSkillMdFiles(fullPath);
        } else if (entry.name === SKILL_FILE) {
          skillFiles.push(fullPath);
        }
      }
    }
    await findSkillMdFiles(tempDir);

    if (skillFiles.length === 0) {
      return {
        success: false,
        error: 'No SKILL.md files found in zip archive',
      };
    }

    // Step 3: Copy each skill directory into SKILLS_ROOT

    // Helper function to extract skill name from SKILL.md
    async function getSkillName(skillFilePath: string): Promise<string> {
      try {
        const raw = await fsp.readFile(skillFilePath, 'utf-8');
        const nameMatch = raw.match(/^\s*name\s*:\s*(.+)$/m);
        const parsed = nameMatch?.[1]?.trim()?.replace(/^['"]|['"]$/g, '');
        return parsed || path.basename(path.dirname(skillFilePath));
      } catch {
        return path.basename(path.dirname(skillFilePath));
      }
    }

    // Collect conflicts if replacements not provided
    const conflicts: Array<{ folderName: string; skillName: string }> = [];
    const replacementsSet = replacements || new Set<string>();

    for (const skillFilePath of skillFiles) {
      const skillDir = path.dirname(skillFilePath);

      if (skillDir === tempDir) {
        // SKILL.md is at the zip root (no parent skill folder).
        // Derive a folder name from the SKILL.md frontmatter or zip filename.
        let folderName = safePathComponent(
          path.basename(zipPath, path.extname(zipPath))
        );
        try {
          const raw = await fsp.readFile(skillFilePath, 'utf-8');
          const nameMatch = raw.match(/^\s*name\s*:\s*(.+)$/m);
          const parsed = nameMatch?.[1]?.trim()?.replace(/^['"]|['"]$/g, '');
          if (parsed) {
            folderName = safePathComponent(
              parsed
                .replace(/[\\/*?:"<>|\s]+/g, '-')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '') || folderName
            );
          }
        } catch {
          // Use zip filename fallback
        }
        const dest = path.join(SKILLS_ROOT, folderName);

        // Check if skill already exists
        if (existsSync(dest)) {
          const skillName = await getSkillName(skillFilePath);
          // If replacements not provided, collect conflict and skip
          if (!replacements) {
            conflicts.push({ folderName, skillName });
            continue;
          }
          // If user confirmed replacement, remove existing directory
          if (replacementsSet.has(folderName)) {
            await fsp.rm(dest, { recursive: true, force: true });
          } else {
            // User didn't confirm, skip this skill
            continue;
          }
        }

        // Import the skill (either no conflict, or conflict was resolved)
        await fsp.mkdir(dest, { recursive: true });
        // Recursively copy all root-level entries (files and subdirectories)
        await copyDirRecursive(tempDir, dest);
      } else {
        // SKILL.md is inside a subdirectory — copy that directory to SKILLS_ROOT
        const skillDirName = safePathComponent(path.basename(skillDir));
        const dest = path.join(SKILLS_ROOT, skillDirName);

        // Check if skill already exists
        if (existsSync(dest)) {
          const skillName = await getSkillName(skillFilePath);
          // If replacements not provided, collect conflict and skip
          if (!replacements) {
            conflicts.push({ folderName: skillDirName, skillName });
            continue;
          }
          // If user confirmed replacement, remove existing directory
          if (replacementsSet.has(skillDirName)) {
            await fsp.rm(dest, { recursive: true, force: true });
          } else {
            // User didn't confirm, skip this skill
            continue;
          }
        }

        // Import the skill (either no conflict, or conflict was resolved)
        await fsp.mkdir(dest, { recursive: true });
        await copyDirRecursive(skillDir, dest);
      }
    }

    // Return conflicts if any were found and replacements not provided
    if (conflicts.length > 0 && !replacements) {
      return { success: false, conflicts };
    }

    log.info(
      `Imported ${skillFiles.length} skill(s) from zip into ~/.eigent/skills:`,
      zipPath
    );
    return { success: true };
  } catch (error: any) {
    log.error('importSkillsFromZip failed', error);
    return { success: false, error: error?.message || String(error) };
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ==================== Shared backend startup logic ====================
// Starts backend after installation completes
// Used by both initial startup and retry flows
const startBackendAfterInstall = async () => {
  log.info('[DEPS INSTALL] Starting backend...');

  // Add a small delay to ensure any previous processes are fully cleaned up
  await new Promise((resolve) => setTimeout(resolve, 500));

  await checkAndStartBackend();
};

// ==================== installation lock ====================
let isInstallationInProgress = false;
let installationLock: Promise<PromiseReturnType> = Promise.resolve({
  message: 'No installation needed',
  success: true,
});

// ==================== window create ====================
async function createWindow() {
  const isMac = process.platform === 'darwin';

  // Ensure .eigent directories exist before anything else
  ensureEigentDirectories();
  await seedDefaultSkillsIfEmpty();

  log.info(
    `[PROJECT BROWSER WINDOW] Creating BrowserWindow which will start Chrome with CDP on port ${browser_port}`
  );
  log.info(
    `[PROJECT BROWSER WINDOW] Current user data path: ${app.getPath(
      'userData'
    )}`
  );
  log.info(
    `[PROJECT BROWSER WINDOW] Command line switch user-data-dir: ${app.commandLine.getSwitchValue(
      'user-data-dir'
    )}`
  );

  // Platform-specific window configuration
  // Windows: Use native frame for better native feel, solid background
  // macOS: Use frameless with transparency and vibrancy effects
  win = new BrowserWindow({
    title: 'Eigent',
    width: 1200,
    height: 800,
    minWidth: 1050,
    minHeight: 650,
    // Use native frame on Windows for better native integration
    frame: isWindows ? true : false,
    show: false, // Don't show until content is ready to avoid white screen
    // Only use transparency on macOS and Linux (not supported well on Windows)
    transparent: !isWindows,
    // macOS-only visual effects
    vibrancy: isMac ? 'sidebar' : undefined,
    visualEffectState: isMac ? 'active' : undefined,
    // Solid background on Windows (respect dark/light mode), semi-transparent on macOS/Linux
    backgroundColor: isWindows
      ? nativeTheme.shouldUseDarkColors
        ? '#1e1e1e'
        : '#ffffff'
      : '#f5f5f580',
    // macOS-specific title bar styling
    titleBarStyle: isMac ? 'hidden' : undefined,
    trafficLightPosition: isMac ? { x: 10, y: 10 } : undefined,
    icon: path.join(VITE_PUBLIC, 'favicon.ico'),
    // Rounded corners on macOS and Linux (as original)
    roundedCorners: !isWindows,
    // Windows-specific options
    ...(isWindows && {
      autoHideMenuBar: true, // Hide menu bar on Windows for cleaner look
    }),
    webPreferences: {
      // Use a dedicated partition for main window to isolate from webviews
      // This ensures main window's auth data (localStorage) is stored separately and persists across restarts
      partition: 'persist:main_window',
      webSecurity: false,
      preload,
      nodeIntegration: true,
      contextIsolation: true,
      webviewTag: true,
      spellcheck: false,
    },
  });

  // ==================== Handle renderer crashes and failed loads ====================
  win.webContents.on('render-process-gone', (event, details) => {
    log.error('[RENDERER] Process gone:', details.reason, details.exitCode);
    if (win && !win.isDestroyed()) {
      // Reload the window after a brief delay
      setTimeout(() => {
        if (win && !win.isDestroyed()) {
          log.info('[RENDERER] Attempting to reload after crash...');
          if (VITE_DEV_SERVER_URL) {
            win.loadURL(VITE_DEV_SERVER_URL);
          } else {
            win.loadFile(indexHtml);
          }
        }
      }, 1000);
    }
  });

  win.webContents.on(
    'did-fail-load',
    (event, errorCode, errorDescription, validatedURL) => {
      log.error(
        `[RENDERER] Failed to load: ${errorCode} - ${errorDescription} - ${validatedURL}`
      );
      // Retry loading after a delay
      if (errorCode !== -3) {
        // -3 is USER_CANCELLED, don't retry
        setTimeout(() => {
          if (win && !win.isDestroyed()) {
            log.info('[RENDERER] Retrying load after failure...');
            if (VITE_DEV_SERVER_URL) {
              win.loadURL(VITE_DEV_SERVER_URL);
            } else {
              win.loadFile(indexHtml);
            }
          }
        }, 2000);
      }
    }
  );

  // Main window now uses default userData directly with partition 'persist:main_window'
  // No migration needed - data is already persistent

  // ==================== Import cookies from tool_controller to WebView BEFORE creating WebViews ====================
  // Copy partition data files before any session accesses them
  try {
    const browserProfilesBase = path.join(
      os.homedir(),
      '.eigent',
      'browser_profiles'
    );
    const toolControllerProfile = path.join(
      browserProfilesBase,
      'profile_user_login'
    );
    const toolControllerPartitionPath = path.join(
      toolControllerProfile,
      'Partitions',
      'user_login'
    );

    if (fs.existsSync(toolControllerPartitionPath)) {
      log.info(
        '[COOKIE SYNC] Found tool_controller partition, copying to WebView partition...'
      );

      const targetPartitionPath = path.join(
        app.getPath('userData'),
        'Partitions',
        'user_login'
      );
      log.info('[COOKIE SYNC] From:', toolControllerPartitionPath);
      log.info('[COOKIE SYNC] To:', targetPartitionPath);

      // Ensure target directory exists
      if (!fs.existsSync(path.dirname(targetPartitionPath))) {
        fs.mkdirSync(path.dirname(targetPartitionPath), { recursive: true });
      }

      // Copy the entire partition directory
      fs.cpSync(toolControllerPartitionPath, targetPartitionPath, {
        recursive: true,
        force: true,
      });
      log.info('[COOKIE SYNC] Successfully copied partition data to WebView');

      // Verify cookies were copied
      const targetCookies = path.join(targetPartitionPath, 'Cookies');
      if (fs.existsSync(targetCookies)) {
        const stats = fs.statSync(targetCookies);
        log.info(`[COOKIE SYNC] Cookies file size: ${stats.size} bytes`);
      }
    } else {
      log.info(
        '[COOKIE SYNC] No tool_controller partition found, WebView will start fresh'
      );
    }
  } catch (error) {
    log.error('[COOKIE SYNC] Failed to sync partition data:', error);
  }

  // ==================== initialize manager ====================
  fileReader = new FileReader(win);
  webViewManager = new WebViewManager(win);

  // create multiple webviews
  log.info(
    `[PROJECT BROWSER] Creating WebViews with partition: persist:user_login`
  );
  for (let i = 1; i <= 8; i++) {
    webViewManager.createWebview(i === 1 ? undefined : i.toString());
  }
  log.info('[PROJECT BROWSER] WebViewManager initialized with webviews');

  // ==================== set event listeners ====================
  setupWindowEventListeners();
  setupDevToolsShortcuts();
  setupExternalLinkHandling();
  handleBeforeClose();

  // ==================== auto update ====================
  update(win);

  // ==================== CHECK IF INSTALLATION IS NEEDED BEFORE LOADING CONTENT ====================
  log.info('Pre-checking if dependencies need to be installed...');

  // Check if prebuilt dependencies are available (for packaged app)
  let hasPrebuiltDeps = false;
  if (app.isPackaged) {
    const prebuiltBinDir = path.join(process.resourcesPath, 'prebuilt', 'bin');
    const prebuiltDir = path.join(process.resourcesPath, 'prebuilt');
    const prebuiltVenvDir = path.join(prebuiltDir, 'venv');
    const uvPath = path.join(
      prebuiltBinDir,
      process.platform === 'win32' ? 'uv.exe' : 'uv'
    );
    const bunPath = path.join(
      prebuiltBinDir,
      process.platform === 'win32' ? 'bun.exe' : 'bun'
    );
    const pyvenvCfg = path.join(prebuiltVenvDir, 'pyvenv.cfg');

    const hasVenv = fs.existsSync(pyvenvCfg);
    hasPrebuiltDeps =
      fs.existsSync(uvPath) && fs.existsSync(bunPath) && hasVenv;
    if (hasPrebuiltDeps) {
      log.info(
        '[PRE-CHECK] Prebuilt dependencies found, skipping installation check'
      );
    }
  }

  // Check version and tools status synchronously
  const currentVersion = app.getVersion();
  const versionFile = path.join(app.getPath('userData'), 'version.txt');
  const versionExists = fs.existsSync(versionFile);
  let savedVersion = '';
  if (versionExists) {
    savedVersion = fs.readFileSync(versionFile, 'utf-8').trim();
  }

  const uvExists = await isBinaryExists('uv');
  const bunExists = await isBinaryExists('bun');

  // Check if installation was previously completed
  const backendPath = getBackendPath();
  const installedLockPath = path.join(backendPath, 'uv_installed.lock');
  const installationCompleted = fs.existsSync(installedLockPath);

  // Check venv existence WITHOUT triggering extraction (defers to startBackend when window is visible)
  const { exists: venvExists, path: venvPath } =
    checkVenvExistsForPreCheck(currentVersion);

  // If prebuilt deps are available, skip installation
  const needsInstallation = hasPrebuiltDeps
    ? false
    : !versionExists ||
      savedVersion !== currentVersion ||
      !uvExists ||
      !bunExists ||
      !installationCompleted ||
      !venvExists;

  log.info('Installation check result:', {
    needsInstallation,
    versionExists,
    versionMatch: savedVersion === currentVersion,
    uvExists,
    bunExists,
    installationCompleted,
    venvExists,
    venvPath,
  });

  // Handle localStorage based on installation state
  if (needsInstallation) {
    log.info(
      'Installation needed - resetting initState to carousel while preserving auth data'
    );

    // Instead of deleting the entire localStorage, we'll update only the initState
    // This preserves login information while resetting the initialization flow
    // Set up the injection for when page loads
    win.webContents.once('dom-ready', () => {
      if (!win || win.isDestroyed()) {
        log.warn(
          'Window destroyed before DOM ready - skipping localStorage injection'
        );
        return;
      }
      log.info(
        'DOM ready - updating initState to carousel while preserving auth data'
      );
      win.webContents
        .executeJavaScript(
          `
        (function() {
          try {
            const authStorage = localStorage.getItem('auth-storage');
            if (authStorage) {
              // Preserve existing auth data, only update initState
              const parsed = JSON.parse(authStorage);
              const updatedStorage = {
                ...parsed,
                state: {
                  ...parsed.state,
                  initState: 'carousel'
                }
              };
              localStorage.setItem('auth-storage', JSON.stringify(updatedStorage));
              console.log('[ELECTRON PRE-INJECT] Updated initState to carousel, preserved auth data');
            } else {
              // No existing storage, create new one with carousel state
              const newAuthStorage = {
                state: {
                  token: null,
                  username: null,
                  email: null,
                  user_id: null,
                  appearance: 'light',
                  language: 'system',
                  isFirstLaunch: true,
                  modelType: 'cloud',
                  cloud_model_type: 'gpt-4.1',
                  initState: 'carousel',
                  share_token: null,
                  workerListData: {}
                },
                version: 0
              };
              localStorage.setItem('auth-storage', JSON.stringify(newAuthStorage));
              console.log('[ELECTRON PRE-INJECT] Created fresh auth-storage with carousel state');
            }
          } catch (e) {
            console.error('[ELECTRON PRE-INJECT] Failed to update storage:', e);
          }
        })();
      `
        )
        .catch((err) => {
          log.error('Failed to inject script:', err);
        });
    });
  } else {
    // The proper flow is now handled by useInstallationSetup.ts with dual-check mechanism:
    // 1. Installation complete event → installationCompleted.current = true
    // 2. Backend ready event → backendReady.current = true
    // 3. Only when BOTH are true → setInitState('done')
    //
    // This ensures frontend never shows before backend is ready.
    log.info(
      'Installation already complete - letting useInstallationSetup handle state transitions'
    );
  }

  // Load content
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
    win.webContents.openDevTools();
  } else {
    win.loadFile(indexHtml);
  }

  // Wait for window to be ready with timeout
  await new Promise<void>((resolve) => {
    const loadTimeout = setTimeout(() => {
      log.warn('Window content load timeout (10s), showing window anyway...');
      resolve();
    }, 10000);

    win!.webContents.once('did-finish-load', () => {
      clearTimeout(loadTimeout);
      log.info(
        'Window content loaded, starting dependency check immediately...'
      );
      resolve();
    });
  });

  // Show window now that content is loaded (or timeout reached)
  if (win && !win.isDestroyed()) {
    win.show();
    log.info('Window shown after content loaded');
  }

  // Mark window as ready and process any queued protocol URLs
  isWindowReady = true;
  log.info('Window is ready, processing queued protocol URLs...');
  processQueuedProtocolUrls();

  // Wait for React components to mount and register event listeners
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Now check and install dependencies
  let res: PromiseReturnType = await checkAndInstallDepsOnUpdate({ win });
  if (!res.success) {
    log.info('[DEPS INSTALL] Dependency Error: ', res.message);
    // Note: install-dependencies-complete failure event is already sent by installDependencies function
    // in install-deps.ts, so we don't send it again here to avoid duplicate events
    return;
  }
  log.info('[DEPS INSTALL] Dependency Success: ', res.message);

  // IMPORTANT: Wait a bit to ensure React components have mounted and registered event listeners
  // This prevents race condition where events are sent before listeners are ready
  await new Promise((resolve) => setTimeout(resolve, 500));

  // IMPORTANT: Always send install-dependencies-complete event when installation check succeeds
  // This includes both cases: actual installation completed AND installation was skipped (already installed)
  // The frontend needs this event to properly transition from installation screen to main app
  if (!win.isDestroyed()) {
    win.webContents.send('install-dependencies-complete', {
      success: true,
      code: 0,
    });
    log.info(
      '[DEPS INSTALL] Sent install-dependencies-complete event to frontend'
    );
  }

  // Start backend after dependencies are ready
  await startBackendAfterInstall();
}

// ==================== window event listeners ====================
const setupWindowEventListeners = () => {
  if (!win) return;

  // close default menu
  Menu.setApplicationMenu(null);
};

// ==================== devtools shortcuts ====================
const setupDevToolsShortcuts = () => {
  if (!win) return;

  const toggleDevTools = () => win?.webContents.toggleDevTools();

  win.webContents.on('before-input-event', (event, input) => {
    // F12 key
    if (input.key === 'F12' && input.type === 'keyDown') {
      toggleDevTools();
    }

    // Ctrl+Shift+I (Windows/Linux) or Cmd+Shift+I (Mac)
    if (
      input.control &&
      input.shift &&
      input.key.toLowerCase() === 'i' &&
      input.type === 'keyDown'
    ) {
      toggleDevTools();
    }

    // Mac Cmd+Shift+I
    if (
      input.meta &&
      input.shift &&
      input.key.toLowerCase() === 'i' &&
      input.type === 'keyDown'
    ) {
      toggleDevTools();
    }
  });
};

// ==================== external link handle ====================
const setupExternalLinkHandling = () => {
  if (!win) return;

  // Helper function to check if URL is external
  const isExternalUrl = (url: string): boolean => {
    try {
      const urlObj = new URL(url);
      // Allow localhost and internal URLs
      if (urlObj.hostname === 'localhost' || urlObj.hostname === '127.0.0.1') {
        return false;
      }
      // Allow hash navigation
      if (url.startsWith('#') || url.startsWith('/#')) {
        return false;
      }
      // External URLs start with http/https and are not localhost
      return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
    } catch {
      return false;
    }
  };

  // handle new window open
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'deny' };
  });

  // handle navigation
  win.webContents.on('will-navigate', (event, url) => {
    // Only prevent navigation and open external URLs
    // Allow internal navigation like hash changes
    if (isExternalUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
    // For internal URLs (localhost, hash navigation), allow navigation to proceed
  });
};

// ==================== check and start backend ====================
const checkAndStartBackend = async () => {
  log.info('Checking and starting backend service...');
  try {
    // Clean up any existing backend process before starting new one
    if (python_process && !python_process.killed) {
      log.info('Cleaning up existing backend process before restart...');
      await cleanupPythonProcess();
      python_process = null;
    }

    const isToolInstalled = await checkToolInstalled();
    if (isToolInstalled.success) {
      log.info('Tool installed, starting backend service...');

      // Start backend and wait for health check to pass
      python_process = await startBackend((port) => {
        backendPort = port;
        log.info('Backend service started successfully', { port });
      });

      // Notify frontend that backend is ready
      if (win && !win.isDestroyed()) {
        log.info('Backend is ready, notifying frontend...');
        win.webContents.send('backend-ready', {
          success: true,
          port: backendPort,
        });
      }

      python_process?.on('exit', (code, signal) => {
        log.info('Python process exited', { code, signal });
      });
    } else {
      log.warn('Tool not installed, cannot start backend service');
      // Notify frontend that backend cannot start
      if (win && !win.isDestroyed()) {
        win.webContents.send('backend-ready', {
          success: false,
          error: 'Tools not installed',
        });
      }
    }
  } catch (error) {
    log.error('Failed to start backend:', error);
    // Notify frontend of backend startup failure
    if (win && !win.isDestroyed()) {
      win.webContents.send('backend-ready', {
        success: false,
        error: String(error),
      });
    }
  }
};

// ==================== process cleanup ====================
const cleanupPythonProcess = async () => {
  try {
    // First attempt: Try to kill using PID and all children
    if (python_process?.pid) {
      const pid = python_process.pid;
      log.info('Cleaning up Python process and all children', { pid });

      // Remove all listeners to prevent memory leaks
      python_process.removeAllListeners();

      await new Promise<void>((resolve) => {
        // Kill the entire process tree (parent + all children)
        kill(pid, 'SIGTERM', (err) => {
          if (err) {
            log.error('Failed to clean up process tree with SIGTERM:', err);
            // Try SIGKILL as fallback for entire tree
            kill(pid, 'SIGKILL', (killErr) => {
              if (killErr) {
                log.error('Failed to force kill process tree:', killErr);
              }
              resolve();
            });
          } else {
            log.info('Successfully sent SIGTERM to process tree');
            // Give processes 1 second to clean up, then SIGKILL
            setTimeout(() => {
              kill(pid, 'SIGKILL', () => {
                log.info('Sent SIGKILL to ensure cleanup');
                resolve();
              });
            }, 1000);
          }
        });
      });
    }

    // Second attempt: Use port-based cleanup as fallback
    const portFile = path.join(userData, 'port.txt');
    if (fs.existsSync(portFile)) {
      try {
        const port = parseInt(fs.readFileSync(portFile, 'utf-8').trim(), 10);
        if (!isNaN(port) && port > 0 && port < 65536) {
          log.info(`Attempting to kill process on port: ${port}`);
          await killProcessOnPort(port);
        }
        fs.unlinkSync(portFile);
      } catch (error) {
        log.error('Error handling port file:', error);
      }
    }

    // Clean up any temporary files in userData
    try {
      const tempFiles = ['backend.lock', 'uv_installing.lock'];
      for (const file of tempFiles) {
        const filePath = path.join(userData, file);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    } catch (error) {
      log.error('Error cleaning up temp files:', error);
    }

    python_process = null;
  } catch (error) {
    log.error('Error occurred while cleaning up process:', error);
  }
};

// before close
const handleBeforeClose = () => {
  let isQuitting = false;

  app.on('before-quit', () => {
    isQuitting = true;
  });

  win?.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      win?.webContents.send('before-close');
    }
  });
};

// ==================== app event handle ====================
app.whenReady().then(async () => {
  // Wait for profile initialization to complete
  log.info('[MAIN] Waiting for profile initialization...');
  try {
    await profileInitPromise;
    log.info('[MAIN] Profile initialization completed');
  } catch (error) {
    log.error('[MAIN] Profile initialization failed:', error);
  }

  // ==================== install React DevTools ====================
  // Only install in development mode
  if (VITE_DEV_SERVER_URL) {
    try {
      log.info('[DEVTOOLS] Installing React DevTools extension...');
      // Dynamic import to avoid bundling in production
      const { default: installExtension, REACT_DEVELOPER_TOOLS } =
        await import('electron-devtools-installer');
      const name = await installExtension(REACT_DEVELOPER_TOOLS, {
        loadExtensionOptions: { allowFileAccess: true },
      });
      log.info(`[DEVTOOLS] Successfully installed extension: ${name}`);
    } catch (err) {
      log.error('[DEVTOOLS] Failed to install React DevTools:', err);
      // Don't throw - allow app to continue even if extension installation fails
    }
  }

  // ==================== Anti-fingerprint: Set User Agent for all sessions ====================
  // Use the same dynamic User Agent as app.userAgentFallback
  session.defaultSession.setUserAgent(normalUserAgent);
  // Also set for the user_login partition used by webviews
  session.fromPartition('persist:user_login').setUserAgent(normalUserAgent);
  // And for main_window partition
  session.fromPartition('persist:main_window').setUserAgent(normalUserAgent);
  log.info('[ANTI-FINGERPRINT] User Agent set for all sessions');

  // ==================== Apply proxy to Electron sessions ====================
  if (proxyUrl) {
    const proxyConfig = { proxyRules: proxyUrl };
    await session.defaultSession.setProxy(proxyConfig);
    await session.fromPartition('persist:user_login').setProxy(proxyConfig);
    await session.fromPartition('persist:main_window').setProxy(proxyConfig);
    log.info(
      `[PROXY] Applied proxy to all sessions: ${maskProxyUrl(proxyUrl)}`
    );
  }

  // ==================== download handle ====================
  session.defaultSession.on('will-download', (event, item, _webContents) => {
    item.once('done', (_event, _state) => {
      shell.showItemInFolder(item.getURL().replace('localfile://', ''));
    });
  });

  // ==================== protocol handle ====================
  // Register protocol handler for both default session and main window session
  const protocolHandler = async (request: Request) => {
    const url = decodeURIComponent(request.url.replace('localfile://', ''));
    const filePath = path.normalize(url);

    log.info(`[PROTOCOL] Handling localfile request: ${request.url}`);
    log.info(`[PROTOCOL] Decoded path: ${filePath}`);

    try {
      // Check if file exists
      const fileExists = await fsp
        .access(filePath)
        .then(() => true)
        .catch(() => false);
      if (!fileExists) {
        log.error(`[PROTOCOL] File not found: ${filePath}`);
        return new Response('File Not Found', { status: 404 });
      }

      const data = await fsp.readFile(filePath);
      log.info(`[PROTOCOL] Successfully read file, size: ${data.length} bytes`);

      // set correct Content-Type according to file extension
      const ext = path.extname(filePath).toLowerCase();
      let contentType = 'application/octet-stream';

      switch (ext) {
        case '.pdf':
          contentType = 'application/pdf';
          break;
        case '.html':
        case '.htm':
          contentType = 'text/html';
          break;
        case '.png':
          contentType = 'image/png';
          break;
        case '.jpg':
        case '.jpeg':
          contentType = 'image/jpeg';
          break;
        case '.gif':
          contentType = 'image/gif';
          break;
        case '.svg':
          contentType = 'image/svg+xml';
          break;
        case '.webp':
          contentType = 'image/webp';
          break;
      }

      log.info(`[PROTOCOL] Returning file with Content-Type: ${contentType}`);

      return new Response(new Uint8Array(data), {
        headers: {
          'Content-Type': contentType,
          'Content-Length': data.length.toString(),
        },
      });
    } catch (err) {
      log.error(`[PROTOCOL] Error reading file: ${err}`);
      return new Response('Internal Server Error', { status: 500 });
    }
  };

  // Register on default session
  protocol.handle('localfile', protocolHandler);

  // Also register on main window session
  const mainSession = session.fromPartition('persist:main_window');
  mainSession.protocol.handle('localfile', protocolHandler);

  log.info(
    '[PROTOCOL] Registered localfile protocol on both default and main_window sessions'
  );

  // ==================== initialize app ====================
  initializeApp();
  registerIpcHandlers();
  createWindow();
});

// ==================== window close event ====================
app.on('window-all-closed', () => {
  log.info('window-all-closed');

  // Clean up WebView manager
  if (webViewManager) {
    webViewManager.destroy();
    webViewManager = null;
  }

  // Reset window state
  win = null;
  isWindowReady = false;
  protocolUrlQueue = [];

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ==================== app activate event ====================
app.on('activate', () => {
  const allWindows = BrowserWindow.getAllWindows();
  log.info('activate', allWindows.length);

  if (allWindows.length) {
    allWindows[0].focus();
  } else {
    cleanupPythonProcess();
    createWindow();
  }
});

// ==================== app exit event ====================
app.on('before-quit', async (event) => {
  log.info('before-quit');
  log.info('quit python_process.pid: ' + python_process?.pid);

  // Prevent default quit to ensure cleanup completes
  event.preventDefault();

  try {
    // NOTE: Profile sync removed - we now use app userData directly for all partitions
    // No need to sync between different profile directories

    // Clean up resources
    if (webViewManager) {
      webViewManager.destroy();
      webViewManager = null;
    }

    if (win && !win.isDestroyed()) {
      win.destroy();
      win = null;
    }

    // Wait for Python process cleanup
    await cleanupPythonProcess();

    // Clean up file reader if exists
    if (fileReader) {
      fileReader = null;
    }

    // Clear any remaining timeouts/intervals
    if (global.gc) {
      global.gc();
    }

    // Reset protocol handling state
    isWindowReady = false;
    protocolUrlQueue = [];

    log.info('All cleanup completed, exiting...');
  } catch (error) {
    log.error('Error during cleanup:', error);
  } finally {
    // Force quit after cleanup
    app.exit(0);
  }
});
