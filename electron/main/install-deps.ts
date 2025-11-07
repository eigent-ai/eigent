import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import log from 'electron-log'
import { getMainWindow } from './init'
import fs from 'node:fs'
import { getBackendPath, getBinaryPath, getCachePath, getVenvPath, cleanupOldVenvs, isBinaryExists, runInstallScript } from './utils/process'
import { spawn } from 'child_process'
import { safeMainWindowSend } from './utils/safeWebContentsSend'
import os from 'node:os'

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
      // Clean up cache in production environment BEFORE any checks
      // This ensures users always get fresh dependencies in production
      if (app.isPackaged) {
        log.info('[CACHE CLEANUP] Production environment detected, cleaning cache before dependency check...');
        cleanupCacheInProduction();
      }

      const versionExists:boolean = checkInstallOperations.getSavedVersion();

      // Check if command tools are installed
      const uvExists = await isBinaryExists('uv');
      const bunExists = await isBinaryExists('bun');
      const toolsMissing = !uvExists || !bunExists;

      // If version file does not exist or version does not match, reinstall dependencies
      // Or if command tools are missing, need to install them
      if (forceInstall || !versionExists || savedVersion !== currentVersion || toolsMissing) {
        if (toolsMissing) {
          log.info('[DEPS INSTALL] Command tools missing, starting installation...', {
            uvExists,
            bunExists
          });
        } else {
          log.info('[DEPS INSTALL] version changed, prepare to reinstall uv dependencies...', {
            currentVersion,
            savedVersion: versionExists ? savedVersion : 'none',
            reason: !versionExists ? 'version file not exist' : 'version not match'
          });
        }

        // Notify frontend to update
        checkInstallOperations.handleUpdateNotification(versionExists);

        // Install dependencies (version.txt will be updated AFTER successful install)
        const result = await installDependencies(currentVersion);
        if (!result.success) {
          log.error(' install dependencies failed');
          resolve({ message: `Install dependencies failed, msg ${result.message}`, success: false });
          return
        }

        // Update version file ONLY after successful installation
        checkInstallOperations.createVersionFile();

        resolve({ message: "Dependencies installed successfully after update", success: true });
        log.info('[DEPS INSTALL] install dependencies complete');
        return
      } else {
        log.info('[DEPS INSTALL] version not changed and tools installed, skip install dependencies', { currentVersion });
        resolve({ message: "Version not changed and tools installed, skipped installation", success: true });
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
  try {
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
          return { message: uvResult.message, success: false };
      }

      const bunResult = await ensureInstalled('bun', 'install-bun.js');
      if (!bunResult.success) {
          return { message: bunResult.message, success: false };
      }

      return { message: "Command tools installed successfully", success: true };
  } catch (error) {
      return { message: `Command tool installation failed: ${error}`, success: false };
  }
}

let uv_path:string;
const mainWindow = getMainWindow();
const backendPath = getBackendPath();

