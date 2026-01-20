#!/usr/bin/env node
/**
 * Pre-install dependencies script
 * This script installs all necessary dependencies before packaging the app
 * so users don't have to wait for installation on first run
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const BIN_DIR = path.join(projectRoot, 'resources', 'prebuilt', 'bin');
const VENV_DIR = path.join(projectRoot, 'resources', 'prebuilt', 'venv');
const BACKEND_DIR = path.join(projectRoot, 'backend');

console.log('🚀 Starting pre-installation of dependencies...');
console.log(`📦 Binaries will be installed to: ${BIN_DIR}`);
console.log(`🐍 Python venv will be installed to: ${VENV_DIR}`);

// Ensure directories exist
fs.mkdirSync(BIN_DIR, { recursive: true });
fs.mkdirSync(VENV_DIR, { recursive: true });

/**
 * Validate if the downloaded file is a valid ZIP file
 */
function isValidZip(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    return buffer.length > 4 &&
           buffer[0] === 0x50 &&
           buffer[1] === 0x4B &&
           buffer[2] === 0x03 &&
           buffer[3] === 0x04;
  } catch {
    return false;
  }
}

/**
 * Validate if the downloaded file is a valid tar.gz file
 */
function isValidTarGz(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    return buffer.length > 2 &&
           buffer[0] === 0x1F &&
           buffer[1] === 0x8B;
  } catch {
    return false;
  }
}

/**
 * Download file and validate integrity
 */
async function downloadFileWithValidation(urlsToTry, dest, validateFn, fileType = 'file') {
  const maxRetries = 2;

  for (const { url, name } of urlsToTry) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        console.log(`   Trying ${name} (attempt ${attempt + 1}/${maxRetries})`);
        console.log(`   URL: ${url}`);

        await new Promise((resolve, reject) => {
          const protocol = url.startsWith('https') ? https : http;
          const timeout = 180000; // 3 minutes
          let redirectCount = 0;
          const maxRedirects = 10;

          const makeRequest = (requestUrl) => {
            const requestProtocol = requestUrl.startsWith('https') ? https : http;
            const request = requestProtocol.get(requestUrl, {
              timeout: timeout,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
              }
            }, (response) => {
              // Handle redirects (301, 302, 307, 308)
              if (response.statusCode === 301 || response.statusCode === 302 ||
                  response.statusCode === 307 || response.statusCode === 308) {
                redirectCount++;
                if (redirectCount > maxRedirects) {
                  reject(new Error(`Too many redirects (${redirectCount})`));
                  return;
                }

                const redirectUrl = response.headers.location;
                if (!redirectUrl) {
                  reject(new Error(`Redirect without location header`));
                  return;
                }

                // Handle relative redirects
                const absoluteRedirectUrl = redirectUrl.startsWith('http')
                  ? redirectUrl
                  : new URL(redirectUrl, requestUrl).href;

                console.log(`   Following redirect ${redirectCount} to: ${absoluteRedirectUrl}`);

                // Close current response
                response.destroy();

                // Recursively handle redirects
                makeRequest(absoluteRedirectUrl);
                return;
              }

              if (response.statusCode !== 200) {
                reject(new Error(`HTTP ${response.statusCode}`));
                return;
              }

              const file = fs.createWriteStream(dest);
              let downloadedSize = 0;
              const totalSize = parseInt(response.headers['content-length'] || '0');

              response.on('data', (chunk) => {
                downloadedSize += chunk.length;
                if (totalSize > 0) {
                  const progress = ((downloadedSize / totalSize) * 100).toFixed(1);
                  process.stdout.write(`\r   Progress: ${progress}% (${(downloadedSize / 1024 / 1024).toFixed(2)}MB / ${(totalSize / 1024 / 1024).toFixed(2)}MB)`);
                }
              });

              response.pipe(file);
              file.on('finish', () => {
                file.close();
                console.log(''); // New line
                resolve();
              });
              file.on('error', (err) => {
                file.close();
                if (fs.existsSync(dest)) fs.unlinkSync(dest);
                reject(err);
              });
            });

            request.on('error', (err) => {
              if (fs.existsSync(dest)) fs.unlinkSync(dest);
              reject(err);
            });

            request.on('timeout', () => {
              request.destroy();
              if (fs.existsSync(dest)) fs.unlinkSync(dest);
              reject(new Error('Request timeout'));
            });
          };

          makeRequest(url);
        });

        // Validate downloaded file
        if (!fs.existsSync(dest)) {
          throw new Error('Downloaded file does not exist');
        }

        const fileSize = fs.statSync(dest).size;
        console.log(`   Downloaded file size: ${(fileSize / 1024 / 1024).toFixed(2)}MB`);

        if (fileSize < 1024) {
          const content = fs.readFileSync(dest, 'utf-8');
          console.log(`   ⚠️  File too small, content: ${content.substring(0, 200)}`);
          throw new Error('Downloaded file is too small (likely an error page)');
        }

        if (!validateFn(dest)) {
          throw new Error(`Downloaded file is not a valid ${fileType}`);
        }

        console.log(`   ✅ Successfully downloaded and validated from ${name}`);
        return true;

      } catch (error) {
        console.log(`\n   ⚠️  Failed: ${error.message}`);
        if (fs.existsSync(dest)) {
          try {
            fs.unlinkSync(dest);
          } catch (e) {
            // Ignore
          }
        }
      }
    }
  }

  throw new Error(`Failed to download ${fileType} from all sources`);
}

