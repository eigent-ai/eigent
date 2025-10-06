import { vi } from 'vitest'

/**
 * Environment state management for testing installation flows
 * This module provides utilities to simulate different system states
 */

export interface MockEnvironmentState {
  filesystem: {
    venvExists: boolean
    versionFileExists: boolean
    versionFileContent: string
    installingLockExists: boolean
    installedLockExists: boolean
    backendPathExists: boolean
    pyprojectExists: boolean
    // New fields for process.ts functions
    eigentDirExists: boolean
    eigentBinDirExists: boolean
    eigentCacheDirExists: boolean
    eigentVenvsDirExists: boolean
    eigentRuntimeDirExists: boolean
    resourcesDirExists: boolean
    binariesExist: { [name: string]: boolean }
    oldVenvsExist: string[] // List of old venv directories that exist
  }
  processes: {
    uvAvailable: boolean
    bunAvailable: boolean
    uvicornRunning: boolean
    uvSyncInProgress: boolean
    installationInProgress: boolean
  }
  app: {
    currentVersion: string
    userData: string
    appPath: string
    isPackaged: boolean
    resourcesPath: string
  }
  system: {
    platform: 'win32' | 'darwin' | 'linux'
    homedir: string
  }
  network: {
    canConnectToMirror: boolean
    canConnectToDefault: boolean
  }
}

/**
 * Mock implementations for Node.js fs module
 */
