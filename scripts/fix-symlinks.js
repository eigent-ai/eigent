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
 * Fix Python symlinks in venv directories
 *
 * Problem:
 * - venv/bin/python is a symlink pointing to absolute path on build machine
 * - Example: /Users/builder/.../cache/uv_python/cpython-3.10.19-.../bin/python3.10
 * - Points to cache which is excluded by electron-builder
 * - Symlinks break on user machines
 *
 * Solution:
 * - Remove broken absolute symlinks
 * - Create relative symlinks pointing to uv_python directory
 * - Works on any machine after packaging
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

/**
 * Find Python executable in uv_python directory
 */
function findPythonExecutable(uvPythonDir) {
  if (!fs.existsSync(uvPythonDir)) {
    return null;
  }

  try {
    const entries = fs.readdirSync(uvPythonDir, { withFileTypes: true });

    // Find cpython directory
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('cpython-')) {
        // Try different possible paths
        const possiblePaths = [
          path.join(uvPythonDir, entry.name, 'bin', 'python3.10'),
          path.join(uvPythonDir, entry.name, 'bin', 'python'),
          path.join(uvPythonDir, entry.name, 'install', 'bin', 'python3.10'),
          path.join(uvPythonDir, entry.name, 'install', 'bin', 'python'),
        ];

        for (const pythonPath of possiblePaths) {
          if (fs.existsSync(pythonPath)) {
            return {
              absolutePath: pythonPath,
              cpythonDir: entry.name,
              // Extract relative path from uv_python
              relativePath: path.relative(uvPythonDir, pythonPath)
            };
          }
        }
      }
    }
  } catch (error) {
    console.error(`Error searching for Python: ${error.message}`);
  }

  return null;
}

/**
 * Fix Python symlinks in a venv
 */
function fixVenvSymlinks(venvPath, venvName) {
  const binDir = path.join(venvPath, 'bin');

  if (!fs.existsSync(binDir)) {
    console.log(`⚠️  ${venvName} bin directory not found: ${binDir}`);
    return false;
  }

  // Find Python in uv_python
  const uvPythonDir = path.join(projectRoot, 'resources', 'prebuilt', 'uv_python');
  const pythonInfo = findPythonExecutable(uvPythonDir);

  if (!pythonInfo) {
    console.log(`⚠️  No Python executable found in uv_python`);
    return false;
  }

  console.log(`\n📝 Processing ${venvName}`);
  console.log(`   Found Python: ${pythonInfo.cpythonDir}`);

  // Python symlink names to fix
  const symlinkNames = ['python', 'python3', 'python3.10'];
  let fixedCount = 0;

  for (const symlinkName of symlinkNames) {
    const symlinkPath = path.join(binDir, symlinkName);

    try {
      // Check if symlink exists
      let needsFix = false;
      let currentTarget = null;

      if (fs.existsSync(symlinkPath) || fs.lstatSync(symlinkPath).isSymbolicLink()) {
        try {
          currentTarget = fs.readlinkSync(symlinkPath);

          // Check if it's a broken symlink or points to wrong location
          if (path.isAbsolute(currentTarget) || currentTarget.includes('cache')) {
            needsFix = true;
            console.log(`   ❌ ${symlinkName}: broken symlink -> ${currentTarget}`);
          } else {
            console.log(`   ✓  ${symlinkName}: already fixed -> ${currentTarget}`);
            continue;
          }
        } catch (err) {
          // Broken symlink
          needsFix = true;
          console.log(`   ❌ ${symlinkName}: broken symlink (target doesn't exist)`);
        }
      } else {
        needsFix = true;
        console.log(`   ➕ ${symlinkName}: missing, will create`);
      }

      if (needsFix) {
        // Remove existing symlink
        try {
          if (fs.existsSync(symlinkPath) || fs.lstatSync(symlinkPath).isSymbolicLink()) {
            fs.unlinkSync(symlinkPath);
          }
        } catch (err) {
          // Ignore
        }

        // Calculate relative path from bin/ to the Python executable
        // Example: ../../uv_python/cpython-3.10.19-macos-aarch64-none/bin/python3.10
        const relativePath = path.relative(binDir, pythonInfo.absolutePath);

        // For secondary symlinks (python3, python3.10), just point to python
        let targetPath;
        if (symlinkName === 'python') {
          targetPath = relativePath;
        } else {
          targetPath = 'python';
        }

        // Create new relative symlink
        fs.symlinkSync(targetPath, symlinkPath);
        console.log(`   ✅ ${symlinkName} -> ${targetPath}`);
        fixedCount++;
      }
    } catch (error) {
      console.error(`   ❌ Failed to fix ${symlinkName}: ${error.message}`);
    }
  }

  return fixedCount > 0;
}

/**
 * Main function
 */
function main() {
  console.log('🔧 Fixing Python symlinks in venv directories...');
  console.log('================================================\n');

  const venvDirs = [
    {
      path: path.join(projectRoot, 'resources', 'prebuilt', 'venv'),
      name: 'backend venv'
    },
    {
      path: path.join(projectRoot, 'resources', 'prebuilt', 'terminal_venv'),
      name: 'terminal venv'
    }
  ];

  let successCount = 0;
  let totalCount = 0;

  for (const { path: venvPath, name } of venvDirs) {
    if (fs.existsSync(venvPath)) {
      totalCount++;
      if (fixVenvSymlinks(venvPath, name)) {
        successCount++;
      }
    } else {
      console.log(`⚠️  ${name} directory not found: ${venvPath}`);
    }
  }

  console.log('\n================================================');
  if (successCount > 0) {
    console.log(`✅ Fixed symlinks in ${successCount}/${totalCount} venv(s)`);
    console.log('✅ Python executables are now portable!');
  } else if (totalCount === 0) {
    console.log('⚠️  No venv directories found - this is OK for development builds');
  } else {
    console.log('ℹ️  All symlinks already correct, no changes needed');
  }
}

main();
