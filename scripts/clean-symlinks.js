#!/usr/bin/env node
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

/**
 * Clean invalid symbolic links before packaging
 * This script removes symbolic links that point outside the bundle
 * or to non-existent files, which can cause codesign to fail
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const VENV_DIR = path.join(projectRoot, 'resources', 'prebuilt', 'venv');

/**
 * Check if a symlink is valid (points to an existing file within the bundle)
 */
function isValidSymlink(symlinkPath, bundleRoot) {
  try {
    const stats = fs.lstatSync(symlinkPath);
    if (!stats.isSymbolicLink()) {
      return true; // Not a symlink, so it's valid
    }

    const target = fs.readlinkSync(symlinkPath);
    const resolvedPath = path.resolve(path.dirname(symlinkPath), target);
    const bundlePath = path.resolve(bundleRoot);

    // Check if target exists
    if (!fs.existsSync(resolvedPath)) {
      return false; // Target doesn't exist
    }

    // Check if target is within bundle
    if (!resolvedPath.startsWith(bundlePath)) {
      return false; // Target is outside bundle
    }

    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Fix Python symlinks in venv/bin (Unix) or venv/Scripts (Windows)
 * Remove symlinks that point outside the bundle (to cache directory)
 */
function fixPythonSymlinks(venvBinDir, bundleRoot) {
  if (!fs.existsSync(venvBinDir)) {
    return;
  }

  const bundlePath = path.resolve(bundleRoot);
  const isWindows = process.platform === 'win32';
  const pythonNames = isWindows
    ? ['python.exe', 'python3.exe', 'python3.10.exe', 'python3.11.exe', 'python3.12.exe']
    : ['python', 'python3', 'python3.10', 'python3.11', 'python3.12'];

  for (const pythonName of pythonNames) {
    const pythonSymlink = path.join(venvBinDir, pythonName);

    if (fs.existsSync(pythonSymlink)) {
      try {
        const stats = fs.lstatSync(pythonSymlink);
        if (stats.isSymbolicLink()) {
          const target = fs.readlinkSync(pythonSymlink);
          const resolvedPath = path.resolve(path.dirname(pythonSymlink), target);

          // If symlink points outside bundle (especially to cache), remove it
          if (!resolvedPath.startsWith(bundlePath)) {
            console.log(`Removing invalid ${pythonName} symlink pointing to: ${target}`);
            fs.unlinkSync(pythonSymlink);
          }
        }
      } catch (error) {
        console.warn(`Warning: Could not process ${pythonName} symlink: ${error.message}`);
      }
    }
  }
}

/**
 * Remove invalid symlinks recursively
 */
function cleanSymlinks(dir, bundleRoot, removed = []) {
  if (!fs.existsSync(dir)) {
    return removed;
  }

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      try {
        if (entry.isSymbolicLink()) {
          if (!isValidSymlink(fullPath, bundleRoot)) {
            console.log(`Removing invalid symlink: ${fullPath}`);
            fs.unlinkSync(fullPath);
            removed.push(fullPath);
          }
        } else if (entry.isDirectory()) {
          // Skip certain directories that might have many symlinks
          if (entry.name === 'node_modules' || entry.name === '__pycache__') {
            continue;
          }
          cleanSymlinks(fullPath, bundleRoot, removed);
        }
      } catch (error) {
        // Ignore errors for individual files
        console.warn(`Warning: Could not process ${fullPath}: ${error.message}`);
      }
    }
  } catch (error) {
    console.warn(`Warning: Could not read directory ${dir}: ${error.message}`);
  }

  return removed;
}

/**
 * Main function
 */
function main() {
  console.log('🧹 Cleaning invalid symbolic links...');

  const bundleRoot = path.join(projectRoot, 'resources', 'prebuilt');
  const isWindows = process.platform === 'win32';
  const venvBinDir = path.join(bundleRoot, 'venv', isWindows ? 'Scripts' : 'bin');

  // First, try to fix Python symlinks specifically
  if (fs.existsSync(venvBinDir)) {
    fixPythonSymlinks(venvBinDir, bundleRoot);
  }

  // Then clean all other invalid symlinks
  const removed = cleanSymlinks(bundleRoot, bundleRoot);

  if (removed.length > 0) {
    console.log(`✅ Removed ${removed.length} invalid symbolic link(s)`);
  } else {
    console.log('✅ No invalid symbolic links found');
  }
}

main();
