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

import { execSync, spawn } from 'child_process';
import { app } from 'electron';
import log from 'electron-log';
import fs from 'fs';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);

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
 * Get the actual Python interpreter path from venv's pyvenv.cfg (home points to Python's bin dir).
 * Used to fix shebangs when venv is in userData but Python is in app bundle.
 */
function getActualPythonPathFromPyvenvCfg(venvPath: string): string | null {
  const pyvenvCfgPath = path.join(venvPath, 'pyvenv.cfg');
  if (!fs.existsSync(pyvenvCfgPath)) return null;

  const content = fs.readFileSync(pyvenvCfgPath, 'utf-8');
  const homeMatch = content.match(/^home\s*=\s*(.+)$/m);
  if (!homeMatch) return null;

  const home = homeMatch[1].trim();
  if (!path.isAbsolute(home) || !fs.existsSync(home)) return null;

  // home is Python's bin dir; find python3.X or python3
  try {
    const entries = fs.readdirSync(home);
    const py = entries.find(
      (e) => e === 'python3' || (e.startsWith('python3.') && !e.endsWith('.py'))
    );
    if (py) {
      const fullPath = path.join(home, py);
      if (fs.existsSync(fullPath)) return fullPath;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Fix shebang lines in venv scripts by replacing placeholder or broken relative path with actual Python path.
 * The venv/bin/python script was previously skipped but must be fixed when venv is extracted to userData
 * (relative paths like ../../uv_python/... break because Python lives in the app bundle).
 */
function fixVenvScriptShebangs(venvPath: string): boolean {
  const isWindows = process.platform === 'win32';

  if (isWindows) {
    log.info(`[VENV] Skipping shebang fixes on Windows (not needed)`);
    return true;
  }

  const binDir = path.join(venvPath, 'bin');
  if (!fs.existsSync(binDir)) return false;

  const pythonExe = path.join(binDir, 'python');
  if (!fs.existsSync(pythonExe)) {
    log.warn(`[VENV] Python executable not found: ${pythonExe}`);
    return false;
  }

  const actualPythonPath =
    getActualPythonPathFromPyvenvCfg(venvPath) ?? findPythonForTerminalVenv();

  try {
    const entries = fs.readdirSync(binDir);
    let fixedCount = 0;

    for (const entry of entries) {
      const filePath = path.join(binDir, entry);

      try {
        const stat = fs.lstatSync(filePath);
        if (stat.isDirectory() || stat.isSymbolicLink()) continue;
        if (
          entry.endsWith('.exe') ||
          entry.endsWith('.dll') ||
          entry.endsWith('.pyd')
        ) {
          continue;
        }
        // Include python/activate scripts - they were previously skipped but need shebang fix
        // when venv is in userData with relative paths
      } catch {
        continue;
      }

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const firstLine = content.split('\n')[0];
        if (!firstLine?.startsWith('#!')) continue;

        const shebangPath = firstLine.slice(2).trim();
        let newContent = content;

        // Replace placeholders
        if (content.includes('{{PREBUILT_VENV_PYTHON}}')) {
          newContent = newContent.replace(
            /\{\{PREBUILT_VENV_PYTHON\}\}/g,
            actualPythonPath ?? pythonExe
          );
        }
        if (content.includes('{{PREBUILT_PYTHON_DIR}}')) {
          const prebuiltPythonDir = getPrebuiltPythonDir();
          if (prebuiltPythonDir) {
            newContent = newContent.replace(
              /\{\{PREBUILT_PYTHON_DIR\}\}/g,
              prebuiltPythonDir
            );
          }
        }

        if (actualPythonPath && shebangPath && !shebangPath.startsWith('{{')) {
          const resolved = path.resolve(path.dirname(filePath), shebangPath);
          if (!fs.existsSync(resolved)) {
            newContent = newContent.replace(/^#!.*$/m, `#!${actualPythonPath}`);
          }
        }

        if (newContent !== content) {
          fs.writeFileSync(filePath, newContent, 'utf-8');
          if (process.platform !== 'win32') {
            fs.chmodSync(filePath, 0o755);
          }
          fixedCount++;
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

const PREBUILT_VERSION_FILE = '.prebuilt_version';

/**
 * Extract venv.zip to userData (macOS: venv is zipped to fix EMFILE during signing).
 * Re-extracts when app version changes so we don't reuse stale venv from older releases.
 */
function extractVenvZipIfNeeded(venvZipPath: string): string | null {
  const userData = app.getPath('userData');
  const prebuiltDir = path.join(userData, 'prebuilt');
  const extractedVenvPath = path.join(prebuiltDir, 'venv');
  const pyvenvCfgPath = path.join(extractedVenvPath, 'pyvenv.cfg');
  const versionFile = path.join(prebuiltDir, PREBUILT_VERSION_FILE);
  const currentVersion = app.getVersion();

  if (fs.existsSync(pyvenvCfgPath)) {
    const storedVersion = fs.existsSync(versionFile)
      ? fs.readFileSync(versionFile, 'utf-8').trim()
      : null;
    if (storedVersion === currentVersion) {
      log.info(
        `[VENV] venv already extracted at ${extractedVenvPath}, using existing (v${currentVersion})`
      );
      fixExtractedVenvPermissions(extractedVenvPath);
      return extractedVenvPath;
    }
    log.info(
      `[VENV] Version changed (${storedVersion ?? 'unknown'} -> ${currentVersion}), re-extracting venv...`
    );
    try {
      fs.rmSync(extractedVenvPath, { recursive: true, force: true });
    } catch (e) {
      log.warn(`[VENV] Failed to remove old venv: ${e}`);
    }
  }

  log.info(`[VENV] Extracting venv.zip to ${extractedVenvPath}...`);
  const extractDir = path.dirname(extractedVenvPath);
  fs.mkdirSync(extractDir, { recursive: true });

  try {
    // Use native ditto on macOS - typically 2-5x faster than adm-zip for large zips
    if (process.platform === 'darwin') {
      execSync(`ditto -x -k --sequesterRsrc "${venvZipPath}" "${extractDir}"`, {
        stdio: 'ignore',
      });
    } else {
      const AdmZip = require('adm-zip');
      const zip = new AdmZip(venvZipPath);
      zip.extractAllTo(extractDir, true);
    }
    log.info(`[VENV] Extracted venv successfully`);

    // Fix executable permissions (ditto preserves them, adm-zip doesn't)
    fixExtractedVenvPermissions(extractedVenvPath);

    // Record version so we re-extract on upgrade
    fs.mkdirSync(prebuiltDir, { recursive: true });
    fs.writeFileSync(versionFile, currentVersion, 'utf-8');

    return extractedVenvPath;
  } catch (error) {
    log.error(`[VENV] Failed to extract venv.zip: ${error}`);
    return null;
  }
}

/**
 * Ensure venv/bin/python exists - create symlink if missing or broken.
 */
function ensureVenvPythonSymlink(venvPath: string): boolean {
  if (process.platform === 'win32') return true;

  const binDir = path.join(venvPath, 'bin');
  const pythonPath = path.join(binDir, 'python');
  if (!fs.existsSync(binDir)) return false;

  try {
    fs.accessSync(pythonPath, fs.constants.X_OK);
    return true;
  } catch {
    // python missing or broken symlink - create/fix below
    log.info(
      `[VENV] python not found or broken at ${pythonPath}, creating symlink...`
    );
  }

  const actualPython = getActualPythonPathFromPyvenvCfg(venvPath);
  if (!actualPython || !fs.existsSync(actualPython)) return false;

  // Find python3.X in venv/bin as fallback (e.g. python3.10)
  const entries = fs.readdirSync(binDir, { withFileTypes: true });
  const py3 = entries.find(
    (e) =>
      e.isFile() &&
      (e.name === 'python3' ||
        (e.name.startsWith('python3.') && !e.name.endsWith('.py')))
  );
  const targetInBin = py3 ? path.join(binDir, py3.name) : null;

  try {
    // Remove existing file/symlink (existsSync is false for broken symlinks, so use lstat)
    try {
      fs.lstatSync(pythonPath);
      fs.unlinkSync(pythonPath);
    } catch {
      // ENOENT = path doesn't exist, that's fine
    }
    // Prefer actual Python (app bundle); fallback to python3.X in same dir
    const target =
      actualPython ??
      (targetInBin && fs.existsSync(targetInBin) ? py3!.name : null);
    if (!target) return false;

    fs.symlinkSync(target, pythonPath);
    if (path.isAbsolute(target)) {
      fs.chmodSync(pythonPath, 0o755);
    }
    log.info(`[VENV] Created python symlink -> ${target}`);
    return true;
  } catch (error) {
    log.warn(`[VENV] Failed to create python symlink: ${error}`);
    return false;
  }
}

/**
 * Set executable permissions on venv bin files (adm-zip doesn't preserve them).
 * Also remove macOS quarantine attr which can cause "Permission denied".
 */
function fixExtractedVenvPermissions(venvPath: string): void {
  if (process.platform === 'win32') return;

  const binDir = path.join(venvPath, 'bin');
  if (!fs.existsSync(binDir)) return;

  try {
    const entries = fs.readdirSync(binDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(binDir, entry.name);
      if (entry.isFile()) {
        fs.chmodSync(fullPath, 0o755);
      }
    }
    log.info(
      `[VENV] Fixed executable permissions on ${entries.length} entries in bin/`
    );

    // Remove macOS quarantine - extracted files may be blocked from execution
    if (process.platform === 'darwin') {
      try {
        execSync(`xattr -cr "${venvPath}"`, { stdio: 'ignore' });
        log.info(`[VENV] Removed quarantine attributes`);
      } catch {
        // xattr may fail if not needed, ignore
      }
    }
  } catch (error) {
    log.warn(`[VENV] Failed to fix permissions: ${error}`);
  }
}

/**
 * Get path to prebuilt venv (if available in packaged app)
 * On macOS, venv is shipped as venv.zip to avoid EMFILE during code signing.
 */
export function getPrebuiltVenvPath(): string | null {
  if (!app.isPackaged) {
    return null;
  }

  const prebuiltDir = path.join(process.resourcesPath, 'prebuilt');
  const prebuiltVenvPath = path.join(prebuiltDir, 'venv');
  const venvZipPath = path.join(prebuiltDir, 'venv.zip');
  const pyvenvCfgPath = path.join(prebuiltVenvPath, 'pyvenv.cfg');

  log.info(`[VENV] Checking prebuilt venv at: ${prebuiltVenvPath}`);

  // Case 1: venv as directory (Windows, Linux - before-sign doesn't run there)
  if (fs.existsSync(prebuiltVenvPath) && fs.existsSync(pyvenvCfgPath)) {
    fixPyvenvCfgPlaceholder(pyvenvCfgPath);
    ensureVenvPythonSymlink(prebuiltVenvPath);
    fixVenvScriptShebangs(prebuiltVenvPath);

    const pythonExePath = getVenvPythonPath(prebuiltVenvPath);
    if (fs.existsSync(pythonExePath)) {
      log.info(`[VENV] Using prebuilt venv: ${prebuiltVenvPath}`);
      return prebuiltVenvPath;
    }
    log.warn(`[VENV] Prebuilt venv Python missing at: ${pythonExePath}`);
  }

  // Case 2: venv as zip (macOS - compressed in before-sign to fix EMFILE)
  if (fs.existsSync(venvZipPath)) {
    const extractedPath = extractVenvZipIfNeeded(venvZipPath);
    if (extractedPath) {
      fixPyvenvCfgPlaceholder(path.join(extractedPath, 'pyvenv.cfg'));
      ensureVenvPythonSymlink(extractedPath);
      fixVenvScriptShebangs(extractedPath);

      const pythonExePath = getVenvPythonPath(extractedPath);
      if (fs.existsSync(pythonExePath)) {
        log.info(`[VENV] Using extracted venv: ${extractedPath}`);
        return extractedPath;
      }
    }
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
  // UV stores Python in subdirectories like: cpython-3.11.x+.../install/bin/python
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

/**
 * Check venv existence for pre-check WITHOUT triggering extraction.
 * Used to avoid blocking app launch - extraction is deferred to startBackend when window is already visible.
 */
export function checkVenvExistsForPreCheck(version: string): {
  exists: boolean;
  path: string;
} {
  if (!app.isPackaged) {
    const venvDir = path.join(
      os.homedir(),
      '.eigent',
      'venvs',
      `backend-${version}`
    );
    const pyvenvCfg = path.join(venvDir, 'pyvenv.cfg');
    return {
      exists: fs.existsSync(pyvenvCfg),
      path: venvDir,
    };
  }

  const prebuiltDir = path.join(process.resourcesPath, 'prebuilt');
  const prebuiltVenvPath = path.join(prebuiltDir, 'venv');
  const venvZipPath = path.join(prebuiltDir, 'venv.zip');
  const prebuiltPyvenvCfg = path.join(prebuiltVenvPath, 'pyvenv.cfg');

  // Case 1: venv as directory (Windows, Linux)
  if (fs.existsSync(prebuiltVenvPath) && fs.existsSync(prebuiltPyvenvCfg)) {
    return { exists: true, path: prebuiltVenvPath };
  }

  // Case 2: venv as zip (macOS) - we have prebuilt, extract when needed; no extraction here
  if (fs.existsSync(venvZipPath)) {
    const userData = app.getPath('userData');
    const extractedPath = path.join(userData, 'prebuilt', 'venv');
    const extractedPyvenvCfg = path.join(extractedPath, 'pyvenv.cfg');
    // exists = already extracted OR we have venv.zip (will extract in startBackend)
    const exists =
      fs.existsSync(extractedPyvenvCfg) || fs.existsSync(venvZipPath);
    return { exists, path: extractedPath };
  }

  const venvDir = path.join(
    os.homedir(),
    '.eigent',
    'venvs',
    `backend-${version}`
  );
  const pyvenvCfg = path.join(venvDir, 'pyvenv.cfg');
  return {
    exists: fs.existsSync(pyvenvCfg),
    path: venvDir,
  };
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
