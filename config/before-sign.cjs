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

    // First, clean invalid symlinks
    for (const pythonName of pythonNames) {
      const pythonPath = path.join(venvBinDir, pythonName);

      if (fs.existsSync(pythonPath)) {
        try {
          const stats = fs.lstatSync(pythonPath);
          if (stats.isSymbolicLink()) {
            const target = fs.readlinkSync(pythonPath);
            const resolvedPath = path.resolve(path.dirname(pythonPath), target);

            // If symlink points outside bundle or target doesn't exist, remove it
            if (!resolvedPath.startsWith(bundlePath) || !fs.existsSync(resolvedPath)) {
              console.log(`Removing invalid ${pythonName} symlink: ${target}`);
              fs.unlinkSync(pythonPath);
            }
          }
        } catch (error) {
          console.warn(`Warning: Could not process ${pythonName}: ${error.message}`);
        }
      }
    }

    // Fix Python symlinks by finding actual Python in cache
    const pythonCacheDir = path.join(prebuiltPath, 'cache', 'uv_python');
    if (fs.existsSync(pythonCacheDir)) {
      try {
        const entries = fs.readdirSync(pythonCacheDir);
        const pythonDirs = entries
          .filter(name => name.startsWith('cpython-'))
          .map(name => {
            const binDir = path.join(pythonCacheDir, name, 'bin');
            const pythonExe = isWindows
              ? path.join(binDir, 'python.exe')
              : path.join(binDir, 'python3.10');
            return { name, binDir, pythonExe };
          })
          .filter(({ pythonExe }) => fs.existsSync(pythonExe));

        if (pythonDirs.length > 0) {
          // Use the first available Python (usually the latest)
          const { pythonExe, binDir } = pythonDirs[0];
          const mainPythonName = isWindows ? 'python.exe' : 'python';
          const mainPythonPath = path.join(venvBinDir, mainPythonName);

          // Check if main Python symlink exists and is valid
          let needsFix = true;
          if (fs.existsSync(mainPythonPath)) {
            try {
              const stats = fs.lstatSync(mainPythonPath);
              if (stats.isSymbolicLink()) {
                const target = fs.readlinkSync(mainPythonPath);
                const resolvedPath = path.resolve(path.dirname(mainPythonPath), target);
                if (fs.existsSync(resolvedPath) && resolvedPath === pythonExe) {
                  needsFix = false;
                }
              }
            } catch (error) {
              // Error reading symlink, needs fix
            }
          }

          if (needsFix) {
            // Remove old symlink if exists
            if (fs.existsSync(mainPythonPath)) {
              fs.unlinkSync(mainPythonPath);
            }

            // Create new symlink using relative path
            const relativePath = path.relative(venvBinDir, pythonExe);
            fs.symlinkSync(relativePath, mainPythonPath);
            console.log(`✅ Fixed Python symlink: ${mainPythonPath} -> ${relativePath}`);

            // Also fix python3 and python3.10 symlinks on Unix
            if (!isWindows) {
              const python3Path = path.join(venvBinDir, 'python3');
              const python310Path = path.join(venvBinDir, 'python3.10');

              if (fs.existsSync(python3Path)) {
                fs.unlinkSync(python3Path);
              }
              fs.symlinkSync('python', python3Path);

              if (fs.existsSync(python310Path)) {
                fs.unlinkSync(python310Path);
              }
              fs.symlinkSync('python', python310Path);
            }
          } else {
            console.log(`✅ Python symlink is valid: ${mainPythonPath}`);
          }
        }
      } catch (error) {
        console.warn(`Warning: Could not fix Python symlinks: ${error.message}`);
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
    } else {
      // On Unix, verify Python executable
      const pythonExe = path.join(venvBinDir, 'python');
      if (!fs.existsSync(pythonExe)) {
        console.warn(`⚠️  Warning: Python executable not found at: ${pythonExe}`);
        console.warn(`   This may cause runtime errors. Ensure Python cache (uv_python) is included in the build.`);
      } else {
        // Verify symlink is valid
        try {
          const stats = fs.lstatSync(pythonExe);
          if (stats.isSymbolicLink()) {
            const target = fs.readlinkSync(pythonExe);
            const resolvedPath = path.resolve(path.dirname(pythonExe), target);
            if (fs.existsSync(resolvedPath)) {
              console.log(`✅ Python executable verified: ${pythonExe} -> ${resolvedPath}`);
            } else {
              console.warn(`⚠️  Warning: Python symlink target does not exist: ${target}`);
            }
          } else {
            console.log(`✅ Python executable verified: ${pythonExe}`);
          }
        } catch (error) {
          console.warn(`⚠️  Warning: Could not verify Python executable: ${error.message}`);
        }
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
