import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupMockEnvironment } from '../../mocks/environmentMocks'

// Set up global mock environment before any imports
const globalMockEnv = setupMockEnvironment()

// Mock all dependencies at the top level
vi.mock('node:fs', () => ({
  ...globalMockEnv.fsMock,
  default: globalMockEnv.fsMock
}))
vi.mock('node:path', () => ({
  ...globalMockEnv.pathMock,
  default: globalMockEnv.pathMock
}))
vi.mock('child_process', () => ({
  ...globalMockEnv.processMock,
  default: globalMockEnv.processMock
}))
vi.mock('electron-log', () => ({ default: globalMockEnv.logMock }))
vi.mock('electron', () => ({
  app: globalMockEnv.appMock,
  BrowserWindow: vi.fn()
}))
vi.mock('../../../electron/main/utils/process', () => globalMockEnv.processUtilsMock)
vi.mock('../../../electron/main/init', () => ({
  getMainWindow: vi.fn().mockReturnValue({
    webContents: { send: vi.fn() },
    isDestroyed: vi.fn().mockReturnValue(false)
  })
}))
vi.mock('../../../electron/main/utils/safeWebContentsSend', () => ({
  safeMainWindowSend: vi.fn().mockReturnValue(true)
}))

// Import the module under test after mocking
let installDeps: any

