#!/usr/bin/env node
/* global console process */
/**
 * Test script to verify pyvenv.cfg fix works correctly
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

function testVenvFix() {
  console.log('🧪 Testing pyvenv.cfg fix...\n');

  const testCases = [
    {
      name: 'Backend venv',
      path: path.join(
        projectRoot,
        'resources',
        'prebuilt',
        'venv',
        'pyvenv.cfg'
      ),
    },
    {
      name: 'Terminal venv',
      path: path.join(
        projectRoot,
        'resources',
        'prebuilt',
        'terminal_venv',
        'pyvenv.cfg'
      ),
    },
  ];

  let allPassed = true;

  for (const testCase of testCases) {
    console.log(`Testing ${testCase.name}...`);

    if (!fs.existsSync(testCase.path)) {
      console.log(`  ⚠️  File not found: ${testCase.path}`);
      continue;
    }

    const content = fs.readFileSync(testCase.path, 'utf-8');
    const homeMatch = content.match(/^home\s*=\s*(.+)$/m);

    if (!homeMatch) {
      console.log(`  ❌ FAIL: No 'home' line found`);
      allPassed = false;
      continue;
    }

    const homePath = homeMatch[1].trim();

    // Check if placeholder is used
    if (homePath.includes('{{PREBUILT_PYTHON_DIR}}')) {
      console.log(`  ✅ PASS: Using placeholder correctly`);
      console.log(`     Home: ${homePath}`);

      // Verify placeholder format (accept both / and \ for cross-platform)
      const expectedPattern =
        /^\{\{PREBUILT_PYTHON_DIR\}\}[/\\]cpython-[\w.-]+[/\\](bin|Scripts)$/;
      if (expectedPattern.test(homePath)) {
        console.log(`  ✅ PASS: Placeholder format is correct`);
      } else {
        console.log(`  ⚠️  WARNING: Placeholder format might be incorrect`);
        console.log(
          `     Expected: {{PREBUILT_PYTHON_DIR}}/cpython-X.Y.Z-platform/bin (or \\ on Windows)`
        );
        console.log(`     Got: ${homePath}`);
      }
    } else {
      // Check if it's an absolute path (bad)
      if (path.isAbsolute(homePath)) {
        console.log(`  ❌ FAIL: Still using absolute path`);
        console.log(`     Path: ${homePath}`);
        console.log(`     This path won't work on user machines!`);
        allPassed = false;
      } else {
        console.log(`  ⚠️  WARNING: Using relative path: ${homePath}`);
      }
    }

    console.log();
  }

  console.log('='.repeat(50));
  if (allPassed) {
    console.log('✅ All tests passed! Venvs are portable.');
  } else {
    console.log('❌ Some tests failed. Please run: npm run fix-venv-paths');
    process.exit(1);
  }
}

testVenvFix();