// Ensure backend directory exists
if (!fs.existsSync(backendPath)) {
  log.info(`Creating backend directory: ${backendPath}`);
  fs.mkdirSync(backendPath, { recursive: true });
}

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
  private version: string;

  constructor(extraArgs:string[], version: string) {
    console.log('start install dependencies', extraArgs, 'version:', version)
    const venvPath = getVenvPath(version);
    this.version = version;

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
            UV_PROJECT_ENVIRONMENT: venvPath,
        }
    })
  }

  /**Display filtered logs based on severity */
  displayFilteredLogs(data:String) {
      if (!data) return;      
      const msg = data.toString().trimEnd();
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

/**
 * Clean up cache directory
 * This ensures users get fresh dependencies
 * Note: Only call this in production environment (caller should check app.isPackaged)
 */
function cleanupCacheInProduction(): void {
  try {
    const cacheBaseDir = path.join(os.homedir(), '.eigent', 'cache');

    if (!fs.existsSync(cacheBaseDir)) {
      log.info('[CACHE CLEANUP] Cache directory does not exist, nothing to clean');
      return;
    }

    log.info('[CACHE CLEANUP] Cleaning cache directory:', cacheBaseDir);

    fs.rmSync(cacheBaseDir, { recursive: true, force: true });

    log.info('[CACHE CLEANUP] Cache directory cleaned successfully');

    fs.mkdirSync(cacheBaseDir, { recursive: true });
    log.info('[CACHE CLEANUP] Empty cache directory recreated');

  } catch (error) {
    log.error('[CACHE CLEANUP] Failed to clean cache directory:', error);
  }
}

const runInstall = (extraArgs: string[], version: string) => {
  const installLogs = new InstallLogs(extraArgs, version);
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

export async function installDependencies(version: string): Promise<PromiseReturnType> {
  uv_path = await getBinaryPath('uv');
  const venvPath = getVenvPath(version);

  const handleInstallOperations = {
    spawnBabel: (message:"mirror"|"main"="main") => {
      fs.writeFileSync(installedLockPath, '')
      log.info('[DEPS INSTALL] Script completed successfully')
      console.log(`Install Dependencies completed ${message} for version ${version}`)
      console.log(`Virtual environment path: ${venvPath}`)
      spawn(uv_path, ['run', 'task', 'babel'], {
        cwd: backendPath,
        env: {
          ...process.env,
          UV_PROJECT_ENVIRONMENT: venvPath,
        }
      })
    },
    notifyInstallDependenciesPage: ():boolean => {
      const success = safeMainWindowSend('install-dependencies-start');
      if (!success) {
        log.warn('[DEPS INSTALL] Main window not available, continuing installation without UI updates');
      }
      return success;
    },
    installHybridBrowserDependencies: async (): Promise<boolean> => {
      try {
        // Find the hybrid_browser_toolkit ts directory in the virtual environment
        // Need to determine the Python version to construct the correct path
        let sitePackagesPath: string | null = null;
        const libPath = path.join(venvPath, 'lib');

        // Try to find the site-packages directory (it varies by Python version)
        if (fs.existsSync(libPath)) {
          const libContents = fs.readdirSync(libPath);
          const pythonDir = libContents.find(name => name.startsWith('python'));
          if (pythonDir) {
            sitePackagesPath = path.join(libPath, pythonDir, 'site-packages');
          }
        }

        if (!sitePackagesPath || !fs.existsSync(sitePackagesPath)) {
          log.warn('[DEPS INSTALL] site-packages directory not found in venv, skipping npm install');
          return true; // Not an error if the venv structure is different
        }

        const toolkitPath = path.join(sitePackagesPath, 'camel', 'toolkits', 'hybrid_browser_toolkit', 'ts');

        if (!fs.existsSync(toolkitPath)) {
          log.warn('[DEPS INSTALL] hybrid_browser_toolkit ts directory not found at ' + toolkitPath + ', skipping npm install');
          return true; // Not an error if the toolkit isn't installed
        }

        // Check if npm dependencies are already installed
        const npmMarkerPath = path.join(toolkitPath, '.npm_dependencies_installed');
        const nodeModulesPath = path.join(toolkitPath, 'node_modules');
        const distPath = path.join(toolkitPath, 'dist');

        // Check if marker exists and verify version
        if (fs.existsSync(npmMarkerPath) && fs.existsSync(nodeModulesPath) && fs.existsSync(distPath)) {
          try {
            const markerContent = JSON.parse(fs.readFileSync(npmMarkerPath, 'utf-8'));
            if (markerContent.version === version) {
              log.info('[DEPS INSTALL] hybrid_browser_toolkit npm dependencies already installed for current version, skipping...');
              return true;
            } else {
              log.info('[DEPS INSTALL] npm dependencies installed for different version, will reinstall...');
              // Clean up old installation
              fs.unlinkSync(npmMarkerPath);
            }
          } catch (error) {
            log.warn('[DEPS INSTALL] Could not read npm marker file, will reinstall...', error);
            // If we can't read the marker, assume we need to reinstall
          }
        }

        log.info('[DEPS INSTALL] Installing hybrid_browser_toolkit npm dependencies...');
        safeMainWindowSend('install-dependencies-log', {
          type: 'stdout',
          data: 'Installing browser toolkit dependencies...\n'
        });

        // Try to find npm - first try system npm, then try uv run npm
        let npmCommand: string[];
        const testNpm = spawn('npm', ['--version'], { shell: true });
        const npmExists = await new Promise<boolean>(resolve => {
          testNpm.on('close', (code) => resolve(code === 0));
          testNpm.on('error', () => resolve(false));
        });

        if (npmExists) {
          // Use system npm directly
          npmCommand = ['npm'];
          log.info('[DEPS INSTALL] Using system npm for installation');
        } else {
          // Try uv run npm (might not work if nodejs-wheel isn't properly set up)
          npmCommand = [uv_path, 'run', 'npm'];
          log.info('[DEPS INSTALL] Attempting to use uv run npm');
        }

        // Run npm install
        const npmCacheDir = path.join(venvPath, '.npm-cache');
        if (!fs.existsSync(npmCacheDir)) {
          fs.mkdirSync(npmCacheDir, { recursive: true });
        }
        
        const npmInstall = spawn(npmCommand[0], [...npmCommand.slice(1), 'install'], {
          cwd: toolkitPath,
          env: {
            ...process.env,
            UV_PROJECT_ENVIRONMENT: venvPath,
            npm_config_cache: npmCacheDir,
          },
          shell: true // Important for Windows
        });

        await new Promise<void>((resolve, reject) => {
          if (npmInstall.stdout) {
            npmInstall.stdout.on('data', (data) => {
              log.info(`[DEPS INSTALL] npm install: ${data}`);
              safeMainWindowSend('install-dependencies-log', { type: 'stdout', data: data.toString() });
            });
          }

          if (npmInstall.stderr) {
            npmInstall.stderr.on('data', (data) => {
              log.warn(`[DEPS INSTALL] npm install stderr: ${data}`);
              safeMainWindowSend('install-dependencies-log', { type: 'stderr', data: data.toString() });
            });
          }

          npmInstall.on('close', (code) => {
            if (code === 0) {
              log.info('[DEPS INSTALL] npm install completed successfully');
              resolve();
            } else {
              log.error(`[DEPS INSTALL] npm install failed with code ${code}`);
              reject(new Error(`npm install failed with code ${code}`));
            }
          });

          npmInstall.on('error', (err) => {
            log.error(`[DEPS INSTALL] npm install process error: ${err}`);
            reject(err);
          });
        });

        // Run npm build (use the same npm command as install)
        log.info('[DEPS INSTALL] Building hybrid_browser_toolkit TypeScript...');
        safeMainWindowSend('install-dependencies-log', {
          type: 'stdout',
          data: 'Building browser toolkit TypeScript...\n'
        });

        const buildArgs = npmCommand[0] === 'npm' ? ['run', 'build'] : [...npmCommand.slice(1), 'run', 'build'];
        const npmBuild = spawn(npmCommand[0], buildArgs, {
          cwd: toolkitPath,
          env: {
            ...process.env,
            UV_PROJECT_ENVIRONMENT: venvPath,
            npm_config_cache: npmCacheDir,
          },
          shell: true // Important for Windows
        });

        await new Promise<void>((resolve, reject) => {
          if (npmBuild.stdout) {
            npmBuild.stdout.on('data', (data) => {
              log.info(`[DEPS INSTALL] npm build: ${data}`);
              safeMainWindowSend('install-dependencies-log', { type: 'stdout', data: data.toString() });
            });
          }

          if (npmBuild.stderr) {
            npmBuild.stderr.on('data', (data) => {
              // TypeScript build warnings are common, don't treat as errors
              log.info(`[DEPS INSTALL] npm build output: ${data}`);
              safeMainWindowSend('install-dependencies-log', { type: 'stdout', data: data.toString() });
            });
          }

          npmBuild.on('close', (code) => {
            if (code === 0) {
              log.info('[DEPS INSTALL] TypeScript build completed successfully');
              resolve();
            } else {
              log.error(`[DEPS INSTALL] TypeScript build failed with code ${code}`);
              reject(new Error(`TypeScript build failed with code ${code}`));
            }
          });

          npmBuild.on('error', (err) => {
            log.error(`[DEPS INSTALL] npm build process error: ${err}`);
            reject(err);
          });
        });

        // Optionally install Playwright browsers
        try {
          log.info('[DEPS INSTALL] Installing Playwright browsers...');
          const npxCommand = npmCommand[0] === 'npm' ? ['npx'] : [uv_path, 'run', 'npx'];
          const playwrightInstall = spawn(npxCommand[0], [...npxCommand.slice(1), 'playwright', 'install'], {
            cwd: toolkitPath,
            env: {
              ...process.env,
              UV_PROJECT_ENVIRONMENT: venvPath,
            },
            shell: true
          });

          await new Promise<void>((resolve) => {
            playwrightInstall.on('close', (code) => {
              if (code === 0) {
                log.info('[DEPS INSTALL] Playwright browsers installed successfully');
                // Create marker file
                const markerPath = path.join(toolkitPath, '.playwright_installed');
                fs.writeFileSync(markerPath, 'installed');
              } else {
                log.warn('[DEPS INSTALL] Playwright installation failed, but continuing anyway');
              }
              resolve();
            });

            playwrightInstall.on('error', (err) => {
              log.warn('[DEPS INSTALL] Playwright installation process error:', err);
              resolve(); // Non-critical, continue
            });
          });
        } catch (error) {
          log.warn('[DEPS INSTALL] Failed to install Playwright browsers:', error);
          // Non-critical, continue
        }

        // Create marker file to indicate npm dependencies are installed
        fs.writeFileSync(npmMarkerPath, JSON.stringify({
          installedAt: new Date().toISOString(),
          version: version
        }));
        log.info('[DEPS INSTALL] Created npm dependencies marker file');

        log.info('[DEPS INSTALL] hybrid_browser_toolkit dependencies installed successfully');
        return true;
      } catch (error) {
        log.error('[DEPS INSTALL] Failed to install hybrid_browser_toolkit dependencies:', error);
        // Don't fail the entire installation if this fails
        return false;
      }
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

    // Clean up npm dependencies marker when reinstalling Python deps
    // This ensures npm deps are reinstalled when Python environment changes
    try {
      let sitePackagesPath: string | null = null;
      const libPath = path.join(venvPath, 'lib');

      if (fs.existsSync(libPath)) {
        const libContents = fs.readdirSync(libPath);
        const pythonDir = libContents.find(name => name.startsWith('python'));
        if (pythonDir) {
          sitePackagesPath = path.join(libPath, pythonDir, 'site-packages');
        }
      }

      if (sitePackagesPath) {
        const npmMarkerPath = path.join(sitePackagesPath, 'camel', 'toolkits', 'hybrid_browser_toolkit', 'ts', '.npm_dependencies_installed');
        if (fs.existsSync(npmMarkerPath)) {
          fs.unlinkSync(npmMarkerPath);
          log.info('[DEPS INSTALL] Removed npm dependencies marker for fresh installation');
        }
      }
    } catch (error) {
      log.warn('[DEPS INSTALL] Could not clean npm marker file:', error);
      // Non-critical, continue
    }

    // try default install
    const installSuccess = await runInstall([], version)
    if (installSuccess.success) {
        // Install hybrid_browser_toolkit npm dependencies after Python packages are installed
        log.info('[DEPS INSTALL] Installing hybrid_browser_toolkit dependencies...')
        await handleInstallOperations.installHybridBrowserDependencies()

        handleInstallOperations.spawnBabel()

        // Clean up old venvs after successful installation
        log.info('[DEPS INSTALL] Cleaning up old virtual environments...')
        await cleanupOldVenvs(version)
        log.info('[DEPS INSTALL] Old venvs cleanup completed')

        resolve({ message: "Dependencies installed successfully", success: true })
        return
    }

    // try mirror install
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    let mirrorInstallSuccess: PromiseReturnType = { message: "", success: false }
    mirrorInstallSuccess = (timezone === 'Asia/Shanghai')? await runInstall(proxyArgs, version) :await runInstall([], version)

    if (mirrorInstallSuccess.success) {
        // Install hybrid_browser_toolkit npm dependencies after Python packages are installed
        log.info('[DEPS INSTALL] Installing hybrid_browser_toolkit dependencies...')
        await handleInstallOperations.installHybridBrowserDependencies()

        handleInstallOperations.spawnBabel("mirror")

        // Clean up old venvs after successful installation
        log.info('[DEPS INSTALL] Cleaning up old virtual environments...')
        await cleanupOldVenvs(version)
        log.info('[DEPS INSTALL] Old venvs cleanup completed')

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
  // CRITICAL FIX: Use file system to check if installation is complete
  // Don't rely on module variables as they can be reset during hot reload

  // Check if dependencies are already installed
  const isAlreadyInstalled = fs.existsSync(installedLockPath);

  // If installed lock file exists, dependencies are already installed
  // Skip all detection to avoid false positives
  if (isAlreadyInstalled) {
    // Dependencies are already installed, skip detection entirely
    return;
  }

  // Also skip if notification was already sent (in current session)
  if (installationNotificationSent) {
    return;
  }

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