/**
 * Get Bun download URL list
 */
function getBunUrls(platform, arch) {
  const filename = `bun-${platform}-${arch}.zip`;
  return [{
    url: `https://github.com/oven-sh/bun/releases/latest/download/${filename}`,
    name: 'GitHub'
  }];
}

/**
 * Get UV download URL list
 */
function getUvUrls(archStr, platformStr, isWindows = false) {
  const extension = isWindows ? '.zip' : '.tar.gz';
  const filename = `uv-${archStr}-${platformStr}${extension}`;
  return [{
    url: `https://github.com/astral-sh/uv/releases/latest/download/${filename}`,
    name: 'GitHub'
  }];
}

/**
 * Install uv binary
 */
async function installUv() {
  console.log('\n📥 Installing uv...');
  const uvPath = path.join(BIN_DIR, process.platform === 'win32' ? 'uv.exe' : 'uv');

  if (fs.existsSync(uvPath)) {
    // Verify the binary actually works (correct architecture)
    try {
      execSync(`"${uvPath}" --version`, { stdio: 'pipe' });
      console.log('✅ uv already installed');
      return uvPath;
    } catch (e) {
      console.log('⚠️  Existing uv binary is invalid or wrong architecture, removing...');
      fs.unlinkSync(uvPath);
    }
  }

  // Check manual path
  const manualUvPath = process.env.MANUAL_UV_PATH;
  if (manualUvPath && fs.existsSync(manualUvPath)) {
    console.log(`📋 Using manually provided uv binary: ${manualUvPath}`);
    fs.copyFileSync(manualUvPath, uvPath);
    if (process.platform !== 'win32') {
      fs.chmodSync(uvPath, '755');
    }
    return uvPath;
  }

  // Try to find uv in system PATH
  try {
    const whichCommand = process.platform === 'win32' ? 'where uv' : 'which uv';
    const systemUvPath = execSync(whichCommand, { encoding: 'utf-8', stdio: 'pipe' }).trim().split('\n')[0];
    if (systemUvPath && fs.existsSync(systemUvPath)) {
      console.log(`📋 Using system uv: ${systemUvPath}`);
      fs.copyFileSync(systemUvPath, uvPath);
      if (process.platform !== 'win32') {
        fs.chmodSync(uvPath, '755');
      }
      return uvPath;
    }
  } catch (error) {
    // uv not found in PATH, continue to try pip or download
    console.log('   uv not found in system PATH, will try pip or download...');
  }

  // Try pip first
  const usePipEnv = process.env.USE_PIP_INSTALL_UV;
  const shouldTryPip = usePipEnv !== 'false';

  if (shouldTryPip) {
    console.log('\n🐍 Trying to install uv via pip...');

    try {
      let pipCommand = null;

      try {
        execSync('pip3 --version', { stdio: 'ignore' });
        pipCommand = 'pip3';
      } catch {
        try {
          execSync('pip --version', { stdio: 'ignore' });
          pipCommand = 'pip';
        } catch {
          throw new Error('pip not found');
        }
      }

      const isMacOS = process.platform === 'darwin';
      const pipArgs = isMacOS
        ? `install --user --break-system-packages uv`
        : `install --user uv`;

      console.log(`   Installing via ${pipCommand}...`);
      execSync(`${pipCommand} ${pipArgs}`, { stdio: 'inherit' });

      // Find installed uv
      const possiblePaths = process.platform === 'win32'
        ? [
            path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python311', 'Scripts', 'uv.exe'),
            path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'Scripts', 'uv.exe'),
            path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python313', 'Scripts', 'uv.exe'),
            path.join(os.homedir(), '.local', 'bin', 'uv.exe'),
            'C:\\Python311\\Scripts\\uv.exe',
            'C:\\Python312\\Scripts\\uv.exe',
            'C:\\Python313\\Scripts\\uv.exe',
          ]
        : [
            path.join(os.homedir(), '.local', 'bin', 'uv'),
            path.join(os.homedir(), 'Library', 'Python', '3.11', 'bin', 'uv'),
            path.join(os.homedir(), 'Library', 'Python', '3.12', 'bin', 'uv'),
            path.join(os.homedir(), 'Library', 'Python', '3.13', 'bin', 'uv'),
            '/usr/local/bin/uv',
          ];

      let foundUvPath = null;
      try {
        const whichCommand = process.platform === 'win32' ? 'where uv' : 'which uv';
        foundUvPath = execSync(whichCommand, { encoding: 'utf-8' }).trim().split('\n')[0];
      } catch {
        for (const p of possiblePaths) {
          if (fs.existsSync(p)) {
            foundUvPath = p;
            break;
          }
        }
      }

      if (foundUvPath && fs.existsSync(foundUvPath)) {
        fs.copyFileSync(foundUvPath, uvPath);
        if (process.platform !== 'win32') {
          fs.chmodSync(uvPath, '755');
        }
        console.log('✅ uv installed via pip');
        return uvPath;
      }
    } catch (error) {
      console.log(`   ⚠️  pip install failed: ${error.message}`);
    }
  }

  // Download from GitHub
  console.log('\n📥 Downloading uv...');

  const platform = process.platform;
  const arch = process.arch;
  let platformStr, archStr;

  archStr = arch === 'x64' ? 'x86_64' : arch === 'arm64' ? 'aarch64' : arch;

  if (platform === 'darwin') {
    platformStr = 'apple-darwin';
  } else if (platform === 'linux') {
    platformStr = 'unknown-linux-gnu';
  } else if (platform === 'win32') {
    platformStr = 'pc-windows-msvc';
    archStr = 'x86_64';
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const isWindows = platform === 'win32';
  const fileExtension = isWindows ? '.zip' : '.tar.gz';
  const tempFilename = path.join(BIN_DIR, `uv-download-${Date.now()}${fileExtension}`);

  console.log(`   Platform: ${platform}-${arch}`);

  const urlsToTry = getUvUrls(archStr, platformStr, isWindows);
  const validateFn = isWindows ? isValidZip : isValidTarGz;
  await downloadFileWithValidation(urlsToTry, tempFilename, validateFn, fileExtension);

  // Extract
  console.log('   Extracting...');

  if (isWindows) {
    try {
      const AdmZip = (await import('adm-zip')).default;
      const zip = new AdmZip(tempFilename);
      zip.extractAllTo(BIN_DIR, true);
    } catch (admZipError) {
      console.log('   Using system unzip...');
      execSync(`powershell -command "Expand-Archive -Path '${tempFilename}' -DestinationPath '${BIN_DIR}' -Force"`, { stdio: 'inherit' });
    }
  } else {
    const tar = await import('tar');
    await tar.extract({ file: tempFilename, cwd: BIN_DIR });
  }

  // Handle nested directory from tarball if needed
  if (!isWindows) {
    const nestedDir = fs.readdirSync(BIN_DIR).find(f => 
      fs.statSync(path.join(BIN_DIR, f)).isDirectory() && f.startsWith('uv-')
    );
    if (nestedDir) {
      const nestedUvPath = path.join(BIN_DIR, nestedDir, 'uv');
      const targetPath = path.join(BIN_DIR, 'uv');
      if (fs.existsSync(nestedUvPath)) {
        console.log(`   Found uv in ${nestedDir}, moving...`);
        try {
          if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
          fs.renameSync(nestedUvPath, targetPath);
          // Clean up directory
          fs.rmSync(path.join(BIN_DIR, nestedDir), { recursive: true, force: true });
        } catch (e) {
          console.log(`   Warning: Failed to move uv from nested dir: ${e.message}`);
        }
      }
    }
  }

  const extractedUvPath = path.join(BIN_DIR, isWindows ? 'uv.exe' : 'uv');
  if (fs.existsSync(extractedUvPath)) {
    if (!isWindows && extractedUvPath !== uvPath) {
      fs.renameSync(extractedUvPath, uvPath);
    }
    if (process.platform !== 'win32') {
      fs.chmodSync(uvPath, '755');
    }
  }

  fs.unlinkSync(tempFilename);
  console.log('✅ uv installed successfully');
  return uvPath;
}