describe('Install Deps Module', () => {
  let mockEnv: ReturnType<typeof setupMockEnvironment>

  beforeEach(async () => {
    // Reset the mock environment state for each test
    mockEnv = globalMockEnv
    mockEnv.reset()

    // Set up the shared state
    mockEnv.processMock.setupSpawnMock(mockEnv.mockState)
    mockEnv.appMock.setup(mockEnv.mockState)
    mockEnv.osMock.setup(mockEnv.mockState)
    mockEnv.processUtilsMock.setup(mockEnv.mockState)

    // Import the module under test fresh for each test
    installDeps = await import('../../../electron/main/install-deps')
  })

  afterEach(() => {
    vi.clearAllMocks()
    mockEnv.reset()
  })

  describe('checkAndInstallDepsOnUpdate', () => {
    it('should skip installation when version has not changed and tools are installed', async () => {
      // Set up scenario where version is the same and tools exist
      mockEnv.mockState.filesystem.versionFileExists = true
      mockEnv.mockState.filesystem.versionFileContent = '1.0.0'
      mockEnv.mockState.app.currentVersion = '1.0.0'
      mockEnv.mockState.filesystem.binariesExist = { 'uv': true, 'bun': true }

      const mockWin = {
        webContents: { send: vi.fn() },
        isDestroyed: vi.fn().mockReturnValue(false)
      }

      const result = await installDeps.checkAndInstallDepsOnUpdate({
        win: mockWin,
        forceInstall: false
      })

      expect(result.success).toBe(true)
      expect(result.message).toContain('Version not changed')
      expect(mockEnv.fsMock.writeFileSync).not.toHaveBeenCalledWith(
        expect.stringContaining('version.txt'),
        expect.any(String)
      )
    })

    it('should install dependencies when version file does not exist', async () => {
      // Set up fresh installation scenario
      mockEnv.scenarios.freshInstall()

      const mockWin = {
        webContents: { send: vi.fn() },
        isDestroyed: vi.fn().mockReturnValue(false)
      }

      const result = await installDeps.checkAndInstallDepsOnUpdate({
        win: mockWin,
        forceInstall: false
      })
      console.log(result);

      expect(result.success).toBe(true)
      expect(result.message).toContain('Dependencies installed successfully')
      expect(mockWin.webContents.send).toHaveBeenCalledWith(
        'update-notification',
        expect.objectContaining({
          type: 'version-update',
          reason: 'version file not exist'
        })
      )
    })

    it('should install dependencies when version has changed', async () => {
      // Set up version update scenario
      mockEnv.scenarios.versionUpdate('0.9.0', '1.0.0')

      const mockWin = {
        webContents: { send: vi.fn() },
        isDestroyed: vi.fn().mockReturnValue(false)
      }

      const result = await installDeps.checkAndInstallDepsOnUpdate({
        win: mockWin,
        forceInstall: false
      })

      expect(result.success).toBe(true)
      expect(result.message).toContain('Dependencies installed successfully')
      expect(mockWin.webContents.send).toHaveBeenCalledWith(
        'update-notification',
        expect.objectContaining({
          type: 'version-update',
          currentVersion: '1.0.0',
          previousVersion: '0.9.0',
          reason: 'version not match'
        })
      )
    })

    it('should install when command tools are missing', async () => {
      // Same version but tools missing
      mockEnv.mockState.filesystem.versionFileExists = true
      mockEnv.mockState.filesystem.versionFileContent = '1.0.0'
      mockEnv.mockState.app.currentVersion = '1.0.0'
      mockEnv.mockState.filesystem.binariesExist = { 'uv': false, 'bun': true }

      const mockWin = {
        webContents: { send: vi.fn() },
        isDestroyed: vi.fn().mockReturnValue(false)
      }

      const result = await installDeps.checkAndInstallDepsOnUpdate({
        win: mockWin,
        forceInstall: false
      })

      expect(result.success).toBe(true)
      expect(result.message).toContain('Dependencies installed successfully')
    })

    it('should force install when forceInstall is true', async () => {
      // Set up scenario where normally no installation would be needed
      mockEnv.mockState.filesystem.versionFileExists = true
      mockEnv.mockState.filesystem.versionFileContent = '1.0.0'
      mockEnv.mockState.app.currentVersion = '1.0.0'
      mockEnv.mockState.filesystem.binariesExist = { 'uv': true, 'bun': true }

      const mockWin = {
        webContents: { send: vi.fn() },
        isDestroyed: vi.fn().mockReturnValue(false)
      }

      const result = await installDeps.checkAndInstallDepsOnUpdate({
        win: mockWin,
        forceInstall: true
      })

      expect(result.success).toBe(true)
      expect(result.message).toContain('Dependencies installed successfully')
    })

    it('should handle installation failure', async () => {
      // Set up failure scenario
      mockEnv.scenarios.completeFailure()

      const mockWin = {
        webContents: { send: vi.fn() },
        isDestroyed: vi.fn().mockReturnValue(false)
      }

      const result = await installDeps.checkAndInstallDepsOnUpdate({
        win: mockWin,
        forceInstall: true
      })

      expect(result.success).toBe(false)
      expect(result.message).toContain('Install dependencies failed')
    })

    it('should handle window being destroyed', async () => {
      const mockWin = {
        webContents: { send: vi.fn() },
        isDestroyed: vi.fn().mockReturnValue(true)
      }

      mockEnv.scenarios.versionUpdate('0.9.0', '1.0.0')

      const result = await installDeps.checkAndInstallDepsOnUpdate({
        win: mockWin,
        forceInstall: false
      })

      // Should still complete successfully
      expect(result.success).toBe(true)
      // Should not try to send notifications to destroyed window
      expect(mockWin.webContents.send).not.toHaveBeenCalled()
    })

    it('should handle null window gracefully', async () => {
      mockEnv.scenarios.versionUpdate('0.9.0', '1.0.0')

      const result = await installDeps.checkAndInstallDepsOnUpdate({
        win: null,
        forceInstall: false
      })

      expect(result.success).toBe(true)
      // Should not crash when window is null
    })
  })

  describe('installCommandTool', () => {
    it('should install uv and bun when not available', async () => {
      // Set up scenario where tools are not available initially
      mockEnv.mockState.filesystem.binariesExist = { 'uv': false, 'bun': false }
      
      // Simulate successful installation
      let uvCallCount = 0
      let bunCallCount = 0
      mockEnv.processUtilsMock.isBinaryExists.mockImplementation(async (name: string) => {
        if (name === 'uv') {
          uvCallCount++
          return uvCallCount > 1 // False first time, true after "installation"
        }
        if (name === 'bun') {
          bunCallCount++
          return bunCallCount > 1 // False first time, true after "installation"
        }
        return false
      })

      const result = await installDeps.installCommandTool()

      expect(result.success).toBe(true)
      expect(result.message).toContain('Command tools installed successfully')
      expect(mockEnv.processUtilsMock.runInstallScript).toHaveBeenCalledTimes(2) // uv and bun
    })

    it('should skip installation when tools are already available', async () => {
      // Tools are available by default in mockState
      mockEnv.mockState.filesystem.binariesExist = { 'uv': true, 'bun': true }
      
      const result = await installDeps.installCommandTool()

      expect(result.success).toBe(true)
      expect(result.message).toContain('Command tools installed successfully')
      expect(mockEnv.processUtilsMock.runInstallScript).not.toHaveBeenCalled()
    })

    it('should handle uv installation failure', async () => {
      // Mock uv installation failure
      mockEnv.mockState.filesystem.binariesExist = { 'uv': false, 'bun': true }
      
      // uv remains unavailable even after installation attempt
      mockEnv.processUtilsMock.isBinaryExists.mockImplementation(async (name: string) => {
        if (name === 'uv') return false // Always fails
        if (name === 'bun') return true
        return false
      })

      const result = await installDeps.installCommandTool()

      expect(result.success).toBe(false)
      expect(result.message).toContain('uv installation failed')
    })

    it('should handle bun installation failure', async () => {
      // Mock bun installation failure
      mockEnv.mockState.filesystem.binariesExist = { 'uv': true, 'bun': false }
      
      // bun remains unavailable even after installation attempt
      mockEnv.processUtilsMock.isBinaryExists.mockImplementation(async (name: string) => {
        if (name === 'uv') return true
        if (name === 'bun') return false // Always fails
        return false
      })

      const result = await installDeps.installCommandTool()

      expect(result.success).toBe(false)
      expect(result.message).toContain('bun installation failed')
    })
  })
})

