import { spawn } from 'child_process';
import log from 'electron-log';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { app } from 'electron';

export function getResourcePath() {
  return path.join(app.getAppPath(), 'resources');
}

export function getBackendPath() {
  if (app.isPackaged) {
    //  after packaging, backend is in extraResources
    return path.join(process.resourcesPath, 'backend');
  } else {
    // development environment
    return path.join(app.getAppPath(), 'backend');
  }
}

export function runInstallScript(scriptPath: string): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const installScriptPath = path.join(
      getResourcePath(),
      'scripts',
      scriptPath
    );
    log.info(`Running script at: ${installScriptPath}`);

    const nodeProcess = spawn(process.execPath, [installScriptPath], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });

    let stderrOutput = '';

    nodeProcess.stdout.on('data', (data) => {
      log.info(`Script output: ${data}`);
    });

    nodeProcess.stderr.on('data', (data) => {
      const errorMsg = data.toString();
      stderrOutput += errorMsg;
      log.error(`Script error: ${errorMsg}`);
    });

    nodeProcess.on('close', (code) => {
      if (code === 0) {
        log.info('Script completed successfully');
        resolve(true);
      } else {
        log.error(`Script exited with code ${code}`);
        const errorMessage =
          stderrOutput.trim() || `Script exited with code ${code}`;
        reject(new Error(errorMessage));
      }
    });
  });
}

export async function getBinaryName(name: string): Promise<string> {
  if (process.platform === 'win32') {
    return `${name}.exe`;
  }
  return name;
}

/**
 * Get path to prebuilt binary (if available in packaged app)
 */
export function getPrebuiltBinaryPath(name?: string): string | null {
  if (!app.isPackaged) {
    return null;
  }

  const prebuiltBinDir = path.join(process.resourcesPath, 'prebuilt', 'bin');
  if (!fs.existsSync(prebuiltBinDir)) {
    return null;
  }

  if (!name) {
    return prebuiltBinDir;
  }

  const binaryName = process.platform === 'win32' ? `${name}.exe` : name;
  const binaryPath = path.join(prebuiltBinDir, binaryName);
  return fs.existsSync(binaryPath) ? binaryPath : null;
}

export async function getBinaryPath(name?: string): Promise<string> {
  // First check for prebuilt binary in packaged app
  if (app.isPackaged) {
    const prebuiltPath = getPrebuiltBinaryPath(name);
    if (prebuiltPath) {
      log.info(`Using prebuilt binary: ${prebuiltPath}`);
      return prebuiltPath;
    }
  }

  const binariesDir = path.join(os.homedir(), '.eigent', 'bin');

  // Ensure .eigent/bin directory exists
  if (!fs.existsSync(binariesDir)) {
    fs.mkdirSync(binariesDir, { recursive: true });
  }

  if (!name) {
    return binariesDir;
  }

  const binaryName = await getBinaryName(name);
  return path.join(binariesDir, binaryName);
}

export function getCachePath(folder: string): string {
  // For packaged app, try to use prebuilt cache first
  if (app.isPackaged) {
    const prebuiltCachePath = path.join(
      process.resourcesPath,
      'prebuilt',
      'cache',
      folder
    );
    if (fs.existsSync(prebuiltCachePath)) {
      log.info(`Using prebuilt cache: ${prebuiltCachePath}`);
      return prebuiltCachePath;
    }
  }

  const cacheDir = path.join(os.homedir(), '.eigent', 'cache', folder);

  // Ensure cache directory exists
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  return cacheDir;
}

/**
 * Get path to prebuilt venv (if available in packaged app)
 * Attempts to fix Python symlinks if they are broken
 */
