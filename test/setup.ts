// Global test setup file
import { vi } from 'vitest'
import '@testing-library/jest-dom'

// Mock Electron APIs if needed
global.electronAPI = {
  // Add mock implementations for electron preload APIs
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
