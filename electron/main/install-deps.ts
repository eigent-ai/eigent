import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import log from 'electron-log'
import { getMainWindow } from './init'
import fs from 'node:fs'
import { getBackendPath, getBinaryPath, getCachePath, isBinaryExists, runInstallScript } from './utils/process'
import { spawn } from 'child_process'
import { safeMainWindowSend } from './utils/safeWebContentsSend'

const userData = app.getPath('userData');
const versionFile = path.join(userData, 'version.txt');

export type PromiseReturnType = {
  message: string;
  success: boolean;
}

interface checkInstallProps {
  win:BrowserWindow|null; 
  forceInstall?:boolean
}
// Read last run version and install dependencies on update
export const checkAndInstallDepsOnUpdate = async ({win, forceInstall=false}:checkInstallProps): 
Promise<PromiseReturnType> => {
  const currentVersion = app.getVersion();
  let savedVersion = '';
  const checkInstallOperations = {
    getSavedVersion: ():boolean => {
      // Check if version file exists
      const versionExists = fs.existsSync(versionFile);
      if (versionExists) {
        log.info('[DEPS INSTALL] start check version', { currentVersion });
        savedVersion = fs.readFileSync(versionFile, 'utf-8').trim();
        log.info('[DEPS INSTALL] read saved version', { savedVersion });
      } else {
        log.info('[DEPS INSTALL] version file not exist, will create new file');
      }
      return versionExists;
    },
    handleUpdateNotification: (versionExists:boolean) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('update-notification', {
          type: 'version-update',
          currentVersion,
          previousVersion: versionExists ? savedVersion : 'none',
          reason: !versionExists ? 'version file not exist' : 'version not match'
        });
      } else {
        log.warn('[DEPS INSTALL] Cannot send update notification - window not available');
      }
    },
    createVersionFile: () => {
      fs.writeFileSync(versionFile, currentVersion);
      log.info('[DEPS INSTALL] version file updated', { currentVersion });
    }
  }

  return new Promise(async (resolve, reject) => {
    try {
      const versionExists:boolean = checkInstallOperations.getSavedVersion();

      // If version file does not exist or version does not match, reinstall dependencies
      if (forceInstall || !versionExists || savedVersion !== currentVersion) {
        log.info('[DEPS INSTALL] version changed, prepare to reinstall uv dependencies...', {
          currentVersion,
          savedVersion: versionExists ? savedVersion : 'none',
          reason: !versionExists ? 'version file not exist' : 'version not match'
        });

        // Notify frontend to update
        checkInstallOperations.handleUpdateNotification(versionExists);

        // Update version file
        checkInstallOperations.createVersionFile();

        // Install dependencies
        const result = await installDependencies();
        if (!result.success) {
          log.error(' install dependencies failed');
          resolve({ message: `Install dependencies failed, msg ${result.message}`, success: false });
          return
        }
        resolve({ message: "Dependencies installed successfully after update", success: true });
        log.info('[DEPS INSTALL] install dependencies complete');
        return
      } else {
        log.info('[DEPS INSTALL] version not changed, skip install dependencies', { currentVersion });
        resolve({ message: "Version not changed, skipped installation", success: true });
        return
      }
    } catch (error) {
      log.error(' check version and install dependencies error:', error);
      resolve({ message: `Error checking version: ${error}`, success: false });
      return
    }
  })
}

/**
 * Check if command line tools are installed, install if not
 */
export async function installCommandTool(): Promise<PromiseReturnType> {
  return new Promise(async (resolve, reject) => {
      const ensureInstalled = async (toolName: 'uv' | 'bun', scriptName: string): Promise<PromiseReturnType> => {
        if (await isBinaryExists(toolName)) {
            return { message: `${toolName} already installed`, success: true };
        }

        console.log(`start install ${toolName}`);
        await runInstallScript(scriptName);
        const installed = await isBinaryExists(toolName);

        if (installed) {
          safeMainWindowSend('install-dependencies-log', {
            type: 'stdout',
            data: `${toolName} installed successfully`,
          });
        } else {
          safeMainWindowSend('install-dependencies-complete', {
            success: false,
            code: 2,
            error: `${toolName} installation failed (script exit code 2)`,
          });
        }

        return { 
          message: installed ? `${toolName} installed successfully` : `${toolName} installation failed`,
          success: installed 
        };
      };

      const uvResult = await ensureInstalled('uv', 'install-uv.js');
      if (!uvResult.success) {
          return reject({ message: uvResult.message, success: false });
      }
      
      const bunResult = await ensureInstalled('bun', 'install-bun.js');
      if (!bunResult.success) {
          return reject({ message: bunResult.message, success: false });
      }

      return resolve({ message: "Command tools installed successfully", success: true });
  })
}

