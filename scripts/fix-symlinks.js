#!/usr/bin/env node
/* global console */
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

import { Buffer } from 'buffer';
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
        const possiblePaths = [
          // Unix paths
          path.join(uvPythonDir, entry.name, 'bin', 'python3.10'),
          path.join(uvPythonDir, entry.name, 'bin', 'python'),
          path.join(uvPythonDir, entry.name, 'install', 'bin', 'python3.10'),
          path.join(uvPythonDir, entry.name, 'install', 'bin', 'python'),
          // Windows paths
          path.join(uvPythonDir, entry.name, 'Scripts', 'python.exe'),
          path.join(
            uvPythonDir,
            entry.name,
            'install',
            'Scripts',
            'python.exe'
          ),
          path.join(uvPythonDir, entry.name, 'python.exe'),
        ];

        for (const pythonPath of possiblePaths) {
          if (fs.existsSync(pythonPath)) {
            return {
              absolutePath: pythonPath,
              cpythonDir: entry.name,
              // Extract relative path from uv_python
              relativePath: path.relative(uvPythonDir, pythonPath),
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
  const scriptsDir = path.join(venvPath, 'Scripts');

  // Windows uses Scripts directory and doesn't need symlink fixes
  if (fs.existsSync(scriptsDir) && !fs.existsSync(binDir)) {
    console.log(`\n📝 Processing ${venvName}`);
    console.log(
      `   ℹ️  Windows venv detected - skipping symlink fixes (not needed)`
    );
    return true;
  }

  if (!fs.existsSync(binDir)) {
    console.log(`⚠️  ${venvName} bin directory not found: ${binDir}`);
    return false;
  }

  // Find Python in uv_python
  const uvPythonDir = path.join(
    projectRoot,
    'resources',
    'prebuilt',
    'uv_python'
  );
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

      if (
        fs.existsSync(symlinkPath) ||
        fs.lstatSync(symlinkPath).isSymbolicLink()
      ) {
        try {
          currentTarget = fs.readlinkSync(symlinkPath);

          // Check if it's a broken symlink or points to wrong location
          if (
            path.isAbsolute(currentTarget) ||
            currentTarget.includes('cache')
          ) {
            needsFix = true;
            console.log(
              `   ❌ ${symlinkName}: broken symlink -> ${currentTarget}`
            );
          } else {
            console.log(
              `   ✓  ${symlinkName}: already fixed -> ${currentTarget}`
            );
            continue;
          }
        } catch (err) {
          // Broken symlink
          needsFix = true;
          console.log(
            `   ❌ ${symlinkName}: broken symlink (target doesn't exist), ${err.message}`
          );
        }
      } else {
        needsFix = true;
        console.log(`   ➕ ${symlinkName}: missing, will create`);
      }

      if (needsFix) {
        // Remove existing symlink
        try {
          if (
            fs.existsSync(symlinkPath) ||
            fs.lstatSync(symlinkPath).isSymbolicLink()
          ) {
            fs.unlinkSync(symlinkPath);
          }
        } catch (err) {
          console.error(
            `   ❌ Failed to remove ${symlinkName}: ${err.message}`
          );
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
 * Fix shebang lines in all executable scripts in venv/bin directory
 * Note: Windows doesn't use shebangs - it uses .exe wrappers instead
 */
function fixScriptShebangs(venvPath, venvName) {
  const binDir = path.join(venvPath, 'bin');
  const scriptsDir = path.join(venvPath, 'Scripts');

  // Windows uses Scripts directory and doesn't need shebang fixes
  if (fs.existsSync(scriptsDir) && !fs.existsSync(binDir)) {
    console.log(`\n📝 Processing ${venvName}`);
    console.log(
      `   ℹ️  Windows venv detected - skipping shebang fixes (not needed)`
    );
    return { fixed: 0, skipped: 0 };
  }

  if (!fs.existsSync(binDir)) {
    console.log(`⚠️  ${venvName} bin directory not found: ${binDir}`);
    return { fixed: 0, skipped: 0 };
  }

  console.log(`\n📝 Fixing shebangs in ${venvName}/bin scripts`);

  let fixedCount = 0;
  let skippedCount = 0;

  try {
    const entries = fs.readdirSync(binDir);

    for (const entry of entries) {
      const filePath = path.join(binDir, entry);

      // Skip directories and symlinks
      try {
        const stat = fs.lstatSync(filePath);
        if (stat.isDirectory() || stat.isSymbolicLink()) {
          continue;
        }
      } catch (err) {
        console.error(`   ❌ Failed to check ${entry}: ${err.message}`);
        continue;
      }

      try {
        // Read first line to check for shebang
        const fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(512);
        const bytesRead = fs.readSync(fd, buffer, 0, 512, 0);
        fs.closeSync(fd);

        if (bytesRead === 0) continue;

        const content = buffer.toString('utf-8', 0, bytesRead);
        const firstLineEnd = content.indexOf('\n');
        if (firstLineEnd === -1) continue;

        const firstLine = content.substring(0, firstLineEnd);

        // Check if it's a Python shebang with absolute path
        if (!firstLine.startsWith('#!') || !firstLine.includes('python')) {
          continue;
        }

        // Check if it contains an absolute path to the venv
        // Support both Unix (/resources/prebuilt/venv/) and Windows (\resources\prebuilt\venv\ or \resources\prebuilt\Scripts\)
        const shebangPath = firstLine.substring(2).trim();
        const hasVenvPath =
          firstLine.includes('/resources/prebuilt/venv/') ||
          firstLine.includes('\\resources\\prebuilt\\venv\\') ||
          firstLine.includes('/resources/prebuilt/terminal_venv/') ||
          firstLine.includes('\\resources\\prebuilt\\terminal_venv\\') ||
          firstLine.includes('/resources/prebuilt/Scripts/') ||
          firstLine.includes('\\resources\\prebuilt\\Scripts\\');

        if (!path.isAbsolute(shebangPath) && !hasVenvPath) {
          skippedCount++;
          continue;
        }

        // Read full file content
        const fullContent = fs.readFileSync(filePath, 'utf-8');

        // Replace absolute shebang with placeholder
        // This will be replaced at runtime with actual venv path
        // Similar to how pyvenv.cfg is handled
        const newContent = fullContent.replace(
          /^#!.*python.*$/m,
          '#!{{PREBUILT_VENV_PYTHON}}'
        );

        if (newContent !== fullContent) {
          fs.writeFileSync(filePath, newContent, 'utf-8');
          // Preserve executable permissions
          fs.chmodSync(filePath, 0o755);
          fixedCount++;

          if (fixedCount <= 5) {
            // Only show first 5 for brevity
            console.log(`   ✅ Fixed: ${entry}`);
          }
        }
      } catch (err) {
        // Silently skip files that can't be processed
        console.error(`   ❌ Failed to process ${entry}: ${err.message}`);
        continue;
      }
    }

    if (fixedCount > 5) {
      console.log(`   ✅ ... and ${fixedCount - 5} more files`);
    }
    console.log(
      `   📊 Total: ${fixedCount} fixed, ${skippedCount} already correct`
    );
  } catch (error) {
    console.error(`❌ Error processing ${venvName}: ${error.message}`);
  }

  return { fixed: fixedCount, skipped: skippedCount };
}

/**
 * Main function
 */
function main() {
  console.log(
    '🔧 Fixing Python symlinks and placeholders in venv directories...'
  );
  console.log('==========================================================\n');

  const venvDirs = [
    {
      path: path.join(projectRoot, 'resources', 'prebuilt', 'venv'),
      name: 'backend venv',
    },
    {
      path: path.join(projectRoot, 'resources', 'prebuilt', 'terminal_venv'),
      name: 'terminal venv',
    },
  ];

  let symlinkSuccessCount = 0;
  let totalCount = 0;
  let totalShebangsFixed = 0;

  for (const { path: venvPath, name } of venvDirs) {
    if (fs.existsSync(venvPath)) {
      totalCount++;

      // Fix symlinks
      if (fixVenvSymlinks(venvPath, name)) {
        symlinkSuccessCount++;
      }

      // Fix shebangs in all scripts
      const { fixed } = fixScriptShebangs(venvPath, name);
      totalShebangsFixed += fixed;
    } else {
      console.log(`⚠️  ${name} directory not found: ${venvPath}`);
    }
  }

  console.log('\n==========================================================');
  if (totalCount === 0) {
    console.log(
      '⚠️  No venv directories found - this is OK for development builds'
    );
  } else {
    console.log(
      `✅ Fixed symlinks in ${symlinkSuccessCount}/${totalCount} venv(s)`
    );
    console.log(`✅ Fixed placeholders in ${totalShebangsFixed} script(s)`);
    console.log('✅ Venvs are now fully portable!');
  }
}

main();