export function createFileSystemMock() {
  const mockState: MockEnvironmentState = {
    filesystem: {
      venvExists: true,
      versionFileExists: true,
      versionFileContent: '1.0.0',
      installingLockExists: false,
      installedLockExists: true,
      backendPathExists: true,
      pyprojectExists: true,
      eigentDirExists: true,
      eigentBinDirExists: true,
      eigentCacheDirExists: true,
      eigentVenvsDirExists: true,
      eigentRuntimeDirExists: true,
      resourcesDirExists: true,
      binariesExist: { 'uv': true, 'bun': true },
      oldVenvsExist: []
    },
    processes: {
      uvAvailable: true,
      bunAvailable: true,
      uvicornRunning: false,
      uvSyncInProgress: false,
      installationInProgress: false,
    },
    app: {
      currentVersion: '1.0.0',
      userData: '/mock/user/data',
      appPath: '/mock/app/path',
      isPackaged: false,
      resourcesPath: '/mock/resources/path'
    },
    system: {
      platform: 'win32',
      homedir: '/mock/home'
    },
    network: {
      canConnectToMirror: true,
      canConnectToDefault: true,
    }
  }

  const fsMock = {
    existsSync: vi.fn().mockImplementation((path: string) => {
      if (!path || typeof path !== 'string') return false
      if (path.includes('version.txt')) return mockState.filesystem.versionFileExists
      if (path.includes('uv_installing.lock')) return mockState.filesystem.installingLockExists
      if (path.includes('uv_installed.lock')) return mockState.filesystem.installedLockExists
      if (path.includes('.venv')) return mockState.filesystem.venvExists
      if (path.includes('backend')) return mockState.filesystem.backendPathExists
      if (path.includes('pyproject.toml')) return mockState.filesystem.pyprojectExists
      if (path.includes('.eigent/bin') || path.includes('.eigent\\bin')) return mockState.filesystem.eigentBinDirExists
      if (path.includes('.eigent/cache') || path.includes('.eigent\\cache')) return mockState.filesystem.eigentCacheDirExists
      if (path.includes('.eigent/venvs') || path.includes('.eigent\\venvs')) return mockState.filesystem.eigentVenvsDirExists
      if (path.includes('.eigent/runtime') || path.includes('.eigent\\runtime')) return mockState.filesystem.eigentRuntimeDirExists
      if (path.includes('.eigent') && !path.includes('bin') && !path.includes('cache') && !path.includes('venvs') && !path.includes('runtime')) {
        return mockState.filesystem.eigentDirExists
      }
      if (path.includes('resources')) return mockState.filesystem.resourcesDirExists
      // Check for specific binaries
      for (const [name, exists] of Object.entries(mockState.filesystem.binariesExist)) {
        if (path.includes(name + '.exe') || path.endsWith(name)) {
          return exists
        }
      }
      // Check for old venv directories
      for (const oldVenv of mockState.filesystem.oldVenvsExist) {
        if (path.includes(oldVenv)) return true
      }
      return true
    }),

    readFileSync: vi.fn().mockImplementation((path: string, encoding?: string) => {
      if (!path || typeof path !== 'string') return ''
      if (path.includes('version.txt')) {
        return mockState.filesystem.versionFileContent
      }
      if (path.includes('pyproject.toml')) {
        return `
[project]
name = "backend"
version = "1.0.0"
dependencies = ["fastapi", "uvicorn"]
        `
      }
      return ''
    }),

    writeFileSync: vi.fn().mockImplementation((path: string, content: string) => {
      if (!path || typeof path !== 'string') return
      if (path.includes('version.txt')) {
        mockState.filesystem.versionFileContent = content
        mockState.filesystem.versionFileExists = true
      } else if (path.includes('uv_installing.lock')) {
        mockState.filesystem.installingLockExists = true
      } else if (path.includes('uv_installed.lock')) {
        mockState.filesystem.installedLockExists = true
      }
    }),

    unlinkSync: vi.fn().mockImplementation((path: string) => {
      if (!path || typeof path !== 'string') return
      if (path.includes('uv_installing.lock')) {
        mockState.filesystem.installingLockExists = false
      } else if (path.includes('uv_installed.lock')) {
        mockState.filesystem.installedLockExists = false
      } else if (path.includes('version.txt')) {
        mockState.filesystem.versionFileExists = false
      }
    }),

    mkdirSync: vi.fn().mockImplementation((path: string, options?: any) => {
      if (!path || typeof path !== 'string') return
      if (path.includes('backend')) {
        mockState.filesystem.backendPathExists = true
      } else if (path.includes('.eigent/bin') || path.includes('.eigent\\bin')) {
        mockState.filesystem.eigentBinDirExists = true
      } else if (path.includes('.eigent/cache') || path.includes('.eigent\\cache')) {
        mockState.filesystem.eigentCacheDirExists = true
      } else if (path.includes('.eigent/venvs') || path.includes('.eigent\\venvs')) {
        mockState.filesystem.eigentVenvsDirExists = true
      } else if (path.includes('.eigent/runtime') || path.includes('.eigent\\runtime')) {
        mockState.filesystem.eigentRuntimeDirExists = true
      } else if (path.includes('.eigent')) {
        mockState.filesystem.eigentDirExists = true
      }
    }),

    rmSync: vi.fn().mockImplementation((path: string, options?: any) => {
      if (!path || typeof path !== 'string') return
      // Handle cleanup of old venvs
      for (let i = 0; i < mockState.filesystem.oldVenvsExist.length; i++) {
        if (path.includes(mockState.filesystem.oldVenvsExist[i])) {
          mockState.filesystem.oldVenvsExist.splice(i, 1)
          break
        }
      }
    }),

    readdirSync: vi.fn().mockImplementation((path: string, options?: any) => {
      if (!path || typeof path !== 'string') return []
      if (path.includes('.eigent/venvs')) {
        // Return old venv directories for cleanup testing
        return mockState.filesystem.oldVenvsExist.map(venv => ({
          name: venv,
          isDirectory: () => true
        }))
      }
      return []
    }),

    // State control methods
    mockState,
    
    reset: () => {
      Object.assign(mockState, {
        filesystem: {
          venvExists: true,
          versionFileExists: true,
          versionFileContent: '1.0.0',
          installingLockExists: false,
          installedLockExists: true,
          backendPathExists: true,
          pyprojectExists: true,
          eigentDirExists: true,
          eigentBinDirExists: true,
          eigentCacheDirExists: true,
          eigentVenvsDirExists: true,
          eigentRuntimeDirExists: true,
          resourcesDirExists: true,
          binariesExist: { 'uv': true, 'bun': true },
          oldVenvsExist: []
        },
        processes: {
          uvAvailable: true,
          bunAvailable: true,
          uvicornRunning: false,
          uvSyncInProgress: false,
          installationInProgress: false,
        },
        app: {
          currentVersion: '1.0.0',
          userData: '/mock/user/data',
          appPath: '/mock/app/path',
          isPackaged: false,
          resourcesPath: '/mock/resources/path'
        },
        system: {
          platform: 'win32',
          homedir: '/mock/home'
        },
        network: {
          canConnectToMirror: true,
          canConnectToDefault: true,
        }
      })
    }
  }

  return fsMock
}

/**
 * Mock implementations for child_process spawn
 */
