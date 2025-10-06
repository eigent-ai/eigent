import { vi } from 'vitest'

export interface MockedElectronAPI {
  // Mock environment state that can be controlled in tests
  mockState: {
    venvExists: boolean
    versionFileExists: boolean
    currentVersion: string
    savedVersion: string
    isInstalling: boolean
    installedLockExists: boolean
    uvicornStarting: boolean
    toolInstalled: boolean
    allowForceInstall: boolean
    // Environment-related state
    envFileExists: boolean
    envContent: string
    eigentDirExists: boolean
    userEmail: string
    mcpRemoteConfigExists: boolean
    hasToken: boolean
  }
  
  // Mock implementation functions
  checkAndInstallDepsOnUpdate: ReturnType<typeof vi.fn>
  getInstallationStatus: ReturnType<typeof vi.fn>
  exportLog: ReturnType<typeof vi.fn>
  onInstallDependenciesStart: ReturnType<typeof vi.fn>
  onInstallDependenciesLog: ReturnType<typeof vi.fn>
  onInstallDependenciesComplete: ReturnType<typeof vi.fn>
  removeAllListeners: ReturnType<typeof vi.fn>
  
  // EnvUtil mock functions
  getEnvPath: ReturnType<typeof vi.fn>
  updateEnvBlock: ReturnType<typeof vi.fn>
  removeEnvKey: ReturnType<typeof vi.fn>
  getEmailFolderPath: ReturnType<typeof vi.fn>
  parseEnvBlock: ReturnType<typeof vi.fn>
  
  // Test utilities
  simulateInstallationStart: () => void
  simulateInstallationLog: (type: 'stdout' | 'stderr', data: string) => void
  simulateInstallationComplete: (success: boolean, error?: string) => void
  simulateVersionChange: (newVersion: string) => void
  simulateVenvRemoval: () => void
  simulateUvicornStartup: () => void
  simulateEnvCorruption: () => void
  simulateUserEmailChange: (email: string) => void
  simulateMcpConfigMissing: () => void
  reset: () => void
}

export interface MockedIpcRenderer {
  invoke: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  removeAllListeners: ReturnType<typeof vi.fn>
}

/**
 * Creates a comprehensive mock for the Electron API
 * This mock can simulate all the different installation scenarios
 */
