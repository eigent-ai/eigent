import { app, BrowserWindow, shell, ipcMain, Menu, dialog, nativeTheme, protocol, session } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os, { homedir } from 'node:os'
import log from 'electron-log'
import { update, registerUpdateIpcHandlers } from './update'
import { checkToolInstalled, installDependencies, startBackend } from './init'
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

const userData = app.getPath('userData');
const versionFile = path.join(userData, 'version.txt');

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

// ==================== path config ====================
const preload = path.join(__dirname, '../preload/index.mjs');
const indexHtml = path.join(RENDERER_DIST, 'index.html');
const logPath = log.transports.file.getFile().path;

// Set remote debugging port
findAvailablePort(browser_port).then(port => {
  browser_port = port;
  app.commandLine.appendSwitch('remote-debugging-port', port + '');
});

// Read last run version and install dependencies on update
async function checkAndInstallDepsOnUpdate(): Promise<boolean> {
  const currentVersion = app.getVersion();
  return new Promise(async (resolve, reject) => {
    try {
      log.info(' start check version', { currentVersion });

      // Check if version file exists
      const versionExists = fs.existsSync(versionFile);
      let savedVersion = '';

      if (versionExists) {
        savedVersion = fs.readFileSync(versionFile, 'utf-8').trim();
        log.info(' read saved version', { savedVersion });
      } else {
        log.info(' version file not exist, will create new file');
      }

      // If version file does not exist or version does not match, reinstall dependencies
      if (!versionExists || savedVersion !== currentVersion) {
        log.info(' version changed, prepare to reinstall uv dependencies...', {
          currentVersion,
          savedVersion: versionExists ? savedVersion : 'none',
          reason: !versionExists ? 'version file not exist' : 'version not match'
        });

        // Notify frontend to update
        if (win && !win.isDestroyed()) {
          win.webContents.send('update-notification', {
            type: 'version-update',
            currentVersion,
            previousVersion: versionExists ? savedVersion : 'none',
            reason: !versionExists ? 'version file not exist' : 'version not match'
          });
        }

        // Update version file
        fs.writeFileSync(versionFile, currentVersion);
        log.info(' version file updated', { currentVersion });

        // Install dependencies
        const result = await installDependencies();
        if (!result) {
          log.error(' install dependencies failed');
          resolve(false);
          return
        }
        resolve(true);
        log.info(' install dependencies complete');
        return
      } else {
        log.info(' version not changed, skip install dependencies', { currentVersion });
        resolve(true);
        return
      }
    } catch (error) {
      log.error(' check version and install dependencies error:', error);
      resolve(false);
      return
    }
  })
}

// ==================== app config ====================
process.env.APP_ROOT = MAIN_DIST;
process.env.VITE_PUBLIC = VITE_PUBLIC;

// Disable system theme
nativeTheme.themeSource = 'light';

// Set log level
log.transports.console.level = 'info';
log.transports.file.level = 'info';

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

const handleDependencyInstallation = async () => {
  try {
    log.info(' start install dependencies...');

    const isSuccess = await installDependencies();
    if (!isSuccess) {
      log.error(' install dependencies failed');
      return { success: false, error: 'install dependencies failed' };
    }

    log.info(' install dependencies success, check tool installed status...');
    const isToolInstalled = await checkToolInstalled();

    if (isToolInstalled && !python_process) {
      log.info(' tool installed, start backend service...');
      python_process = await startBackend((port) => {
        backendPort = port;
        log.info(' backend service start success', { port });
      });

      // Notify frontend to install success
      if (win && !win.isDestroyed()) {
        win.webContents.send('install-dependencies-complete', { success: true, code: 0 });
      }

      python_process?.on('exit', (code, signal) => {
        log.info(' python process exit', { code, signal });
      });
    } else if (!isToolInstalled) {
      log.warn(' tool not installed, skip backend start');
    } else {
      log.info(' backend process already exist, skip start');
    }

    log.info(' install dependencies complete');
    return { success: true };
  } catch (error: any) {
    log.error(' install dependencies error:', error);
    if (win && !win.isDestroyed()) {
      win.webContents.send('install-dependencies-complete', { success: false, code: 2 });
    }
    return { success: false, error: error.message };
  }
};