export function createProcessMock() {
  const processMock = {
    spawn: vi.fn(),
    mockState: {} as MockEnvironmentState,
    
    setupSpawnMock: (mockState: MockEnvironmentState) => {
      processMock.mockState = mockState
      
      processMock.spawn.mockImplementation((command: string, args: string[], options: any) => {
        // Mock process events
        const mockProcess = {
          stdout: {
            on: vi.fn().mockImplementation((event: string, callback: (data: Buffer) => void) => {
              if (event === 'data') {
                // Simulate different process outputs based on command
                setTimeout(() => {
                  if (command.includes('uv') && args.includes('sync')) {
                    mockState.processes.uvSyncInProgress = true
                    callback(Buffer.from('Resolved 10 packages in 1.2s\n'))
                    setTimeout(() => {
                      callback(Buffer.from('Installing packages...\n'))
                      setTimeout(() => {
                        callback(Buffer.from('Installation complete\n'))
                        mockState.processes.uvSyncInProgress = false
                      }, 100)
                    }, 50)
                  } else if (command.includes('uvicorn')) {
                    mockState.processes.uvicornRunning = true
                    callback(Buffer.from('Uvicorn running on http://127.0.0.1:8000\n'))
                  }
                }, 10)
              }
            })
          },
          stderr: {
            on: vi.fn().mockImplementation((event: string, callback: (data: Buffer) => void) => {
              if (event === 'data') {
                // Simulate error scenarios
                if (!mockState.processes.uvAvailable && command.includes('uv')) {
                  setTimeout(() => {
                    callback(Buffer.from('uv: command not found\n'))
                  }, 10)
                }
              }
            })
          },
          on: vi.fn().mockImplementation((event: string, callback: (code: number) => void) => {
            if (event === 'close') {
              setTimeout(() => {
                if (command.includes('uv') && args.includes('sync')) {
                  const exitCode = mockState.processes.uvAvailable && 
                                   mockState.network.canConnectToDefault ? 0 : 1
                  callback(exitCode)
                } else {
                  callback(0)
                }
              }, 150)
            }
          }),
          kill: vi.fn()
        }
        
        return mockProcess
      })
    },
    
    reset: () => {
      processMock.spawn.mockReset()
    }
  }
  
  return processMock
}

/**
 * Mock for Electron app module
 */
export function createElectronAppMock() {
  const appMock = {
    getVersion: vi.fn(),
    getPath: vi.fn(),
    getAppPath: vi.fn(),
    isPackaged: false,
    mockState: {} as MockEnvironmentState,
    
    setup: (mockState: MockEnvironmentState) => {
      appMock.mockState = mockState
      appMock.getVersion.mockReturnValue(mockState.app.currentVersion)
      appMock.getAppPath.mockReturnValue(mockState.app.appPath)
      appMock.isPackaged = mockState.app.isPackaged
      appMock.getPath.mockImplementation((name: string) => {
        if (name === 'userData') return mockState.app.userData
        return '/mock/path'
      })
      
      // Mock process.resourcesPath for packaged apps
      if (mockState.app.isPackaged) {
        Object.defineProperty(process, 'resourcesPath', {
          value: mockState.app.resourcesPath,
          configurable: true
        })
      }
    },
    
    reset: () => {
      appMock.getVersion.mockReset()
      appMock.getPath.mockReset()
      appMock.getAppPath.mockReset()
    }
  }
  
  return appMock
}

/**
 * Mock for OS module
 */
export function createOsMock() {
  const osMock = {
    homedir: vi.fn().mockReturnValue('/mock/home'),
    mockState: {} as MockEnvironmentState,
    
    setup: (mockState: MockEnvironmentState) => {
      osMock.mockState = mockState
      osMock.homedir.mockReturnValue(mockState.system.homedir || '/mock/home')
    },
    
    reset: () => {
      osMock.homedir.mockReset()
      osMock.homedir.mockReturnValue('/mock/home')
    }
  }
  
  return osMock
}

/**
 * Mock for path module
 */
export function createPathMock() {
  return {
    join: vi.fn((...args) => {
      const validArgs = args.filter(arg => arg != null && arg !== undefined && arg !== '')
      return validArgs.length > 0 ? validArgs.join(process.platform === 'win32' ? '\\' : '/') : ''
    }),
    resolve: vi.fn((...args) => {
      const validArgs = args.filter(arg => arg != null && arg !== undefined && arg !== '')
      return validArgs.length > 0 ? validArgs.join(process.platform === 'win32' ? '\\' : '/') : ''
    }),
    dirname: vi.fn((path: string) => {
      if (!path || typeof path !== 'string') return ''
      const parts = path.split(process.platform === 'win32' ? '\\' : '/')
      return parts.slice(0, -1).join(process.platform === 'win32' ? '\\' : '/')
    })
  }
}

