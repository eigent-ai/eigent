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
 * Test script for macOS code signing
 * This script helps debug signing issues by:
 * 1. Checking for invalid symlinks
 * 2. Verifying bundle structure
 * 3. Testing codesign verification (without actual signing)
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
 * Check for invalid symlinks in the app bundle
 */
function checkSymlinks(bundlePath) {
  console.log('\n🔍 Checking for invalid symlinks...');

  const invalidSymlinks = [];

  function checkDir(dir) {
    if (!fs.existsSync(dir)) return;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        try {
          if (entry.isSymbolicLink()) {
            const target = fs.readlinkSync(fullPath);
            const resolvedPath = path.resolve(path.dirname(fullPath), target);
            const bundlePathResolved = path.resolve(bundlePath);

            if (!fs.existsSync(resolvedPath)) {
              invalidSymlinks.push({
                path: fullPath,
                target: target,
                reason: 'Target does not exist',
              });
            } else if (!resolvedPath.startsWith(bundlePathResolved)) {
              invalidSymlinks.push({
                path: fullPath,
                target: target,
                reason: 'Target is outside bundle',
              });
            }
          } else if (entry.isDirectory()) {
            // Skip certain directories
            if (entry.name === 'node_modules' || entry.name === '__pycache__') {
              continue;
            }
            checkDir(fullPath);
          }
        } catch (error) {
          console.error(`Error checking symlinks: ${error}`);
          // Ignore errors for individual files
        }
      }
    } catch (error) {
      console.error(`Error checking symlinks: ${error}`);
      // Ignore errors for directories
    }
  }

  checkDir(bundlePath);

  if (invalidSymlinks.length > 0) {
    console.log(`❌ Found ${invalidSymlinks.length} invalid symlink(s):`);
    invalidSymlinks.forEach((symlink) => {
      console.log(`   - ${symlink.path}`);
      console.log(`     → ${symlink.target}`);
      console.log(`     Reason: ${symlink.reason}`);
    });
    return false;
  } else {
    console.log('✅ No invalid symlinks found');
    return true;
  }
}

/**
 * Check bundle structure
 */
function checkBundleStructure(bundlePath) {
  console.log('\n🔍 Checking bundle structure...');

  const requiredPaths = [
    'Contents/Info.plist',
    'Contents/MacOS',
    'Contents/Resources',
  ];

  let allValid = true;

  for (const requiredPath of requiredPaths) {
    const fullPath = path.join(bundlePath, requiredPath);
    if (!fs.existsSync(fullPath)) {
      console.log(`❌ Missing: ${requiredPath}`);
      allValid = false;
    } else {
      console.log(`✅ Found: ${requiredPath}`);
    }
  }

  return allValid;
}

/**
 * Check entitlements file
 */
function checkEntitlements() {
  console.log('\n🔍 Checking entitlements...');

  const entitlementsPath = path.join(projectRoot, 'entitlements.mac.plist');

  if (!fs.existsSync(entitlementsPath)) {
    console.log('❌ entitlements.mac.plist not found');
    return false;
  }

  console.log('✅ entitlements.mac.plist exists');

  // Try to validate plist format
  try {
    execSync(`plutil -lint "${entitlementsPath}"`, { stdio: 'pipe' });
    console.log('✅ Entitlements file is valid');
    return true;
  } catch (error) {
    console.error(`Error validating entitlements file: ${error}`);
    console.log('⚠️  Could not validate entitlements file format');
    return true; // Don't fail on this
  }
}

/**
 * Test codesign verification (if app is already signed)
 */
