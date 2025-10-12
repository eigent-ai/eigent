import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useInstallationStore, type InstallationState } from '../../../src/store/installationStore'
import { setupElectronMocks, TestScenarios, type MockedElectronAPI } from '../../mocks/electronMocks'

// Mock the authStore import since it's imported dynamically
vi.mock('../../../src/store/authStore', () => ({
  useAuthStore: {
    getState: () => ({
      setInitState: vi.fn()
    })
  }
}))

describe('Installation Store', () => {
  let electronAPI: MockedElectronAPI
  let mockSetInitState: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    // Set up electron mocks
    const mocks = setupElectronMocks()
    electronAPI = mocks.electronAPI

    // Mock the authStore
    const { useAuthStore } = await import('../../../src/store/authStore')
    mockSetInitState = vi.fn()
    useAuthStore.getState = vi.fn().mockReturnValue({
      setInitState: mockSetInitState
    })

    // Reset the store to initial state
    useInstallationStore.getState().reset()
  })

  afterEach(() => {
    vi.clearAllMocks()
    electronAPI.reset()
  })

  describe('Initial State', () => {
    it('should have correct initial state', () => {
      const { result } = renderHook(() => useInstallationStore())
      
      expect(result.current.state).toBe('idle')
      expect(result.current.progress).toBe(20)
      expect(result.current.logs).toEqual([])
      expect(result.current.error).toBeUndefined()
      expect(result.current.isVisible).toBe(false)
    })
  })

  describe('State Transitions', () => {
    it('should transition from idle to installing when startInstallation is called', () => {
      const { result } = renderHook(() => useInstallationStore())
      
      act(() => {
        result.current.startInstallation()
      })
      
      expect(result.current.state).toBe('installing')
      expect(result.current.progress).toBe(20)
      expect(result.current.logs).toEqual([])
      expect(result.current.error).toBeUndefined()
      expect(result.current.isVisible).toBe(true)
    })

    it('should transition to completed when setSuccess is called', () => {
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

    it('should transition to error when setError is called', () => {
      const { result } = renderHook(() => useInstallationStore())
      const errorMessage = 'Installation failed'
      
      act(() => {
        result.current.startInstallation()
      })
      
      act(() => {
        result.current.setError(errorMessage)
      })
      
      expect(result.current.state).toBe('error')
      expect(result.current.error).toBe(errorMessage)
      expect(result.current.logs).toHaveLength(1)
      expect(result.current.logs[0].type).toBe('stderr')
      expect(result.current.logs[0].data).toBe(errorMessage)
    })

    it('should reset to installing state when retryInstallation is called', () => {
      const { result } = renderHook(() => useInstallationStore())
      
      // First, set error state
      act(() => {
        result.current.startInstallation()
      })
      
      act(() => {
        result.current.setError('Some error')
      })
      
      expect(result.current.state).toBe('error')
      
      // Then retry
      act(() => {
        result.current.retryInstallation()
      })
      
      expect(result.current.state).toBe('installing')
      expect(result.current.logs).toEqual([])
      expect(result.current.error).toBeUndefined()
      expect(result.current.isVisible).toBe(true)
    })
  })

  describe('Log Management', () => {
    it('should add logs and update progress', () => {
      const { result } = renderHook(() => useInstallationStore())
      
      act(() => {
        result.current.startInstallation()
      })
      
      const initialProgress = result.current.progress
      
      act(() => {
        result.current.addLog({
          type: 'stdout',
          data: 'Installing package...',
          timestamp: new Date()
        })
      })
      
      expect(result.current.logs).toHaveLength(1)
      expect(result.current.logs[0].type).toBe('stdout')
      expect(result.current.logs[0].data).toBe('Installing package...')
      expect(result.current.progress).toBe(initialProgress + 5)
    })

    it('should not exceed 90% progress when adding logs', () => {
      const { result } = renderHook(() => useInstallationStore())
      
      act(() => {
        result.current.startInstallation()
      })
      
      // Add many logs to test progress cap
      act(() => {
        for (let i = 0; i < 20; i++) {
          result.current.addLog({
            type: 'stdout',
            data: `Log entry ${i}`,
            timestamp: new Date()
          })
        }
      })
      
      expect(result.current.progress).toBe(90)
      expect(result.current.logs).toHaveLength(20)
    })
  })

  describe('Installation Flow Integration', () => {
    it('should handle successful installation flow', async () => {
      TestScenarios.versionUpdate(electronAPI)
      
      const { result } = renderHook(() => useInstallationStore())
      
      // Start installation
      await act(async () => {
        await result.current.performInstallation()
      })
      
      // Wait for the mocked installation to complete
      await vi.waitFor(() => {
        expect(result.current.state).toBe('completed')
      }, { timeout: 1000 })
      
      expect(electronAPI.checkAndInstallDepsOnUpdate).toHaveBeenCalled()
      expect(mockSetInitState).toHaveBeenCalledWith('done')
    })

    it('should handle installation failure', async () => {
      TestScenarios.installationError(electronAPI)
      
      const { result } = renderHook(() => useInstallationStore())
      
      await act(async () => {
        await result.current.performInstallation()
      })
      
      // Wait for the mocked installation to fail
      await vi.waitFor(() => {
        expect(result.current.state).toBe('error')
      }, { timeout: 1000 })
      
      expect(result.current.error).toBe('Installation failed')
    })

    it('should handle fresh installation scenario', async () => {
      TestScenarios.freshInstall(electronAPI)
      
      const { result } = renderHook(() => useInstallationStore())
      
      await act(async () => {
        await result.current.performInstallation()
      })
      
      await vi.waitFor(() => {
        expect(result.current.state).toBe('completed')
      }, { timeout: 1000 })
      
      expect(electronAPI.checkAndInstallDepsOnUpdate).toHaveBeenCalled()
    })
  })

  describe('Log Export', () => {
    it('should export logs successfully', async () => {
      const { result } = renderHook(() => useInstallationStore())
      
      // Mock window.location.href
      const originalLocation = window.location
      Object.defineProperty(window, 'location', {
        value: { href: '' },
        writable: true
      })
      
      // Mock alert
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
      
      await act(async () => {
        await result.current.exportLog()
      })
      
      expect(electronAPI.exportLog).toHaveBeenCalled()
      expect(alertSpy).toHaveBeenCalledWith('Log saved: /mock/path/to/log.txt')
      expect(window.location.href).toBe('https://github.com/eigent-ai/eigent/issues/new/choose')
      
      // Restore
      Object.defineProperty(window, 'location', {
        value: originalLocation,
        writable: true
      })
      alertSpy.mockRestore()
    })

    it('should handle export failure', async () => {
      electronAPI.exportLog.mockResolvedValue({
        success: false,
        error: 'Export failed'
      })
      
      const { result } = renderHook(() => useInstallationStore())
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
      
      await act(async () => {
        await result.current.exportLog()
      })
      
      expect(alertSpy).toHaveBeenCalledWith('Export cancelled: Export failed')
      alertSpy.mockRestore()
    })
  })

  describe('Computed Selectors', () => {
    it('useLatestLog should return the most recent log', () => {
      const { result: storeResult } = renderHook(() => useInstallationStore())
      const { result: latestLogResult } = renderHook(() => useInstallationStore((state: any) => 
        state.logs[state.logs.length - 1]
      ))
      
      expect(latestLogResult.current).toBeUndefined()
      
      act(() => {
        storeResult.current.startInstallation()
        storeResult.current.addLog({
          type: 'stdout',
          data: 'First log',
          timestamp: new Date()
        })
        storeResult.current.addLog({
          type: 'stderr',
          data: 'Latest log',
          timestamp: new Date()
        })
      })
      
      expect(latestLogResult.current.data).toBe('Latest log')
      expect(latestLogResult.current.type).toBe('stderr')
    })

    it('useInstallationStatus should return correct status', () => {
      const { result: storeResult } = renderHook(() => useInstallationStore())
      const { result: statusResult } = renderHook(() => {
        const state = useInstallationStore((state: any) => state.state)
        const isVisible = useInstallationStore((state: any) => state.isVisible)
        
        return {
          isInstalling: state === 'installing',
          installationState: state,
          shouldShowInstallScreen: isVisible && state !== 'completed',
          isInstallationComplete: state === 'completed',
          canRetry: state === 'error',
        }
      })
      
      // Initial state
      expect(statusResult.current.isInstalling).toBe(false)
      expect(statusResult.current.installationState).toBe('idle')
      expect(statusResult.current.shouldShowInstallScreen).toBe(false)
      expect(statusResult.current.isInstallationComplete).toBe(false)
      expect(statusResult.current.canRetry).toBe(false)
      
      // Installing state
      act(() => {
        storeResult.current.startInstallation()
      })
      
      expect(statusResult.current.isInstalling).toBe(true)
      expect(statusResult.current.shouldShowInstallScreen).toBe(true)
      expect(statusResult.current.canRetry).toBe(false)
      
      // Error state
      act(() => {
        storeResult.current.setError('Some error')
      })
      
      expect(statusResult.current.isInstalling).toBe(false)
      expect(statusResult.current.canRetry).toBe(true)
      
      // Completed state
      act(() => {
        storeResult.current.setSuccess()
      })
      
      expect(statusResult.current.isInstallationComplete).toBe(true)
      expect(statusResult.current.shouldShowInstallScreen).toBe(false)
    })
  })

  describe('Edge Cases', () => {
    it('should handle multiple rapid state changes', () => {
      const { result } = renderHook(() => useInstallationStore())
      
      act(() => {
        result.current.startInstallation()
        result.current.setError('Error 1')
        result.current.retryInstallation()
        result.current.setSuccess()
      })
      
      expect(result.current.state).toBe('completed')
      expect(result.current.progress).toBe(100)
    })

    it('should handle visibility changes correctly', () => {
      const { result } = renderHook(() => useInstallationStore())
      
      expect(result.current.isVisible).toBe(false)
      
      act(() => {
        result.current.setVisible(true)
      })
      
      expect(result.current.isVisible).toBe(true)
      
      act(() => {
        result.current.completeSetup()
      })
      
      expect(result.current.state).toBe('completed')
      expect(result.current.isVisible).toBe(false)
    })

    it('should handle manual progress updates', () => {
      const { result } = renderHook(() => useInstallationStore())
      
      act(() => {
        result.current.updateProgress(75)
      })
      
      expect(result.current.progress).toBe(75)
    })
  })

  describe('Installation State Sequence', () => {
    it('should follow correct state sequence for normal installation', async () => {
      const { result } = renderHook(() => useInstallationStore())
      const states: InstallationState[] = []
      
      // Subscribe to state changes
      useInstallationStore.subscribe((state: any) => {
        states.push(state.state)
      })
      
      await act(async () => {
        await result.current.performInstallation()
      })
      
      await vi.waitFor(() => {
        expect(result.current.state).toBe('completed')
      }, { timeout: 1000 })
      
      // Should have progressed through: idle -> installing -> completed
      expect(states).toContain('installing')
      expect(states).toContain('completed')
    })
  })
})