/**
 * Install bun binary
 */
async function installBun() {
  console.log('\n📥 Installing bun...');
  const platform = process.platform;
  const arch = process.arch;
  const bunPath = path.join(BIN_DIR, platform === 'win32' ? 'bun.exe' : 'bun');

  if (fs.existsSync(bunPath)) {
    // Verify the binary actually works (correct architecture)
    try {
      execSync(`"${bunPath}" --version`, { stdio: 'pipe' });
      console.log('✅ bun already installed');
      return bunPath;
    } catch (e) {
      console.log('⚠️  Existing bun binary is invalid or wrong architecture, removing...');
      fs.unlinkSync(bunPath);
    }
  }

  // Check manual path
  const manualBunPath = process.env.MANUAL_BUN_PATH;
  if (manualBunPath && fs.existsSync(manualBunPath)) {
    console.log(`📋 Using manually provided bun binary: ${manualBunPath}`);
    fs.copyFileSync(manualBunPath, bunPath);
    if (platform !== 'win32') {
      fs.chmodSync(bunPath, '755');
    }
    return bunPath;
  }

  // Try to find bun in system PATH
  try {
    const whichCommand = platform === 'win32' ? 'where bun' : 'which bun';
    const output = execSync(whichCommand, { encoding: 'utf-8', stdio: 'pipe' }).trim();
    const paths = output.split(/[\r\n]+/).map(p => p.trim()).filter(p => p && !p.includes('INFO:'));

    for (const systemBunPath of paths) {
      if (systemBunPath && fs.existsSync(systemBunPath)) {
        console.log(`📋 Using system bun: ${systemBunPath}`);
        fs.copyFileSync(systemBunPath, bunPath);
        if (platform !== 'win32') {
          fs.chmodSync(bunPath, '755');
        }
        return bunPath;
      }
    }

    // Also try common Windows paths (npm global install locations)
    if (platform === 'win32') {
      const npmPrefix = execSync('npm config get prefix', { encoding: 'utf-8', stdio: 'pipe' }).trim();
      const commonPaths = [
        path.join(npmPrefix, 'bun.exe'),
        path.join(npmPrefix, 'bun.cmd'),
        path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'bun.exe'),
        path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'bun.cmd'),
        path.join(os.homedir(), 'AppData', 'Local', 'npm', 'bun.exe'),
        path.join(os.homedir(), '.bun', 'bin', 'bun.exe'),
        'C:\\Program Files\\nodejs\\bun.exe',
        'C:\\Program Files\\bun\\bun.exe',
        'C:\\bun\\bun.exe',
      ];

      for (const commonPath of commonPaths) {
        if (fs.existsSync(commonPath)) {
          console.log(`📋 Using bun from common path: ${commonPath}`);
          fs.copyFileSync(commonPath, bunPath);
          return bunPath;
        }
      }
    }
  } catch (error) {
    // bun not found in PATH, continue to download
    console.log(`   bun not found in system PATH (${error.message}), will download...`);
  }

  // Determine platform and architecture
  let bunPlatform, bunArch;

  if (platform === 'darwin') {
    bunPlatform = 'darwin';
    bunArch = arch === 'arm64' ? 'aarch64' : 'x64';
  } else if (platform === 'linux') {
    bunPlatform = 'linux';
    bunArch = arch === 'arm64' ? 'aarch64' : 'x64';
  } else if (platform === 'win32') {
    bunPlatform = 'windows';
    bunArch = 'x64';
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const tempFilename = path.join(BIN_DIR, `bun-download-${Date.now()}.zip`);

  console.log(`   Platform: ${bunPlatform}-${bunArch}`);

  // Try using curl first (more reliable for redirects)
  try {
    const urlsToTry = getBunUrls(bunPlatform, bunArch);
    const url = urlsToTry[0].url;

    console.log(`   Trying to download with curl: ${url}`);
    execSync(`curl -L -o "${tempFilename}" "${url}"`, { stdio: 'inherit' });

    if (fs.existsSync(tempFilename) && isValidZip(tempFilename)) {
      console.log('   ✅ Downloaded successfully with curl');
    } else {
      throw new Error('Downloaded file is invalid');
    }
  } catch (curlError) {
    console.log(`   ⚠️  curl download failed: ${curlError.message}`);
    console.log('   Falling back to manual download...');

    // Fallback to manual download
    const urlsToTry = getBunUrls(bunPlatform, bunArch);
    await downloadFileWithValidation(urlsToTry, tempFilename, isValidZip, 'ZIP');
  }

  // Extract
  console.log('   Extracting...');

  try {
    const AdmZip = (await import('adm-zip')).default;
    const zip = new AdmZip(tempFilename);
    const entries = zip.getEntries();

    for (const entry of entries) {
      const name = entry.entryName;
      if (name === 'bun' || name === 'bun.exe' || name.endsWith('/bun') || name.endsWith('/bun.exe')) {
        zip.extractEntryTo(entry, BIN_DIR, false, true);
        break;
      }
    }
  } catch (admZipError) {
    console.log('   Using system unzip...');
    if (platform === 'win32') {
      execSync(`powershell -command "Expand-Archive -Path '${tempFilename}' -DestinationPath '${BIN_DIR}' -Force"`, { stdio: 'inherit' });
    } else {
      execSync(`unzip -o "${tempFilename}" -d "${BIN_DIR}"`, { stdio: 'inherit' });
    }
  }

  if (platform !== 'win32' && fs.existsSync(bunPath)) {
    fs.chmodSync(bunPath, '755');
  }

  fs.unlinkSync(tempFilename);

  if (fs.existsSync(bunPath)) {
    console.log('✅ bun installed successfully');
    return bunPath;
  } else {
    throw new Error('bun binary not found after extraction');
  }
}

