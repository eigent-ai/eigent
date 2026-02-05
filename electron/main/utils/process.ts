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

import { spawn } from 'child_process';
import { app } from 'electron';
import log from 'electron-log';
import fs from 'fs';
import os from 'os';
import path from 'path';

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
 * Fix pyvenv.cfg by replacing placeholder with actual Python path
 * This makes prebuilt venvs portable across different machines
 */
function fixPyvenvCfgPlaceholder(pyvenvCfgPath: string): boolean {
  try {
    let content = fs.readFileSync(pyvenvCfgPath, 'utf-8');

    if (content.includes('{{PREBUILT_PYTHON_DIR}}')) {
      const prebuiltPythonDir = getPrebuiltPythonDir();
      if (!prebuiltPythonDir) {
        log.warn(
          '[VENV] Cannot fix pyvenv.cfg: prebuilt Python directory not found'
        );
        return false;
      }

      content = content.replace(
        /\{\{PREBUILT_PYTHON_DIR\}\}/g,
        prebuiltPythonDir
      );

      const homeMatch = content.match(/^home\s*=\s*(.+)$/m);
      if (homeMatch) {
        const finalHomePath = homeMatch[1].trim();
        log.info(`[VENV] pyvenv.cfg home path set to: ${finalHomePath}`);

        // Verify the path exists
        if (!fs.existsSync(finalHomePath)) {
          log.warn(
            `[VENV] WARNING: home path does not exist: ${finalHomePath}`
          );
        } else {
          log.info(`[VENV] home path verified successfully`);
        }
      }

      fs.writeFileSync(pyvenvCfgPath, content);
      log.info(
        `[VENV] Fixed pyvenv.cfg placeholder with: ${prebuiltPythonDir}`
      );
      return true;
    }

    const homeMatch = content.match(/^home\s*=\s*(.+)$/m);
    if (homeMatch) {
      const homePath = homeMatch[1].trim();
      if (!fs.existsSync(homePath)) {
        log.warn(`[VENV] pyvenv.cfg home path does not exist: ${homePath}`);
        return false;
      }
    }

    return true;
  } catch (error) {
    log.warn(`[VENV] Failed to fix pyvenv.cfg: ${error}`);
    return false;
  }
}

/**
 * Fix shebang lines in venv scripts by replacing placeholder with actual Python path
 * This ensures scripts can be executed directly (not just via `uv run`)
 * Note: Windows doesn't use shebangs - it uses .exe wrappers instead
 */
function fixVenvScriptShebangs(venvPath: string): boolean {
  const isWindows = process.platform === 'win32';

  // Windows doesn't use shebangs - skip this step
  if (isWindows) {
    log.info(`[VENV] Skipping shebang fixes on Windows (not needed)`);
    return true;
  }

  const binDir = path.join(venvPath, 'bin');

  if (!fs.existsSync(binDir)) {
    return false;
  }

  const pythonExe = path.join(binDir, 'python');

  if (!fs.existsSync(pythonExe)) {
    log.warn(`[VENV] Python executable not found: ${pythonExe}`);
    return false;
  }

  try {
    const entries = fs.readdirSync(binDir);
    let fixedCount = 0;

    for (const entry of entries) {
      const filePath = path.join(binDir, entry);

      try {
        const stat = fs.lstatSync(filePath);
        if (stat.isDirectory() || stat.isSymbolicLink()) {
          continue;
        }
        // Skip .exe files (binary), .dll, .pyd (compiled Python modules)
        if (
          entry.endsWith('.exe') ||
          entry.endsWith('.dll') ||
          entry.endsWith('.pyd') ||
          entry.startsWith('python') ||
          entry.startsWith('activate')
        ) {
          continue;
        }
      } catch {
        continue;
      }

      try {
        const content = fs.readFileSync(filePath, 'utf-8');

        // Check if file contains any placeholders
        const hasVenvPythonPlaceholder = content.includes(
          '{{PREBUILT_VENV_PYTHON}}'
        );
        const hasPythonDirPlaceholder = content.includes(
          '{{PREBUILT_PYTHON_DIR}}'
        );

        if (hasVenvPythonPlaceholder || hasPythonDirPlaceholder) {
          let newContent = content;
          if (hasVenvPythonPlaceholder) {
            newContent = newContent.replace(
              /\{\{PREBUILT_VENV_PYTHON\}\}/g,
              pythonExe
            );
          }
          if (hasPythonDirPlaceholder) {
            const prebuiltPythonDir = getPrebuiltPythonDir();
            if (prebuiltPythonDir) {
              newContent = newContent.replace(
                /\{\{PREBUILT_PYTHON_DIR\}\}/g,
                prebuiltPythonDir
              );
            }
          }

          if (newContent !== content) {
            fs.writeFileSync(filePath, newContent, 'utf-8');
            if (process.platform !== 'win32') {
              fs.chmodSync(filePath, 0o755);
            }
            fixedCount++;
          }
        }
      } catch {
        // Silently skip files that can't be processed
      }
    }

    if (fixedCount > 0) {
      log.info(`[VENV] Fixed shebangs in ${fixedCount} script(s)`);
    }
    return true;
  } catch (error) {
    log.warn(`[VENV] Failed to fix script shebangs: ${error}`);
    return false;
  }
}

