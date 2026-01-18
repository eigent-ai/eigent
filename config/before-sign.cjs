const path = require('path');
const fs = require('fs');

/**
 * After pack hook - clean invalid symlinks after packing, before signing
 * Also ensures Python executable is available on Windows
 */
exports.default = async function afterPack(context) {
  const isMac = process.platform === 'darwin';
  const isWindows = process.platform === 'win32';

  if (!isMac && !isWindows) {
    return;
  }

  const appOutDir = context.appOutDir;
  const appName = context.packager.appInfo.productName;

  let appPath, resourcesPath, prebuiltPath;

  if (isMac) {
    appPath = path.join(appOutDir, `${appName}.app`);
    if (!fs.existsSync(appPath)) {
      console.log('App bundle not found, skipping cleanup');
      return;
    }
    resourcesPath = path.join(appPath, 'Contents', 'Resources');
  } else if (isWindows) {
    // On Windows, resources are directly in the app directory
    appPath = appOutDir;
    resourcesPath = path.join(appPath, 'resources');
  }

  prebuiltPath = path.join(resourcesPath, 'prebuilt');

  console.log('🧹 Cleaning invalid symlinks and cache directories...');

  if (!fs.existsSync(prebuiltPath)) {
    return;
  }

  // Remove .npm-cache directories (should not be packaged)
  function removeNpmCache(dir) {
    if (!fs.existsSync(dir)) {
      return;
    }

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        try {
          if (entry.name === '.npm-cache' && entry.isDirectory()) {
            console.log(`Removing .npm-cache directory: ${fullPath}`);
            fs.rmSync(fullPath, { recursive: true, force: true });
          } else if (entry.isDirectory()) {
            removeNpmCache(fullPath);
          }
        } catch (error) {
          // Ignore errors
        }
      }
    } catch (error) {
      // Ignore errors
    }
  }

  removeNpmCache(prebuiltPath);

  // Remove flac-mac binary (uses outdated SDK, causes notarization issues)
  const venvLibPath = path.join(prebuiltPath, 'venv', 'lib');
  if (fs.existsSync(venvLibPath)) {
    try {
      const entries = fs.readdirSync(venvLibPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('python')) {
          const flacMacPath = path.join(venvLibPath, entry.name, 'site-packages', 'speech_recognition', 'flac-mac');
          if (fs.existsSync(flacMacPath)) {
            console.log(`Removing flac-mac binary (outdated SDK): ${flacMacPath}`);
            try {
              fs.unlinkSync(flacMacPath);
            } catch (error) {
              console.warn(`Warning: Could not remove flac-mac: ${error.message}`);
            }
          }
        }
      }
    } catch (error) {
      // Ignore errors
    }
  }

  // Clean Python symlinks in venv/bin (Unix) or venv/Scripts (Windows)
  const venvBinDir = isWindows
    ? path.join(prebuiltPath, 'venv', 'Scripts')
    : path.join(prebuiltPath, 'venv', 'bin');

  if (fs.existsSync(venvBinDir)) {
    const pythonNames = isWindows
      ? ['python.exe', 'python3.exe', 'python3.10.exe', 'python3.11.exe', 'python3.12.exe']
      : ['python', 'python3', 'python3.10', 'python3.11', 'python3.12'];
    const bundlePath = path.resolve(appPath);

    for (const pythonName of pythonNames) {
      const pythonPath = path.join(venvBinDir, pythonName);

      if (fs.existsSync(pythonPath)) {
        try {
          const stats = fs.lstatSync(pythonPath);
          if (stats.isSymbolicLink()) {
            const target = fs.readlinkSync(pythonPath);
            const resolvedPath = path.resolve(path.dirname(pythonPath), target);

            // If symlink points outside bundle, remove it
            if (!resolvedPath.startsWith(bundlePath)) {
              console.log(`Removing invalid ${pythonName} symlink: ${target}`);
              fs.unlinkSync(pythonPath);
            }
          }
        } catch (error) {
          console.warn(`Warning: Could not process ${pythonName}: ${error.message}`);
        }
      }
    }

    // On Windows, verify Python executable exists and is accessible
    if (isWindows) {
      const pythonExe = path.join(venvBinDir, 'python.exe');
      if (!fs.existsSync(pythonExe)) {
        console.warn(`⚠️  Warning: Python executable not found at: ${pythonExe}`);
        console.warn(`   This may cause runtime errors. Ensure Python cache (uv_python) is included in the build.`);
      } else {
        console.log(`✅ Python executable verified: ${pythonExe}`);
      }
    }
  }

  // Recursively clean other invalid symlinks
  function cleanSymlinks(dir, bundleRoot) {
    if (!fs.existsSync(dir)) {
      return;
    }

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        try {
          if (entry.isSymbolicLink()) {
            const target = fs.readlinkSync(fullPath);
            const resolvedPath = path.resolve(path.dirname(fullPath), target);
            const bundlePath = path.resolve(bundleRoot);

            if (!fs.existsSync(resolvedPath) || !resolvedPath.startsWith(bundlePath)) {
              console.log(`Removing invalid symlink: ${fullPath} -> ${target}`);
              fs.unlinkSync(fullPath);
            }
          } else if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '__pycache__') {
              continue;
            }
            cleanSymlinks(fullPath, bundleRoot);
          }
        } catch (error) {
          // Ignore errors
        }
      }
    } catch (error) {
      // Ignore errors
    }
  }

  cleanSymlinks(prebuiltPath, appPath);
  console.log('✅ Symlink cleanup completed');
};
