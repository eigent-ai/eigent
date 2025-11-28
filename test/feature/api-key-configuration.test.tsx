import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  mockProxyFetchGet,
  mockProxyFetchPost,
  resetApiConfigMock,
  getConfigStore,
  getConfigValue,
  setConfigStore,
} from '../mocks/apiConfig.mock'

/**
 * Feature Test: API Key Configuration
 *
 * User Journey: User enters API key → Saves → Key is validated and persisted
 *
 * This test suite validates the API key configuration functionality.
 * It focuses on the backend API interactions for storing and validating API keys.
 */

// Mock the http module
vi.mock('@/api/http', () => ({
  proxyFetchGet: mockProxyFetchGet,
  proxyFetchPost: mockProxyFetchPost,
}))

describe('Feature Test: API Key Configuration', () => {
  beforeEach(() => {
    // Reset mock state before each test
    resetApiConfigMock()
  })

  /**
   * Test 1: Retrieve available config groups
   *
   * Validates that users can see available API config groups:
   * - Fetches config info from backend
   * - Returns list of providers with their environment variables
   */
  it('retrieves available API configuration groups', async () => {
    const configInfo = await mockProxyFetchGet('/api/config/info')

    // Verify config info is returned
    expect(configInfo).toBeDefined()
    expect(configInfo['OpenAI']).toBeDefined()
    expect(configInfo['OpenAI'].env_vars).toContain('OPENAI_API_KEY')
    expect(configInfo['Anthropic']).toBeDefined()
    expect(configInfo['Anthropic'].env_vars).toContain('ANTHROPIC_API_KEY')
  })

  /**
   * Test 2: Retrieve existing config values
   *
   * Validates that users can see their saved API keys:
   * - Fetches stored config values
   * - Returns empty array when no configs saved
   */
  it('retrieves existing configuration values', async () => {
    // Initially no configs
    let configs = await mockProxyFetchGet('/api/configs')
    expect(configs).toEqual([])

    // Add a config
    setConfigStore([
      { config_name: 'OPENAI_API_KEY', config_value: 'sk-test123456789' },
    ])

    // Retrieve configs
    configs = await mockProxyFetchGet('/api/configs')
    expect(configs.length).toBe(1)
    expect(configs[0].config_name).toBe('OPENAI_API_KEY')
    expect(configs[0].config_value).toBe('sk-test123456789')
  })

  /**
   * Test 3: Save valid API key
   *
   * Validates that users can save a valid API key:
   * - Submits API key to backend
   * - Backend validates and stores the key
   * - Returns success response
   */
  it('saves valid API key successfully', async () => {
    const result = await mockProxyFetchPost('/api/configs', {
      config_name: 'OPENAI_API_KEY',
      config_value: 'sk-validkey123456',
      config_group: 'OpenAI',
    })

    // Verify success response
    expect(result.code).toBe(0)
    expect(result.text).toBe('Success')

    // Verify key was stored
    const storedValue = getConfigValue('OPENAI_API_KEY')
    expect(storedValue).toBe('sk-validkey123456')
  })

  /**
   * Test 4: Reject empty API key
   *
   * Validates that empty API keys are rejected:
   * - Submits empty value
   * - Backend returns error
   * - Key is not stored
   */
  it('rejects empty API key value', async () => {
    await expect(
      mockProxyFetchPost('/api/configs', {
        config_name: 'OPENAI_API_KEY',
        config_value: '',
        config_group: 'OpenAI',
      })
    ).rejects.toThrow('Config value cannot be empty')

    // Verify key was not stored
    const storedValue = getConfigValue('OPENAI_API_KEY')
    expect(storedValue).toBeNull()
  })

  /**
   * Test 5: Reject whitespace-only API key
   *
   * Validates that whitespace-only values are rejected:
   * - Submits whitespace value
   * - Backend returns error
   * - Key is not stored
   */
  it('rejects whitespace-only API key value', async () => {
    await expect(
      mockProxyFetchPost('/api/configs', {
        config_name: 'OPENAI_API_KEY',
        config_value: '   ',
        config_group: 'OpenAI',
      })
    ).rejects.toThrow('Config value cannot be empty')

    // Verify key was not stored
    const storedValue = getConfigValue('OPENAI_API_KEY')
    expect(storedValue).toBeNull()
  })

  /**
   * Test 6: Validate API key format
   *
   * Validates that API keys must meet minimum requirements:
   * - Short API keys are rejected
   * - Valid-length API keys are accepted
   */
  it('validates API key format', async () => {
    // Too short API key should fail
    await expect(
      mockProxyFetchPost('/api/configs', {
        config_name: 'OPENAI_API_KEY',
        config_value: 'sk-short',
        config_group: 'OpenAI',
      })
    ).rejects.toThrow('Invalid API key format')

    // Valid length API key should succeed
    const result = await mockProxyFetchPost('/api/configs', {
      config_name: 'OPENAI_API_KEY',
      config_value: 'sk-validkey123456',
      config_group: 'OpenAI',
    })

    expect(result.code).toBe(0)
    expect(getConfigValue('OPENAI_API_KEY')).toBe('sk-validkey123456')
  })

  /**
   * Test 7: Update existing API key
   *
   * Validates that users can update their API keys:
   * - Saves initial key
   * - Updates with new value
   * - New value replaces old value
   */
  it('updates existing API key', async () => {
    // Save initial key
    await mockProxyFetchPost('/api/configs', {
      config_name: 'OPENAI_API_KEY',
      config_value: 'sk-oldkey123456',
      config_group: 'OpenAI',
    })

    expect(getConfigValue('OPENAI_API_KEY')).toBe('sk-oldkey123456')

    // Update with new key
    await mockProxyFetchPost('/api/configs', {
      config_name: 'OPENAI_API_KEY',
      config_value: 'sk-newkey789012',
      config_group: 'OpenAI',
    })

    // Verify new key replaced old key
    expect(getConfigValue('OPENAI_API_KEY')).toBe('sk-newkey789012')

    // Verify only one entry exists
    const store = getConfigStore()
    const openAIKeys = store.filter((c) => c.config_name === 'OPENAI_API_KEY')
    expect(openAIKeys.length).toBe(1)
  })

  /**
   * Test 8: Save multiple API keys
   *
   * Validates that users can configure multiple providers:
   * - Saves OpenAI key
   * - Saves Anthropic key
   * - Both keys are stored independently
   */
  it('saves multiple API keys for different providers', async () => {
    // Save OpenAI key
    await mockProxyFetchPost('/api/configs', {
      config_name: 'OPENAI_API_KEY',
      config_value: 'sk-openai123456',
      config_group: 'OpenAI',
    })

    // Save Anthropic key
    await mockProxyFetchPost('/api/configs', {
      config_name: 'ANTHROPIC_API_KEY',
      config_value: 'sk-ant-123456789012',
      config_group: 'Anthropic',
    })

    // Verify both keys are stored
    expect(getConfigValue('OPENAI_API_KEY')).toBe('sk-openai123456')
    expect(getConfigValue('ANTHROPIC_API_KEY')).toBe('sk-ant-123456789012')

    // Verify store has 2 entries
    const store = getConfigStore()
    expect(store.length).toBe(2)
  })

  /**
   * Test 9: Save custom API configuration
   *
   * Validates that users can configure custom API endpoints:
   * - Saves custom API key
   * - Saves custom API URL
   * - Both values are stored
   */
  it('saves custom API configuration with multiple env vars', async () => {
    // Save custom API key
    await mockProxyFetchPost('/api/configs', {
      config_name: 'CUSTOM_API_KEY',
      config_value: 'custom-key-123456',
      config_group: 'Custom API',
    })

    // Save custom API URL (not an API key, so no format validation)
    await mockProxyFetchPost('/api/configs', {
      config_name: 'CUSTOM_API_URL',
      config_value: 'https://api.example.com',
      config_group: 'Custom API',
    })

    // Verify both values are stored
    expect(getConfigValue('CUSTOM_API_KEY')).toBe('custom-key-123456')
    expect(getConfigValue('CUSTOM_API_URL')).toBe('https://api.example.com')
  })

  /**
   * Test 10: Config persistence
   *
   * Validates that config values persist:
   * - Saves multiple configs
   * - Retrieves all configs
   * - All values are present
   */
  it('persists configuration values across retrievals', async () => {
    // Save multiple configs
    await mockProxyFetchPost('/api/configs', {
      config_name: 'OPENAI_API_KEY',
      config_value: 'sk-openai123456',
      config_group: 'OpenAI',
    })

    await mockProxyFetchPost('/api/configs', {
      config_name: 'GOOGLE_API_KEY',
      config_value: 'google-key-123456',
      config_group: 'Google',
    })

    // Retrieve all configs
    const configs = await mockProxyFetchGet('/api/configs')

    // Verify all configs are present
    expect(configs.length).toBe(2)
    expect(configs.some((c: any) => c.config_name === 'OPENAI_API_KEY')).toBe(true)
    expect(configs.some((c: any) => c.config_name === 'GOOGLE_API_KEY')).toBe(true)
  })

  /**
   * Test 11: Config group association
   *
   * Validates that configs are associated with their groups:
   * - Saves config with group
   * - Group information is stored
   * - Can retrieve by group
   */
  it('associates configurations with their config groups', async () => {
    await mockProxyFetchPost('/api/configs', {
      config_name: 'OPENAI_API_KEY',
      config_value: 'sk-openai123456',
      config_group: 'OpenAI',
    })

    const store = getConfigStore()
    const openAIConfig = store.find((c) => c.config_name === 'OPENAI_API_KEY')

    expect(openAIConfig).toBeDefined()
    expect(openAIConfig!.config_group).toBe('OpenAI')
  })

  /**
   * Test 12: Complete configuration workflow
   *
   * Validates the complete user workflow:
   * - Fetch available config groups
   * - Check existing values (initially empty)
   * - Save new API key
   * - Retrieve to verify persistence
   * - Update API key
   * - Verify update persisted
   */
  it('completes full configuration workflow', async () => {
    // Step 1: Fetch available config groups
    const configInfo = await mockProxyFetchGet('/api/config/info')
    expect(configInfo['OpenAI']).toBeDefined()

    // Step 2: Check existing values (should be empty)
    let configs = await mockProxyFetchGet('/api/configs')
    expect(configs.length).toBe(0)

    // Step 3: Save new API key
    const saveResult = await mockProxyFetchPost('/api/configs', {
      config_name: 'OPENAI_API_KEY',
      config_value: 'sk-initial123456',
      config_group: 'OpenAI',
    })
    expect(saveResult.code).toBe(0)

    // Step 4: Retrieve to verify persistence
    configs = await mockProxyFetchGet('/api/configs')
    expect(configs.length).toBe(1)
    expect(configs[0].config_value).toBe('sk-initial123456')

    // Step 5: Update API key
    const updateResult = await mockProxyFetchPost('/api/configs', {
      config_name: 'OPENAI_API_KEY',
      config_value: 'sk-updated789012',
      config_group: 'OpenAI',
    })
    expect(updateResult.code).toBe(0)

    // Step 6: Verify update persisted
    configs = await mockProxyFetchGet('/api/configs')
    expect(configs.length).toBe(1) // Still only one entry
    expect(configs[0].config_value).toBe('sk-updated789012') // Updated value
  })
})
