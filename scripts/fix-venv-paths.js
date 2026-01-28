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
 * Fix pyvenv.cfg paths before packaging
 *
 * Problem:
 * - pyvenv.cfg contains absolute paths from the build machine
 * - Example: home = /Users/builder/project/resources/prebuilt/cache/uv_python/cpython-3.10.19-macos-aarch64-none/bin
 * - These paths don't exist on user machines, causing venv to fail
 *
 * Solution:
 * - Replace absolute paths with placeholder tokens
 * - At runtime, replace tokens with actual paths on user's machine
 * - This makes prebuilt venvs portable across different machines
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

/**
 * Fix pyvenv.cfg in a venv directory
 */
function fixPyvenvCfg(venvPath, venvName) {
  const pyvenvCfgPath = path.join(venvPath, 'pyvenv.cfg');

  if (!fs.existsSync(pyvenvCfgPath)) {
    console.log(`⚠️  pyvenv.cfg not found: ${pyvenvCfgPath}`);
    return false;
  }

  try {
    let content = fs.readFileSync(pyvenvCfgPath, 'utf-8');
    const originalContent = content;

    // Extract the home path
    const homeMatch = content.match(/^home\s*=\s*(.+)$/m);
    if (!homeMatch) {
      console.log(`⚠️  No 'home' line found in ${venvName}/pyvenv.cfg`);
      return false;
    }

    const originalHome = homeMatch[1].trim();
    console.log(`\n📝 Processing ${venvName}/pyvenv.cfg`);
    console.log(`   Original home: ${originalHome}`);

    // Extract cpython directory name from the path
    // Example: /path/to/cpython-3.10.19-macos-aarch64-none/bin -> cpython-3.10.19-macos-aarch64-none
    const cpythonMatch = originalHome.match(/(cpython-[\w\.\-]+)/);
    if (!cpythonMatch) {
      console.log(`⚠️  Could not extract cpython directory from: ${originalHome}`);
      return false;
    }

    const cpythonDir = cpythonMatch[1];

    // Determine if this is Windows or Unix path
    const isWindowsPath = originalHome.includes('\\') || originalHome.includes('Scripts');
    const binDir = isWindowsPath ? 'Scripts' : 'bin';

    // Replace with placeholder that will be substituted at runtime
    // {{PREBUILT_PYTHON_DIR}} will be replaced with the actual path on user's machine
    // Use appropriate path separator for the platform
    const pathSep = isWindowsPath ? '\\' : '/';
    const newHome = `{{PREBUILT_PYTHON_DIR}}${pathSep}${cpythonDir}${pathSep}${binDir}`;
    content = content.replace(/^home\s*=\s*.+$/m, `home = ${newHome}`);

    // Only write if content changed
    if (content !== originalContent) {
      fs.writeFileSync(pyvenvCfgPath, content);
      console.log(`   ✅ Updated to: ${newHome}`);
      console.log(`   🔧 Runtime will replace {{PREBUILT_PYTHON_DIR}} with actual path`);
      return true;
    } else {
      console.log(`   ℹ️  Already using placeholder, no change needed`);
      return true;
    }
  } catch (error) {
    console.error(`❌ Error processing ${venvName}/pyvenv.cfg:`, error.message);
    return false;
  }
}

/**
 * Main function
 */
function main() {
  console.log('🔧 Fixing pyvenv.cfg paths for portable venvs...');
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
      if (fixPyvenvCfg(venvPath, name)) {
        successCount++;
      }
    } else {
      console.log(`⚠️  ${name} directory not found: ${venvPath}`);
    }
  }

  console.log('\n================================================');
  if (successCount === totalCount && totalCount > 0) {
    console.log(`✅ Successfully fixed ${successCount}/${totalCount} pyvenv.cfg files`);
    console.log('✅ Venvs are now portable and will work on user machines!');
  } else if (totalCount === 0) {
    console.log('⚠️  No venv directories found - this is OK for development builds');
  } else {
    console.log(`⚠️  Fixed ${successCount}/${totalCount} pyvenv.cfg files`);
    process.exit(1);
  }
}

main();