export function createElectronAPIMock(): MockedElectronAPI {
  // Listeners for simulation
  const installStartListeners: Array<() => void> = []
  const installLogListeners: Array<(data: { type: string; data: string }) => void> = []
  const installCompleteListeners: Array<(data: { success: boolean; code?: number; error?: string }) => void> = []

  const mockState = {
    venvExists: true,
    versionFileExists: true,
    currentVersion: '1.0.0',
    savedVersion: '1.0.0',
    isInstalling: false,
    installedLockExists: true,
    uvicornStarting: false,
    toolInstalled: true,
    allowForceInstall: false,
    // Environment-related state
    envFileExists: true,
    envContent: 'MOCK_VAR=mock_value\n# === MCP INTEGRATION ENV START ===\nMCP_KEY=test_value\n# === MCP INTEGRATION ENV END ===',
    eigentDirExists: true,
    userEmail: 'test@example.com',
    mcpRemoteConfigExists: true,
    hasToken: true,
  }

  const electronAPI: MockedElectronAPI = {
    mockState,

    // Core API functions
    checkAndInstallDepsOnUpdate: vi.fn().mockImplementation(async () => {
      const { versionFileExists, currentVersion, savedVersion, allowForceInstall, venvExists, toolInstalled } = mockState
      
      // Simulate the real implementation logic that checks:
      // 1. Version file existence and version match
      // 2. Virtual environment existence
      // 3. Command tools installation status
      const versionChanged = !versionFileExists || savedVersion !== currentVersion
      const needsInstallation = allowForceInstall || versionChanged || !venvExists || !toolInstalled
      
      if (needsInstallation) {
        // Log the reason for installation
        if (!toolInstalled) {
          electronAPI.simulateInstallationLog('stdout', 'Command tools missing, starting installation...')
        } else if (!venvExists) {
          electronAPI.simulateInstallationLog('stdout', 'Virtual environment missing, starting installation...')
        } else if (versionChanged) {
          electronAPI.simulateInstallationLog('stdout', 'Version changed, starting installation...')
        }
        
        // Trigger installation
        electronAPI.simulateInstallationStart()
        
        // Simulate installation process with delay
        setTimeout(() => {
          electronAPI.simulateInstallationLog('stdout', 'Resolving dependencies...')
          setTimeout(() => {
            electronAPI.simulateInstallationLog('stdout', 'Installing packages...')
            setTimeout(() => {
              electronAPI.simulateInstallationComplete(true)
              // Update state after successful installation
              mockState.venvExists = true
              mockState.toolInstalled = true
              mockState.installedLockExists = true
            }, 100)
          }, 100)
        }, 50)
        
        return { success: true, message: 'Dependencies installed successfully after update' }
      } else {
        return { success: true, message: 'Version not changed, venv exists, and tools installed - skipped installation' }
      }
    }),

    getInstallationStatus: vi.fn().mockImplementation(async () => {
      return {
        success: true,
        isInstalling: mockState.isInstalling,
        hasLockFile: mockState.isInstalling || mockState.installedLockExists,
        installedExists: mockState.installedLockExists
      }
    }),

    exportLog: vi.fn().mockImplementation(async () => {
      return {
        success: true,
        savedPath: '/mock/path/to/log.txt'
      }
    }),

    // Event listeners
    onInstallDependenciesStart: vi.fn().mockImplementation((callback: () => void) => {
      installStartListeners.push(callback)
    }),

    onInstallDependenciesLog: vi.fn().mockImplementation((callback: (data: { type: string; data: string }) => void) => {
      installLogListeners.push(callback)
    }),

    onInstallDependenciesComplete: vi.fn().mockImplementation((callback: (data: { success: boolean; code?: number; error?: string }) => void) => {
      installCompleteListeners.push(callback)
    }),

    removeAllListeners: vi.fn().mockImplementation(() => {
      installStartListeners.length = 0
      installLogListeners.length = 0
      installCompleteListeners.length = 0
    }),

    // EnvUtil mock functions
    getEnvPath: vi.fn().mockImplementation((email: string) => {
      const sanitizedEmail = email.split("@")[0].replace(/[\\/*?:"<>|\s]/g, "_").replace(".", "_")
      return `/mock/home/.eigent/.env.${sanitizedEmail}`
    }),

    updateEnvBlock: vi.fn().mockImplementation((lines: string[], kv: Record<string, string>) => {
      // Mock implementation that adds/updates environment variables in the MCP block
      const startMarker = '# === MCP INTEGRATION ENV START ==='
      const endMarker = '# === MCP INTEGRATION ENV END ==='
      
      let start = lines.findIndex(l => l.trim() === startMarker)
      let end = lines.findIndex(l => l.trim() === endMarker)
      
      if (start === -1 || end === -1) {
        // No block exists, create one
        lines.push(startMarker)
        Object.entries(kv).forEach(([k, v]) => {
          lines.push(`${k}=${v}`)
        })
        lines.push(endMarker)
        return lines
      }
      
      // Update existing block
      const newBlock = Object.entries(kv).map(([k, v]) => `${k}=${v}`)
      return [
        ...lines.slice(0, start + 1),
        ...newBlock,
        ...lines.slice(end)
      ]
    }),

    removeEnvKey: vi.fn().mockImplementation((lines: string[], key: string) => {
      // Mock implementation that removes a key from the MCP block
      const startMarker = '# === MCP INTEGRATION ENV START ==='
      const endMarker = '# === MCP INTEGRATION ENV END ==='
      
      let start = lines.findIndex(l => l.trim() === startMarker)
      let end = lines.findIndex(l => l.trim() === endMarker)
      
      if (start === -1 || end === -1) return lines
      
      const block = lines.slice(start + 1, end)
      const newBlock = block.filter(line => !line.startsWith(key + '='))
      
      return [
        ...lines.slice(0, start + 1),
        ...newBlock,
        ...lines.slice(end)
      ]
    }),

    getEmailFolderPath: vi.fn().mockImplementation((email: string) => {
      const sanitizedEmail = email.split("@")[0].replace(/[\\/*?:"<>|\s]/g, "_").replace(".", "_")
      return {
        MCP_REMOTE_CONFIG_DIR: `/mock/home/.eigent/${sanitizedEmail}`,
        MCP_CONFIG_DIR: '/mock/home/.eigent',
        tempEmail: sanitizedEmail,
        hasToken: mockState.hasToken
      }
    }),

    parseEnvBlock: vi.fn().mockImplementation((content: string) => {
      const lines = content.split(/\r?\n/)
      const startMarker = '# === MCP INTEGRATION ENV START ==='
      const endMarker = '# === MCP INTEGRATION ENV END ==='
      
      let start = lines.findIndex(l => l.trim() === startMarker)
      let end = lines.findIndex(l => l.trim() === endMarker)
      
      if (start === -1) start = lines.length
      if (end === -1) end = lines.length
      
      return { lines, start, end }
    }),

    // Simulation utilities
    simulateInstallationStart: () => {
      mockState.isInstalling = true
      installStartListeners.forEach(listener => listener())
    },

    simulateInstallationLog: (type: 'stdout' | 'stderr', data: string) => {
      installLogListeners.forEach(listener => listener({ type, data }))
    },

    simulateInstallationComplete: (success: boolean, error?: string) => {
      mockState.isInstalling = false
      if (success) {
        mockState.installedLockExists = true
      }
      installCompleteListeners.forEach(listener => 
        listener({ success, error, code: success ? 0 : 1 })
      )
    },

    simulateVersionChange: (newVersion: string) => {
      mockState.currentVersion = newVersion
      // This simulates a version mismatch scenario
    },

    simulateVenvRemoval: () => {
      mockState.venvExists = false
      mockState.installedLockExists = false
      // Don't remove version file - this simulates venv being deleted but version file still existing
    },

    simulateUvicornStartup: () => {
      mockState.uvicornStarting = true
      // Simulate uvicorn detecting dependency installation need
      setTimeout(() => {
        electronAPI.simulateInstallationStart()
        electronAPI.simulateInstallationLog('stdout', 'Uvicorn detected missing dependencies')
        electronAPI.simulateInstallationLog('stdout', 'Resolving dependencies...')
        setTimeout(() => {
          electronAPI.simulateInstallationLog('stdout', 'Uvicorn running on http://127.0.0.1:8000')
          electronAPI.simulateInstallationComplete(true)
          mockState.uvicornStarting = false
        }, 200)
      }, 100)
    },

    simulateEnvCorruption: () => {
      mockState.envFileExists = true
      mockState.envContent = 'INVALID_ENV_CONTENT\n# === MCP INTEGRATION ENV START ===\nBROKEN'
    },

    simulateUserEmailChange: (email: string) => {
      mockState.userEmail = email
    },

    simulateMcpConfigMissing: () => {
      mockState.mcpRemoteConfigExists = false
    },

    reset: () => {
      Object.assign(mockState, {
        venvExists: true,
        versionFileExists: true,
        currentVersion: '1.0.0',
        savedVersion: '1.0.0',
        isInstalling: false,
        installedLockExists: true,
        uvicornStarting: false,
        toolInstalled: true,
        allowForceInstall: false,
        // Reset environment-related state
        envFileExists: true,
        envContent: 'MOCK_VAR=mock_value\n# === MCP INTEGRATION ENV START ===\nMCP_KEY=test_value\n# === MCP INTEGRATION ENV END ===',
        eigentDirExists: true,
        userEmail: 'test@example.com',
        mcpRemoteConfigExists: true,
        hasToken: true,
      })

      // Clear all listeners
      installStartListeners.length = 0
      installLogListeners.length = 0
      installCompleteListeners.length = 0

      // Reset all mocks
      electronAPI.checkAndInstallDepsOnUpdate.mockClear()
      electronAPI.getInstallationStatus.mockClear()
      electronAPI.exportLog.mockClear()
      electronAPI.onInstallDependenciesStart.mockClear()
      electronAPI.onInstallDependenciesLog.mockClear()
      electronAPI.onInstallDependenciesComplete.mockClear()
      electronAPI.removeAllListeners.mockClear()
      electronAPI.getEnvPath.mockClear()
      electronAPI.updateEnvBlock.mockClear()
      electronAPI.removeEnvKey.mockClear()
      electronAPI.getEmailFolderPath.mockClear()
      electronAPI.parseEnvBlock.mockClear()
    }
  }

  return electronAPI
}

/**
 * Creates a mock for the IPC Renderer
 */
export function createIpcRendererMock(): MockedIpcRenderer {
  return {
    invoke: vi.fn().mockImplementation(async (channel: string, ...args: any[]) => {
      if (channel === 'check-tool-installed') {
        return {
          success: true,
          isInstalled: true // This can be controlled via the electronAPI mock
        }
      }
      return { success: false, error: 'Unknown channel' }
    }),

    on: vi.fn(),
    removeAllListeners: vi.fn(),
  }
}

/**
 * Test utility to set up all Electron mocks
 */
export function setupElectronMocks() {
  const electronAPI = createElectronAPIMock()
  const ipcRenderer = createIpcRendererMock()

  // Set up global mocks
  Object.defineProperty(window, 'electronAPI', {
    value: electronAPI,
    writable: true
  })

  Object.defineProperty(window, 'ipcRenderer', {
    value: ipcRenderer,
    writable: true
  })

  return { electronAPI, ipcRenderer }
}

/**
 * Predefined test scenarios
 */
export const TestScenarios = {
  /**
   * Fresh installation - no venv, no version file
   */
  freshInstall: (electronAPI: MockedElectronAPI) => {
    electronAPI.mockState.venvExists = false
    electronAPI.mockState.versionFileExists = false
    electronAPI.mockState.installedLockExists = false
    electronAPI.mockState.toolInstalled = false
  },

  /**
   * Version update scenario - version file exists but version changed
   */
  versionUpdate: (electronAPI: MockedElectronAPI) => {
    electronAPI.mockState.versionFileExists = true
    electronAPI.mockState.savedVersion = '0.9.0'
    electronAPI.mockState.currentVersion = '1.0.0'
    electronAPI.mockState.installedLockExists = false
  },

  /**
   * Venv removed scenario - version file exists but .venv is missing
   */
  venvRemoved: (electronAPI: MockedElectronAPI) => {
    electronAPI.mockState.venvExists = false
    electronAPI.mockState.versionFileExists = true
    electronAPI.mockState.installedLockExists = false
  },

  /**
   * Installation in progress - when user opens app during installation
   */
  installationInProgress: (electronAPI: MockedElectronAPI) => {
    electronAPI.mockState.isInstalling = true
    electronAPI.mockState.installedLockExists = false
  },

  /**
   * Installation error scenario
   */
  installationError: (electronAPI: MockedElectronAPI) => {
    electronAPI.checkAndInstallDepsOnUpdate.mockImplementation(async () => {
      electronAPI.simulateInstallationStart()
      setTimeout(() => {
        electronAPI.simulateInstallationLog('stderr', 'Error: Failed to resolve dependencies')
        electronAPI.simulateInstallationComplete(false, 'Installation failed')
      }, 100)
      return { success: false, message: 'Installation failed' }
    })
  },

  /**
   * Uvicorn startup with dependency installation
   */
  uvicornDepsInstall: (electronAPI: MockedElectronAPI) => {
    electronAPI.mockState.uvicornStarting = true
    electronAPI.mockState.isInstalling = false
    // The simulateUvicornStartup method will handle the rest
  },

  /**
   * All good - no installation needed
   */
  allGood: (electronAPI: MockedElectronAPI) => {
    electronAPI.mockState.venvExists = true
    electronAPI.mockState.versionFileExists = true
    electronAPI.mockState.savedVersion = electronAPI.mockState.currentVersion
    electronAPI.mockState.installedLockExists = true
    electronAPI.mockState.isInstalling = false
    electronAPI.mockState.toolInstalled = true
  }
}