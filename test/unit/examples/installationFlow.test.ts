import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { createTestEnvironment, waitForInstallationState } from '../../mocks/testUtils'
import { useInstallationStore } from '../../../src/store/installationStore'

/**
 * Example test file demonstrating how to use the test environment
 * This shows all the main scenarios you wanted to test
 */
describe('Installation Flow Examples', () => {
  let testEnv: ReturnType<typeof createTestEnvironment>

  beforeEach(() => {
    testEnv = createTestEnvironment()
    useInstallationStore.getState().reset()
  })

  afterEach(() => {
    testEnv.reset()
  })

  describe('Main Test Scenarios', () => {
    it('should handle when .venv is removed', async () => {
      // Set up scenario
      testEnv.scenarios.venvRemoved()
      
      // Verify scenario is set up correctly
      expect(testEnv.inspect.verifyScenario('venvRemoved')).toBe(true)
      expect(testEnv.inspect.getInstallationState().venvExists).toBe(false)
      
      // Trigger installation
      const result = await testEnv.electronAPI.checkAndInstallDepsOnUpdate()
      
      // Should trigger installation since .venv is missing
      expect(result.success).toBe(true)
      console.log(result);
      
      expect(result.message).toContain('Dependencies installed successfully')
    })

    it('should handle when version file is different', async () => {
      // Set up version update scenario
      testEnv.scenarios.versionUpdate('0.9.0', '1.0.0')
      
      // Verify scenario
      expect(testEnv.inspect.verifyScenario('versionUpdate')).toBe(true)
      
      // Trigger installation
      const result = await testEnv.electronAPI.checkAndInstallDepsOnUpdate()
      
      // Should install due to version mismatch
      expect(result.success).toBe(true)
      expect(result.message).toContain('Dependencies installed successfully after update')
    })

    it('should handle when uvicorn starts installing deps after page is loaded', async () => {
      // Set up uvicorn dependency installation scenario
      testEnv.scenarios.uvicornDepsInstall()
      
      const { result } = renderHook(() => useInstallationStore())
      
      // Set up event listeners manually for this test
      const startInstallation = result.current.startInstallation
      const addLog = result.current.addLog
      const setSuccess = result.current.setSuccess
      const setError = result.current.setError
      
      // Set up the electron API event handlers to connect to the store
      testEnv.electronAPI.onInstallDependenciesStart(() => {
        act(() => {
          startInstallation()
        })
      })
      
      testEnv.electronAPI.onInstallDependenciesLog((data: { type: string; data: string }) => {
        act(() => {
          addLog({
            type: data.type as 'stdout' | 'stderr',
            data: data.data,
            timestamp: new Date(),
          })
        })
      })
      
      testEnv.electronAPI.onInstallDependenciesComplete((data: { success: boolean; error?: string }) => {
        act(() => {
          if (data.success) {
            setSuccess()
          } else {
            setError(data.error || 'Installation failed')
          }
        })
      })
      
      // Simulate uvicorn startup that triggers dependency detection
      await act(async () => {
        // Use the electron mock's simulation methods instead of calling detectInstallationLogs directly
        testEnv.electronAPI.simulateInstallationStart()
        
        // Wait a bit for state to update
        await new Promise(resolve => setTimeout(resolve, 50))
      })
      
      // Should start installation
      expect(result.current.state).toBe('installing')
      console.log("State after startInstalling() ", result.current);
      
      
      // Simulate UV sync/run command being executed
      await act(async () => {
        testEnv.electronAPI.simulateInstallationLog('stdout', 'Resolved 45 packages in 2.1s')
        testEnv.electronAPI.simulateInstallationLog('stdout', 'Downloaded 12 packages in 1.3s')
        testEnv.electronAPI.simulateInstallationLog('stdout', 'Installing packages...')
        
        // Wait a bit for state to update
        await new Promise(resolve => setTimeout(resolve, 50))
      })
      
      // Should still be installing with logs
      expect(result.current.state).toBe('installing')
      expect(result.current.logs.length).toBeGreaterThan(0)
      
      // Simulate uvicorn completing successfully
      await act(async () => {
        testEnv.electronAPI.simulateInstallationLog('stdout', 'Uvicorn running on http://127.0.0.1:8000')
        testEnv.electronAPI.simulateInstallationComplete(true)
        await new Promise(resolve => setTimeout(resolve, 50))
      })
      
      // Should complete successfully
      expect(result.current.state).toBe('completed')
    })
  })

  describe('All Installation UI States', () => {
    it('should test idle state', () => {
      const { result } = renderHook(() => useInstallationStore())
      
      expect(result.current.state).toBe('idle')
      expect(result.current.progress).toBe(20)
      expect(result.current.logs).toEqual([])
      expect(result.current.error).toBeUndefined()
      expect(result.current.isVisible).toBe(false)
    })

    it('should test installing state', async () => {
      const { result } = renderHook(() => useInstallationStore())
      
      act(() => {
        result.current.startInstallation()
      })
      
      expect(result.current.state).toBe('installing')
      expect(result.current.isVisible).toBe(true)
      expect(result.current.progress).toBe(20)
    })

    it('should test error state', async () => {
      const { result } = renderHook(() => useInstallationStore())
      
      act(() => {
        result.current.startInstallation()
      })
      
      act(() => {
        result.current.setError('Installation failed')
      })
      
      expect(result.current.state).toBe('error')
      expect(result.current.error).toBe('Installation failed')
      expect(result.current.logs).toHaveLength(1)
      expect(result.current.logs[0].type).toBe('stderr')
    })

    it('should test completed state', async () => {
      const { result } = renderHook(() => useInstallationStore())
      
      act(() => {
        result.current.startInstallation()
      })
      
      act(() => {
        result.current.setSuccess()
      })
      
      expect(result.current.state).toBe('completed')
      expect(result.current.progress).toBe(100)
    })

    it('should test retry after error', async () => {
      const { result } = renderHook(() => useInstallationStore())
      
      // Start and fail installation
      act(() => {
        result.current.startInstallation()
        result.current.setError('Installation failed')
      })
      
      expect(result.current.state).toBe('error')
      
      // Retry installation
      act(() => {
        result.current.retryInstallation()
      })
      
      expect(result.current.state).toBe('installing')
      expect(result.current.error).toBeUndefined()
      expect(result.current.logs).toEqual([])
    })
  })

  describe('Complete Installation Flows', () => {
    it('should handle fresh installation flow', async () => {
      testEnv.scenarios.freshInstall()
      
      const { result } = renderHook(() => useInstallationStore())
      
      // Start installation
      await act(async () => {
        await result.current.performInstallation()
      })
      
      // Should complete successfully
      await waitForInstallationState(() => result.current, 'completed', 1000)
      expect(result.current.state).toBe('completed')
    })

    it('should handle installation with simulation', async () => {
      const { result } = renderHook(() => useInstallationStore())
      
      // Start installation manually
      act(() => {
        result.current.startInstallation()
      })

      testEnv.electronAPI.onInstallDependenciesStart(() => {
        act(() => {
          result.current.startInstallation()
        })
      })

      testEnv.electronAPI.onInstallDependenciesLog((data: { type: string; data: string }) => {
        act(() => {
          result.current.addLog({
            type: data.type as 'stdout' | 'stderr',
            data: data.data,
            timestamp: new Date(),
          })
        })
      })

      testEnv.electronAPI.onInstallDependenciesComplete((data: { success: boolean; error?: string }) => {
        act(() => {
          if (data.success) {
            result.current.setSuccess()
          } else {
            result.current.setError(data.error || 'Installation failed')
          }
        })
      })
      
      console.log("State before success installation, ", result.current)
      // Simulate successful installation flow
      await testEnv.simulate.successfulInstallation(50)
      
      // Wait for completion
      await waitForInstallationState(() => result.current, 'completed', 1000)
      console.log("State after success installation, ", result.current)
      
      expect(result.current.state).toBe('completed')
      expect(result.current.logs.length).toBeGreaterThan(0)
    })

    it('should handle installation failure with retry', async () => {
      const { result } = renderHook(() => useInstallationStore())
      
      // Start installation
      act(() => {
        result.current.startInstallation()
      })

      testEnv.electronAPI.onInstallDependenciesStart(() => {
        act(() => {
          result.current.startInstallation()
        })
      })

      testEnv.electronAPI.onInstallDependenciesLog((data: { type: string; data: string }) => {
        act(() => {
          result.current.addLog({
            type: data.type as 'stdout' | 'stderr',
            data: data.data,
            timestamp: new Date(),
          })
        })
      })

      testEnv.electronAPI.onInstallDependenciesComplete((data: { success: boolean; error?: string }) => {
        act(() => {
          if (data.success) {
            result.current.setSuccess()
          } else {
            result.current.setError(data.error || 'Installation failed')
          }
        })
      })
      
      // Simulate failed installation
      await testEnv.simulate.failedInstallation(50, 'Network error')
      
      // Wait for error state
      await waitForInstallationState(() => result.current, 'error', 1000)
      console.log("State after event listened", result.current);
      
      expect(result.current.state).toBe('error')
      expect(result.current.error).toBe('Network error')
      
      // Fix the environment and retry
      testEnv.scenarios.allGood()
      
      act(() => {
        result.current.retryInstallation()
      })
      
      // Simulate successful retry
      await testEnv.simulate.successfulInstallation(50)
      
      // Should complete successfully
      await waitForInstallationState(() => result.current, 'completed', 1000)
      expect(result.current.state).toBe('completed')
    })
  })

  describe('State Inspection', () => {
    it('should provide useful state inspection', () => {
      testEnv.scenarios.freshInstall()
      
      const state = testEnv.inspect.getInstallationState()
      
      expect(state.venvExists).toBe(false)
      expect(state.toolsAvailable).toBe(false)
      expect(state.isInstalling).toBe(false)
      expect(state.hasLockFiles).toBe(false)
    })

    it('should verify scenario setup', () => {
      testEnv.scenarios.versionUpdate()
      expect(testEnv.inspect.verifyScenario('versionUpdate')).toBe(true)
      
      testEnv.scenarios.freshInstall()
      expect(testEnv.inspect.verifyScenario('freshInstall')).toBe(true)
      expect(testEnv.inspect.verifyScenario('versionUpdate')).toBe(false)
    })
  })

  describe('Environment Changes During Tests', () => {
    it('should allow changing environment state during test', async () => {
      // Start with fresh install
      testEnv.scenarios.freshInstall()
      expect(testEnv.inspect.getInstallationState().venvExists).toBe(false)
      
      // Simulate .venv being created
      testEnv.electronAPI.mockState.venvExists = true
      testEnv.mockEnv.mockState.filesystem.venvExists = true
      
      expect(testEnv.inspect.getInstallationState().venvExists).toBe(true)
      
      // Simulate version file being created
      testEnv.electronAPI.simulateVersionChange('1.0.0')
      testEnv.mockEnv.mockState.filesystem.versionFileExists = true
      testEnv.mockEnv.mockState.filesystem.versionFileContent = '1.0.0'
      
      // Now environment should be in 'all good' state
      const state = testEnv.inspect.getInstallationState()
      expect(state.venvExists).toBe(true)
    })
  })
})

// You can run this test file with:
// npm test test/unit/examples/installationFlow.test.ts