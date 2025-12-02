import { app, BrowserWindow, shell, ipcMain, Menu, dialog, nativeTheme, protocol, session } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os, { homedir } from 'node:os'
import log from 'electron-log'
import { update, registerUpdateIpcHandlers } from './update'
import { checkToolInstalled, killProcessOnPort, startBackend } from './init'
import { WebViewManager } from './webview'
import { FileReader } from './fileReader'
import { ChildProcessWithoutNullStreams } from 'node:child_process'
import fs, { existsSync, readFileSync } from 'node:fs'
import fsp from 'fs/promises'
import { addMcp, removeMcp, updateMcp, readMcpConfig } from './utils/mcpConfig'
import { getEnvPath, updateEnvBlock, removeEnvKey, getEmailFolderPath } from './utils/envUtil'
import { copyBrowserData } from './copy'
import { findAvailablePort } from './init'
import kill from 'tree-kill';
import { zipFolder } from './utils/log'
import mime from "mime";
import axios from 'axios';
import FormData from 'form-data';
import { checkAndInstallDepsOnUpdate, PromiseReturnType, getInstallationStatus } from './install-deps'
import { isBinaryExists, getBackendPath, getVenvPath } from './utils/process'

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
profileInitPromise = findAvailablePort(browser_port).then(async port => {
  browser_port = port;
  app.commandLine.appendSwitch('remote-debugging-port', port + '');

  // Create isolated profile for CDP browser only
  const browserProfilesBase = path.join(os.homedir(), '.eigent', 'browser_profiles');
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

// Disable system theme
nativeTheme.themeSource = 'light';

// Set log level
log.transports.console.level = 'info';
log.transports.file.level = 'info';
log.transports.console.format = '[{level}]{text}';
log.transports.file.format = '[{level}]{text}';

// Disable GPU Acceleration for Windows 7
if (os.release().startsWith('6.1')) app.disableHardwareAcceleration()

// Set application name for Windows 10+ notifications
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

// ==================== protocol config ====================
const setupProtocolHandlers = () => {
  if (process.env.NODE_ENV === 'development') {
    const isDefault = app.isDefaultProtocolClient('eigent', process.execPath, [path.resolve(process.argv[1])]);
    if (!isDefault) {
      app.setAsDefaultProtocolClient('eigent', process.execPath, [path.resolve(process.argv[1])]);
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
      log.info("protocol oauth", provider, code);
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
      log.warn('Window not ready for processing queued URLs, keeping URLs in queue');
      return;
    }

    const urls = [...protocolUrlQueue];
    protocolUrlQueue = [];

    urls.forEach(url => {
      processProtocolUrl(url);
    });
  }
}

// ==================== single instance lock ====================
const setupSingleInstanceLock = () => {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    log.info("no-lock");
    app.quit();
  } else {
    app.on('second-instance', (event, argv) => {
      log.info("second-instance", argv);
      const url = argv.find(arg => arg.startsWith('eigent://'));
      if (url) handleProtocolUrl(url);
      if (win) win.show();
    });

    app.on('open-url', (event, url) => {
      log.info("open-url");
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
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, 'logs', 'main.log')
}
// Constants define
const BROWSER_PATHS = {
  win32: {
    chrome: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    edge: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    firefox: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
    qq: 'C:\\Program Files\\Tencent\\QQBrowser\\QQBrowser.exe',
    '360': path.join(homedir(), 'AppData\\Local\\360Chrome\\Chrome\\Application\\360chrome.exe'),
    arc: path.join(homedir(), 'AppData\\Local\\Arc\\User Data\\Arc.exe'),
    dia: path.join(homedir(), 'AppData\\Local\\Dia\\Application\\dia.exe'),
    fellou: path.join(homedir(), 'AppData\\Local\\Fellou\\Application\\fellou.exe'),
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
    log.info('Getting browser port')
    return browser_port
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
  ipcMain.handle('execute-command', async (event, command: string, email: string) => {
    log.info("execute-command", command);
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
      console.log(cmd, args)
      return new Promise((resolve) => {
        const child = spawn(cmd, args, {
          cwd: process.cwd(),
          env: { ...process.env, MCP_REMOTE_CONFIG_DIR },
          stdio: ['pipe', 'pipe', 'pipe']
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
            const url = output.split('OAuth callback server running at')[1].trim();
            log.info('detect OAuth callback URL:', url);

            // Notify frontend to callback URL
            if (win && !win.isDestroyed()) {
              const match = url.match(/^https?:\/\/[^:\n]+:\d+/);
              const cleanedUrl = match ? match[0] : null;
              log.info('cleanedUrl', cleanedUrl);
              win.webContents.send('oauth-callback-url', {
                url: cleanedUrl,
                provider: 'notion' // TODO: can be set dynamically according to actual situation
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
  });

  ipcMain.handle("read-file-dataurl", async (event, filePath) => {
    try {
      const file = fs.readFileSync(filePath);
      const mimeType = mime.getType(path.extname(filePath)) || "application/octet-stream";
      return `data:${mimeType};base64,${file.toString("base64")}`;
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
        filters: [{ name: 'log file', extensions: ['log', 'txt'] }]
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

  ipcMain.handle('upload-log', async (event, email: string, taskId: string, baseUrl: string, token: string) => {
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
      const response = await axios.post(baseUrl + '/api/chat/logs', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          'Authorization': `Bearer ${token}`
        },
        timeout: 60000, // 60 second timeout
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });

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
  });

  // ==================== MCP manage handler ====================
  ipcMain.handle('mcp-install', async (event, name, mcp) => {
    // Convert args from JSON string to array if needed
    if (mcp.args && typeof mcp.args === 'string') {
      try {
        mcp.args = JSON.parse(mcp.args);
      } catch (e) {
        // If parsing fails, split by comma as fallback
        mcp.args = mcp.args.split(',').map((arg: string) => arg.trim()).filter((arg: string) => arg !== '');
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
      } catch (e) {
        // If parsing fails, split by comma as fallback
        mcp.args = mcp.args.split(',').map((arg: string) => arg.trim()).filter((arg: string) => arg !== '');
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
    if(data.isForceQuit) {
      return app?.quit()
    }
    return win?.close()
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
      ...options
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const files = result.filePaths.map(filePath => ({
        filePath,
        fileName: filePath.split(/[/\\]/).pop() || ''
      }));

      return {
        success: true,
        files,
        fileCount: files.length
      };
    }

    return {
      success: false,
      canceled: result.canceled
    };
  });

  ipcMain.handle("reveal-in-folder", async (event, filePath: string) => {
    try {
      const stats = await fs.promises.stat(filePath.replace(/\/$/, '')).catch(() => null);
      if (stats && stats.isDirectory()) {
        shell.openPath(filePath);
      } else {
        shell.showItemInFolder(filePath);
      }
    } catch (e) {
      log.error("reveal in folder failed", e);
    }
  });

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
        size: fileContent.length
      };
    } catch (error: any) {
      log.error('Failed to read file:', filePath, error);
      return {
        success: false,
        error: error.message || 'Failed to read file'
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
        message: 'Folder deleted successfully'
      };
    } catch (error: any) {
      log.error('Failed to delete folder:', MCP_REMOTE_CONFIG_DIR, error);
      return {
        success: false,
        error: error.message || 'Failed to delete folder'
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
        error: error.message || 'Failed to get MCP config path'
      };
    }
  });

  // ==================== env handler ====================

  ipcMain.handle('get-env-path', async (_event, email) => {
    return getEnvPath(email);
  });

  ipcMain.handle('get-env-has-key', async (_event, email, key) => {
    const ENV_PATH = getEnvPath(email);
    let content = '';
    try {
      content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf-8') : '';
    } catch (error) {
      log.error("env-remove error:", error);
    }
    let lines = content.split(/\r?\n/);
    return { success: lines.some(line => line.startsWith(key + '=')) };
  });

  ipcMain.handle('env-write', async (_event, email, { key, value }) => {
    const ENV_PATH = getEnvPath(email);
    let content = '';
    try {
      content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf-8') : '';
    } catch (error) {
      log.error("env-write error:", error);
    }
    let lines = content.split(/\r?\n/);
    lines = updateEnvBlock(lines, { [key]: value });
    fs.writeFileSync(ENV_PATH, lines.join('\n'), 'utf-8');
    
    // Also write to global .env file for backend process to read
    const GLOBAL_ENV_PATH = path.join(os.homedir(), '.eigent', '.env');
    let globalContent = '';
    try {
      globalContent = fs.existsSync(GLOBAL_ENV_PATH) ? fs.readFileSync(GLOBAL_ENV_PATH, 'utf-8') : '';
    } catch (error) {
      log.error("global env-write read error:", error);
    }
    let globalLines = globalContent.split(/\r?\n/);
    globalLines = updateEnvBlock(globalLines, { [key]: value });
    try {
      fs.writeFileSync(GLOBAL_ENV_PATH, globalLines.join('\n'), 'utf-8');
      log.info(`env-write: wrote ${key} to both user and global .env files`);
    } catch (error) {
      log.error("global env-write error:", error);
    }
    
    return { success: true };
  });

  ipcMain.handle('env-remove', async (_event, email, key) => {
    log.info("env-remove", key);
    const ENV_PATH = getEnvPath(email);
    let content = '';
    try {
      content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf-8') : '';
    } catch (error) {
      log.error("env-remove error:", error);
    }
    let lines = content.split(/\r?\n/);
    lines = removeEnvKey(lines, key);
    fs.writeFileSync(ENV_PATH, lines.join('\n'), 'utf-8');
    log.info("env-remove success", ENV_PATH);
    
    // Also remove from global .env file
    const GLOBAL_ENV_PATH = path.join(os.homedir(), '.eigent', '.env');
    try {
      let globalContent = fs.existsSync(GLOBAL_ENV_PATH) ? fs.readFileSync(GLOBAL_ENV_PATH, 'utf-8') : '';
      let globalLines = globalContent.split(/\r?\n/);
      globalLines = removeEnvKey(globalLines, key);
      fs.writeFileSync(GLOBAL_ENV_PATH, globalLines.join('\n'), 'utf-8');
      log.info(`env-remove: removed ${key} from both user and global .env files`);
    } catch (error) {
      log.error("global env-remove error:", error);
    }
    
    return { success: true };
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
  ipcMain.handle('open-file', async (_, type: string, filePath: string, isShowSourceCode: boolean) => {
    const manager = checkManagerInstance(fileReader, 'FileReader');
    return manager.openFile(type, filePath, isShowSourceCode);
  });

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

  ipcMain.handle('get-file-list', async (_, email: string, taskId: string, projectId?: string) => {
    const manager = checkManagerInstance(fileReader, 'FileReader');
    return manager.getFileList(email, taskId, projectId);
  });

  ipcMain.handle('delete-task-files', async (_, email: string, taskId: string, projectId?: string) => {
    const manager = checkManagerInstance(fileReader, 'FileReader');
    return manager.deleteTaskFiles(email, taskId, projectId);
  });

  // New project management handlers
  ipcMain.handle('create-project-structure', async (_, email: string, projectId: string) => {
    const manager = checkManagerInstance(fileReader, 'FileReader');
    return manager.createProjectStructure(email, projectId);
  });

  ipcMain.handle('get-project-list', async (_, email: string) => {
    const manager = checkManagerInstance(fileReader, 'FileReader');
    return manager.getProjectList(email);
  });

  ipcMain.handle('get-tasks-in-project', async (_, email: string, projectId: string) => {
    const manager = checkManagerInstance(fileReader, 'FileReader');
    return manager.getTasksInProject(email, projectId);
  });

  ipcMain.handle('move-task-to-project', async (_, email: string, taskId: string, projectId: string) => {
    const manager = checkManagerInstance(fileReader, 'FileReader');
    return manager.moveTaskToProject(email, taskId, projectId);
  });

  ipcMain.handle('get-project-file-list', async (_, email: string, projectId: string) => {
    const manager = checkManagerInstance(fileReader, 'FileReader');
    return manager.getProjectFileList(email, projectId);
  });

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
      if(win === null) throw new Error("Window is null");

      // Prevent concurrent installations
      if (isInstallationInProgress) {
        log.info('[DEPS INSTALL] Installation already in progress, waiting...');
        await installationLock;
        return { success: true, message: 'Installation completed by another process' };
      }

      log.info('[DEPS INSTALL] Manual installation/retry triggered');

      // Set lock
      isInstallationInProgress = true;
      installationLock = checkAndInstallDepsOnUpdate({win, forceInstall: true})
        .finally(() => {
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
        win.webContents.send('install-dependencies-complete', { success: true, code: 0 });
        log.info('[DEPS INSTALL] Sent install-dependencies-complete event after retry');
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
        timestamp: Date.now()
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
  ];

  for (const dir of requiredDirs) {
    if (!fs.existsSync(dir)) {
      log.info(`Creating directory: ${dir}`);
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  log.info('.eigent directory structure ensured');
};

// ==================== Shared backend startup logic ====================
// Starts backend after installation completes
// Used by both initial startup and retry flows
const startBackendAfterInstall = async () => {
  log.info('[DEPS INSTALL] Starting backend...');

  // Add a small delay to ensure any previous processes are fully cleaned up
  await new Promise(resolve => setTimeout(resolve, 500));

  await checkAndStartBackend();
};

// ==================== installation lock ====================
let isInstallationInProgress = false;
let installationLock: Promise<PromiseReturnType> = Promise.resolve({ message: "No installation needed", success: true });

// ==================== window create ====================
async function createWindow() {
  const isMac = process.platform === 'darwin';

  // Ensure .eigent directories exist before anything else
  ensureEigentDirectories();

  log.info(`[PROJECT BROWSER WINDOW] Creating BrowserWindow which will start Chrome with CDP on port ${browser_port}`);
  log.info(`[PROJECT BROWSER WINDOW] Current user data path: ${app.getPath('userData')}`);
  log.info(`[PROJECT BROWSER WINDOW] Command line switch user-data-dir: ${app.commandLine.getSwitchValue('user-data-dir')}`);
  
  win = new BrowserWindow({
    title: 'Eigent',
    width: 1200,
    height: 800,
    minWidth: 1050,
    minHeight: 650,
    frame: false,
    transparent: true,
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    backgroundColor: '#f5f5f580',
    titleBarStyle: isMac ? 'hidden' : undefined,
    trafficLightPosition: isMac ? { x: 10, y: 10 } : undefined,
    icon: path.join(VITE_PUBLIC, 'favicon.ico'),
    roundedCorners: true,
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

  // Main window now uses default userData directly with partition 'persist:main_window'
  // No migration needed - data is already persistent

  // ==================== Import cookies from tool_controller to WebView BEFORE creating WebViews ====================
  // Copy partition data files before any session accesses them
  try {
    const browserProfilesBase = path.join(os.homedir(), '.eigent', 'browser_profiles');
    const toolControllerProfile = path.join(browserProfilesBase, 'profile_user_login');
    const toolControllerPartitionPath = path.join(toolControllerProfile, 'Partitions', 'user_login');

    if (fs.existsSync(toolControllerPartitionPath)) {
      log.info('[COOKIE SYNC] Found tool_controller partition, copying to WebView partition...');

      const targetPartitionPath = path.join(app.getPath('userData'), 'Partitions', 'user_login');
      log.info('[COOKIE SYNC] From:', toolControllerPartitionPath);
      log.info('[COOKIE SYNC] To:', targetPartitionPath);

      // Ensure target directory exists
      if (!fs.existsSync(path.dirname(targetPartitionPath))) {
        fs.mkdirSync(path.dirname(targetPartitionPath), { recursive: true });
      }

      // Copy the entire partition directory
      fs.cpSync(toolControllerPartitionPath, targetPartitionPath, {
        recursive: true,
        force: true
      });
      log.info('[COOKIE SYNC] Successfully copied partition data to WebView');

      // Verify cookies were copied
      const targetCookies = path.join(targetPartitionPath, 'Cookies');
      if (fs.existsSync(targetCookies)) {
        const stats = fs.statSync(targetCookies);
        log.info(`[COOKIE SYNC] Cookies file size: ${stats.size} bytes`);
      }
    } else {
      log.info('[COOKIE SYNC] No tool_controller partition found, WebView will start fresh');
    }
  } catch (error) {
    log.error('[COOKIE SYNC] Failed to sync partition data:', error);
  }

  // ==================== initialize manager ====================
  fileReader = new FileReader(win);
  webViewManager = new WebViewManager(win);

  // create multiple webviews
  log.info(`[PROJECT BROWSER] Creating WebViews with partition: persist:user_login`);
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

  // Check if venv path exists for current version
  const venvPath = getVenvPath(currentVersion);
  const venvExists = fs.existsSync(venvPath);

  const needsInstallation = !versionExists || savedVersion !== currentVersion || !uvExists || !bunExists || !installationCompleted || !venvExists;

  log.info('Installation check result:', {
    needsInstallation,
    versionExists,
    versionMatch: savedVersion === currentVersion,
    uvExists,
    bunExists,
    installationCompleted,
    venvExists,
    venvPath
  });

  // Handle localStorage based on installation state
  if (needsInstallation) {
    log.info('Installation needed - resetting initState to carousel while preserving auth data');

    // Instead of deleting the entire localStorage, we'll update only the initState
    // This preserves login information while resetting the initialization flow
    // Set up the injection for when page loads
    win.webContents.once('dom-ready', () => {
      if (!win || win.isDestroyed()) {
        log.warn('Window destroyed before DOM ready - skipping localStorage injection');
        return;
      }
      log.info('DOM ready - updating initState to carousel while preserving auth data');
      win.webContents.executeJavaScript(`
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
      `).catch(err => {
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
    log.info('Installation already complete - letting useInstallationSetup handle state transitions');
  }

  // Load content
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
    win.webContents.openDevTools();
  } else {
    win.loadFile(indexHtml);
  }

  // Wait for window to be ready
  await new Promise<void>(resolve => {
    win!.webContents.once('did-finish-load', () => {
      log.info('Window content loaded, starting dependency check immediately...');
      resolve();
    });
  });

  // Mark window as ready and process any queued protocol URLs
  isWindowReady = true;
  log.info('Window is ready, processing queued protocol URLs...');
  processQueuedProtocolUrls();

  // Wait for React components to mount and register event listeners
  await new Promise(resolve => setTimeout(resolve, 500));

  // Now check and install dependencies
  let res:PromiseReturnType = await checkAndInstallDepsOnUpdate({ win });
  if (!res.success) {
    log.info("[DEPS INSTALL] Dependency Error: ", res.message);
    // Note: install-dependencies-complete failure event is already sent by installDependencies function
    // in install-deps.ts, so we don't send it again here to avoid duplicate events
    return;
  }
  log.info("[DEPS INSTALL] Dependency Success: ", res.message);

  // IMPORTANT: Wait a bit to ensure React components have mounted and registered event listeners
  // This prevents race condition where events are sent before listeners are ready
  await new Promise(resolve => setTimeout(resolve, 500));

  // IMPORTANT: Always send install-dependencies-complete event when installation check succeeds
  // This includes both cases: actual installation completed AND installation was skipped (already installed)
  // The frontend needs this event to properly transition from installation screen to main app
  if (!win.isDestroyed()) {
    win.webContents.send('install-dependencies-complete', { success: true, code: 0 });
    log.info("[DEPS INSTALL] Sent install-dependencies-complete event to frontend");
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
    if (input.control && input.shift && input.key.toLowerCase() === 'i' && input.type === 'keyDown') {
      toggleDevTools();
    }

    // Mac Cmd+Shift+I
    if (input.meta && input.shift && input.key.toLowerCase() === 'i' && input.type === 'keyDown') {
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
          port: backendPort
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
          error: 'Tools not installed'
        });
      }
    }
  } catch (error) {
    log.error("Failed to start backend:", error);
    // Notify frontend of backend startup failure
    if (win && !win.isDestroyed()) {
      win.webContents.send('backend-ready', {
        success: false,
        error: String(error)
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
    
    win?.on("close", (event) => {
      if (!isQuitting) {
        event.preventDefault();
        win?.webContents.send("before-close");
      }
    })
}

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

  // ==================== download handle ====================
  session.defaultSession.on('will-download', (event, item, webContents) => {
    item.once('done', (event, state) => {
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
      const fileExists = await fsp.access(filePath).then(() => true).catch(() => false);
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

  log.info('[PROTOCOL] Registered localfile protocol on both default and main_window sessions');

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

