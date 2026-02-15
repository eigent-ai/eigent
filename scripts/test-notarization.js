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

/* global console, process */

/**
 * Test script for macOS notarization issues
 * This script checks for common issues that cause notarization to fail:
 * 1. .npm-cache directories
 * 2. flac-mac binary (outdated SDK)
 * 3. Unsigned native binaries (.node files)
 * 4. Other problematic files
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const RELEASE_DIR = path.join(projectRoot, 'release');
const APP_BUNDLE_PATTERN = /Eigent\.app$/;

/**
 * Find the app bundle in release directory
 */
function findAppBundle() {
  if (!fs.existsSync(RELEASE_DIR)) {
    console.log(
      '❌ Release directory does not exist. Please build the app first.'
    );
    console.log('   Run: npm run build:mac');
    return null;
  }

  const entries = fs.readdirSync(RELEASE_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.match(APP_BUNDLE_PATTERN)) {
      return path.join(RELEASE_DIR, entry.name);
    }

    // Check subdirectories (e.g., mac-arm64/Eigent.app)
    if (entry.isDirectory()) {
      const subDir = path.join(RELEASE_DIR, entry.name);
      const subEntries = fs.readdirSync(subDir, { withFileTypes: true });
      for (const subEntry of subEntries) {
        if (subEntry.isDirectory() && subEntry.name.match(APP_BUNDLE_PATTERN)) {
          return path.join(subDir, subEntry.name);
        }
      }
    }
  }

  return null;
}

/**
 * Check for .npm-cache directories
 */
function checkNpmCache(bundlePath) {
  console.log('\n🔍 Checking for .npm-cache directories...');
  const issues = [];

  function scanDir(dir) {
    if (!fs.existsSync(dir)) {
      return;
    }

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.name === '.npm-cache' && entry.isDirectory()) {
          issues.push(fullPath);
        } else if (entry.isDirectory()) {
          // Skip node_modules to avoid deep scanning
          if (entry.name !== 'node_modules' && entry.name !== '__pycache__') {
            scanDir(fullPath);
          }
        }
      }
    } catch (error) {
      console.error(`Error checking npm cache: ${error}`);
      // Ignore errors
    }
  }

  const resourcesPath = path.join(bundlePath, 'Contents', 'Resources');
  const prebuiltPath = path.join(resourcesPath, 'prebuilt');

  if (fs.existsSync(prebuiltPath)) {
    scanDir(prebuiltPath);
  }

  if (issues.length > 0) {
    console.log(`❌ Found ${issues.length} .npm-cache directory(ies):`);
    issues.forEach((issue) => console.log(`   - ${issue}`));
    return false;
  } else {
    console.log('✅ No .npm-cache directories found');
    return true;
  }
}

/**
 * Check for flac-mac binary
 */
function checkFlacMac(bundlePath) {
  console.log('\n🔍 Checking for flac-mac binary...');
  const issues = [];

  const resourcesPath = path.join(bundlePath, 'Contents', 'Resources');
  const prebuiltPath = path.join(resourcesPath, 'prebuilt');
  const venvLibPath = path.join(prebuiltPath, 'venv', 'lib');

  if (fs.existsSync(venvLibPath)) {
    try {
      const entries = fs.readdirSync(venvLibPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('python')) {
          const flacMacPath = path.join(
            venvLibPath,
            entry.name,
            'site-packages',
            'speech_recognition',
            'flac-mac'
          );
          if (fs.existsSync(flacMacPath)) {
            issues.push(flacMacPath);
          }
        }
      }
    } catch (error) {
      console.error(`Error checking flac-mac binary: ${error}`);
      // Ignore errors
    }
  }

  if (issues.length > 0) {
    console.log(
      `❌ Found ${issues.length} flac-mac binary(ies) (outdated SDK):`
    );
    issues.forEach((issue) => console.log(`   - ${issue}`));
    return false;
  } else {
    console.log('✅ No flac-mac binaries found');
    return true;
  }
}

/**
 * Check for unsigned native binaries
 */
