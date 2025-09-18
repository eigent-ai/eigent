import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import log from 'electron-log'
import { getMainWindow } from './init'
import fs from 'node:fs'
import { getBackendPath, getBinaryPath, getCachePath, isBinaryExists, runInstallScript } from './utils/process'

const userData = app.getPath('userData');
const versionFile = path.join(userData, 'version.txt');

// Read last run version and install dependencies on update
export async function checkAndInstallDepsOnUpdate(win:BrowserWindow): Promise<boolean> {
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

/**
 * Check if command line tools are installed, install if not
 */
export async function installCommandTool() {
  return new Promise(async (resolve, reject) => {
  const ensureInstalled = async (toolName: 'uv' | 'bun', scriptName: string): Promise<boolean> => {
      if (await isBinaryExists(toolName)) {
          return true;
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

      return installed;
      };

      if (!(await ensureInstalled('uv', 'install-uv.js'))) {
          return reject("uv install failed");
      }
      if (!(await ensureInstalled('bun', 'install-bun.js'))) {
          return reject("bun install failed");
      }

      return resolve(true);
  })
}

export async function installDependencies() {
  const { spawn } = await import('child_process');
  return new Promise<boolean>(async (resolve, reject) => {
  console.log('start install dependencies')

  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('install-dependencies-start');
  }

  const isInstalCommandTool = await installCommandTool()
  if (!isInstalCommandTool) {
      resolve(false)
      return
  }

  const uv_path = await getBinaryPath('uv')
  const backendPath = getBackendPath()

  if (!fs.existsSync(backendPath)) {
      fs.mkdirSync(backendPath, { recursive: true })
  }

  const installingLockPath = path.join(backendPath, 'uv_installing.lock')
  fs.writeFileSync(installingLockPath, '')

  const installedLockPath = path.join(backendPath, 'uv_installed.lock')
  // const proxyArgs = ['--default-index', 'https://pypi.tuna.tsinghua.edu.cn/simple']
  const proxyArgs = ['--default-index', 'https://mirrors.aliyun.com/pypi/simple/']
  const runInstall = (extraArgs: string[]) => {
      return new Promise<boolean>((resolveInner, rejectInner) => {
          try {
              const node_process = spawn(uv_path, [
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
              console.log('start install dependencies', extraArgs)
              node_process.stdout.on('data', (data) => {

                  log.info(`Script output: ${data}`)
                  if (mainWindow && !mainWindow.isDestroyed()) {
                      mainWindow.webContents.send('install-dependencies-log', { type: 'stdout', data: data.toString() });
                  }
              })

              node_process.stderr.on('data', (data) => {
                  log.error(`Script error: ${data}`)
                  if (mainWindow && !mainWindow.isDestroyed()) {
                      mainWindow.webContents.send('install-dependencies-log', { type: 'stderr', data: data.toString() });
                  }
              })

              node_process.on('close', (code) => {
                  console.log('install dependencies end', code === 0)
                  resolveInner(code === 0)
              })
          }catch(err) {
              log.error('run install failed', err)    
              // Clean up uv_installing.lock file if installation fails
              if (fs.existsSync(installingLockPath)) {
                  fs.unlinkSync(installingLockPath);
              }
              rejectInner(err)
          }
          
      })
  }

  // try default install
  const installSuccess = await runInstall([])

  if (installSuccess) {
      fs.unlinkSync(installingLockPath)
      fs.writeFileSync(installedLockPath, '')
      log.info('Script completed successfully')
      console.log('end install dependencies')
      spawn(uv_path, ['run', 'task', 'babel'], { cwd: backendPath })
      resolve(true)
      return
  }

  // try mirror install
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  let mirrorInstallSuccess = false

  if (timezone === 'Asia/Shanghai') {
      mirrorInstallSuccess = await runInstall(proxyArgs)
  } else {
      mirrorInstallSuccess = await runInstall([])
  }


  fs.existsSync(installingLockPath) && fs.unlinkSync(installingLockPath)

  if (mirrorInstallSuccess) {
      fs.writeFileSync(installedLockPath, '')
      log.info('Mirror script completed successfully')
      console.log('end install dependencies (mirror)')
      spawn(uv_path, ['run', 'task', 'babel'], { cwd: backendPath })
      resolve(true)
  } else {
      log.error('Both default and mirror install failed')
      if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('install-dependencies-complete', { success: false, error: 'Both default and mirror install failed' });
      }
      resolve(false)
  }
  })
}
