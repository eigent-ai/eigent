import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'
import AdmZip from 'adm-zip'
import { downloadWithRedirects } from './download.js'

// Base URL for downloading bun binaries
const BUN_RELEASE_BASE_URL = 'https://github.com/oven-sh/bun/releases/download'
const DEFAULT_BUN_VERSION = '1.2.9' // Default fallback version

// Mapping of platform+arch to binary package name
const BUN_PACKAGES = {
  'darwin-arm64': 'bun-darwin-aarch64.zip',
  'darwin-x64': 'bun-darwin-x64.zip',
  'win32-x64': 'bun-windows-x64.zip',
  'win32-x64-baseline': 'bun-windows-x64-baseline.zip',
  'linux-x64': 'bun-linux-x64.zip',
  'linux-x64-baseline': 'bun-linux-x64-baseline.zip',
  'linux-arm64': 'bun-linux-aarch64.zip',
  // MUSL variants
  'linux-musl-x64': 'bun-linux-x64-musl.zip',
  'linux-musl-x64-baseline': 'bun-linux-x64-musl-baseline.zip',
  'linux-musl-arm64': 'bun-linux-aarch64-musl.zip'
}

/**
 * Downloads and extracts the bun binary for the specified platform and architecture
 * @param {string} platform Platform to download for (e.g., 'darwin', 'win32', 'linux')
 * @param {string} arch Architecture to download for (e.g., 'x64', 'arm64')
 * @param {string} version Version of bun to download
 * @param {boolean} isMusl Whether to use MUSL variant for Linux
 * @param {boolean} isBaseline Whether to use baseline variant
 */
async function downloadBunBinary(bun_download_url,platform, arch, version = DEFAULT_BUN_VERSION, isMusl = false, isBaseline = false) {
  let platformKey = isMusl ? `${platform}-musl-${arch}` : `${platform}-${arch}`
  if (isBaseline) {
    platformKey += '-baseline'
  }
  const packageName = BUN_PACKAGES[platformKey]

  if (!packageName) {
    console.error(`No binary available for ${platformKey}`)
    return false
  }

  // Create output directory structure
  const binDir = path.join(os.homedir(), '.eigent', 'bin')
  // Ensure directories exist
  fs.mkdirSync(binDir, { recursive: true })

  // Download URL for the specific binary
  const downloadUrl = `${bun_download_url}/bun-v${version}/${packageName}`
  const tempdir = os.tmpdir()
  // Create a temporary file for the downloaded binary
  const tempFilename = path.join(tempdir, packageName)

  try {
    console.log(`Downloading bun ${version} for ${platformKey}...`)
    console.log(`URL: ${downloadUrl}`)
    if (fs.existsSync(tempFilename)) fs.unlinkSync(tempFilename)
    // Use the new download function
    await downloadWithRedirects(downloadUrl, tempFilename)

    // Extract the zip file using adm-zip
    console.log(`Extracting ${packageName} to ${binDir}...`)
    const zip = new AdmZip(tempFilename)
    
    // Get all entries and find the bun binary
    const entries = zip.getEntries()
    let bunFound = false
    
    for (const entry of entries) {
      const entryName = entry.entryName
      // Look for the bun binary (could be in root or in a subdirectory)
      if (entryName === 'bun' || entryName === 'bun.exe' || 
          entryName.endsWith('/bun') || entryName.endsWith('/bun.exe') ||
          entryName.endsWith('\\bun') || entryName.endsWith('\\bun.exe')) {
        
        // Extract just the binary name
        const fileName = path.basename(entryName)
        const destPath = path.join(binDir, fileName)
        
        // Extract the specific file
        zip.extractEntryTo(entry, binDir, false, true)
        
        // Set executable permissions for non-Windows platforms
        if (platform !== 'win32' && fileName === 'bun') {
          try {
            fs.chmodSync(destPath, '755')
          } catch (error) {
            console.warn(`Warning: Failed to set executable permissions: ${error.message}`)
          }
        }
        
        bunFound = true
      }
    }
    
    if (!bunFound) {
      throw new Error('bun binary not found in archive')
    }

    // Clean up
    fs.unlinkSync(tempFilename)

    console.log(`Successfully installed bun ${version} for ${platformKey}`)
    return true
  } catch (error) {
    console.error(`Error installing bun for ${platformKey}: ${error.message}`)
    // Clean up temporary file if it exists
    if (fs.existsSync(tempFilename)) {
      fs.unlinkSync(tempFilename)
    }

    // Check if binDir is empty and remove it if so
    try {
      const files = fs.readdirSync(binDir)
      if (files.length === 0) {
        fs.rmSync(binDir, { recursive: true })
        console.log(`Removed empty directory: ${binDir}`)
      }
    } catch (cleanupError) {
      console.warn(`Warning: Failed to clean up directory: ${cleanupError.message}`)
    }

    return false
  }
}

/**
 * Detects current platform and architecture
 */
function detectPlatformAndArch() {
  const platform = os.platform()
  const arch = os.arch()
  const isMusl = platform === 'linux' && detectIsMusl()
  const isBaseline = platform === 'win32'

  return { platform, arch, isMusl, isBaseline }
}

/**
 * Attempts to detect if running on MUSL libc
 */
function detectIsMusl() {
  try {
    // Simple check for Alpine Linux which uses MUSL
    const output = execSync('cat /etc/os-release').toString()
    return output.toLowerCase().includes('alpine')
  } catch (error) {
    return false
  }
}

/**
 * Main function to install bun
 */
async function installBun() {
  // Get the latest version if no specific version is provided
  const version = DEFAULT_BUN_VERSION
  console.log(`Using bun version: ${version}`)

  const { platform, arch, isMusl, isBaseline } = detectPlatformAndArch()

  console.log(
    `Installing bun ${version} for ${platform}-${arch}${isMusl ? ' (MUSL)' : ''}${isBaseline ? ' (baseline)' : ''}...`
  )

  const isInstalled = await downloadBunBinary(BUN_RELEASE_BASE_URL,platform, arch, version, isMusl, isBaseline)
  if(!isInstalled){
    // Wait for the file lock handle to be released
    await new Promise(r => setTimeout(r, 200))
    console.log('Downloading bun from gitcode.com')
    await downloadBunBinary('https://gitcode.com/CherryHQ/bun/releases/download',platform, arch, version, isMusl, isBaseline)
  }
}

// Run the installation
installBun()
  .then(() => {
    console.log('Installation successful')
    process.exit(0)
  })
  .catch((error) => {
    console.error('Installation failed:', error)
    process.exit(1)
  })
