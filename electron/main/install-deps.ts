import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import log from 'electron-log'
import { getMainWindow } from './init'
import fs from 'node:fs'
import { getBackendPath, getBinaryPath, getCachePath, isBinaryExists, runInstallScript } from './utils/process'
import { spawn } from 'child_process'

const userData = app.getPath('userData');
const versionFile = path.join(userData, 'version.txt');

export type PromiseReturnType = {
  message: string;
  success: boolean;
}

// Read last run version and install dependencies on update
export async function checkAndInstallDepsOnUpdate(win:BrowserWindow): Promise<PromiseReturnType> {
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
        if (!result.success) {
          log.error(' install dependencies failed');
          resolve({ message: "Install dependencies failed", success: false });
          return
        }
        resolve({ message: "Dependencies installed successfully after update", success: true });
        log.info(' install dependencies complete');
        return
      } else {
        log.info(' version not changed, skip install dependencies', { currentVersion });
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

      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
          if (installed) {
              mainWindow.webContents.send('install-dependencies-log', {
                  type: 'stdout',
                  data: `${toolName} installed successfully`,
              });
          } else {
              mainWindow.webContents.send('install-dependencies-complete', {
                  success: false,
                  code: 2,
                  error: `${toolName} installation failed (script exit code 2)`,
              });
          }
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
  
  /**Handle stdout data */
  onStdout() { 
    this.node_process.stdout.on('data', (data:any) => {
        log.info(`Script output: ${data}`)
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('install-dependencies-log', { type: 'stdout', data: data.toString() });
        }
    })
  }

  /**Handle stderr data */
  onStderr() {
    this.node_process.stderr.on('data', (data:any) => {
        log.error(`Script error: ${data}`)
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('install-dependencies-log', { type: 'stderr', data: data.toString() });
        }
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
  const handleCompletion = {
    spawnBabel: (type:"mirror"|"main"="main") => {
      fs.writeFileSync(installedLockPath, '')
      log.info('Script completed successfully')
      console.log(`Install Dependencies completed ${type}`)
      spawn(uv_path, ['run', 'task', 'babel'], { cwd: backendPath })
    }
  }

  return new Promise<PromiseReturnType>(async (resolve, reject) => {
    console.log('start install dependencies')
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('install-dependencies-start');
    } else {
        resolve({ message: "Main window not available", success: false })
        return
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
        handleCompletion.spawnBabel()
        resolve({ message: "Dependencies installed successfully", success: true })
        return
    }

    // try mirror install
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    let mirrorInstallSuccess: PromiseReturnType = { message: "", success: false }
    mirrorInstallSuccess = (timezone === 'Asia/Shanghai')? await runInstall(proxyArgs) :await runInstall([])

    if (mirrorInstallSuccess.success) {
        handleCompletion.spawnBabel("mirror")
        resolve({ message: "Dependencies installed successfully with mirror", success: true })
    } else {
        log.error('Both default and mirror install failed')
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('install-dependencies-complete', { success: false, error: 'Both default and mirror install failed' });
        }
        resolve({ message: "Both default and mirror install failed", success: false })
    }
  })
}