let uv_path:string;
const mainWindow = getMainWindow();
const backendPath = getBackendPath();
const installingLockPath = path.join(backendPath, 'uv_installing.lock')
const installedLockPath = path.join(backendPath, 'uv_installed.lock')
// const proxyArgs = ['--default-index', 'https://pypi.tuna.tsinghua.edu.cn/simple']
const proxyArgs = ['--default-index', 'https://mirrors.aliyun.com/pypi/simple/']

/**
 * Get current installation status by checking lock files
 * @returns Object with installation status information
 */
export async function getInstallationStatus(): Promise<{
  isInstalling: boolean;
  hasLockFile: boolean;
  installedExists: boolean;
}> {
  try {
    const installingExists = fs.existsSync(installingLockPath);
    const installedExists = fs.existsSync(installedLockPath);
    
    // If installing lock exists, installation is in progress
    // If installed lock exists, installation completed previously
    return {
      isInstalling: installingExists,
      hasLockFile: installingExists || installedExists,
      installedExists: installedExists
    };
  } catch (error) {
    console.error('[getInstallationStatus] Error checking installation status:', error);
    return {
      isInstalling: false,
      hasLockFile: false,
      installedExists: false
    };
  }
}

class InstallLogs {
  private node_process;

  constructor(extraArgs:string[]) {
    console.log('start install dependencies', extraArgs)
    this.node_process = spawn(uv_path, [
        'sync',
        '--no-dev',
        '--cache-dir', getCachePath('uv_cache'),
        ...extraArgs], {
        cwd: backendPath,
        env: {
            ...process.env,
            UV_TOOL_DIR: getCachePath('uv_tool'),
            UV_PYTHON_INSTALL_DIR: getCachePath('uv_python'),
        }
    })
  }

  /**Display filtered logs based on severity */
  displayFilteredLogs(data:String) {
      if (!data) return;
      const msg = data.toString().trimEnd();
      //Detect if uv sync is run
      detectInstallationLogs(msg);
      if (msg.toLowerCase().includes("error") || msg.toLowerCase().includes("traceback")) {
          log.error(`BACKEND: [DEPS INSTALL] ${msg}`);
          safeMainWindowSend('install-dependencies-log', { type: 'stderr', data: data.toString() });
      } else {
          log.info(`BACKEND: [DEPS INSTALL] ${msg}`);
          safeMainWindowSend('install-dependencies-log', { type: 'stdout', data: data.toString() });
      }
  }
  
  /**Handle stdout data */
  onStdout() { 
    this.node_process.stdout.on('data', (data:any) => {
        this.displayFilteredLogs(data);
    })
  }

  /**Handle stderr data */
  onStderr() {
    this.node_process.stderr.on('data', (data:any) => {
        this.displayFilteredLogs(data);
    })
  }

  /**Handle process close event */
  onClose(resolveInner:(code: number | null) => void) {
    this.node_process.on('close', resolveInner);
  }

  /**
   * Set installing Lock Path
   * Creates uv_installing.lock file to indicate installation in progress
   * Creates backend directory if not exists
   */
  static setLockPath() {
    if (!fs.existsSync(backendPath)) {
        fs.mkdirSync(backendPath, { recursive: true })
    }
    fs.writeFileSync(installingLockPath, '')
  }

  /**Clean installing Lock Path */
  static cleanLockPath() {
    if (fs.existsSync(installingLockPath)) {
        fs.unlinkSync(installingLockPath);
    }
  }
}

const runInstall = (extraArgs: string[]) => {
  const installLogs = new InstallLogs(extraArgs);
  return new Promise<PromiseReturnType>((resolveInner, rejectInner) => {
    try {
        installLogs.onStdout();
        installLogs.onStderr();
        installLogs.onClose((code) => {
          console.log('install dependencies end', code === 0)
          InstallLogs.cleanLockPath()
          resolveInner({
            message: code === 0 ? "Installation completed successfully" : `Installation failed with code ${code}`,
            success: code === 0
          })
        })
    } catch (err) {
        log.error('run install failed', err)    
        // Clean up uv_installing.lock file if installation fails
        InstallLogs.cleanLockPath();
        rejectInner({ message: `Installation failed: ${err}`, success: false })
    }
  })
}