function checkUnsignedBinaries(bundlePath) {
  console.log('\n🔍 Checking for unsigned native binaries (.node files)...');
  const issues = [];

  function scanForNodeFiles(dir) {
    if (!fs.existsSync(dir)) {
      return;
    }

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isFile() && entry.name.endsWith('.node')) {
          // Check if file is signed
          try {
            const output = execSync(`codesign -dv "${fullPath}" 2>&1 || true`, {
              encoding: 'utf-8',
            });
            if (output.includes('code object is not signed')) {
              issues.push({
                path: fullPath,
                reason: 'Not signed',
              });
            }
          } catch (error) {
            console.error(`Error checking unsigned native binaries: ${error}`);
            // If codesign fails, assume it's not signed
            issues.push({
              path: fullPath,
              reason: 'Could not verify signature',
            });
          }
        } else if (entry.isDirectory()) {
          // Skip certain directories
          if (
            entry.name !== 'node_modules' &&
            entry.name !== '__pycache__' &&
            !entry.name.startsWith('.')
          ) {
            scanForNodeFiles(fullPath);
          }
        }
      }
    } catch (error) {
      console.error(`Error checking unsigned native binaries: ${error}`);
      // Ignore errors
    }
  }

  const resourcesPath = path.join(bundlePath, 'Contents', 'Resources');
  const prebuiltPath = path.join(resourcesPath, 'prebuilt');

  if (fs.existsSync(prebuiltPath)) {
    scanForNodeFiles(prebuiltPath);
  }

  if (issues.length > 0) {
    console.log(`❌ Found ${issues.length} unsigned .node file(s):`);
    issues.forEach((issue) => {
      console.log(`   - ${issue.path}`);
      console.log(`     Reason: ${issue.reason}`);
    });
    return false;
  } else {
    console.log('✅ No unsigned .node files found');
    return true;
  }
}

/**
 * Check app bundle size
 */
function checkBundleSize(bundlePath) {
  console.log('\n🔍 Checking app bundle size...');

  try {
    function getDirSize(dir) {
      let size = 0;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isFile()) {
            size += fs.statSync(fullPath).size;
          } else if (entry.isDirectory()) {
            size += getDirSize(fullPath);
          }
        }
      } catch (error) {
        console.error(`Error checking bundle size: ${error}`);
        // Ignore errors
      }
      return size;
    }

    const size = getDirSize(bundlePath);
    const sizeInMB = (size / (1024 * 1024)).toFixed(2);
    console.log(`   App bundle size: ${sizeInMB} MB`);

    if (size > 500 * 1024 * 1024) {
      console.log(
        `   ⚠️  Large bundle size (>500MB) may cause slow notarization (30-60 minutes)`
      );
    } else if (size > 200 * 1024 * 1024) {
      console.log(
        `   ⚠️  Medium bundle size (200-500MB) may take 15-30 minutes to notarize`
      );
    } else {
      console.log(`   ✅ Bundle size is reasonable for notarization`);
    }

    return true;
  } catch (error) {
    console.log(`   ⚠️  Could not calculate bundle size: ${error.message}`);
    return true;
  }
}

/**
 * Main function
 */
function main() {
  console.log('🧪 macOS Notarization Test Script\n');

  const appBundle = findAppBundle();

  if (!appBundle) {
    console.log('\n💡 To build the app for testing:');
    console.log('   npm run build:mac');
    process.exit(1);
  }

  console.log(`📦 Found app bundle: ${appBundle}\n`);

  const results = {
    npmCache: checkNpmCache(appBundle),
    flacMac: checkFlacMac(appBundle),
    unsignedBinaries: checkUnsignedBinaries(appBundle),
    bundleSize: checkBundleSize(appBundle),
  };

  console.log('\n📊 Summary:');
  console.log(`   .npm-cache directories: ${results.npmCache ? '✅' : '❌'}`);
  console.log(`   flac-mac binaries: ${results.flacMac ? '✅' : '❌'}`);
  console.log(
    `   Unsigned .node files: ${results.unsignedBinaries ? '✅' : '❌'}`
  );
  console.log(`   Bundle size: ${results.bundleSize ? '✅' : '⚠️'}`);

  const allPassed = Object.values(results).every((r) => r);

  if (allPassed) {
    console.log(
      '\n✅ All checks passed! The app should be ready for notarization.'
    );
    console.log('\n💡 Note: This script only checks for common issues.');
    console.log('   Actual notarization may still fail for other reasons.');
    console.log('   To test actual notarization, you need:');
    console.log('   - Valid Apple Developer ID certificate');
    console.log(
      '   - APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID environment variables'
    );
  } else {
    console.log(
      '\n❌ Some checks failed. Please fix the issues above before notarization.'
    );
    process.exit(1);
  }
}

main();
