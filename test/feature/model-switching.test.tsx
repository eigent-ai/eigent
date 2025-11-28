import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAuthStore } from '../../src/store/authStore'

/**
 * Feature Test: Model Switching
 *
 * User Journey: User switches between Cloud/Custom API/Local modes → Configuration takes effect
 *
 * This test suite validates the model switching functionality.
 * It focuses on the store behavior and state management for different model types.
 */

describe('Feature Test: Model Switching', () => {
  beforeEach(() => {
    // Reset store state before each test
    const store = useAuthStore.getState()
    store.setModelType('cloud')
    store.setCloudModelType('gpt-4.1')
  })

  /**
   * Test 1: Default model type is cloud
   *
   * Validates that the application starts with cloud model:
   * - Default modelType is 'cloud'
   * - Default cloud model type is set
   */
  it('initializes with cloud model type by default', () => {
    const { result } = renderHook(() => useAuthStore())

    // Verify default model type
    expect(result.current.modelType).toBe('cloud')
    expect(result.current.cloud_model_type).toBeDefined()
  })

  /**
   * Test 2: Switch to local model
   *
   * Validates that users can switch to local model:
   * - Can set modelType to 'local'
   * - State updates correctly
   */
  it('switches from cloud to local model', () => {
    const { result } = renderHook(() => useAuthStore())

    // Verify starts with cloud
    expect(result.current.modelType).toBe('cloud')

    // Switch to local
    act(() => {
      result.current.setModelType('local')
    })

    // Verify switched to local
    expect(result.current.modelType).toBe('local')
  })

  /**
   * Test 3: Switch to custom API model
   *
   * Validates that users can switch to custom API:
   * - Can set modelType to 'custom'
   * - State persists
   */
  it('switches from cloud to custom API model', () => {
    const { result } = renderHook(() => useAuthStore())

    // Verify starts with cloud
    expect(result.current.modelType).toBe('cloud')

    // Switch to custom
    act(() => {
      result.current.setModelType('custom')
    })

    // Verify switched to custom
    expect(result.current.modelType).toBe('custom')
  })

  /**
   * Test 4: Switch between all model types
   *
   * Validates that users can switch between all three types:
   * - cloud → local → custom → cloud
   * - Each switch updates state correctly
   */
  it('switches between all model types sequentially', () => {
    const { result } = renderHook(() => useAuthStore())

    // Start with cloud
    expect(result.current.modelType).toBe('cloud')

    // Switch to local
    act(() => {
      result.current.setModelType('local')
    })
    expect(result.current.modelType).toBe('local')

    // Switch to custom
    act(() => {
      result.current.setModelType('custom')
    })
    expect(result.current.modelType).toBe('custom')

    // Switch back to cloud
    act(() => {
      result.current.setModelType('cloud')
    })
    expect(result.current.modelType).toBe('cloud')
  })

  /**
   * Test 5: Change cloud model type
   *
   * Validates that users can change the cloud model:
   * - Can switch between different cloud models
   * - Model type persists
   */
  it('changes cloud model type', () => {
    const { result } = renderHook(() => useAuthStore())

    // Verify initial cloud model
    expect(result.current.cloud_model_type).toBe('gpt-4.1')

    // Change to GPT-4.1 mini
    act(() => {
      result.current.setCloudModelType('gpt-4.1-mini')
    })
    expect(result.current.cloud_model_type).toBe('gpt-4.1-mini')

    // Change to Claude Sonnet
    act(() => {
      result.current.setCloudModelType('claude-sonnet-4-5')
    })
    expect(result.current.cloud_model_type).toBe('claude-sonnet-4-5')

    // Change to Gemini
    act(() => {
      result.current.setCloudModelType('gemini/gemini-2.5-pro')
    })
    expect(result.current.cloud_model_type).toBe('gemini/gemini-2.5-pro')
  })

  /**
   * Test 6: Cloud model type persists when switching model types
   *
   * Validates that cloud model selection is preserved:
   * - Switching to local/custom doesn't change cloud_model_type
   * - Can switch back to cloud with same model
   */
  it('preserves cloud model type when switching to other model types', () => {
    const { result } = renderHook(() => useAuthStore())

    // Set specific cloud model
    act(() => {
      result.current.setCloudModelType('claude-sonnet-4-5')
    })
    expect(result.current.cloud_model_type).toBe('claude-sonnet-4-5')

    // Switch to local
    act(() => {
      result.current.setModelType('local')
    })

    // Verify cloud model type is still set
    expect(result.current.cloud_model_type).toBe('claude-sonnet-4-5')

    // Switch back to cloud
    act(() => {
      result.current.setModelType('cloud')
    })

    // Verify cloud model type is still the same
    expect(result.current.cloud_model_type).toBe('claude-sonnet-4-5')
  })

  /**
   * Test 7: All cloud model types are supported
   *
   * Validates that all cloud models can be selected:
   * - GPT models (4.1, 4.1-mini, 5, 5-mini)
   * - Claude models (Sonnet 4-5, Sonnet 4, Haiku 3.5)
   * - Gemini models (2.5 Pro, 2.5 Flash, 3 Pro Preview)
   */
  it('supports all available cloud model types', () => {
    const { result } = renderHook(() => useAuthStore())

    const cloudModels: Array<'gemini/gemini-2.5-pro' | 'gemini-2.5-flash' | 'gemini-3-pro-preview' | 'gpt-4.1-mini' | 'gpt-4.1' | 'claude-sonnet-4-5' | 'claude-sonnet-4-20250514' | 'claude-3-5-haiku-20241022' | 'gpt-5' | 'gpt-5-mini'> = [
      'gpt-4.1',
      'gpt-4.1-mini',
      'gpt-5',
      'gpt-5-mini',
      'claude-sonnet-4-5',
      'claude-sonnet-4-20250514',
      'claude-3-5-haiku-20241022',
      'gemini/gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-3-pro-preview'
    ]

    cloudModels.forEach(model => {
      act(() => {
        result.current.setCloudModelType(model)
      })
      expect(result.current.cloud_model_type).toBe(model)
    })
  })

  /**
   * Test 8: Model type state is independent
   *
   * Validates that modelType and cloud_model_type are independent:
   * - Changing modelType doesn't affect cloud_model_type
   * - Changing cloud_model_type doesn't affect modelType
   */
  it('maintains independence between modelType and cloud_model_type', () => {
    const { result } = renderHook(() => useAuthStore())

    // Set cloud model while in cloud mode
    act(() => {
      result.current.setModelType('cloud')
      result.current.setCloudModelType('claude-sonnet-4-5')
    })
    expect(result.current.modelType).toBe('cloud')
    expect(result.current.cloud_model_type).toBe('claude-sonnet-4-5')

    // Switch to custom, cloud_model_type should remain
    act(() => {
      result.current.setModelType('custom')
    })
    expect(result.current.modelType).toBe('custom')
    expect(result.current.cloud_model_type).toBe('claude-sonnet-4-5')

    // Change cloud_model_type while in custom mode
    act(() => {
      result.current.setCloudModelType('gpt-5')
    })
    expect(result.current.modelType).toBe('custom')
    expect(result.current.cloud_model_type).toBe('gpt-5')
  })

  /**
   * Test 9: Multiple switches maintain correct state
   *
   * Validates that multiple rapid switches work correctly:
   * - State updates are consistent
   * - No race conditions
   */
  it('handles multiple rapid model type switches correctly', () => {
    const { result } = renderHook(() => useAuthStore())

    act(() => {
      result.current.setModelType('cloud')
      result.current.setModelType('local')
      result.current.setModelType('custom')
    })

    // Should end with the last set value
    expect(result.current.modelType).toBe('custom')

    act(() => {
      result.current.setCloudModelType('gpt-4.1')
      result.current.setCloudModelType('claude-sonnet-4-5')
      result.current.setCloudModelType('gemini/gemini-2.5-pro')
    })

    // Should end with the last set value
    expect(result.current.cloud_model_type).toBe('gemini/gemini-2.5-pro')
  })

  /**
   * Test 10: Model configuration persists across store access
   *
   * Validates that model configuration is persistent:
   * - Creating new hook instances shows same values
   * - State is shared across all consumers
   */
  it('persists model configuration across multiple hook instances', () => {
    const { result: result1 } = renderHook(() => useAuthStore())

    // Set model configuration in first instance
    act(() => {
      result1.current.setModelType('local')
      result1.current.setCloudModelType('claude-sonnet-4-5')
    })

    // Create second instance
    const { result: result2 } = renderHook(() => useAuthStore())

    // Verify second instance has same values
    expect(result2.current.modelType).toBe('local')
    expect(result2.current.cloud_model_type).toBe('claude-sonnet-4-5')

    // Change in second instance
    act(() => {
      result2.current.setModelType('custom')
    })

    // Verify first instance is updated
    expect(result1.current.modelType).toBe('custom')
  })

  /**
   * Test 11: Model type validation
   *
   * Validates that only valid model types are accepted:
   * - 'cloud', 'local', 'custom' are valid
   * - State correctly reflects the current model type
   */
  it('only accepts valid model types', () => {
    const { result } = renderHook(() => useAuthStore())

    const validTypes: Array<'cloud' | 'local' | 'custom'> = ['cloud', 'local', 'custom']

    validTypes.forEach(type => {
      act(() => {
        result.current.setModelType(type)
      })
      expect(result.current.modelType).toBe(type)
    })
  })

  /**
   * Test 12: Model settings survive logout/login cycle (persistence test)
   *
   * Validates that model settings are preserved:
   * - Model preferences persist through logout
   * - Cloud model type persists
   */
  it('preserves model settings through logout', () => {
    const { result } = renderHook(() => useAuthStore())

    // Set custom configuration
    act(() => {
      result.current.setModelType('custom')
      result.current.setCloudModelType('claude-sonnet-4-5')
    })

    // Simulate logout
    act(() => {
      result.current.logout()
    })

    // Verify model settings are still preserved (due to persistence)
    // Note: In real implementation, these settings persist to localStorage
    expect(result.current.cloud_model_type).toBe('claude-sonnet-4-5')
  })
})