function testCodesignVerification(bundlePath) {
  console.log('\n🔍 Testing codesign verification...');

  try {
    // First check if app is signed at all
    const signCheck = execSync(`codesign -dv "${bundlePath}" 2>&1 || true`, {
      encoding: 'utf-8',
    });

    if (signCheck.includes('code object is not signed')) {
      console.log(
        'ℹ️  App is not signed (this is expected for local testing without certificates)'
      );
      return true;
    }

    // If signed, verify it
    const output = execSync(
      `codesign --verify --deep --strict --verbose=2 "${bundlePath}" 2>&1 || true`,
      { encoding: 'utf-8' }
    );

    if (
      output.includes('valid on disk') ||
      output.includes('satisfies its Designated Requirement')
    ) {
      console.log('✅ App is properly signed');
      return true;
    } else if (
      output.includes(
        'code has no resources but signature indicates they must be present'
      )
    ) {
      // This error often means the app was signed incorrectly or needs to be re-signed
      console.log('⚠️  Codesign verification issue detected:');
      console.log('   This usually means the app needs to be re-signed.');
      console.log(
        '   In CI/CD, this should be fixed by electron-builder during signing.'
      );
      console.log(
        "   For local testing, you can ignore this if you don't have signing certificates."
      );
      return true; // Don't fail local testing
    } else {
      console.log('⚠️  Codesign verification issues:');
      console.log(output);
      return true; // Don't fail local testing
    }
  } catch (error) {
    console.error(`Error testing codesign verification: ${error}`);
    console.log(
      'ℹ️  Could not verify signature (app may not be signed - expected for local testing)'
    );
    return true; // Don't fail on this for local testing
  }
}

/**
 * Check for common signing issues
 */
function checkCommonIssues(bundlePath) {
  console.log('\n🔍 Checking for common signing issues...');

  const issues = [];

  // Check for files that might cause issues
  const problematicPatterns = [/\.DS_Store$/, /\.git$/, /node_modules/];

  function scanDir(dir, depth = 0) {
    if (depth > 10) return; // Prevent infinite recursion

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(bundlePath, fullPath);

        // Check for problematic files
        for (const pattern of problematicPatterns) {
          if (pattern.test(relativePath)) {
            issues.push(`Found ${relativePath} (may cause signing issues)`);
          }
        }

        if (entry.isDirectory() && !entry.isSymbolicLink()) {
          scanDir(fullPath, depth + 1);
        }
      }
    } catch (error) {
      console.error(`Error checking common issues: ${error}`);
      // Ignore errors
    }
  }

  scanDir(bundlePath);

  if (issues.length > 0) {
    console.log('⚠️  Potential issues found:');
    issues.forEach((issue) => console.log(`   - ${issue}`));
  } else {
    console.log('✅ No obvious issues found');
  }

  return issues.length === 0;
}

/**
 * Main function
 */
function main() {
  console.log('🧪 macOS Code Signing Test Script\n');

  const appBundle = findAppBundle();

  if (!appBundle) {
    console.log('\n💡 To build the app for testing:');
    console.log('   npm run build:mac');
    process.exit(1);
  }

  console.log(`📦 Found app bundle: ${appBundle}\n`);

  const results = {
    symlinks: checkSymlinks(appBundle),
    structure: checkBundleStructure(appBundle),
    entitlements: checkEntitlements(),
    codesign: testCodesignVerification(appBundle),
    commonIssues: checkCommonIssues(appBundle),
  };

  console.log('\n📊 Summary:');
  console.log(`   Symlinks: ${results.symlinks ? '✅' : '❌'}`);
  console.log(`   Structure: ${results.structure ? '✅' : '❌'}`);
  console.log(`   Entitlements: ${results.entitlements ? '✅' : '❌'}`);
  console.log(`   Codesign: ${results.codesign ? '✅' : '⚠️'}`);
  console.log(`   Common Issues: ${results.commonIssues ? '✅' : '⚠️'}`);

  // For local testing, only fail on critical issues (symlinks, structure, entitlements)
  const criticalChecks = [
    results.symlinks,
    results.structure,
    results.entitlements,
  ];
  const allCriticalPassed = criticalChecks.every((r) => r);

  if (allCriticalPassed) {
    console.log(
      '\n✅ Critical checks passed! The app should be ready for signing.'
    );
    console.log(
      '   Note: Codesign warnings are expected for local testing without certificates.'
    );
    console.log(
      '   The app will be properly signed in CI/CD with the provided certificates.'
    );
  } else {
    console.log(
      '\n❌ Critical checks failed. Please fix the issues above before signing.'
    );
    process.exit(1);
  }
}

main();
