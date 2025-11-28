import { vi } from 'vitest'

/**
 * Mock for API Configuration
 *
 * This mock simulates the backend API config endpoints used in Setting/API.tsx
 * It handles:
 * - Config info retrieval (/api/config/info)
 * - Config values retrieval (/api/configs)
 * - Config value verification and storage (/api/configs POST)
 */

export interface ConfigItem {
  name: string
  env_vars: string[]
}

export interface ConfigValue {
  config_name: string
  config_value: string
  config_group?: string
}

// In-memory storage for config values
let configStore: ConfigValue[] = []

// Predefined config groups (simulating backend /api/config/info response)
const configInfo = {
  'OpenAI': {
    env_vars: ['OPENAI_API_KEY']
  },
  'Anthropic': {
    env_vars: ['ANTHROPIC_API_KEY']
  },
  'Google': {
    env_vars: ['GOOGLE_API_KEY']
  },
  'Custom API': {
    env_vars: ['CUSTOM_API_KEY', 'CUSTOM_API_URL']
  }
}

/**
 * Mock for proxyFetchGet - retrieves config info or config values
 */
export const mockProxyFetchGet = vi.fn((url: string) => {
  if (url === '/api/config/info') {
    return Promise.resolve(configInfo)
  }

  if (url === '/api/configs') {
    return Promise.resolve(configStore)
  }

  return Promise.resolve(null)
})

/**
 * Mock for proxyFetchPost - stores and validates config values
 */
export const mockProxyFetchPost = vi.fn((url: string, data?: any) => {
  if (url === '/api/configs' && data) {
    const { config_name, config_value, config_group } = data

    // Validation: empty values should fail
    if (!config_value || !config_value.trim()) {
      return Promise.reject(new Error('Config value cannot be empty'))
    }

    // Validation: API key format (simple validation)
    if (config_name.includes('API_KEY') && config_value.length < 10) {
      return Promise.reject(new Error('Invalid API key format'))
    }

    // Update or add config value
    const existingIndex = configStore.findIndex(
      (item) => item.config_name === config_name
    )

    if (existingIndex >= 0) {
      configStore[existingIndex] = { config_name, config_value, config_group }
    } else {
      configStore.push({ config_name, config_value, config_group })
    }

    return Promise.resolve({ code: 0, text: 'Success' })
  }

  return Promise.resolve(null)
})

/**
 * Reset the mock state
 */
export const resetApiConfigMock = () => {
  configStore = []
  mockProxyFetchGet.mockClear()
  mockProxyFetchPost.mockClear()
}

/**
 * Get current config store (for testing)
 */
export const getConfigStore = () => [...configStore]

/**
 * Set config store (for testing)
 */
export const setConfigStore = (configs: ConfigValue[]) => {
  configStore = [...configs]
}

/**
 * Helper to get a specific config value
 */
export const getConfigValue = (config_name: string): string | null => {
  const config = configStore.find((item) => item.config_name === config_name)
  return config ? config.config_value : null
}
