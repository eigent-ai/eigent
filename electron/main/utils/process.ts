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
const PREBUILT_FIXED_MARKER = '.prebuilt_fixed';

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

  // Find python3.X in venv/bin as fallback (e.g. python3.10)
  const entries = fs.readdirSync(binDir, { withFileTypes: true });
  const py3 = entries.find(
    (e) =>
      !e.isDirectory() &&
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

    // Prefer actual Python from pyvenv.cfg (absolute path to app bundle);
    // fallback to python3.X in same dir (relative symlink)
    let target: string | null = null;
    if (actualPython && fs.existsSync(actualPython)) {
      target = actualPython;
    } else if (targetInBin && fs.existsSync(targetInBin)) {
      // Use relative name for symlink within same directory
      target = py3!.name;
    }

    if (!target) {
      log.warn(`[VENV] No valid Python target found for symlink`);
      return false;
    }

    fs.symlinkSync(target, pythonPath);
    try {
      fs.chmodSync(pythonPath, 0o755);
    } catch {}
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
  const fixedMarkerPath = path.join(prebuiltDir, PREBUILT_FIXED_MARKER);
  const currentVersion = app.getVersion();

  // Case 1: venv as directory (Windows, Linux - before-sign doesn't run there)
  if (fs.existsSync(prebuiltVenvPath) && fs.existsSync(pyvenvCfgPath)) {
    // Check if already fixed for this version
    const needsFix =
      !fs.existsSync(fixedMarkerPath) ||
      fs.readFileSync(fixedMarkerPath, 'utf-8').trim() !== currentVersion;

    if (needsFix) {
      fixPyvenvCfgPlaceholder(pyvenvCfgPath);
      ensureVenvPythonSymlink(prebuiltVenvPath);
      fixVenvScriptShebangs(prebuiltVenvPath);
      fs.writeFileSync(fixedMarkerPath, currentVersion, 'utf-8');
    }

    const pythonExePath = getVenvPythonPath(prebuiltVenvPath);
    if (fs.existsSync(pythonExePath)) {
      return prebuiltVenvPath;
    }
    log.warn(`[VENV] Prebuilt venv Python missing at: ${pythonExePath}`);
  }

  // Case 2: venv as zip (macOS - compressed in before-sign to fix EMFILE)
  if (fs.existsSync(venvZipPath)) {
    const extractedPath = extractVenvZipIfNeeded(venvZipPath);
    if (extractedPath) {
      const extractedPyvenvCfg = path.join(extractedPath, 'pyvenv.cfg');
      const extractedFixedMarker = path.join(
        path.dirname(extractedPath),
        PREBUILT_FIXED_MARKER
      );

      // Check if already fixed for this version
      const needsFix =
        !fs.existsSync(extractedFixedMarker) ||
        fs.readFileSync(extractedFixedMarker, 'utf-8').trim() !==
          currentVersion;

      if (needsFix) {
        fixPyvenvCfgPlaceholder(extractedPyvenvCfg);
        ensureVenvPythonSymlink(extractedPath);
        fixVenvScriptShebangs(extractedPath);
        fs.writeFileSync(extractedFixedMarker, currentVersion, 'utf-8');
      }

      const pythonExePath = getVenvPythonPath(extractedPath);
      if (fs.existsSync(pythonExePath)) {
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

const TERMINAL_VENV_VERSION_FILE = '.terminal_venv_version';
const BACKEND_VENV_VERSION_FILE = '.backend_venv_version';

/**
 * Copy prebuilt backend venv to ~/.eigent/venvs/backend-{version} for unified management.
 * The copied venv is the one actually used by the backend (via getVenvPath()).
 * The source venv (prebuilt/extracted) is kept as-is for re-copying on version changes.
 *
 * @param version App version (used for version-specific venv directory)
 */
export function ensureBackendVenvAtUserPath(version: string): void {
  if (!app.isPackaged) return;

  const prebuiltDir = path.join(process.resourcesPath, 'prebuilt');
  const prebuiltVenvPath = path.join(prebuiltDir, 'venv');
  const venvZipPath = path.join(prebuiltDir, 'venv.zip');
  const prebuiltUvPython = path.join(prebuiltDir, 'uv_python');

  // Check if we have prebuilt venv (either directory or zip)
  let sourceVenvPath: string | null = null;

  if (
    fs.existsSync(prebuiltVenvPath) &&
    fs.existsSync(path.join(prebuiltVenvPath, 'pyvenv.cfg'))
  ) {
    sourceVenvPath = prebuiltVenvPath;
  } else if (fs.existsSync(venvZipPath)) {
    // For macOS venv.zip: use extractVenvZipIfNeeded (extracts to userData, avoids ditto permission issues)
    const extracted = extractVenvZipIfNeeded(venvZipPath);
    if (extracted) {
      sourceVenvPath = extracted;
    }
  }

  if (!sourceVenvPath) return;

  const userVenvsDir = path.join(os.homedir(), '.eigent', 'venvs');
  const userBackendVenv = path.join(userVenvsDir, `backend-${version}`);
  const pyvenvCfgPath = path.join(userBackendVenv, 'pyvenv.cfg');
  const versionFile = path.join(userVenvsDir, BACKEND_VENV_VERSION_FILE);

  // Ensure uv_python symlink exists (needed even if venv already copied)
  const userUvPython = path.join(os.homedir(), '.eigent', 'uv_python');
  if (!fs.existsSync(userUvPython) && fs.existsSync(prebuiltUvPython)) {
    try {
      fs.mkdirSync(path.dirname(userUvPython), { recursive: true });
      fs.symlinkSync(prebuiltUvPython, userUvPython);
      log.info(`[VENV] Created uv_python symlink: ${userUvPython}`);
    } catch (e) {
      log.warn(`[VENV] Failed to create uv_python symlink: ${e}`);
    }
  }

  if (fs.existsSync(pyvenvCfgPath)) {
    const storedVersion = fs.existsSync(versionFile)
      ? fs.readFileSync(versionFile, 'utf-8').trim()
      : null;
    if (storedVersion === version) {
      log.info(
        `[VENV] Backend venv already at ${userBackendVenv} (v${version})`
      );
      return;
    }
  }

  log.info(`[VENV] Copying prebuilt backend venv to ${userBackendVenv}...`);

  try {
    fs.mkdirSync(userVenvsDir, { recursive: true });

    if (fs.existsSync(userBackendVenv)) {
      fs.rmSync(userBackendVenv, { recursive: true, force: true });
    }

    // Copy from source (prebuilt dir or userData venv from extractVenvZipIfNeeded)
    if (!sourceVenvPath) {
      log.error(`[VENV] No source venv found to copy`);
      return;
    }
    fs.cpSync(sourceVenvPath, userBackendVenv, {
      recursive: true,
      verbatimSymlinks: true,
    });

    // Fix paths after copying (source venv paths don't match user venv location)
    // - pyvenv.cfg: update home path to point to correct Python location
    // - shebangs: update #! paths in bin/* scripts to point to correct Python
    // - python symlink: ensure bin/python exists and points to correct Python
    fixPyvenvCfgPlaceholder(pyvenvCfgPath);
    fixVenvScriptShebangs(userBackendVenv);
    ensureVenvPythonSymlink(userBackendVenv);

    if (process.platform === 'darwin') {
      try {
        execSync(`xattr -cr "${userBackendVenv}"`, { stdio: 'ignore' });
      } catch {
        // ignore
      }
    }

    fs.writeFileSync(versionFile, version, 'utf-8');
    log.info(`[VENV] Backend venv copied successfully`);
  } catch (error) {
    log.error(`[VENV] Failed to copy backend venv: ${error}`);
  }
}

/**
 * Copy prebuilt terminal venv to ~/.eigent/venvs/terminal_base-{version}.
 * @param version App version (used for version-specific venv directory)
 */
export function ensureTerminalVenvAtUserPath(version: string): void {
  if (!app.isPackaged) return;

  const prebuiltDir = path.join(process.resourcesPath, 'prebuilt');
  const prebuiltTerminalVenv = path.join(prebuiltDir, 'terminal_venv');
  const prebuiltUvPython = path.join(prebuiltDir, 'uv_python');

  if (!fs.existsSync(prebuiltTerminalVenv)) return;
  const installedMarker = path.join(
    prebuiltTerminalVenv,
    '.packages_installed'
  );
  if (!fs.existsSync(installedMarker)) return;

  const userVenvsDir = path.join(os.homedir(), '.eigent', 'venvs');
  const userTerminalVenv = path.join(userVenvsDir, `terminal_base-${version}`);
  const userVenvMarker = path.join(userTerminalVenv, '.packages_installed');
  const versionFile = path.join(userVenvsDir, TERMINAL_VENV_VERSION_FILE);

  // Ensure uv_python symlink exists (needed even if venv already copied)
  const userUvPython = path.join(os.homedir(), '.eigent', 'uv_python');
  if (!fs.existsSync(userUvPython) && fs.existsSync(prebuiltUvPython)) {
    try {
      fs.mkdirSync(path.dirname(userUvPython), { recursive: true });
      fs.symlinkSync(prebuiltUvPython, userUvPython);
      log.info(`[VENV] Created uv_python symlink: ${userUvPython}`);
    } catch (e) {
      log.warn(`[VENV] Failed to create uv_python symlink: ${e}`);
    }
  }

  if (fs.existsSync(userVenvMarker)) {
    const storedVersion = fs.existsSync(versionFile)
      ? fs.readFileSync(versionFile, 'utf-8').trim()
      : null;
    if (storedVersion === version) {
      log.info(
        `[VENV] Terminal venv already at ${userTerminalVenv} (v${version})`
      );
      return;
    }
  }

  log.info(`[VENV] Copying prebuilt terminal venv to ${userTerminalVenv}...`);

  try {
    fs.mkdirSync(userVenvsDir, { recursive: true });

    if (fs.existsSync(userTerminalVenv)) {
      fs.rmSync(userTerminalVenv, { recursive: true, force: true });
    }

    fs.cpSync(prebuiltTerminalVenv, userTerminalVenv, {
      recursive: true,
      verbatimSymlinks: true,
    });

    // Fix paths after copying (source venv paths don't match user venv location)
    // - pyvenv.cfg: update home path to point to correct Python location
    // - shebangs: update #! paths in bin/* scripts to point to correct Python
    // - python symlink: ensure bin/python exists and points to correct Python
    fixPyvenvCfgPlaceholder(path.join(userTerminalVenv, 'pyvenv.cfg'));
    fixVenvScriptShebangs(userTerminalVenv);
    ensureVenvPythonSymlink(userTerminalVenv);

    if (process.platform === 'darwin') {
      try {
        execSync(`xattr -cr "${userTerminalVenv}"`, { stdio: 'ignore' });
      } catch {
        // ignore
      }
    }

    fs.writeFileSync(versionFile, version, 'utf-8');
    log.info(`[VENV] Terminal venv copied successfully`);
  } catch (error) {
    log.error(`[VENV] Failed to copy terminal venv: ${error}`);
  }
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
  if (!fs.existsSync(prebuiltTerminalVenvPath)) {
    return null;
  }

  const pyvenvCfgPath = path.join(prebuiltTerminalVenvPath, 'pyvenv.cfg');
  const installedMarker = path.join(
    prebuiltTerminalVenvPath,
    '.packages_installed'
  );
  if (!fs.existsSync(pyvenvCfgPath) || !fs.existsSync(installedMarker)) {
    return null;
  }

  // Check if already fixed for this version (avoid repeated fixes)
  const fixedMarkerPath = path.join(
    process.resourcesPath,
    'prebuilt',
    '.terminal_venv_fixed'
  );
  const currentVersion = app.getVersion();
  const needsFix =
    !fs.existsSync(fixedMarkerPath) ||
    fs.readFileSync(fixedMarkerPath, 'utf-8').trim() !== currentVersion;

  if (needsFix) {
    fixPyvenvCfgPlaceholder(pyvenvCfgPath);
    fixVenvScriptShebangs(prebuiltTerminalVenvPath);
    fs.writeFileSync(fixedMarkerPath, currentVersion, 'utf-8');
  }

  const pythonExePath = getVenvPythonPath(prebuiltTerminalVenvPath);

  if (fs.existsSync(pythonExePath)) {
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
      log.warn(`[VENV] Failed to fix terminal venv Python symlink: ${error}`);
    }
  }

  log.warn(
    `[VENV] Prebuilt terminal venv Python missing, falling back to user venv`
  );
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

/**
 * Get path to backend venv for the given version.
 * @param version App version
 * @returns Path to backend venv
 */
export function getVenvPath(version: string): string {
  // For packaged apps, ensure venv is copied to ~/.eigent/venvs first
  if (app.isPackaged) {
    ensureBackendVenvAtUserPath(version);

    // Check if user venv exists (after ensuring copy)
    const userVenvDir = path.join(
      os.homedir(),
      '.eigent',
      'venvs',
      `backend-${version}`
    );
    const pyvenvCfgPath = path.join(userVenvDir, 'pyvenv.cfg');
    if (fs.existsSync(pyvenvCfgPath)) {
      return userVenvDir;
    }

    // Fallback to prebuilt venv if copy failed (shouldn't happen normally)
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

/**
 * Create npm/npx wrapper scripts that use nodejs_wheel Python API.
 * The bin/npm from nodejs_wheel can fail with "Cannot find module '../lib/cli.js'"
 * when invoked directly. Using the Python API avoids this.
 */
export function ensureNpmWrappersForBrowserToolkit(
  venvPath: string
): string | null {
  const pythonPath = getVenvPythonPath(venvPath);
  if (!fs.existsSync(pythonPath)) return null;

  const eigentBinDir = path.join(os.homedir(), '.eigent', 'bin');
  fs.mkdirSync(eigentBinDir, { recursive: true });

  const wrapperVersion = '1';
  const versionFile = path.join(eigentBinDir, '.npm_wrapper_version');
  const storedVersion = fs.existsSync(versionFile)
    ? fs.readFileSync(versionFile, 'utf-8').trim()
    : '';

  const npmWrapper = path.join(
    eigentBinDir,
    process.platform === 'win32' ? 'npm.cmd' : 'npm'
  );
  const npxWrapper = path.join(
    eigentBinDir,
    process.platform === 'win32' ? 'npx.cmd' : 'npx'
  );

  const needsUpdate =
    storedVersion !== wrapperVersion ||
    !fs.existsSync(npmWrapper) ||
    !fs.existsSync(npxWrapper);

  if (needsUpdate) {
    try {
      if (process.platform === 'win32') {
        const npmContent = `@echo off
"${pythonPath.replace(/\//g, '\\')}" -c "import sys; from nodejs_wheel import npm; sys.exit(npm(sys.argv[1:]))" %*
`;
        const npxContent = `@echo off
"${pythonPath.replace(/\//g, '\\')}" -c "import sys; from nodejs_wheel import npx; sys.exit(npx(sys.argv[1:]))" %*
`;
        fs.writeFileSync(npmWrapper, npmContent, 'utf-8');
        fs.writeFileSync(npxWrapper, npxContent, 'utf-8');
      } else {
        const shebang = `#!${pythonPath}\n`;
        const npmContent =
          shebang +
          `import sys
from nodejs_wheel import npm
sys.exit(npm(sys.argv[1:]))
`;
        const npxContent =
          shebang +
          `import sys
from nodejs_wheel import npx
sys.exit(npx(sys.argv[1:]))
`;
        fs.writeFileSync(npmWrapper, npmContent, 'utf-8');
        fs.writeFileSync(npxWrapper, npxContent, 'utf-8');
        fs.chmodSync(npmWrapper, 0o755);
        fs.chmodSync(npxWrapper, 0o755);
      }
      fs.writeFileSync(versionFile, wrapperVersion, 'utf-8');
      log.info(`[VENV] Created npm/npx wrappers at ${eigentBinDir}`);
    } catch (error) {
      log.warn(`[VENV] Failed to create npm wrappers: ${error}`);
      return null;
    }
  }

  return eigentBinDir;
}

/**
 * Find nodejs-wheel npm path in venv for browser toolkit.
 * Prefer Python API wrappers over direct bin (which can fail with cli.js error).
 */
export function findNodejsWheelNpmPath(venvPath: string): string | null {
  // Prefer wrapper scripts that use Python API (avoids bin/npm "../lib/cli.js" error)
  const wrapperDir = ensureNpmWrappersForBrowserToolkit(venvPath);
  if (wrapperDir) {
    const npmWrapper = path.join(
      wrapperDir,
      process.platform === 'win32' ? 'npm.cmd' : 'npm'
    );
    const npxWrapper = path.join(
      wrapperDir,
      process.platform === 'win32' ? 'npx.cmd' : 'npx'
    );
    if (fs.existsSync(npmWrapper) && fs.existsSync(npxWrapper)) {
      return wrapperDir;
    }
  }

  // Fallback to nodejs_wheel/bin (may fail with cli.js error)
  return findNodejsWheelBinPath(venvPath);
}

/**
 * Find nodejs_wheel/bin directory for the node executable.
 * Browser toolkit needs node in PATH (npm/npx use our wrappers from ~/.eigent/bin).
 */
export function findNodejsWheelBinPath(venvPath: string): string | null {
  try {
    const libPath = path.join(venvPath, 'lib');
    if (!fs.existsSync(libPath)) return null;

    const pythonDirs = fs
      .readdirSync(libPath)
      .filter((n) => n.startsWith('python'));
    if (pythonDirs.length === 0) return null;

    for (const pythonDir of pythonDirs) {
      const sitePackages = path.join(libPath, pythonDir, 'site-packages');
      const nodejsWheelBin = path.join(sitePackages, 'nodejs_wheel', 'bin');
      const nodePath = path.join(
        nodejsWheelBin,
        process.platform === 'win32' ? 'node.exe' : 'node'
      );

      if (fs.existsSync(nodePath)) {
        return nodejsWheelBin;
      }
    }
  } catch {
    // ignore
  }
  return null;
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
