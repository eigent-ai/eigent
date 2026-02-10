#!/usr/bin/env node
/* global console process */
/**
 * Comprehensive test for prebuilt dependencies
 * Verifies pyvenv.cfg and Python symlinks are correct
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

let testsPassed = 0;
let testsFailed = 0;

function pass(message) {
  console.log(`  ✅ ${message}`);
  testsPassed++;
}

function fail(message) {
  console.log(`  ❌ ${message}`);
  testsFailed++;
}

function warn(message) {
  console.log(`  ⚠️  ${message}`);
}

function testPyvenvCfg(venvPath, venvName) {
  console.log(`\n📝 Testing ${venvName} pyvenv.cfg`);

  const pyvenvCfgPath = path.join(venvPath, 'pyvenv.cfg');

  if (!fs.existsSync(pyvenvCfgPath)) {
    fail('pyvenv.cfg not found');
    return;
  }

  const content = fs.readFileSync(pyvenvCfgPath, 'utf-8');
  const homeMatch = content.match(/^home\s*=\s*(.+)$/m);

  if (!homeMatch) {
    fail('No home line found in pyvenv.cfg');
    return;
  }

  const homePath = homeMatch[1].trim();

  // Check if using placeholder (build-time state)
  if (homePath.includes('{{PREBUILT_PYTHON_DIR}}')) {
    pass('Using placeholder (ready for packaging)');
    pass(`Home: ${homePath}`);
  }
  // Check if using absolute path (should be fixed)
  else if (path.isAbsolute(homePath)) {
    // Check if it's a valid path on this machine
    if (fs.existsSync(homePath)) {
      pass('Using absolute path (runtime-fixed or local)');
      pass(`Home: ${homePath}`);
    } else {
      fail('Using absolute path that does not exist!');
      fail(`Path: ${homePath}`);
      warn('Run: npm run fix-venv-paths');
    }
  }
  // Relative path
  else {
    warn(`Using relative path: ${homePath}`);
  }
}

function testPythonSymlinks(venvPath, venvName) {
  console.log(`\n🔗 Testing ${venvName} Python symlinks`);

  const binDir = path.join(venvPath, 'bin');

  if (!fs.existsSync(binDir)) {
    fail('bin/ directory not found');
    return;
  }

  const symlinkNames = ['python', 'python3', 'python3.10'];

  for (const symlinkName of symlinkNames) {
    const symlinkPath = path.join(binDir, symlinkName);

    if (!fs.existsSync(symlinkPath)) {
      try {
        // Check if it's a broken symlink
        fs.lstatSync(symlinkPath);
        fail(`${symlinkName}: broken symlink (target doesn't exist)`);
        const target = fs.readlinkSync(symlinkPath);
        fail(`  Target: ${target}`);
        warn('Run: npm run fix-symlinks');
      } catch (err) {
        fail(`${symlinkName}: missing - ${err.message}`);
        warn('Run: npm run fix-symlinks');
      }
      continue;
    }

    try {
      const stats = fs.lstatSync(symlinkPath);

      if (stats.isSymbolicLink()) {
        const target = fs.readlinkSync(symlinkPath);

        // Check if absolute path (bad)
        if (path.isAbsolute(target)) {
          fail(`${symlinkName}: using absolute path`);
          fail(`  Target: ${target}`);
          warn('Run: npm run fix-symlinks');
        }
        // Check if relative path (good)
        else {
          const resolvedPath = path.resolve(binDir, target);
          if (fs.existsSync(resolvedPath)) {
            pass(`${symlinkName} -> ${target}`);
          } else {
            fail(`${symlinkName}: relative symlink but target doesn't exist`);
            fail(`  Target: ${target}`);
            fail(`  Resolved: ${resolvedPath}`);
          }
        }
      } else {
        // Not a symlink, might be a copy
        pass(`${symlinkName}: regular file (not symlink)`);
      }
    } catch (err) {
      fail(`${symlinkName}: error checking - ${err.message}`);
    }
  }
}

function testPythonExecutable(venvPath, venvName) {
  console.log(`\n🐍 Testing ${venvName} Python executable`);

  const binDir = path.join(venvPath, 'bin');
  const pythonPath = path.join(binDir, 'python');

  if (!fs.existsSync(pythonPath)) {
    fail('Python executable not found');
    return;
  }

  try {
    // Verify it's executable (on Unix)
    if (process.platform !== 'win32') {
      const stats = fs.statSync(pythonPath);
      const isExecutable = (stats.mode & fs.constants.S_IXUSR) !== 0;

      if (isExecutable) {
        pass('Python is executable');
      } else {
        fail('Python is not executable');
      }
    } else {
      pass('Python file exists (Windows)');
    }
  } catch (err) {
    fail(`Error checking executable: ${err.message}`);
  }
}

function main() {
  console.log('🧪 Testing Prebuilt Dependencies');
  console.log('='.repeat(50));

  const venvs = [
    {
      path: path.join(projectRoot, 'resources', 'prebuilt', 'venv'),
      name: 'Backend venv',
    },
    {
      path: path.join(projectRoot, 'resources', 'prebuilt', 'terminal_venv'),
      name: 'Terminal venv',
    },
  ];

  for (const venv of venvs) {
    if (!fs.existsSync(venv.path)) {
      console.log(`\n⚠️  ${venv.name} not found: ${venv.path}`);
      console.log('   This is OK for development builds');
      continue;
    }

    testPyvenvCfg(venv.path, venv.name);
    testPythonSymlinks(venv.path, venv.name);
    testPythonExecutable(venv.path, venv.name);
  }

  console.log('\n' + '='.repeat(50));
  console.log(
    `\n📊 Test Results: ${testsPassed} passed, ${testsFailed} failed`
  );

  if (testsFailed > 0) {
    console.log('\n❌ Some tests failed!');
    console.log('\n🔧 To fix:');
    console.log('   npm run fix-venv-paths  # Fix pyvenv.cfg');
    console.log('   npm run fix-symlinks    # Fix Python symlinks');
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed! Prebuilt dependencies are ready.');
  }
}

main();