function registerIpcHandlers() {
  // ==================== basic info handler ====================
  ipcMain.handle('get-browser-port', () => browser_port);
  ipcMain.handle('get-app-version', () => app.getVersion());
  ipcMain.handle('get-backend-port', () => backendPort);
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
    const {MCP_REMOTE_CONFIG_DIR} = getEmailFolderPath(email);

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
            log.info(' detect OAuth callback URL:', url);

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

  // ==================== MCP manage handler ====================
  ipcMain.handle('mcp-install', async (event, name, mcp) => {
    addMcp(name, mcp);
    return { success: true };
  });

  ipcMain.handle('mcp-remove', async (event, name) => {
    removeMcp(name);
    return { success: true };
  });

  ipcMain.handle('mcp-update', async (event, name, mcp) => {
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
  ipcMain.on('window-close', () => win?.close());
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
      shell.showItemInFolder(filePath);
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
    const {MCP_REMOTE_CONFIG_DIR} = getEmailFolderPath(email);
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
      const {MCP_REMOTE_CONFIG_DIR,tempEmail} = getEmailFolderPath(email);
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

  ipcMain.handle('get-file-list', async (_, email: string, taskId: string) => {
    const manager = checkManagerInstance(fileReader, 'FileReader');
    return manager.getFileList(email, taskId);
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
  ipcMain.handle('install-dependencies', handleDependencyInstallation);
  ipcMain.handle('frontend-ready', handleDependencyInstallation);

  ipcMain.handle('check-tool-installed', async () => {
    try {
      const isInstalled = await checkToolInstalled();
      return { success: true, isInstalled };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // ==================== register update related handler ====================
  registerUpdateIpcHandlers();
}

// ==================== window create ====================
async function createWindow() {
  const isMac = process.platform === 'darwin';

  win = new BrowserWindow({
    title: 'Eigent',
    width: 1200,
    height: 800,
    frame: false,
    transparent: true,
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    titleBarStyle: isMac ? 'hidden' : undefined,
    trafficLightPosition: isMac ? { x: 10, y: 10 } : undefined,
    icon: path.join(VITE_PUBLIC, 'favicon.ico'),
    roundedCorners: true,
    webPreferences: {
      webSecurity: false,
      preload,
      nodeIntegration: true,
      contextIsolation: true,
      webviewTag: true,
      spellcheck: false,
    },
  });

  // ==================== initialize manager ====================
  fileReader = new FileReader(win);
  webViewManager = new WebViewManager(win);

  // create multiple webviews
  for (let i = 1; i <= 8; i++) {
    webViewManager.createWebview(i === 1 ? undefined : i.toString());
  }

  // ==================== load content ====================
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
    win.webContents.openDevTools();
  } else {
    win.loadFile(indexHtml);
  }

  // ==================== set event listeners ====================
  setupWindowEventListeners();
  setupDevToolsShortcuts();
  setupExternalLinkHandling();

  // ==================== auto update ====================
  update(win);

  // ==================== check tool installed ====================
  let res = await checkAndInstallDepsOnUpdate();
  if (!res) {
    log.info('checkAndInstallDepsOnUpdate,install dependencies failed');
    win.webContents.send('install-dependencies-complete', { success: false, code: 2 });
    return;
  }
  await checkAndStartBackend();
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

  // handle new window open
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // handle navigation
  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    shell.openExternal(url);
  });
};

// ==================== check and start backend ====================
const checkAndStartBackend = async () => {
  log.info('Checking and starting backend service...');

  const isToolInstalled = await checkToolInstalled();
  if (isToolInstalled) {
    log.info('Tool installed, starting backend service...');

    // Notify frontend installation success
    if (win && !win.isDestroyed()) {
      win.webContents.send('install-dependencies-complete', { success: true, code: 0 });
    }

    python_process = await startBackend((port) => {
      backendPort = port;
      log.info('Backend service started successfully', { port });
    });

    python_process?.on('exit', (code, signal) => {
      log.info('Python process exited', { code, signal });
    });
  } else {
    log.warn('Tool not installed, cannot start backend service');
  }
};

// ==================== process cleanup ====================
const cleanupPythonProcess = () => {
  try {
    if (python_process?.pid) {
      log.info('Cleaning up Python process', { pid: python_process.pid });
      kill(python_process.pid, 'SIGINT', (err) => {
        if (err) {
          log.error('Failed to clean up process tree:', err);
        } else {
          log.info('Successfully cleaned up Python process tree');
        }
      });
    } else {
      log.info('No Python process to clean up');
    }
  } catch (error) {
    log.error('Error occurred while cleaning up process:', error);
  }
};

// ==================== app event handle ====================
app.whenReady().then(() => {

  // ==================== download handle ====================
  session.defaultSession.on('will-download', (event, item, webContents) => {
    item.once('done', (event, state) => {
      shell.showItemInFolder(item.getURL().replace('localfile://', ''));
    });
  });

  // ==================== protocol handle ====================
  protocol.handle('localfile', async (request) => {
    const url = decodeURIComponent(request.url.replace('localfile://', ''));
    const filePath = path.normalize(url);

    try {
      const data = await fsp.readFile(filePath);

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
      }

      return new Response(new Uint8Array(data), {
        headers: {
          'Content-Type': contentType,
        },
      });
    } catch (err) {
      return new Response('Not Found', { status: 404 });
    }
  });

  // ==================== initialize app ====================
  initializeApp();
  registerIpcHandlers();
  createWindow();
});

// ==================== window close event ====================
app.on('window-all-closed', () => {
  log.info('window-all-closed');
  webViewManager = null;
  win = null;
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
app.on('before-quit', () => {
  log.info('before-quit');
  log.info('quit python_process.pid: ' + python_process?.pid);
  if (win) {
    win.destroy();
  }
  cleanupPythonProcess();
});