/**
 * Install Python dependencies
 */
async function installPythonDeps(uvPath) {
  console.log('\n🐍 Installing Python dependencies...');

  const venvPath = VENV_DIR;
  const cacheDir = path.join(projectRoot, 'resources', 'prebuilt', 'cache', 'uv_cache');
  const pythonCacheDir = path.join(projectRoot, 'resources', 'prebuilt', 'cache', 'uv_python');
  const toolCacheDir = path.join(projectRoot, 'resources', 'prebuilt', 'cache', 'uv_tool');

  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(pythonCacheDir, { recursive: true });
  fs.mkdirSync(toolCacheDir, { recursive: true });

  const env = {
    ...process.env,
    UV_PYTHON_INSTALL_DIR: pythonCacheDir,
    UV_TOOL_DIR: toolCacheDir,
    UV_PROJECT_ENVIRONMENT: venvPath,
    UV_HTTP_TIMEOUT: '300',
  };

  const pyvenvCfg = path.join(venvPath, 'pyvenv.cfg');
  if (fs.existsSync(pyvenvCfg)) {
    console.log('✅ Python venv exists, syncing...');
  } else {
    console.log('📦 Creating Python venv...');
  }

  // Ensure Python is installed before syncing
  // This is critical for Windows where Python might not be in the venv
  console.log('🐍 Ensuring Python is installed...');
  try {
    execSync(
      `"${uvPath}" python install 3.10`,
      { cwd: BACKEND_DIR, env: env, stdio: 'inherit' }
    );
  } catch (error) {
    console.log('⚠️  Python install command failed, continuing with sync (Python may already be installed)...');
  }

  execSync(
    `"${uvPath}" sync --no-dev --cache-dir "${cacheDir}"`,
    { cwd: BACKEND_DIR, env: env, stdio: 'inherit' }
  );

  // Verify Python executable exists in the virtual environment
  const isWindows = process.platform === 'win32';
  const pythonExePath = isWindows
    ? path.join(venvPath, 'Scripts', 'python.exe')
    : path.join(venvPath, 'bin', 'python');

  if (!fs.existsSync(pythonExePath)) {
    throw new Error(
      `Python executable not found in virtual environment at: ${pythonExePath}\n` +
      `Virtual environment may be corrupted. Please ensure uv sync completed successfully.`
    );
  }

  console.log(`✅ Python executable verified: ${pythonExePath}`);
  console.log('✅ Python dependencies installed');

  console.log('📝 Compiling babel...');
  execSync(`"${uvPath}" run pybabel compile -d lang`, {
    cwd: BACKEND_DIR,
    env: env,
    stdio: 'inherit'
  });

  console.log('✅ Babel compiled');
}

