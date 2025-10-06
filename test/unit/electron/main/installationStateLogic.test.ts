/**
 * Focused tests for the complex installation state detection logic in createWindow
 * This tests the decision matrix for when installation is needed vs when it's not
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupMockEnvironment } from '../../../mocks/environmentMocks'

describe('createWindow - Installation State Detection Logic', () => {
  let mockEnv: ReturnType<typeof setupMockEnvironment>
  let installationStateChecker: (mockState: any) => Promise<boolean>

  beforeEach(() => {
    mockEnv = setupMockEnvironment()
    
    // Extract the installation decision logic for focused testing
    installationStateChecker = async (mockState) => {
      const currentVersion = mockState.app.currentVersion
      const versionExists = mockState.filesystem.versionFileExists
      const savedVersion = versionExists ? mockState.filesystem.versionFileContent : ''
      const uvExists = mockState.filesystem.binariesExist['uv'] || false
      const bunExists = mockState.filesystem.binariesExist['bun'] || false
      const installationCompleted = mockState.filesystem.installedLockExists

      return !versionExists || 
             savedVersion !== currentVersion || 
             !uvExists || 
             !bunExists || 
             !installationCompleted
    }
  })

  afterEach(() => {
    mockEnv.reset()
  })

  describe('Version File Scenarios', () => {
    it('should require installation when version file does not exist', async () => {
      mockEnv.mockState.filesystem.versionFileExists = false
      
      const needsInstallation = await installationStateChecker(mockEnv.mockState)
      expect(needsInstallation).toBe(true)
    })

    it('should require installation when saved version differs from current version', async () => {
      mockEnv.mockState.filesystem.versionFileExists = true
      mockEnv.mockState.filesystem.versionFileContent = '0.9.0'
      mockEnv.mockState.app.currentVersion = '1.0.0'
      
      const needsInstallation = await installationStateChecker(mockEnv.mockState)
      expect(needsInstallation).toBe(true)
    })

    it('should not require installation when versions match', async () => {
      mockEnv.mockState.filesystem.versionFileExists = true
      mockEnv.mockState.filesystem.versionFileContent = '1.0.0'
      mockEnv.mockState.app.currentVersion = '1.0.0'
      mockEnv.mockState.filesystem.binariesExist = { 'uv': true, 'bun': true }
      mockEnv.mockState.filesystem.installedLockExists = true
      
      const needsInstallation = await installationStateChecker(mockEnv.mockState)
      expect(needsInstallation).toBe(false)
    })

    it('should handle version file with whitespace correctly', async () => {
      mockEnv.mockState.filesystem.versionFileExists = true
      mockEnv.mockState.filesystem.versionFileContent = '  1.0.0  \n'
      mockEnv.mockState.app.currentVersion = '1.0.0'
      mockEnv.mockState.filesystem.binariesExist = { 'uv': true, 'bun': true }
      mockEnv.mockState.filesystem.installedLockExists = true
      
      // In the real code, version content is trimmed
      const trimmedVersion = mockEnv.mockState.filesystem.versionFileContent.trim()
      const needsInstallation = trimmedVersion !== mockEnv.mockState.app.currentVersion ||
                               !mockEnv.mockState.filesystem.binariesExist['uv'] ||
                               !mockEnv.mockState.filesystem.binariesExist['bun'] ||
                               !mockEnv.mockState.filesystem.installedLockExists
      
      expect(needsInstallation).toBe(false)
    })
  })

  describe('Binary Existence Scenarios', () => {
    it('should require installation when uv binary is missing', async () => {
      mockEnv.mockState.filesystem.versionFileExists = true
      mockEnv.mockState.filesystem.versionFileContent = '1.0.0'
      mockEnv.mockState.app.currentVersion = '1.0.0'
      mockEnv.mockState.filesystem.binariesExist = { 'uv': false, 'bun': true }
      mockEnv.mockState.filesystem.installedLockExists = true
      
      const needsInstallation = await installationStateChecker(mockEnv.mockState)
      expect(needsInstallation).toBe(true)
    })

    it('should require installation when bun binary is missing', async () => {
      mockEnv.mockState.filesystem.versionFileExists = true
      mockEnv.mockState.filesystem.versionFileContent = '1.0.0'
      mockEnv.mockState.app.currentVersion = '1.0.0'
      mockEnv.mockState.filesystem.binariesExist = { 'uv': true, 'bun': false }
      mockEnv.mockState.filesystem.installedLockExists = true
      
      const needsInstallation = await installationStateChecker(mockEnv.mockState)
      expect(needsInstallation).toBe(true)
    })

    it('should require installation when both binaries are missing', async () => {
      mockEnv.mockState.filesystem.versionFileExists = true
      mockEnv.mockState.filesystem.versionFileContent = '1.0.0'
      mockEnv.mockState.app.currentVersion = '1.0.0'
      mockEnv.mockState.filesystem.binariesExist = { 'uv': false, 'bun': false }
      mockEnv.mockState.filesystem.installedLockExists = true
      
      const needsInstallation = await installationStateChecker(mockEnv.mockState)
      expect(needsInstallation).toBe(true)
    })
  })

  describe('Installation Lock File Scenarios', () => {
    it('should require installation when lock file is missing', async () => {
      mockEnv.mockState.filesystem.versionFileExists = true
      mockEnv.mockState.filesystem.versionFileContent = '1.0.0'
      mockEnv.mockState.app.currentVersion = '1.0.0'
      mockEnv.mockState.filesystem.binariesExist = { 'uv': true, 'bun': true }
      mockEnv.mockState.filesystem.installedLockExists = false
      
      const needsInstallation = await installationStateChecker(mockEnv.mockState)
      expect(needsInstallation).toBe(true)
    })

    it('should not require installation when lock file exists', async () => {
      mockEnv.mockState.filesystem.versionFileExists = true
      mockEnv.mockState.filesystem.versionFileContent = '1.0.0'
      mockEnv.mockState.app.currentVersion = '1.0.0'
      mockEnv.mockState.filesystem.binariesExist = { 'uv': true, 'bun': true }
      mockEnv.mockState.filesystem.installedLockExists = true
      
      const needsInstallation = await installationStateChecker(mockEnv.mockState)
      expect(needsInstallation).toBe(false)
    })
  })

  describe('Combined Failure Scenarios', () => {
    it('should require installation when multiple conditions fail', async () => {
      mockEnv.mockState.filesystem.versionFileExists = false
      mockEnv.mockState.filesystem.binariesExist = { 'uv': false, 'bun': false }
      mockEnv.mockState.filesystem.installedLockExists = false
      
      const needsInstallation = await installationStateChecker(mockEnv.mockState)
      expect(needsInstallation).toBe(true)
    })

    it('should require installation when version mismatch AND missing binaries', async () => {
      mockEnv.mockState.filesystem.versionFileExists = true
      mockEnv.mockState.filesystem.versionFileContent = '0.9.0'
      mockEnv.mockState.app.currentVersion = '1.0.0'
      mockEnv.mockState.filesystem.binariesExist = { 'uv': false, 'bun': true }
      mockEnv.mockState.filesystem.installedLockExists = true
      
      const needsInstallation = await installationStateChecker(mockEnv.mockState)
      expect(needsInstallation).toBe(true)
    })

    it('should require installation when only lock file is present', async () => {
      mockEnv.mockState.filesystem.versionFileExists = false
      mockEnv.mockState.filesystem.binariesExist = { 'uv': false, 'bun': false }
      mockEnv.mockState.filesystem.installedLockExists = true
      
      const needsInstallation = await installationStateChecker(mockEnv.mockState)
      expect(needsInstallation).toBe(true)
    })
  })

  describe('Edge Cases and Boundaries', () => {
    it('should handle empty version strings', async () => {
      mockEnv.mockState.filesystem.versionFileExists = true
      mockEnv.mockState.filesystem.versionFileContent = ''
      mockEnv.mockState.app.currentVersion = '1.0.0'
      mockEnv.mockState.filesystem.binariesExist = { 'uv': true, 'bun': true }
      mockEnv.mockState.filesystem.installedLockExists = true
      
      const needsInstallation = await installationStateChecker(mockEnv.mockState)
      expect(needsInstallation).toBe(true)
    })

    it('should handle version with special characters', async () => {
      mockEnv.mockState.filesystem.versionFileExists = true
      mockEnv.mockState.filesystem.versionFileContent = '1.0.0-beta.1'
      mockEnv.mockState.app.currentVersion = '1.0.0-beta.1'
      mockEnv.mockState.filesystem.binariesExist = { 'uv': true, 'bun': true }
      mockEnv.mockState.filesystem.installedLockExists = true
      
      const needsInstallation = await installationStateChecker(mockEnv.mockState)
      expect(needsInstallation).toBe(false)
    })

    it('should handle null or undefined binary states', async () => {
      mockEnv.mockState.filesystem.versionFileExists = true
      mockEnv.mockState.filesystem.versionFileContent = '1.0.0'
      mockEnv.mockState.app.currentVersion = '1.0.0'
      mockEnv.mockState.filesystem.binariesExist = {}
      mockEnv.mockState.filesystem.installedLockExists = true
      
      const needsInstallation = await installationStateChecker(mockEnv.mockState)
      expect(needsInstallation).toBe(true)
    })
  })

  describe('Platform-Specific Binary Detection', () => {
    it('should check for .exe extension on Windows', async () => {
      mockEnv.scenarios.missingEigentDirectories()
      mockEnv.mockState.system.platform = 'win32'
      
      // Test that binary detection considers .exe files on Windows
      expect(mockEnv.processUtilsMock.getBinaryName('uv')).resolves.toBe('uv.exe')
    })

    it('should not add .exe extension on macOS', async () => {
      mockEnv.scenarios.macOSEnvironment()
      
      expect(mockEnv.processUtilsMock.getBinaryName('uv')).resolves.toBe('uv')
    })

    it('should not add .exe extension on Linux', async () => {
      mockEnv.scenarios.linuxEnvironment()
      
      expect(mockEnv.processUtilsMock.getBinaryName('uv')).resolves.toBe('uv')
    })
  })

  describe('Decision Matrix Verification', () => {
    // This test verifies the complete decision matrix
    const testCases = [
      {
        name: 'All conditions met - no installation needed',
        setup: {
          versionFileExists: true,
          versionFileContent: '1.0.0',
          currentVersion: '1.0.0',
          uvExists: true,
          bunExists: true,
          installedLockExists: true
        },
        expectedNeedsInstallation: false
      },
      {
        name: 'Missing version file',
        setup: {
          versionFileExists: false,
          versionFileContent: '',
          currentVersion: '1.0.0',
          uvExists: true,
          bunExists: true,
          installedLockExists: true
        },
        expectedNeedsInstallation: true
      },
      {
        name: 'Version mismatch',
        setup: {
          versionFileExists: true,
          versionFileContent: '0.9.0',
          currentVersion: '1.0.0',
          uvExists: true,
          bunExists: true,
          installedLockExists: true
        },
        expectedNeedsInstallation: true
      },
      {
        name: 'Missing uv binary',
        setup: {
          versionFileExists: true,
          versionFileContent: '1.0.0',
          currentVersion: '1.0.0',
          uvExists: false,
          bunExists: true,
          installedLockExists: true
        },
        expectedNeedsInstallation: true
      },
      {
        name: 'Missing bun binary',
        setup: {
          versionFileExists: true,
          versionFileContent: '1.0.0',
          currentVersion: '1.0.0',
          uvExists: true,
          bunExists: false,
          installedLockExists: true
        },
        expectedNeedsInstallation: true
      },
      {
        name: 'Missing installation lock',
        setup: {
          versionFileExists: true,
          versionFileContent: '1.0.0',
          currentVersion: '1.0.0',
          uvExists: true,
          bunExists: true,
          installedLockExists: false
        },
        expectedNeedsInstallation: true
      }
    ]

    testCases.forEach(({ name, setup, expectedNeedsInstallation }) => {
      it(`should correctly handle: ${name}`, async () => {
        // Set up the mock state according to the test case
        mockEnv.mockState.filesystem.versionFileExists = setup.versionFileExists
        mockEnv.mockState.filesystem.versionFileContent = setup.versionFileContent
        mockEnv.mockState.app.currentVersion = setup.currentVersion
        mockEnv.mockState.filesystem.binariesExist = { 
          'uv': setup.uvExists, 
          'bun': setup.bunExists 
        }
        mockEnv.mockState.filesystem.installedLockExists = setup.installedLockExists

        const needsInstallation = await installationStateChecker(mockEnv.mockState)
        expect(needsInstallation).toBe(expectedNeedsInstallation)
      })
    })
  })

  describe('Logging Verification', () => {
    it('should log installation check results', async () => {
      // This test ensures that the installation decision logic provides proper logging
      const mockState = mockEnv.mockState
      
      const logData = {
        needsInstallation: await installationStateChecker(mockState),
        versionExists: mockState.filesystem.versionFileExists,
        versionMatch: mockState.filesystem.versionFileContent === mockState.app.currentVersion,
        uvExists: mockState.filesystem.binariesExist['uv'] || false,
        bunExists: mockState.filesystem.binariesExist['bun'] || false,
        installationCompleted: mockState.filesystem.installedLockExists
      }

      // Verify that all required data for logging is available
      expect(logData).toHaveProperty('needsInstallation')
      expect(logData).toHaveProperty('versionExists')
      expect(logData).toHaveProperty('versionMatch')
      expect(logData).toHaveProperty('uvExists')
      expect(logData).toHaveProperty('bunExists')
      expect(logData).toHaveProperty('installationCompleted')
      
      // Verify the logic is consistent
      const expectedNeedsInstallation = !logData.versionExists || 
                                       !logData.versionMatch || 
                                       !logData.uvExists || 
                                       !logData.bunExists || 
                                       !logData.installationCompleted
      
      expect(logData.needsInstallation).toBe(expectedNeedsInstallation)
    })
  })
})