/**
 * Get path to prebuilt venv (if available in packaged app)
 */
export function getPrebuiltVenvPath(): string | null {
  if (!app.isPackaged) {
    return null;
  }

  const prebuiltVenvPath = path.join(process.resourcesPath, 'prebuilt', 'venv');
  const pyvenvCfgPath = path.join(prebuiltVenvPath, 'pyvenv.cfg');

  log.info(`[VENV] Checking prebuilt venv at: ${prebuiltVenvPath}`);

  if (fs.existsSync(prebuiltVenvPath) && fs.existsSync(pyvenvCfgPath)) {
    fixPyvenvCfgPlaceholder(pyvenvCfgPath);
    fixVenvScriptShebangs(prebuiltVenvPath);

    const pythonExePath = getVenvPythonPath(prebuiltVenvPath);
    if (fs.existsSync(pythonExePath)) {
      log.info(`[VENV] Using prebuilt venv: ${prebuiltVenvPath}`);
      return prebuiltVenvPath;
    }
    log.warn(`[VENV] Prebuilt venv Python missing at: ${pythonExePath}`);
  }
  return null;
}

/**
 * Find Python executable in prebuilt Python directory for terminal venv
 */
function findPythonForTerminalVenv(): string | null {
  const prebuiltPythonDir = getPrebuiltPythonDir();
  if (!prebuiltPythonDir) {
    return null;
  }

  // Look for Python executable in the prebuilt directory
  // UV stores Python in subdirectories like: cpython-3.10.19+.../install/bin/python
  const possiblePaths: string[] = [];

  // First, try common direct paths
  possiblePaths.push(
    path.join(prebuiltPythonDir, 'install', 'bin', 'python'),
    path.join(prebuiltPythonDir, 'install', 'python.exe'),
    path.join(prebuiltPythonDir, 'bin', 'python'),
    path.join(prebuiltPythonDir, 'python.exe')
  );

  // Then, search in subdirectories (UV stores Python in versioned directories)
  try {
    if (fs.existsSync(prebuiltPythonDir)) {
      const entries = fs.readdirSync(prebuiltPythonDir, {
        withFileTypes: true,
      });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('cpython-')) {
          const subDir = path.join(prebuiltPythonDir, entry.name);
          possiblePaths.push(
            path.join(subDir, 'install', 'bin', 'python'),
            path.join(subDir, 'install', 'python.exe'),
            path.join(subDir, 'bin', 'python'),
            path.join(subDir, 'python.exe')
          );
        }
      }
    }
  } catch (error) {
    log.warn('[PROCESS] Error searching for prebuilt Python:', error);
  }

  for (const pythonPath of possiblePaths) {
    if (fs.existsSync(pythonPath)) {
      return pythonPath;
    }
  }

  return null;
}

/**
 * Get path to prebuilt terminal venv (if available in packaged app)
 */