//   describe('getInstallationStatus', () => {
//     it('should return correct status when installation is in progress', async () => {
//       mockEnv.scenarios.installationInProgress()

//       const status = await installDeps.getInstallationStatus()

//       expect(status.isInstalling).toBe(true)
//       expect(status.hasLockFile).toBe(true)
//       expect(status.installedExists).toBe(false)
//     })

//     it('should return correct status when installation is completed', async () => {
//       // Default state has installation completed
//       mockEnv.mockState.filesystem.installingLockExists = false
//       mockEnv.mockState.filesystem.installedLockExists = true

//       const status = await installDeps.getInstallationStatus()

//       expect(status.isInstalling).toBe(false)
//       expect(status.hasLockFile).toBe(true)
//       expect(status.installedExists).toBe(true)
//     })

//     it('should return correct status when no installation has occurred', async () => {
//       mockEnv.mockState.filesystem.installingLockExists = false
//       mockEnv.mockState.filesystem.installedLockExists = false

//       const status = await installDeps.getInstallationStatus()

//       expect(status.isInstalling).toBe(false)
//       expect(status.hasLockFile).toBe(false)
//       expect(status.installedExists).toBe(false)
//     })

//     it('should handle file system errors gracefully', async () => {
//       // Mock fs.existsSync to throw an error
//       mockEnv.fsMock.existsSync.mockImplementation(() => {
//         throw new Error('File system error')
//       })

//       const status = await installDeps.getInstallationStatus()

//       expect(status.isInstalling).toBe(false)
//       expect(status.hasLockFile).toBe(false)
//       expect(status.installedExists).toBe(false)
//     })
//   })

//   describe('installDependencies', () => {
//     it('should successfully install dependencies with default settings', async () => {
//       // Set up successful installation scenario
//       mockEnv.mockState.processes.uvAvailable = true
//       mockEnv.mockState.network.canConnectToDefault = true

//       const result = await installDeps.installDependencies('1.0.0')

//       expect(result.success).toBe(true)
//       expect(result.message).toContain('Dependencies installed successfully')
//       expect(mockEnv.fsMock.writeFileSync).toHaveBeenCalledWith(
//         expect.stringContaining('uv_installed.lock'),
//         ''
//       )
//     })

