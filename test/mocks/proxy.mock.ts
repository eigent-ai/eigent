import { vi } from "vitest"

// Mock API calls for both relative and alias paths
const mockImplementation = {
  fetchPost: vi.fn((url, data) => {
    if (url.includes('/task/')) {
      return Promise.resolve({ success: true })
    }
    return Promise.resolve({})
  }),
  fetchPut: vi.fn(() => Promise.resolve({ success: true })),
  getBaseURL: vi.fn(() => Promise.resolve('http://localhost:8000')),
  proxyFetchPost: vi.fn((url, data) => {
    // Mock history creation
    if (url.includes('/api/chat/history')) {
      return Promise.resolve({ id: 'history-' + Date.now() })
    }
    // Mock provider info
    if (url.includes('/api/providers')) {
      return Promise.resolve({ items: [] })
    }
    return Promise.resolve({})
  }),
  proxyFetchPut: vi.fn(() => Promise.resolve({ success: true })),
  proxyFetchGet: vi.fn((url, params) => {
    // Mock user key
    if (url.includes('/api/user/key')) {
      return Promise.resolve({
        value: 'test-api-key',
        api_url: 'https://api.openai.com',
      })
    }
    // Mock providers
    if (url.includes('/api/providers')) {
      return Promise.resolve({ items: [] })
    }
    // Mock privacy settings
    if (url.includes('/api/user/privacy')) {
      return Promise.resolve({
        dataCollection: true,
        analytics: true,
        marketing: true
      })
    }
    // Mock configs
    if (url.includes('/api/configs')) {
      return Promise.resolve([])
    }
    // Mock snapshots - return empty array to prevent the error
    if (url.includes('/api/chat/snapshots')) {
      return Promise.resolve([])
    }
    return Promise.resolve({})
  }),
  uploadFile: vi.fn(),
  fetchDelete: vi.fn(),
}

// Mock both relative and alias paths
vi.mock('../../src/api/http', () => mockImplementation)
vi.mock('@/api/http', () => mockImplementation)

// Export the mocked functions for use in tests
export const { proxyFetchGet, proxyFetchPost, fetchPost } = mockImplementation