export function getPrebuiltTerminalVenvPath(): string | null {
  if (!app.isPackaged) {
    return null;
  }

  const prebuiltTerminalVenvPath = path.join(
    process.resourcesPath,
    'prebuilt',
    'terminal_venv'
  );
  if (fs.existsSync(prebuiltTerminalVenvPath)) {
    const pyvenvCfgPath = path.join(prebuiltTerminalVenvPath, 'pyvenv.cfg');
    const installedMarker = path.join(
      prebuiltTerminalVenvPath,
      '.packages_installed'
    );
    if (fs.existsSync(pyvenvCfgPath) && fs.existsSync(installedMarker)) {
      fixPyvenvCfgPlaceholder(pyvenvCfgPath);
      fixVenvScriptShebangs(prebuiltTerminalVenvPath);

      const pythonExePath = getVenvPythonPath(prebuiltTerminalVenvPath);

      if (fs.existsSync(pythonExePath)) {
        log.info(
          `[VENV] Using prebuilt terminal venv: ${prebuiltTerminalVenvPath}`
        );
        return prebuiltTerminalVenvPath;
      }

      // Try to fix the missing Python executable by creating a symlink to prebuilt Python
      const prebuiltPython = findPythonForTerminalVenv();
      if (prebuiltPython && fs.existsSync(prebuiltPython)) {
        try {
          const binDir = path.join(
            prebuiltTerminalVenvPath,
            process.platform === 'win32' ? 'Scripts' : 'bin'
          );

          if (!fs.existsSync(binDir)) {
            fs.mkdirSync(binDir, { recursive: true });
          }

          if (fs.existsSync(pythonExePath)) {
            fs.unlinkSync(pythonExePath);
          }

          const relativePath = path.relative(binDir, prebuiltPython);
          fs.symlinkSync(relativePath, pythonExePath);
          log.info(
            `[VENV] Fixed terminal venv Python symlink: ${pythonExePath} -> ${prebuiltPython}`
          );
          return prebuiltTerminalVenvPath;
        } catch (error) {
          log.warn(
            `[VENV] Failed to fix terminal venv Python symlink: ${error}`
          );
        }
      }
      log.warn(
        `[VENV] Prebuilt terminal venv Python missing, falling back to user venv`
      );
    }
  }
  return null;
}

/**
 * Get the Python executable path from a venv directory.
 * Use this to directly invoke venv's python, avoiding uv/launcher placeholder issues.
 */
export function getVenvPythonPath(venvPath: string): string {
  const isWindows = process.platform === 'win32';
  return isWindows
    ? path.join(venvPath, 'Scripts', 'python.exe')
    : path.join(venvPath, 'bin', 'python');
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

/**
 * Packages to install in the terminal base venv.
 * These are commonly used packages for terminal tasks (data processing, visualization, etc.)
 * Keep this list minimal - users can install additional packages as needed.
 */
export const TERMINAL_BASE_PACKAGES = [
  'pandas',
  'numpy',
  'matplotlib',
  'requests',
  'openpyxl',
  'beautifulsoup4',
  'pillow',
];

/**
 * Get path to the terminal base venv.
 * This is a lightweight venv with common packages for terminal tasks,
 * separate from the backend venv.
 */
export function getTerminalVenvPath(version: string): string {
  // First check for prebuilt terminal venv in packaged app
  if (app.isPackaged) {
    const prebuiltTerminalVenv = getPrebuiltTerminalVenvPath();
    if (prebuiltTerminalVenv) {
      return prebuiltTerminalVenv;
    }
  }

  const venvDir = path.join(
    os.homedir(),
    '.eigent',
    'venvs',
    `terminal_base-${version}`
  );

  // Ensure venvs directory exists
  const venvsBaseDir = path.dirname(venvDir);
  if (!fs.existsSync(venvsBaseDir)) {
    fs.mkdirSync(venvsBaseDir, { recursive: true });
  }

  return venvDir;
}

export async function cleanupOldVenvs(currentVersion: string): Promise<void> {
  const venvsBaseDir = getVenvsBaseDir();

  // Check if venvs directory exists
  if (!fs.existsSync(venvsBaseDir)) {
    return;
  }

  // Patterns to match: backend-{version} and terminal_base-{version}
  const venvPatterns = [
    { prefix: 'backend-', regex: /^backend-(.+)$/ },
    { prefix: 'terminal_base-', regex: /^terminal_base-(.+)$/ },
  ];

  try {
    const entries = fs.readdirSync(venvsBaseDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      for (const pattern of venvPatterns) {
        if (entry.name.startsWith(pattern.prefix)) {
          const versionMatch = entry.name.match(pattern.regex);
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
          break; // Found matching pattern, no need to check others
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
 * Get path to prebuilt Python installation (if available in packaged app)
 */
export function getPrebuiltPythonDir(): string | null {
  if (!app.isPackaged) {
    return null;
  }

  const prebuiltPythonDir = path.join(
    process.resourcesPath,
    'prebuilt',
    'uv_python'
  );
  if (fs.existsSync(prebuiltPythonDir)) {
    log.info(`[VENV] Using prebuilt Python: ${prebuiltPythonDir}`);
    return prebuiltPythonDir;
  }

  return null;
}

/**
 * Get unified UV environment variables for consistent Python environment management.
 * This ensures both installation and runtime use the same paths.
 * @param version - The app version for venv path
 * @returns Environment variables for UV commands
 */
export function getUvEnv(version: string): Record<string, string> {
  // Use prebuilt Python if available (packaged app)
  const prebuiltPython = getPrebuiltPythonDir();
  const pythonInstallDir = prebuiltPython || getCachePath('uv_python');

  return {
    UV_PYTHON_INSTALL_DIR: pythonInstallDir,
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