/**
 * Install browser toolkit deps
 */
async function installBrowserToolkitDeps(uvPath, venvPath) {
  console.log('\n🌐 Installing browser toolkit...');

  try {
    const libPath = path.join(venvPath, 'lib');
    if (!fs.existsSync(libPath)) {
      console.log('⚠️  Skipping browser toolkit');
      return;
    }

    const pythonDir = fs.readdirSync(libPath).find(n => n.startsWith('python'));
    if (!pythonDir) {
      console.log('⚠️  Skipping browser toolkit');
      return;
    }

    const toolkitPath = path.join(libPath, pythonDir, 'site-packages', 'camel', 'toolkits', 'hybrid_browser_toolkit', 'ts');
    if (!fs.existsSync(toolkitPath)) {
      console.log('⚠️  Toolkit not found');
      return;
    }

    const nodeModulesPath = path.join(toolkitPath, 'node_modules');
    const distPath = path.join(toolkitPath, 'dist');
    if (fs.existsSync(nodeModulesPath) && fs.existsSync(distPath)) {
      console.log('✅ Browser toolkit already installed');
      return;
    }

    const npmCacheDir = path.join(venvPath, '.npm-cache');
    fs.mkdirSync(npmCacheDir, { recursive: true });

    const env = {
      ...process.env,
      UV_PROJECT_ENVIRONMENT: venvPath,
      npm_config_cache: npmCacheDir,
    };

    let npmCommand = 'npm';
    try {
      execSync('npm --version', { stdio: 'ignore' });
    } catch {
      npmCommand = `"${uvPath}" run npm`;
    }

    console.log('📦 Installing npm deps...');
    execSync(`${npmCommand} install`, { cwd: toolkitPath, env: env, stdio: 'inherit' });

    console.log('🔨 Building TS...');
    execSync(`${npmCommand} run build`, { cwd: toolkitPath, env: env, stdio: 'inherit' });

    console.log('🎭 Installing Playwright...');
    try {
      const npxCommand = npmCommand === 'npm' ? 'npx' : `"${uvPath}" run npx`;
      execSync(`${npxCommand} playwright install`, {
        cwd: toolkitPath,
        env: env,
        stdio: 'inherit',
        timeout: 600000
      });
    } catch (e) {
      console.log('⚠️  Playwright install failed (non-critical)');
    }

    console.log('✅ Browser toolkit installed');
  } catch (error) {
    console.error('❌ Browser toolkit failed:', error.message);
  }
}

/**
 * Main
 */
async function main() {
  try {
    const uvPath = await installUv();
    await installBun();
    await installPythonDeps(uvPath);
    await installBrowserToolkitDeps(uvPath, VENV_DIR);

    console.log('\n✅ All dependencies installed!');
    console.log(`📦 Binaries: ${BIN_DIR}`);
    console.log(`🐍 Python venv: ${VENV_DIR}`);
  } catch (error) {
    console.error('\n❌ Failed:', error);
    process.exit(1);
  }
}

main();
