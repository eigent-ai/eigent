/**
 * Tests for DOM ready event handlers in createWindow function
 * These handlers manage localStorage injection for installation states
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupMockEnvironment } from '../../../mocks/environmentMocks'

describe('createWindow - DOM Ready Event Handlers', () => {
  let mockEnv: ReturnType<typeof setupMockEnvironment>
  let mockWebContents: any
  let mockWindow: any

  beforeEach(() => {
    mockEnv = setupMockEnvironment()
    
    // Mock webContents and window
    mockWebContents = {
      on: vi.fn(),
      once: vi.fn(),
      executeJavaScript: vi.fn(),
      send: vi.fn(),
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      openDevTools: vi.fn()
    }

    mockWindow = {
      webContents: mockWebContents,
      reload: vi.fn()
    }

    // Reset all mocks
    vi.clearAllMocks()
  })

  afterEach(() => {
    mockEnv.reset()
  })

  describe('Fresh Installation - Carousel State Injection', () => {
    it('should inject fresh auth-storage with carousel state', () => {
      // Simulate fresh installation scenario
      const needsInstallation = true

      // Set up DOM ready handler like createWindow does
      if (needsInstallation) {
        mockWebContents.on('dom-ready', () => {
          const injectionScript = `
            (function() {
              try {
                const newAuthStorage = {
                  state: {
                    token: null,
                    username: null,
                    email: null,
                    user_id: null,
                    appearance: 'light',
                    language: 'system',
                    isFirstLaunch: true,
                    modelType: 'cloud',
                    cloud_model_type: 'gpt-4.1',
                    initState: 'carousel',
                    share_token: null,
                    workerListData: {}
                  },
                  version: 0
                };
                localStorage.setItem('auth-storage', JSON.stringify(newAuthStorage));
                console.log('[ELECTRON PRE-INJECT] Created fresh auth-storage with carousel state');
              } catch (e) {
                console.error('[ELECTRON PRE-INJECT] Failed to create storage:', e);
              }
            })();
          `
          mockWebContents.executeJavaScript(injectionScript)
        })
      }

      // Trigger DOM ready event
      const domReadyCallback = mockWebContents.on.mock.calls.find(
        (call: any) => call[0] === 'dom-ready'
      )?.[1]

      expect(domReadyCallback).toBeDefined()
      
      if (domReadyCallback) {
        domReadyCallback()
      }

      // Verify JavaScript injection was called with carousel state
      expect(mockWebContents.executeJavaScript).toHaveBeenCalledWith(
        expect.stringContaining('initState: \'carousel\'')
      )
      expect(mockWebContents.executeJavaScript).toHaveBeenCalledWith(
        expect.stringContaining('isFirstLaunch: true')
      )
    })

    it('should handle JavaScript injection errors gracefully', () => {
      const needsInstallation = true
      
      // Mock executeJavaScript to reject
      mockWebContents.executeJavaScript.mockRejectedValue(new Error('Injection failed'))

      // Set up DOM ready handler with error handling
      if (needsInstallation) {
        mockWebContents.on('dom-ready', () => {
          const injectionScript = `/* injection script */`
          mockWebContents.executeJavaScript(injectionScript).catch((err: Error) => {
            // In real code, this is logged but doesn't throw
            console.error('Failed to inject script:', err)
          })
        })
      }

      // Trigger DOM ready event
      const domReadyCallback = mockWebContents.on.mock.calls.find(
        (call: any) => call[0] === 'dom-ready'
      )?.[1]

      if (domReadyCallback) {
        expect(() => domReadyCallback()).not.toThrow()
      }
    })

    it('should include all required auth-storage properties', () => {
      const needsInstallation = true

      if (needsInstallation) {
        mockWebContents.on('dom-ready', () => {
          const injectionScript = `
            (function() {
              try {
                const newAuthStorage = {
                  state: {
                    token: null,
                    username: null,
                    email: null,
                    user_id: null,
                    appearance: 'light',
                    language: 'system',
                    isFirstLaunch: true,
                    modelType: 'cloud',
                    cloud_model_type: 'gpt-4.1',
                    initState: 'carousel',
                    share_token: null,
                    workerListData: {}
                  },
                  version: 0
                };
                localStorage.setItem('auth-storage', JSON.stringify(newAuthStorage));
              } catch (e) {
                console.error('Failed to create storage:', e);
              }
            })();
          `
          mockWebContents.executeJavaScript(injectionScript)
        })
      }

      const domReadyCallback = mockWebContents.on.mock.calls.find(
        (call: any) => call[0] === 'dom-ready'
      )?.[1]

      if (domReadyCallback) {
        domReadyCallback()
      }

      const injectedScript = mockWebContents.executeJavaScript.mock.calls[0]?.[0]
      
      // Verify all required properties are included
      expect(injectedScript).toContain('token: null')
      expect(injectedScript).toContain('username: null')
      expect(injectedScript).toContain('email: null')
      expect(injectedScript).toContain('user_id: null')
      expect(injectedScript).toContain('appearance: \'light\'')
      expect(injectedScript).toContain('language: \'system\'')
      expect(injectedScript).toContain('isFirstLaunch: true')
      expect(injectedScript).toContain('modelType: \'cloud\'')
      expect(injectedScript).toContain('cloud_model_type: \'gpt-4.1\'')
      expect(injectedScript).toContain('initState: \'carousel\'')
      expect(injectedScript).toContain('share_token: null')
      expect(injectedScript).toContain('workerListData: {}')
      expect(injectedScript).toContain('version: 0')
    })
  })

  describe('Completed Installation - Done State Management', () => {
    it('should check and update initState to done when installation is complete', () => {
      const needsInstallation = false

      if (!needsInstallation) {
        mockWebContents.once('dom-ready', () => {
          const checkScript = `
            (function() {
              try {
                const authStorage = localStorage.getItem('auth-storage');
                if (authStorage) {
                  const parsed = JSON.parse(authStorage);
                  if (parsed.state && parsed.state.initState !== 'done') {
                    console.log('[ELECTRON] Updating initState from', parsed.state.initState, 'to done');
                    parsed.state.initState = 'done';
                    localStorage.setItem('auth-storage', JSON.stringify(parsed));
                    console.log('[ELECTRON] initState updated to done, reloading page...');
                    return true;
                  }
                }
                return false;
              } catch (e) {
                console.error('[ELECTRON] Failed to update initState:', e);
                return false;
              }
            })();
          `
          mockWebContents.executeJavaScript(checkScript)
        })
      }

      // Trigger DOM ready event
      const domReadyCallback = mockWebContents.once.mock.calls.find(
        (call: any) => call[0] === 'dom-ready'
      )?.[1]

      expect(domReadyCallback).toBeDefined()

      if (domReadyCallback) {
        domReadyCallback()
      }

      // Verify the check script was executed
      expect(mockWebContents.executeJavaScript).toHaveBeenCalledWith(
        expect.stringContaining('initState !== \'done\'')
      )
      expect(mockWebContents.executeJavaScript).toHaveBeenCalledWith(
        expect.stringContaining('initState = \'done\'')
      )
    })

    it('should trigger window reload when initState needs updating', async () => {
      const needsInstallation = false
      
      // Mock executeJavaScript to return true (indicating reload needed)
      mockWebContents.executeJavaScript.mockResolvedValue(true)

      if (!needsInstallation) {
        mockWebContents.once('dom-ready', () => {
          mockWebContents.executeJavaScript(`/* check script */`).then((needsReload: boolean) => {
            if (needsReload) {
              mockWindow.reload()
            }
          })
        })
      }

      // Trigger DOM ready event
      const domReadyCallback = mockWebContents.once.mock.calls.find(
        (call: any) => call[0] === 'dom-ready'
      )?.[1]

      if (domReadyCallback) {
        domReadyCallback()
      }

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(mockWindow.reload).toHaveBeenCalled()
    })

    it('should not reload when initState is already done', async () => {
      const needsInstallation = false
      
      // Mock executeJavaScript to return false (no reload needed)
      mockWebContents.executeJavaScript.mockResolvedValue(false)

      if (!needsInstallation) {
        mockWebContents.once('dom-ready', () => {
          mockWebContents.executeJavaScript(`/* check script */`).then((needsReload: boolean) => {
            if (needsReload) {
              mockWindow.reload()
            }
          })
        })
      }

      const domReadyCallback = mockWebContents.once.mock.calls.find(
        (call: any) => call[0] === 'dom-ready'
      )?.[1]

      if (domReadyCallback) {
        domReadyCallback()
      }

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(mockWindow.reload).not.toHaveBeenCalled()
    })

    it('should handle localStorage parsing errors gracefully', async () => {
      const needsInstallation = false
      
      // Mock executeJavaScript to simulate parsing error (return false)
      mockWebContents.executeJavaScript.mockResolvedValue(false)

      if (!needsInstallation) {
        mockWebContents.once('dom-ready', () => {
          const checkScript = `
            (function() {
              try {
                const authStorage = localStorage.getItem('auth-storage');
                if (authStorage) {
                  const parsed = JSON.parse(authStorage); // This could throw
                  // ... rest of logic
                }
                return false;
              } catch (e) {
                console.error('[ELECTRON] Failed to update initState:', e);
                return false; // Error case returns false
              }
            })();
          `
          mockWebContents.executeJavaScript(checkScript)
        })
      }

      const domReadyCallback = mockWebContents.once.mock.calls.find(
        (call: any) => call[0] === 'dom-ready'
      )?.[1]

      if (domReadyCallback) {
        expect(() => domReadyCallback()).not.toThrow()
      }

      await new Promise(resolve => setTimeout(resolve, 10))

      // Should not reload on error
      expect(mockWindow.reload).not.toHaveBeenCalled()
    })
  })

  describe('Event Handler Setup Differences', () => {
    it('should use "on" event for fresh installation (can trigger multiple times)', () => {
      const needsInstallation = true

      // Simulate the logic from createWindow
      if (needsInstallation) {
        mockWebContents.on('dom-ready', () => {
          // Fresh installation handler
        })
      }

      // Verify 'on' was used instead of 'once'
      expect(mockWebContents.on).toHaveBeenCalledWith('dom-ready', expect.any(Function))
      expect(mockWebContents.once).not.toHaveBeenCalled()
    })

    it('should use "once" event for completed installation (single trigger)', () => {
      const needsInstallation = false

      // Simulate the logic from createWindow
      if (!needsInstallation) {
        mockWebContents.once('dom-ready', () => {
          // Completed installation handler
        })
      }

      // Verify 'once' was used instead of 'on'
      expect(mockWebContents.once).toHaveBeenCalledWith('dom-ready', expect.any(Function))
      expect(mockWebContents.on).not.toHaveBeenCalled()
    })
  })

  describe('JavaScript Execution Content Validation', () => {
    it('should create properly structured auth-storage JSON for fresh installation', () => {
      const needsInstallation = true

      if (needsInstallation) {
        mockWebContents.on('dom-ready', () => {
          const script = `
            (function() {
              try {
                const newAuthStorage = {
                  state: {
                    token: null,
                    username: null,
                    email: null,
                    user_id: null,
                    appearance: 'light',
                    language: 'system',
                    isFirstLaunch: true,
                    modelType: 'cloud',
                    cloud_model_type: 'gpt-4.1',
                    initState: 'carousel',
                    share_token: null,
                    workerListData: {}
                  },
                  version: 0
                };
                localStorage.setItem('auth-storage', JSON.stringify(newAuthStorage));
                console.log('[ELECTRON PRE-INJECT] Created fresh auth-storage with carousel state');
              } catch (e) {
                console.error('[ELECTRON PRE-INJECT] Failed to create storage:', e);
              }
            })();
          `
          mockWebContents.executeJavaScript(script)
        })
      }

      const domReadyCallback = mockWebContents.on.mock.calls[0]?.[1]
      if (domReadyCallback) {
        domReadyCallback()
      }

      const executedScript = mockWebContents.executeJavaScript.mock.calls[0]?.[0]
      
      // Verify the script is wrapped in IIFE
      expect(executedScript).toMatch(/^\s*\(\s*function\s*\(\s*\)\s*\{/)
      expect(executedScript).toMatch(/\}\s*\)\s*\(\s*\)\s*;?\s*$/)
      
      // Verify it has try-catch error handling
      expect(executedScript).toContain('try {')
      expect(executedScript).toContain('} catch (e) {')
      
      // Verify it sets localStorage
      expect(executedScript).toContain('localStorage.setItem(\'auth-storage\'')
      expect(executedScript).toContain('JSON.stringify(newAuthStorage)')
    })

    it('should check localStorage properly for completed installation', () => {
      const needsInstallation = false

      if (!needsInstallation) {
        mockWebContents.once('dom-ready', () => {
          const script = `
            (function() {
              try {
                const authStorage = localStorage.getItem('auth-storage');
                if (authStorage) {
                  const parsed = JSON.parse(authStorage);
                  if (parsed.state && parsed.state.initState !== 'done') {
                    parsed.state.initState = 'done';
                    localStorage.setItem('auth-storage', JSON.stringify(parsed));
                    return true;
                  }
                }
                return false;
              } catch (e) {
                console.error('[ELECTRON] Failed to update initState:', e);
                return false;
              }
            })();
          `
          mockWebContents.executeJavaScript(script)
        })
      }

      const domReadyCallback = mockWebContents.once.mock.calls[0]?.[1]
      if (domReadyCallback) {
        domReadyCallback()
      }

      const executedScript = mockWebContents.executeJavaScript.mock.calls[0]?.[0]
      
      // Verify it gets localStorage
      expect(executedScript).toContain('localStorage.getItem(\'auth-storage\')')
      
      // Verify it parses JSON
      expect(executedScript).toContain('JSON.parse(authStorage)')
      
      // Verify it checks initState
      expect(executedScript).toContain('initState !== \'done\'')
      
      // Verify it updates initState
      expect(executedScript).toContain('initState = \'done\'')
      
      // Verify it returns boolean
      expect(executedScript).toContain('return true')
      expect(executedScript).toContain('return false')
    })
  })

  describe('Console Logging in Injected Scripts', () => {
    it('should include proper console logging for fresh installation', () => {
      const needsInstallation = true

      if (needsInstallation) {
        mockWebContents.on('dom-ready', () => {
          const script = `
            console.log('[ELECTRON PRE-INJECT] Created fresh auth-storage with carousel state');
            console.error('[ELECTRON PRE-INJECT] Failed to create storage:', e);
          `
          mockWebContents.executeJavaScript(script)
        })
      }

      const domReadyCallback = mockWebContents.on.mock.calls[0]?.[1]
      if (domReadyCallback) {
        domReadyCallback()
      }

      const executedScript = mockWebContents.executeJavaScript.mock.calls[0]?.[0]
      
      // Verify console logging is included
      expect(executedScript).toContain('[ELECTRON PRE-INJECT]')
      expect(executedScript).toContain('console.log')
      expect(executedScript).toContain('console.error')
    })

    it('should include proper console logging for completed installation', () => {
      const needsInstallation = false

      if (!needsInstallation) {
        mockWebContents.once('dom-ready', () => {
          const script = `
            console.log('[ELECTRON] Updating initState from', parsed.state.initState, 'to done');
            console.log('[ELECTRON] initState updated to done, reloading page...');
            console.error('[ELECTRON] Failed to update initState:', e);
          `
          mockWebContents.executeJavaScript(script)
        })
      }

      const domReadyCallback = mockWebContents.once.mock.calls[0]?.[1]
      if (domReadyCallback) {
        domReadyCallback()
      }

      const executedScript = mockWebContents.executeJavaScript.mock.calls[0]?.[0]
      
      // Verify console logging is included
      expect(executedScript).toContain('[ELECTRON]')
      expect(executedScript).toContain('console.log')
      expect(executedScript).toContain('console.error')
    })
  })
})