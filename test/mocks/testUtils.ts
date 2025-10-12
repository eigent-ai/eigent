import { setupElectronMocks, TestScenarios, type MockedElectronAPI } from './electronMocks'
import { setupMockEnvironment } from './environmentMocks'

/**
 * Complete test setup utility that combines all mocks and provides
 * easy-to-use functions for testing installation flows
 */
export function createTestEnvironment() {
  const { electronAPI, ipcRenderer } = setupElectronMocks()
  const mockEnv = setupMockEnvironment()

  return {
    electronAPI,
    ipcRenderer,
    mockEnv,
    
    // Quick scenario setups
    scenarios: {
      /**
       * Fresh installation - no .venv, no version file, tools not installed
       */
      freshInstall: () => {
        TestScenarios.freshInstall(electronAPI)
        mockEnv.scenarios.freshInstall()
      },

      /**
       * Version update - version file exists but version changed
       */
      versionUpdate: (oldVersion: string = '0.9.0', newVersion: string = '1.0.0') => {
        TestScenarios.versionUpdate(electronAPI)
        mockEnv.scenarios.versionUpdate(oldVersion, newVersion)
      },

      /**
       * .venv removed - version file exists but .venv is missing
       */
      venvRemoved: () => {
        TestScenarios.venvRemoved(electronAPI)
        mockEnv.scenarios.venvRemoved()
      },

      /**
       * Installation in progress - when user opens app during installation
       */
      installationInProgress: () => {
        TestScenarios.installationInProgress(electronAPI)
        mockEnv.scenarios.installationInProgress()
      },

      /**
       * Installation error - installation fails
       */
      installationError: () => {
        TestScenarios.installationError(electronAPI)
        mockEnv.scenarios.completeFailure()
      },

      /**
       * Uvicorn startup with dependency installation
       */
      uvicornDepsInstall: () => {
        TestScenarios.uvicornDepsInstall(electronAPI)
        mockEnv.scenarios.uvicornStartupInstall()
      },

      /**
       * Network issues - default mirror fails, backup succeeds
       */
      networkIssues: () => {
        TestScenarios.allGood(electronAPI)
        mockEnv.scenarios.networkIssues()
      },

      /**
       * All good - no installation needed
       */
      allGood: () => {
        TestScenarios.allGood(electronAPI)
        // Use default mockEnv state (all good)
      }
    },

    // Simulation utilities
    simulate: {
      /**
       * Simulate a complete successful installation flow
       */
      successfulInstallation: async (delay: number = 100) => {
        electronAPI.simulateInstallationStart()
        
        setTimeout(() => {
          electronAPI.simulateInstallationLog('stdout', 'Resolving dependencies...')
        }, delay)
        
        setTimeout(() => {
          electronAPI.simulateInstallationLog('stdout', 'Downloading packages...')
        }, delay * 2)
        
        setTimeout(() => {
          electronAPI.simulateInstallationLog('stdout', 'Installing packages...')
        }, delay * 3)
        
        setTimeout(() => {
          electronAPI.simulateInstallationComplete(true)
        }, delay * 4)
      },

      /**
       * Simulate a failed installation flow
       */
      failedInstallation: async (delay: number = 100, errorMessage: string = 'Installation failed') => {
        electronAPI.simulateInstallationStart()
        
        setTimeout(() => {
          electronAPI.simulateInstallationLog('stdout', 'Resolving dependencies...')
        }, delay)
        
        setTimeout(() => {
          electronAPI.simulateInstallationLog('stderr', `Error: ${errorMessage}`)
        }, delay * 2)
        
        setTimeout(() => {
          electronAPI.simulateInstallationComplete(false, errorMessage)
        }, delay * 3)
      },

      /**
       * Simulate uvicorn startup that detects missing dependencies
       */
      uvicornWithDeps: async (delay: number = 100) => {
        setTimeout(() => {
          electronAPI.simulateInstallationLog('stdout', 'Uvicorn detected missing dependencies')
        }, delay)
        
        setTimeout(() => {
          electronAPI.simulateInstallationStart()
        }, delay * 2)
        
        setTimeout(() => {
          electronAPI.simulateInstallationLog('stdout', 'Resolving dependencies...')
        }, delay * 3)
        
        setTimeout(() => {
          electronAPI.simulateInstallationLog('stdout', 'Uvicorn running on http://127.0.0.1:8000')
          electronAPI.simulateInstallationComplete(true)
        }, delay * 4)
      }
    },

    // State inspection utilities
    inspect: {
      /**
       * Get current installation state summary
       */
      getInstallationState: () => ({
        electronState: electronAPI.mockState,
        envState: mockEnv.mockState,
        isInstalling: electronAPI.mockState.isInstalling || mockEnv.mockState.processes.installationInProgress,
        hasLockFiles: mockEnv.mockState.filesystem.installingLockExists || mockEnv.mockState.filesystem.installedLockExists,
        toolsAvailable: mockEnv.mockState.processes.uvAvailable && mockEnv.mockState.processes.bunAvailable,
        venvExists: electronAPI.mockState.venvExists && mockEnv.mockState.filesystem.venvExists,
      }),

      /**
       * Check if environment is in expected state for a scenario
       */
      verifyScenario: (scenarioName: string) => {
        const state = mockEnv.mockState
        const electronState = electronAPI.mockState
        
        switch (scenarioName) {
          case 'freshInstall':
            return !state.filesystem.venvExists && 
                   !state.filesystem.versionFileExists && 
                   !electronState.toolInstalled
          
          case 'versionUpdate':
            return state.filesystem.versionFileExists && 
                   state.app.currentVersion !== state.filesystem.versionFileContent
          
          case 'venvRemoved':
            return !state.filesystem.venvExists && 
                   state.filesystem.versionFileExists
          
          case 'installationInProgress':
            return state.filesystem.installingLockExists || 
                   electronState.isInstalling
          
          default:
            return false
        }
      }
    },

    // Reset everything
    reset: () => {
      electronAPI.reset()
      mockEnv.reset()
    }
  }
}