//     it('should fall back to mirror when default fails', async () => {
//       // Set up network issues scenario - first install fails, mirror succeeds
//       mockEnv.scenarios.networkIssues()

//       const result = await installDeps.installDependencies('1.0.0')

//       expect(result.success).toBe(true)
//       expect(result.message).toContain('Dependencies installed successfully with mirror')
//     })

//     it('should fail when both default and mirror fail', async () => {
//       mockEnv.scenarios.completeFailure()

//       const result = await installDeps.installDependencies('1.0.0')

//       expect(result.success).toBe(false)
//       expect(result.message).toContain('Both default and mirror install failed')
//     })

//     it('should handle command tool installation failure', async () => {
//       // Set up scenario where command tool installation fails
//       mockEnv.mockState.filesystem.binariesExist = { 'uv': false, 'bun': false }
      
//       // Mock tools to remain unavailable
//       mockEnv.processUtilsMock.isBinaryExists.mockResolvedValue(false)

//       const result = await installDeps.installDependencies('1.0.0')

//       expect(result.success).toBe(false)
//       expect(result.message).toContain('Command tool installation failed')
//     })

//     it('should create and clean up lock files correctly', async () => {
//       mockEnv.mockState.processes.uvAvailable = true
//       mockEnv.mockState.network.canConnectToDefault = true

//       await installDeps.installDependencies('1.0.0')

//       // Verify that installation lock is created and then cleaned up
//       expect(mockEnv.fsMock.writeFileSync).toHaveBeenCalledWith(
//         expect.stringContaining('uv_installing.lock'),
//         ''
//       )
//       expect(mockEnv.fsMock.unlinkSync).toHaveBeenCalledWith(
//         expect.stringContaining('uv_installing.lock')
//       )
//       expect(mockEnv.fsMock.writeFileSync).toHaveBeenCalledWith(
//         expect.stringContaining('uv_installed.lock'),
//         ''
//       )
//     })

//     it('should clean up old virtual environments after successful installation', async () => {
//       mockEnv.scenarios.multipleOldVenvs('1.0.0')
//       mockEnv.mockState.processes.uvAvailable = true
//       mockEnv.mockState.network.canConnectToDefault = true

//       await installDeps.installDependencies('1.0.0')

//       expect(mockEnv.processUtilsMock.cleanupOldVenvs).toHaveBeenCalledWith('1.0.0')
//     })
//   })

//   describe('detectInstallationLogs', () => {
//     beforeEach(() => {
//       // Reset the module-level state variables
//       vi.resetModules()
//     })

//     it('should detect UV dependency installation patterns', () => {
//       const installationPatterns = [
//         'Resolved 10 packages in 1.2s',
//         'Downloaded package xyz',
//         'Installing numpy==1.21.0',
//         'Built wheel for package',
//         'Prepared virtual environment',
//         'Syncing dependencies',
//         'Creating virtualenv at .venv',
//         'Updating package index',
//         'Audited 15 packages'
//       ]

//       installationPatterns.forEach(pattern => {
//         // The function has side effects, so we can't easily test return values
//         // Instead, we test that it doesn't throw and processes the input
//         expect(() => installDeps.detectInstallationLogs(pattern)).not.toThrow()
//       })
//     })

//     it('should handle uvicorn startup messages', () => {
//       const uvicornMessages = [
//         'Uvicorn running on http://127.0.0.1:8000',
//         'Application startup complete',
//         'Server started successfully'
//       ]

//       uvicornMessages.forEach(message => {
//         expect(() => installDeps.detectInstallationLogs(message)).not.toThrow()
//       })
//     })

//     it('should handle installation failure messages', () => {
//       const failureMessages = [
//         '× No solution found when resolving dependencies',
//         'failed to resolve dependencies',
//         'installation failed'
//       ]

//       failureMessages.forEach(message => {
//         expect(() => installDeps.detectInstallationLogs(message)).not.toThrow()
//       })
//     })
//   })

