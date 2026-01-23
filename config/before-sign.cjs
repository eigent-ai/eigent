const path = require('path');
const fs = require('fs');

/**
 * After pack hook - clean invalid symlinks after packing, before signing
 */
exports.default = async function afterPack(context) {
  if (process.platform !== 'darwin') {
    return;
  }

  const appOutDir = context.appOutDir;
  const appName = context.packager.appInfo.productName;
  const appPath = path.join(appOutDir, `${appName}.app`);

  if (!fs.existsSync(appPath)) {
    console.log('App bundle not found, skipping symlink cleanup');
    return;
  }

  console.log('🧹 Cleaning invalid symlinks and cache directories before signing...');

  const resourcesPath = path.join(appPath, 'Contents', 'Resources');
  const prebuiltPath = path.join(resourcesPath, 'prebuilt');

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

  // Find prebuilt Python executable in uv_python directory
  function findPrebuiltPython() {
    const uvPythonDir = path.join(prebuiltPath, 'uv_python');
    if (!fs.existsSync(uvPythonDir)) {
      return null;
    }

    // UV stores Python in cpython-* subdirectories
    try {
      const entries = fs.readdirSync(uvPythonDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('cpython-')) {
          const pythonPath = path.join(uvPythonDir, entry.name, 'install', 'bin', 'python');
          if (fs.existsSync(pythonPath)) {
            return pythonPath;
          }
        }
      }
    } catch (error) {
      console.warn(`Warning: Could not search for prebuilt Python: ${error.message}`);
    }
    return null;
  }

  const prebuiltPython = findPrebuiltPython();
  if (prebuiltPython) {
    console.log(`Found prebuilt Python: ${prebuiltPython}`);
  }

  // Clean and fix Python symlinks in a venv bin directory
  function fixPythonSymlinks(binDir, venvName) {
    if (!fs.existsSync(binDir)) {
      return;
    }

    const pythonNames = ['python', 'python3', 'python3.10', 'python3.11', 'python3.12'];
    const bundlePath = path.resolve(appPath);

    for (const pythonName of pythonNames) {
      const pythonSymlink = path.join(binDir, pythonName);

      try {
        const stats = fs.lstatSync(pythonSymlink);
        if (stats.isSymbolicLink()) {
          const target = fs.readlinkSync(pythonSymlink);
          const resolvedPath = path.resolve(path.dirname(pythonSymlink), target);

          // If symlink points outside bundle or is broken, remove and recreate it
          if (!resolvedPath.startsWith(bundlePath) || !fs.existsSync(resolvedPath)) {
            console.log(`Removing invalid ${venvName} ${pythonName} symlink: ${target}`);
            fs.unlinkSync(pythonSymlink);

            // Recreate symlink pointing to prebuilt Python (only for main 'python')
            if (prebuiltPython && pythonName === 'python') {
              const relativePath = path.relative(binDir, prebuiltPython);
              fs.symlinkSync(relativePath, pythonSymlink);
              console.log(`Created ${venvName} ${pythonName} symlink -> ${relativePath}`);
            }
          }
        }
      } catch (error) {
        // Symlink doesn't exist, create it if this is the main python symlink
        if (error.code === 'ENOENT' && prebuiltPython && pythonName === 'python') {
          try {
            const relativePath = path.relative(binDir, prebuiltPython);
            fs.symlinkSync(relativePath, pythonSymlink);
            console.log(`Created missing ${venvName} ${pythonName} symlink -> ${relativePath}`);
          } catch (createError) {
            console.warn(`Warning: Could not create ${venvName} ${pythonName} symlink: ${createError.message}`);
          }
        }
      }
    }
  }

  // Fix Python symlinks in both venv directories
  fixPythonSymlinks(path.join(prebuiltPath, 'venv', 'bin'), 'venv');
  fixPythonSymlinks(path.join(prebuiltPath, 'terminal_venv', 'bin'), 'terminal_venv');

  // Recursively clean other invalid symlinks (skip already-processed venv bin directories)
  const processedDirs = new Set([
    path.join(prebuiltPath, 'venv', 'bin'),
    path.join(prebuiltPath, 'terminal_venv', 'bin'),
  ]);

  function cleanSymlinks(dir, bundleRoot) {
    if (!fs.existsSync(dir) || processedDirs.has(dir)) {
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

  // Also clean symlinks in backend directory (e.g., backend/workspace/.initial_env)
  const backendPath = path.join(resourcesPath, 'backend');
  if (fs.existsSync(backendPath)) {
    cleanSymlinks(backendPath, appPath);
  }

  console.log('✅ Symlink cleanup completed');
};
