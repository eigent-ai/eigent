import { spawn } from 'child_process'
import log from 'electron-log'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { app } from 'electron'


export function getResourcePath() {
  return path.join(app.getAppPath(), 'resources')
}

export function getBackendPath() {
  if (app.isPackaged) {
    //  after packaging, backend is in extraResources
    return path.join(process.resourcesPath, 'backend')
  } else {
    // development environment
    return path.join(app.getAppPath(), 'backend')
  }
}

export function runInstallScript(scriptPath: string): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const installScriptPath = path.join(getResourcePath(), 'scripts', scriptPath)
    log.info(`Running script at: ${installScriptPath}`)

    const nodeProcess = spawn(process.execPath, [installScriptPath], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    })

    nodeProcess.stdout.on('data', (data) => {
      log.info(`Script output: ${data}`)
    })

    nodeProcess.stderr.on('data', (data) => {
      log.error(`Script error: ${data}`)
    })

    nodeProcess.on('close', (code) => {
      if (code === 0) {
        log.info('Script completed successfully')
        resolve(true)
      } else {
        log.error(`Script exited with code ${code}`)
        reject(false)
      }
    })
  })
}

export async function getBinaryName(name: string): Promise<string> {
  if (process.platform === 'win32') {
    return `${name}.exe`
  }
  return name
}

export async function getBinaryPath(name?: string): Promise<string> {
  const binariesDir = path.join(os.homedir(), '.eigent', 'bin')

  // Ensure .eigent/bin directory exists
  if (!fs.existsSync(binariesDir)) {
    fs.mkdirSync(binariesDir, { recursive: true })
  }

  if (!name) {
    return binariesDir
  }

  const binaryName = await getBinaryName(name)
  return path.join(binariesDir, binaryName)
}

export function getCachePath(folder: string): string {
  const cacheDir = path.join(os.homedir(), '.eigent', 'cache', folder)

  // Ensure cache directory exists
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true })
  }

  return cacheDir
}

export function getVenvPath(version: string): string {
  const venvDir = path.join(os.homedir(), '.eigent', 'venvs', `backend-${version}`)

  // Ensure venvs directory exists (parent of the actual venv)
  const venvsBaseDir = path.dirname(venvDir)
  if (!fs.existsSync(venvsBaseDir)) {
    fs.mkdirSync(venvsBaseDir, { recursive: true })
  }

  return venvDir
}

export function getVenvsBaseDir(): string {
  return path.join(os.homedir(), '.eigent', 'venvs')
}

export async function cleanupOldVenvs(currentVersion: string): Promise<void> {
  const venvsBaseDir = getVenvsBaseDir()

  // Check if venvs directory exists
  if (!fs.existsSync(venvsBaseDir)) {
    return
  }

  try {
    const entries = fs.readdirSync(venvsBaseDir, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('backend-')) {
        const versionMatch = entry.name.match(/^backend-(.+)$/)
        if (versionMatch && versionMatch[1] !== currentVersion) {
          const oldVenvPath = path.join(venvsBaseDir, entry.name)
          console.log(`Cleaning up old venv: ${oldVenvPath}`)

          try {
            // Remove old venv directory recursively
            fs.rmSync(oldVenvPath, { recursive: true, force: true })
            console.log(`Successfully removed old venv: ${entry.name}`)
          } catch (err) {
            console.error(`Failed to remove old venv ${entry.name}:`, err)
          }
        }
      }
    }
  } catch (err) {
    console.error('Error during venv cleanup:', err)
  }
}

export async function isBinaryExists(name: string): Promise<boolean> {
  const cmd = await getBinaryPath(name)

  return await fs.existsSync(cmd)
}