/**
 * Mock for process utilities from electron/main/utils/process.ts
 */
export function createProcessUtilsMock() {
  const utilsMock = {
    getResourcePath: vi.fn(),
    getBackendPath: vi.fn(),
    runInstallScript: vi.fn(),
    getBinaryName: vi.fn(),
    getBinaryPath: vi.fn(),
    getCachePath: vi.fn(),
    getVenvPath: vi.fn(),
    getVenvsBaseDir: vi.fn(),
    cleanupOldVenvs: vi.fn(),
    isBinaryExists: vi.fn(),
    mockState: {} as MockEnvironmentState,
    
    setup: (mockState: MockEnvironmentState) => {
      utilsMock.mockState = mockState
      
      utilsMock.getResourcePath.mockReturnValue(
        `${mockState.app.appPath}/resources`
      )
      
      utilsMock.getBackendPath.mockReturnValue(
        mockState.app.isPackaged 
          ? `${mockState.app.resourcesPath}/backend`
          : `${mockState.app.appPath}/backend`
      )
      
      utilsMock.runInstallScript.mockImplementation(async (scriptPath: string) => {
        // Simulate successful script execution and update binary state
        if (scriptPath.includes('install-uv')) {
          mockState.filesystem.binariesExist['uv'] = true
          mockState.processes.uvAvailable = true
        } else if (scriptPath.includes('install-bun')) {
          mockState.filesystem.binariesExist['bun'] = true
          mockState.processes.bunAvailable = true
        }
        return true
      })
      
      utilsMock.getBinaryName.mockImplementation(async (name: string) => {
        return mockState.system.platform === 'win32' ? `${name}.exe` : name
      })
      
      utilsMock.getBinaryPath.mockImplementation(async (name?: string) => {
        const binDir = `${mockState.system.homedir}/.eigent/bin`
        if (!name) return binDir
        const binaryName = mockState.system.platform === 'win32' ? `${name}.exe` : name
        return `${binDir}/${binaryName}`
      })
      
      utilsMock.getCachePath.mockImplementation((folder: string) => {
        return `${mockState.system.homedir}/.eigent/cache/${folder}`
      })
      
      utilsMock.getVenvPath.mockImplementation((version: string) => {
        return `${mockState.system.homedir}/.eigent/venvs/backend-${version}`
      })
      
      utilsMock.getVenvsBaseDir.mockReturnValue(
        `${mockState.system.homedir}/.eigent/venvs`
      )
      
      utilsMock.cleanupOldVenvs.mockImplementation(async (currentVersion: string) => {
        // Simulate cleanup by removing old venvs from mock state
        mockState.filesystem.oldVenvsExist = mockState.filesystem.oldVenvsExist.filter(
          venv => venv.includes(`backend-${currentVersion}`)
        )
      })
      
      utilsMock.isBinaryExists.mockImplementation(async (name: string) => {
        return mockState.filesystem.binariesExist[name] || false
      })
    },
    
    reset: () => {
      Object.values(utilsMock).forEach(fn => {
        if (typeof fn === 'function' && 'mockReset' in fn) {
          fn.mockReset()
        }
      })
    }
  }
  
  return utilsMock
}

/**
 * Mock for electron-log
 */
export function createLogMock() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }
}

/**
 * Complete environment setup for testing
 * Note: vi.mock calls should be done at the top level of test files, not here
 */