export async function installDependencies(): Promise<PromiseReturnType> {
  uv_path = await getBinaryPath('uv');
  const handleInstallOperations = {
    spawnBabel: (message:"mirror"|"main"="main") => {
      fs.writeFileSync(installedLockPath, '')
      log.info('[DEPS INSTALL] Script completed successfully')
      console.log(`Install Dependencies completed ${message}`)
      spawn(uv_path, ['run', 'task', 'babel'], { cwd: backendPath })
    },
    notifyInstallDependenciesPage: ():boolean => {
      const success = safeMainWindowSend('install-dependencies-start');
      if (!success) {
        log.warn('[DEPS INSTALL] Main window not available, continuing installation without UI updates');
      }
      return success;
    }
  }

  return new Promise<PromiseReturnType>(async (resolve, reject) => {
    console.log('start install dependencies')
    const mainWindowAvailable = handleInstallOperations.notifyInstallDependenciesPage();
    
    if (!mainWindowAvailable) {
      log.info('[DEPS INSTALL] Proceeding with installation without UI notifications');
    }

    const isInstalCommandTool = await installCommandTool()
    if (!isInstalCommandTool.success) {
        resolve({ message: "Command tool installation failed", success: false })
        return
    }

    // Set Installing Lock Files
    InstallLogs.setLockPath();

    // try default install
    const installSuccess = await runInstall([])
    if (installSuccess.success) {
        handleInstallOperations.spawnBabel()
        resolve({ message: "Dependencies installed successfully", success: true })
        return
    }

    // try mirror install
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    let mirrorInstallSuccess: PromiseReturnType = { message: "", success: false }
    mirrorInstallSuccess = (timezone === 'Asia/Shanghai')? await runInstall(proxyArgs) :await runInstall([])

    if (mirrorInstallSuccess.success) {
        handleInstallOperations.spawnBabel("mirror")
        resolve({ message: "Dependencies installed successfully with mirror", success: true })
    } else {
        log.error('Both default and mirror install failed')
        safeMainWindowSend('install-dependencies-complete', { 
          success: false, 
          error: 'Both default and mirror install failed' 
        });
        resolve({ message: "Both default and mirror install failed", success: false })
    }
  })
}

let dependencyInstallationDetected = false;
let installationNotificationSent = false;
export function detectInstallationLogs(msg:string) {
  // Check for UV dependency installation patterns
  const installPatterns = [
      "Resolved", // UV resolving dependencies
      "Downloaded", // UV downloading packages
      "Installing", // UV installing packages
      "Built", // UV building packages
      "Prepared", // UV preparing virtual environment
      "Syncing", // UV sync process
      "Creating virtualenv", // Virtual environment creation
      "Updating", // UV updating packages
      "× No solution found when resolving dependencies", // Dependency resolution issues
      "Audited" // UV auditing dependencies
  ];
  
  // Detect if UV is installing dependencies
  if (!dependencyInstallationDetected && installPatterns.some(pattern => 
      msg.includes(pattern) && !msg.includes("Uvicorn running on")
  )) {
      dependencyInstallationDetected = true;
      log.info('[BACKEND STARTUP] UV dependency installation detected during uvicorn startup');
      
      // Create installing lock file to maintain consistency with install-deps.ts
      InstallLogs.setLockPath();
      log.info('[BACKEND STARTUP] Created uv_installing.lock file');
      
      // Notify frontend that installation has started (only once)
      if (!installationNotificationSent) {
          installationNotificationSent = true;
          const notificationSent = safeMainWindowSend('install-dependencies-start');
          if (notificationSent) {
              log.info('[BACKEND STARTUP] Notified frontend of dependency installation start');
          } else {
              log.warn('[BACKEND STARTUP] Failed to notify frontend of dependency installation start');
          }
      }
  }
  
  // Send installation logs to frontend if installation was detected
  if (dependencyInstallationDetected && !msg.includes("Uvicorn running on")) {
      safeMainWindowSend('install-dependencies-log', {
          type: msg.toLowerCase().includes("error") || msg.toLowerCase().includes("traceback") ? 'stderr' : 'stdout',
          data: msg
      });
  }
  
  // Check if installation is complete (uvicorn starts successfully)
  if (dependencyInstallationDetected && msg.includes("Uvicorn running on")) {
      log.info('[BACKEND STARTUP] UV dependency installation completed, uvicorn started successfully');
      
      // Clean up installing lock and create installed lock
      InstallLogs.cleanLockPath();
      fs.writeFileSync(installedLockPath, '');
      log.info('[BACKEND STARTUP] Created uv_installed.lock file');
      
      safeMainWindowSend('install-dependencies-complete', {
          success: true,
          message: 'Dependencies installed successfully during backend startup'
      });
  }
  
  // Handle installation failures
  if (dependencyInstallationDetected && (
      msg.toLowerCase().includes("failed to resolve dependencies") ||
      msg.toLowerCase().includes("installation failed") ||
      msg.includes("× No solution found when resolving dependencies")
  )) {
      log.error('[BACKEND STARTUP] UV dependency installation failed');
      
      // Clean up installing lock file
      InstallLogs.cleanLockPath();
      log.info('[BACKEND STARTUP] Cleaned up uv_installing.lock file after failure');
      
      safeMainWindowSend('install-dependencies-complete', {
          success: false,
          error: 'Dependency installation failed during backend startup'
      });
  }
}