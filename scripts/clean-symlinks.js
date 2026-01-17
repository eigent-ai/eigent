#!/usr/bin/env node
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
  const removed = cleanSymlinks(bundleRoot, bundleRoot);

  if (removed.length > 0) {
    console.log(`✅ Removed ${removed.length} invalid symbolic link(s)`);
  } else {
    console.log('✅ No invalid symbolic links found');
  }
}

main();