//   describe('Error Handling and Edge Cases', () => {
//     it('should handle file system permission errors gracefully', async () => {
//       // Mock filesystem error
//       mockEnv.fsMock.writeFileSync.mockImplementation((path: string) => {
//         if (path.includes('version.txt')) {
//           throw new Error('Permission denied')
//         }
//       })

//       const mockWin = {
//         webContents: { send: vi.fn() },
//         isDestroyed: vi.fn().mockReturnValue(false)
//       }

//       // The function should handle errors gracefully
//       const result = await installDeps.checkAndInstallDepsOnUpdate({
//         win: mockWin,
//         forceInstall: true
//       })

//       // Should still return a result, even if there are file system errors
//       expect(result).toBeDefined()
//       expect(typeof result.success).toBe('boolean')
//       expect(typeof result.message).toBe('string')
//     })

//     it('should handle timezone-based mirror selection for China', async () => {
//       // Mock Intl.DateTimeFormat for China timezone
//       const originalDateTimeFormat = global.Intl.DateTimeFormat
//       const mockDateTimeFormat = vi.fn().mockImplementation(() => ({
//         resolvedOptions: () => ({ timeZone: 'Asia/Shanghai' })
//       })) as any
//       global.Intl.DateTimeFormat = mockDateTimeFormat

//       try {
//         // Set up scenario where default fails but mirror succeeds  
//         mockEnv.scenarios.networkIssues()

//         const result = await installDeps.installDependencies('1.0.0')

//         expect(result.success).toBe(true)
//         expect(result.message).toContain('Dependencies installed successfully with mirror')
//       } finally {
//         // Restore original
//         global.Intl.DateTimeFormat = originalDateTimeFormat
//       }
//     })

//     it('should handle invalid version strings', async () => {
//       const result = await installDeps.installDependencies('')

//       // Should handle empty version string gracefully
//       expect(result).toBeDefined()
//       expect(typeof result.success).toBe('boolean')
//     })

//     it('should handle missing backend directory', async () => {
//       mockEnv.mockState.filesystem.backendPathExists = false

//       const result = await installDeps.installDependencies('1.0.0')

//       // Should create the directory and continue
//       expect(mockEnv.fsMock.mkdirSync).toHaveBeenCalledWith(
//         expect.stringContaining('backend'),
//         { recursive: true }
//       )
//       expect(result).toBeDefined()
//     })
//   })

//   describe('Integration Tests', () => {
//     it('should handle complete fresh installation workflow', async () => {
//       // Set up completely fresh system
//       mockEnv.scenarios.freshInstall()

//       const mockWin = {
//         webContents: { send: vi.fn() },
//         isDestroyed: vi.fn().mockReturnValue(false)
//       }

//       const result = await installDeps.checkAndInstallDepsOnUpdate({
//         win: mockWin,
//         forceInstall: false
//       })

//       expect(result.success).toBe(true)
//       expect(mockWin.webContents.send).toHaveBeenCalledWith(
//         'update-notification',
//         expect.objectContaining({
//           type: 'version-update',
//           reason: 'version file not exist'
//         })
//       )
//     })

//     it('should handle version update with missing tools', async () => {
//       // Version file exists but tools are missing
//       mockEnv.mockState.filesystem.versionFileExists = true
//       mockEnv.mockState.filesystem.versionFileContent = '0.9.0'
//       mockEnv.mockState.app.currentVersion = '1.0.0'
//       mockEnv.mockState.filesystem.binariesExist = { 'uv': false, 'bun': false }

//       const mockWin = {
//         webContents: { send: vi.fn() },
//         isDestroyed: vi.fn().mockReturnValue(false)
//       }

//       const result = await installDeps.checkAndInstallDepsOnUpdate({
//         win: mockWin,
//         forceInstall: false
//       })

//       expect(result.success).toBe(true)
//       expect(mockWin.webContents.send).toHaveBeenCalledWith(
//         'update-notification',
//         expect.objectContaining({
//           type: 'version-update',
//           currentVersion: '1.0.0',
//           previousVersion: '0.9.0',
//           reason: 'version not match'
//         })
//       )
//     })
//   })
// })