export function getPrebuiltVenvPath(): string | null {
  if (!app.isPackaged) {
    return null;
  }

  const prebuiltVenvPath = path.join(process.resourcesPath, 'prebuilt', 'venv');
  if (fs.existsSync(prebuiltVenvPath)) {
    const pyvenvCfg = path.join(prebuiltVenvPath, 'pyvenv.cfg');
    if (fs.existsSync(pyvenvCfg)) {
      // Verify Python executable exists (Windows: Scripts/python.exe, Unix: bin/python)
      const isWindows = process.platform === 'win32';
      const venvBinDir = isWindows
        ? path.join(prebuiltVenvPath, 'Scripts')
        : path.join(prebuiltVenvPath, 'bin');
      const pythonExePath = isWindows
        ? path.join(venvBinDir, 'python.exe')
        : path.join(venvBinDir, 'python');

      // Check if Python executable exists and is valid
      let pythonValid = false;
      if (fs.existsSync(pythonExePath)) {
        try {
          const stats = fs.lstatSync(pythonExePath);
          if (stats.isSymbolicLink()) {
            const target = fs.readlinkSync(pythonExePath);
            const resolvedPath = path.resolve(path.dirname(pythonExePath), target);
            pythonValid = fs.existsSync(resolvedPath);
          } else {
            pythonValid = true; // Regular file, assume valid
          }
        } catch (error) {
          pythonValid = false;
        }
      }

      if (pythonValid) {
        log.info(`Using prebuilt venv: ${prebuiltVenvPath}`);
        return prebuiltVenvPath;
      } else {
        // Try to fix the Python symlink before falling back
        log.warn(
          `Prebuilt venv found but Python executable missing or invalid at: ${pythonExePath}. ` +
            `Attempting to fix...`
        );

        const pythonCacheDir = path.join(process.resourcesPath, 'prebuilt', 'cache', 'uv_python');
        if (fs.existsSync(pythonCacheDir)) {
          try {
            const entries = fs.readdirSync(pythonCacheDir);
            const pythonDirs = entries
              .filter(name => name.startsWith('cpython-3.10'))
              .map(name => {
                const binDir = path.join(pythonCacheDir, name, 'bin');
                const pythonExe = isWindows
                  ? path.join(binDir, 'python.exe')
                  : path.join(binDir, 'python3.10');
                return { name, binDir, pythonExe };
              })
              .filter(({ pythonExe }) => fs.existsSync(pythonExe));

            if (pythonDirs.length > 0) {
              const { pythonExe } = pythonDirs[0];
              const relativePath = path.relative(venvBinDir, pythonExe);

              // Remove old symlink if exists
              if (fs.existsSync(pythonExePath)) {
                fs.unlinkSync(pythonExePath);
              }

              // Create new symlink
              fs.symlinkSync(relativePath, pythonExePath);
              log.info(`Fixed Python symlink: ${pythonExePath} -> ${relativePath}`);

              // On Unix, also fix python3 and python3.10
              if (!isWindows) {
                const python3Path = path.join(venvBinDir, 'python3');
                const python310Path = path.join(venvBinDir, 'python3.10');

                if (fs.existsSync(python3Path)) {
                  fs.unlinkSync(python3Path);
                }
                fs.symlinkSync('python', python3Path);

                if (fs.existsSync(python310Path)) {
                  fs.unlinkSync(python310Path);
                }
                fs.symlinkSync('python', python310Path);
              }

              log.info(`Using prebuilt venv (after fix): ${prebuiltVenvPath}`);
              return prebuiltVenvPath;
            } else {
              log.warn('No valid Python executable found in cache, falling back to user venv.');
            }
          } catch (error: any) {
            log.warn(`Failed to fix Python symlink: ${error?.message || String(error)}. Falling back to user venv.`);
          }
        } else {
          log.warn('Python cache directory not found, falling back to user venv.');
        }
      }
    }
  }
  return null;
}

export function getVenvPath(version: string): string {
  // First check for prebuilt venv in packaged app
  if (app.isPackaged) {
    const prebuiltVenv = getPrebuiltVenvPath();
    if (prebuiltVenv) {
      return prebuiltVenv;
    }
  }

  const venvDir = path.join(
    os.homedir(),
    '.eigent',
    'venvs',
    `backend-${version}`
  );

  // Ensure venvs directory exists (parent of the actual venv)
  const venvsBaseDir = path.dirname(venvDir);
  if (!fs.existsSync(venvsBaseDir)) {
    fs.mkdirSync(venvsBaseDir, { recursive: true });
  }

  return venvDir;
}

export function getVenvsBaseDir(): string {
  return path.join(os.homedir(), '.eigent', 'venvs');
}

export async function cleanupOldVenvs(currentVersion: string): Promise<void> {
  const venvsBaseDir = getVenvsBaseDir();

  // Check if venvs directory exists
  if (!fs.existsSync(venvsBaseDir)) {
    return;
  }

  try {
    const entries = fs.readdirSync(venvsBaseDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('backend-')) {
        const versionMatch = entry.name.match(/^backend-(.+)$/);
        if (versionMatch && versionMatch[1] !== currentVersion) {
          const oldVenvPath = path.join(venvsBaseDir, entry.name);
          console.log(`Cleaning up old venv: ${oldVenvPath}`);

          try {
            // Remove old venv directory recursively
            fs.rmSync(oldVenvPath, { recursive: true, force: true });
            console.log(`Successfully removed old venv: ${entry.name}`);
          } catch (err) {
            console.error(`Failed to remove old venv ${entry.name}:`, err);
          }
        }
      }
    }
  } catch (err) {
    console.error('Error during venv cleanup:', err);
  }
}

export async function isBinaryExists(name: string): Promise<boolean> {
  const cmd = await getBinaryPath(name);

  return fs.existsSync(cmd);
}

/**
 * Get unified UV environment variables for consistent Python environment management.
 * This ensures both installation and runtime use the same paths.
 * @param version - The app version for venv path
 * @returns Environment variables for UV commands
 */
export function getUvEnv(version: string): Record<string, string> {
  return {
    UV_PYTHON_INSTALL_DIR: getCachePath('uv_python'),
    UV_TOOL_DIR: getCachePath('uv_tool'),
    UV_PROJECT_ENVIRONMENT: getVenvPath(version),
    UV_HTTP_TIMEOUT: '300',
  };
}

export async function killProcessByName(name: string): Promise<void> {
  const platform = process.platform;
  try {
    if (platform === 'win32') {
      await new Promise<void>((resolve, reject) => {
        // /F = force, /IM = image name
        const cmd = spawn('taskkill', ['/F', '/IM', `${name}.exe`]);
        cmd.on('close', (code) => {
          // code 0 = success, code 128 = process not found (which is fine)
          if (code === 0 || code === 128) resolve();
          else reject(new Error(`taskkill exited with code ${code}`));
        });
        cmd.on('error', reject);
      });
    } else {
      await new Promise<void>((resolve, reject) => {
        const cmd = spawn('pkill', ['-9', name]);
        cmd.on('close', (code) => {
          // code 0 = success, code 1 = no process found (which is fine)
          if (code === 0 || code === 1) resolve();
          else reject(new Error(`pkill exited with code ${code}`));
        });
        cmd.on('error', reject);
      });
    }
  } catch (err) {
    // Ignore errors, just best effort
    log.warn(`Failed to kill process ${name}:`, err);
  }
}
