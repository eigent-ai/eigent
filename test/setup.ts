// Global test setup file
import { vi } from 'vitest'
import '@testing-library/jest-dom'

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      // Map translation keys to English text
      const translations: Record<string, string> = {
        'chat.welcome-to-eigent': 'Welcome to Eigent',
        'chat.how-can-i-help-you': 'How can I help you today?',
        'chat.palm-springs-tennis-trip-planner': 'Palm Springs Tennis Trip Planner',
        'chat.bank-transfer-csv-analysis-and-visualization': 'Bank Transfer CSV Analysis and Visualization',
        'chat.find-duplicate-files-in-downloads-folder': 'Find Duplicate Files in Downloads Folder',
        'setting.search-mcp': 'Search MCPs',
        'chat.by-messaging-eigent': 'By messaging Eigent, you agree to our',
        'chat.terms-of-use': 'Terms of Use',
        'chat.and': 'and',
        'chat.privacy-policy': 'Privacy Policy',
        'chat.palm-springs-tennis-trip-planner-message': 'Plan a tennis trip to Palm Springs',
        'chat.bank-transfer-csv-analysis-and-visualization-message': 'Analyze and visualize bank transfer CSV',
        'chat.find-duplicate-files-in-downloads-folder-message': 'Find duplicate files in Downloads folder',
        'chat.no-reply-received-task-continue': 'No reply received, task will continue',
      }
      return translations[key] || key
    },
    i18n: {
      language: 'en',
      changeLanguage: vi.fn(),
    },
  }),
}))

// Mock Electron APIs if needed
global.electronAPI = {
  // Add mock implementations for electron preload APIs
}

// Mock ipcRenderer
global.ipcRenderer = {
  invoke: vi.fn(),
  on: vi.fn(),
  removeAllListeners: vi.fn(),
}

// Mock environment variables
process.env.NODE_ENV = 'test'

// Global test utilities
global.waitFor = async (callback: () => boolean, timeout = 5000) => {
  const startTime = Date.now()
  while (Date.now() - startTime < timeout) {
    if (await callback()) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Timeout waiting for condition after ${timeout}ms`)
}

// Add type declarations for globals
declare global {
  var electronAPI: any
  var ipcRenderer: any
  var waitFor: (callback: () => boolean, timeout?: number) => Promise<void>
}

// Setup DOM environment
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}))

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}))