export function setupMockEnvironment() {
  const fsMock = createFileSystemMock()
  const processMock = createProcessMock()
  const appMock = createElectronAppMock()
  const osMock = createOsMock()
  const pathMock = createPathMock()
  const processUtilsMock = createProcessUtilsMock()
  const logMock = createLogMock()
  
  // Set up the shared state
  processMock.setupSpawnMock(fsMock.mockState)
  appMock.setup(fsMock.mockState)
  osMock.setup(fsMock.mockState)
  processUtilsMock.setup(fsMock.mockState)
  
  return {
    fsMock,
    processMock,
    appMock,
    osMock,
    pathMock,
    processUtilsMock,
    logMock,
    mockState: fsMock.mockState,
    
    // Utility functions for test scenarios
    scenarios: {
      freshInstall: () => {
        fsMock.mockState.filesystem.venvExists = false
        fsMock.mockState.filesystem.versionFileExists = false
        fsMock.mockState.filesystem.installedLockExists = false
        fsMock.mockState.filesystem.binariesExist = { 'uv': false, 'bun': false }
        fsMock.mockState.processes.uvAvailable = false
        fsMock.mockState.processes.bunAvailable = false
      },
      
      versionUpdate: (oldVersion: string, newVersion: string) => {
        fsMock.mockState.filesystem.versionFileContent = oldVersion
        fsMock.mockState.app.currentVersion = newVersion
        appMock.getVersion.mockReturnValue(newVersion)
      },
      
      venvRemoved: () => {
        fsMock.mockState.filesystem.venvExists = false
        fsMock.mockState.filesystem.installedLockExists = false
      },
      
      networkIssues: () => {
        fsMock.mockState.network.canConnectToDefault = false
        fsMock.mockState.network.canConnectToMirror = true
      },
      
      completeFailure: () => {
        fsMock.mockState.network.canConnectToDefault = false
        fsMock.mockState.network.canConnectToMirror = false
        fsMock.mockState.processes.uvAvailable = false
        fsMock.mockState.filesystem.binariesExist = { 'uv': false, 'bun': false }
        
        // Note: installCommandTool is defined in the install-deps module, 
        // not in process utils, so it should be mocked in the test itself
      },
      
      uvicornStartupInstall: () => {
        fsMock.mockState.processes.uvicornRunning = false
        fsMock.mockState.filesystem.installedLockExists = false
        // Uvicorn will detect missing deps and start installation
      },
      
      installationInProgress: () => {
        fsMock.mockState.filesystem.installingLockExists = true
        fsMock.mockState.processes.installationInProgress = true
      },

      // New scenarios for process.ts testing
      packagedApp: () => {
        fsMock.mockState.app.isPackaged = true
        appMock.isPackaged = true
      },

      multipleOldVenvs: (currentVersion: string) => {
        fsMock.mockState.filesystem.oldVenvsExist = [
          'backend-0.9.0',
          'backend-0.9.5', 
          'backend-1.0.1-beta',
          `backend-${currentVersion}` // This should not be cleaned up
        ]
      },

      macOSEnvironment: () => {
        fsMock.mockState.system.platform = 'darwin'
        Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
      },

      linuxEnvironment: () => {
        fsMock.mockState.system.platform = 'linux'
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
      },

      missingEigentDirectories: () => {
        fsMock.mockState.filesystem.eigentDirExists = false
        fsMock.mockState.filesystem.eigentBinDirExists = false
        fsMock.mockState.filesystem.eigentCacheDirExists = false
        fsMock.mockState.filesystem.eigentVenvsDirExists = false
        fsMock.mockState.filesystem.eigentRuntimeDirExists = false
      }
    },
    
    reset: () => {
      fsMock.reset()
      processMock.reset()
      appMock.reset()
      osMock.reset()
      processUtilsMock.reset()
      
      // Reset process.platform to original
      Object.defineProperty(process, 'platform', { 
        value: 'win32', 
        configurable: true 
      })
    }
  }
}

/**
 * Factory functions for creating mocks that can be used in vi.mock calls
 * These should be called at the top level of test files
 */
export function createMockFactories() {
  return {
    fs: () => createFileSystemMock(),
    childProcess: () => createProcessMock(),
    os: () => ({ default: createOsMock() }),
    path: () => ({ default: createPathMock() }),
    electron: () => ({
      app: createElectronAppMock(),
      BrowserWindow: vi.fn()
    }),
    electronLog: () => ({ default: createLogMock() }),
    processUtils: () => createProcessUtilsMock()
  }
}

/**
 * Test utility to wait for async state changes
 */
export function waitForStateChange<T>(
  stateGetter: () => T,
  expectedValue: T,
  timeout: number = 1000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now()
    
    const check = () => {
      if (stateGetter() === expectedValue) {
        resolve()
      } else if (Date.now() - startTime > timeout) {
        reject(new Error(`Timeout waiting for state change. Expected: ${expectedValue}, got: ${stateGetter()}`))
      } else {
        setTimeout(check, 10)
      }
    }
    
    check()
  })
}