/**
 * Helper function to wait for installation state changes
 */
export async function waitForInstallationState(
  getState: () => any,
  expectedState: string,
  timeout: number = 1000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now()
    
    const check = () => {
      if (getState().state === expectedState) {
        resolve()
      } else if (Date.now() - startTime > timeout) {
        reject(new Error(`Timeout waiting for state ${expectedState}, current: ${getState().state}`))
      } else {
        setTimeout(check, 10)
      }
    }
    
    check()
  })
}

/**
 * Helper function to wait for multiple logs
 */
export async function waitForLogs(
  getLogs: () => any[],
  expectedCount: number,
  timeout: number = 1000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now()
    
    const check = () => {
      if (getLogs().length >= expectedCount) {
        resolve()
      } else if (Date.now() - startTime > timeout) {
        reject(new Error(`Timeout waiting for ${expectedCount} logs, got: ${getLogs().length}`))
      } else {
        setTimeout(check, 10)
      }
    }
    
    check()
  })
}

/**
 * Example usage in tests:
 * 
 * ```typescript
 * import { createTestEnvironment, waitForInstallationState } from '../mocks/testUtils'
 * 
 * describe('Installation Flow', () => {
 *   let testEnv: ReturnType<typeof createTestEnvironment>
 * 
 *   beforeEach(() => {
 *     testEnv = createTestEnvironment()
 *   })
 * 
 *   it('should handle fresh installation', async () => {
 *     testEnv.scenarios.freshInstall()
 *     
 *     // Verify scenario setup
 *     expect(testEnv.inspect.verifyScenario('freshInstall')).toBe(true)
 *     
 *     // Simulate installation
 *     await testEnv.simulate.successfulInstallation()
 *     
 *     // Verify result
 *     const state = testEnv.inspect.getInstallationState()
 *     expect(state.isInstalling).toBe(false)
 *   })
 * })
 * ```
 */