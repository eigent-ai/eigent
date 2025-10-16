import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useInstallationSetup } from '../../../src/hooks/useInstallationSetup'
import { useInstallationStore } from '../../../src/store/installationStore'
import { useAuthStore } from '../../../src/store/authStore'
import { setupElectronMocks, TestScenarios, type MockedElectronAPI } from '../../mocks/electronMocks'

// Mock the stores
vi.mock('../../../src/store/installationStore')
vi.mock('../../../src/store/authStore')

describe('useInstallationSetup Hook', () => {
  let electronAPI: MockedElectronAPI
  let mockInstallationStore: any
  let mockAuthStore: any

  beforeEach(() => {
    // Set up electron mocks
    const mocks = setupElectronMocks()
    electronAPI = mocks.electronAPI

    // Mock installation store
    mockInstallationStore = {
      startInstallation: vi.fn(),
      addLog: vi.fn(),
      setSuccess: vi.fn(),
      setError: vi.fn(),
    }

    // Mock auth store
    mockAuthStore = {
      initState: 'done',
      setInitState: vi.fn(),
    }

    // Set up mock implementations
    vi.mocked(useInstallationStore).mockImplementation((selector: any) => {
      if (typeof selector === 'function') {
        return selector(mockInstallationStore)
      }
      return mockInstallationStore
    })

    vi.mocked(useAuthStore).mockReturnValue(mockAuthStore)

    // Mock console.log to avoid noise in tests
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.clearAllMocks()
    electronAPI.reset()
  })

  describe('Initial Setup', () => {
    it('should check tool installation status on mount', async () => {
      // Mock IPC response for tool check
      electronAPI.mockState.toolInstalled = true
      
      renderHook(() => useInstallationSetup())

      await vi.waitFor(() => {
        expect(window.ipcRenderer.invoke).toHaveBeenCalledWith('check-tool-installed')
      })
    })

    it('should check backend installation status on mount', async () => {
      renderHook(() => useInstallationSetup())

      await vi.waitFor(() => {
        expect(electronAPI.getInstallationStatus).toHaveBeenCalled()
      })
    })

    it('should start installation if backend installation is in progress', async () => {
      electronAPI.mockState.isInstalling = true
      
      renderHook(() => useInstallationSetup())

      await vi.waitFor(() => {
        expect(mockInstallationStore.startInstallation).toHaveBeenCalled()
      })
    })

    it('should set initState to carousel if tool is not installed', async () => {
      // Set initial state to permissions (as would happen on fresh startup)
      mockAuthStore.initState = 'permissions'

      // Mock tool not installed
      window.ipcRenderer.invoke = vi.fn().mockResolvedValue({
        success: true,
        isInstalled: false
      })

      renderHook(() => useInstallationSetup())

      await vi.waitFor(() => {
        expect(mockAuthStore.setInitState).toHaveBeenCalledWith('carousel')
      })
    })
  })

  describe('Electron IPC Event Handling', () => {
    it('should register all required event listeners', () => {
      renderHook(() => useInstallationSetup())

      expect(electronAPI.onInstallDependenciesStart).toHaveBeenCalled()
      expect(electronAPI.onInstallDependenciesLog).toHaveBeenCalled()
      expect(electronAPI.onInstallDependenciesComplete).toHaveBeenCalled()
    })

    it('should handle install-dependencies-start event', () => {
      renderHook(() => useInstallationSetup())

      // Get the registered callback
      const startCallback = electronAPI.onInstallDependenciesStart.mock.calls[0][0]
      
      act(() => {
        startCallback()
      })

      expect(mockInstallationStore.startInstallation).toHaveBeenCalled()
    })

    it('should handle install-dependencies-log event', () => {
      renderHook(() => useInstallationSetup())

      // Get the registered callback
      const logCallback = electronAPI.onInstallDependenciesLog.mock.calls[0][0]
      const logData = { type: 'stdout', data: 'Installing packages...' }
      
      act(() => {
        logCallback(logData)
      })

      expect(mockInstallationStore.addLog).toHaveBeenCalledWith({
        type: 'stdout',
        data: 'Installing packages...',
        timestamp: expect.any(Date),
      })
    })

    it('should handle install-dependencies-complete event with success', () => {
      renderHook(() => useInstallationSetup())

      // Get the registered callback
      const completeCallback = electronAPI.onInstallDependenciesComplete.mock.calls[0][0]
      const completeData = { success: true }
      
      act(() => {
        completeCallback(completeData)
      })

      expect(mockInstallationStore.setSuccess).toHaveBeenCalled()
      expect(mockAuthStore.setInitState).toHaveBeenCalledWith('done')
    })

    it('should handle install-dependencies-complete event with failure', () => {
      renderHook(() => useInstallationSetup())

      // Get the registered callback
      const completeCallback = electronAPI.onInstallDependenciesComplete.mock.calls[0][0]
      const completeData = { success: false, error: 'Installation failed' }
      
      act(() => {
        completeCallback(completeData)
      })

      expect(mockInstallationStore.setError).toHaveBeenCalledWith('Installation failed')
      expect(mockAuthStore.setInitState).not.toHaveBeenCalledWith('done')
    })

    it('should handle complete event without error message', () => {
      renderHook(() => useInstallationSetup())

      const completeCallback = electronAPI.onInstallDependenciesComplete.mock.calls[0][0]
      const completeData = { success: false }
      
      act(() => {
        completeCallback(completeData)
      })

      expect(mockInstallationStore.setError).toHaveBeenCalledWith('Installation failed')
    })
  })

  describe('Event Listener Cleanup', () => {
    it('should remove all event listeners on unmount', () => {
      const { unmount } = renderHook(() => useInstallationSetup())

      unmount()

      expect(electronAPI.removeAllListeners).toHaveBeenCalledWith('install-dependencies-start')
      expect(electronAPI.removeAllListeners).toHaveBeenCalledWith('install-dependencies-log')
      expect(electronAPI.removeAllListeners).toHaveBeenCalledWith('install-dependencies-complete')
    })
  })

  describe('Test Scenarios Integration', () => {
    it('should handle fresh installation scenario', async () => {
      TestScenarios.freshInstall(electronAPI)

      // Set initial state to permissions (as would happen on fresh startup)
      mockAuthStore.initState = 'permissions'

      // Mock tool not installed
      window.ipcRenderer.invoke = vi.fn().mockResolvedValue({
        success: true,
        isInstalled: false
      })

      renderHook(() => useInstallationSetup())

      await vi.waitFor(() => {
        expect(mockAuthStore.setInitState).toHaveBeenCalledWith('carousel')
      })
    })

    it('should handle version update scenario', async () => {
      TestScenarios.versionUpdate(electronAPI)
      
      renderHook(() => useInstallationSetup())

      // Simulate version update detection and installation start
      electronAPI.simulateInstallationStart()

      await vi.waitFor(() => {
        expect(mockInstallationStore.startInstallation).toHaveBeenCalled()
      })
    })

    it('should handle venv removed scenario', async () => {
      TestScenarios.venvRemoved(electronAPI)
      electronAPI.mockState.isInstalling = true

      renderHook(() => useInstallationSetup())

      await vi.waitFor(() => {
        expect(mockInstallationStore.startInstallation).toHaveBeenCalled()
      })
    })

    it('should handle installation in progress scenario', async () => {
      TestScenarios.installationInProgress(electronAPI)

      renderHook(() => useInstallationSetup())

      await vi.waitFor(() => {
        expect(mockInstallationStore.startInstallation).toHaveBeenCalled()
      })
    })

    it('should handle uvicorn startup with dependency installation', async () => {
      TestScenarios.uvicornDepsInstall(electronAPI)

      renderHook(() => useInstallationSetup())

      // Simulate uvicorn detecting and installing dependencies
      act(() => {
        electronAPI.simulateUvicornStartup()
      })

      await vi.waitFor(() => {
        expect(mockInstallationStore.startInstallation).toHaveBeenCalled()
      })

      // Should receive logs and completion
      await vi.waitFor(() => {
        expect(mockInstallationStore.addLog).toHaveBeenCalled()
        expect(mockInstallationStore.setSuccess).toHaveBeenCalled()
      })
    })
  })

  describe('Error Handling', () => {
    it('should handle tool installation check failure', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      
      window.ipcRenderer.invoke = vi.fn().mockRejectedValue(new Error('IPC failed'))

      renderHook(() => useInstallationSetup())

      await vi.waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          '[useInstallationSetup] Tool installation check failed:',
          expect.any(Error)
        )
      })

      consoleErrorSpy.mockRestore()
    })

    it('should handle installation status check failure', async () => {
      // Mock console.error to suppress expected error logs
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      electronAPI.getInstallationStatus.mockRejectedValue(new Error('Status check failed'))

      renderHook(() => useInstallationSetup())

      // Should not crash, should handle the error gracefully
      await vi.waitFor(() => {
        expect(electronAPI.getInstallationStatus).toHaveBeenCalled()
      })

      // Wait for error to be logged
      await vi.waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalled()
      })

      consoleErrorSpy.mockRestore()
    })
  })

  describe('Multiple Hook Instances', () => {
    it('should handle multiple hook instances without conflicts', () => {
      const { result: hook1 } = renderHook(() => useInstallationSetup())
      const { result: hook2 } = renderHook(() => useInstallationSetup())

      // Both hooks should register listeners
      expect(electronAPI.onInstallDependenciesStart).toHaveBeenCalledTimes(2)
      expect(electronAPI.onInstallDependenciesLog).toHaveBeenCalledTimes(2)
      expect(electronAPI.onInstallDependenciesComplete).toHaveBeenCalledTimes(2)
    })
  })

  describe('State Dependencies', () => {
    it('should react to initState changes', async () => {
      mockAuthStore.initState = 'carousel'
      
      const { rerender } = renderHook(() => useInstallationSetup())

      // Change initState to 'done'
      mockAuthStore.initState = 'done'
      rerender()

      // Should check tool installation again
      await vi.waitFor(() => {
        expect(window.ipcRenderer.invoke).toHaveBeenCalledWith('check-tool-installed')
      })
    })

    it('should not set carousel state if initState is not done', async () => {
      mockAuthStore.initState = 'loading'
      
      window.ipcRenderer.invoke = vi.fn().mockResolvedValue({
        success: true,
        isInstalled: false
      })

      renderHook(() => useInstallationSetup())

      await vi.waitFor(() => {
        expect(window.ipcRenderer.invoke).toHaveBeenCalledWith('check-tool-installed')
      })

      // Should not call setInitState because initState is not 'done'
      expect(mockAuthStore.setInitState).not.toHaveBeenCalledWith('carousel')
    })
  })

  describe('Console Logging', () => {
    it('should log installation status check', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      renderHook(() => useInstallationSetup())

      await vi.waitFor(() => {
        expect(consoleLogSpy).toHaveBeenCalledWith(
          '[useInstallationSetup] Installation status check:',
          expect.any(Object)
        )
      })

      consoleLogSpy.mockRestore()
    })

    it('should log when installation listeners are registered', () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      renderHook(() => useInstallationSetup())

      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[useInstallationSetup] Installation listeners registered'
      )

      consoleLogSpy.mockRestore()
    })

    it('should log install complete events', () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      renderHook(() => useInstallationSetup())

      const completeCallback = electronAPI.onInstallDependenciesComplete.mock.calls[0][0]
      
      act(() => {
        completeCallback({ success: true })
      })

      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[useInstallationSetup] Install complete event received:',
        { success: true }
      )

      consoleLogSpy.mockRestore()
    })
  })
})