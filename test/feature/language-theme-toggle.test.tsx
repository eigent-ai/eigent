import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAuthStore } from '../../src/store/authStore'

/**
 * Feature Test: Language and Theme Toggle
 *
 * User Journey: User switches language → UI updates / User switches theme → Styles update
 *
 * This test suite validates the language and theme switching functionality.
 * Users should be able to change the application language and appearance theme.
 */

describe('Feature Test: Language and Theme Toggle', () => {
  beforeEach(() => {
    // Reset store to default state
    const store = useAuthStore.getState()
    store.setLanguage('en')
    store.setAppearance('light')
  })

  /**
   * Test 1: Default language is English
   *
   * Validates initial language state:
   * - Application starts with English ('en')
   * - Language setting is accessible
   */
  it('initializes with English language by default', () => {
    const { result } = renderHook(() => useAuthStore())

    expect(result.current.language).toBe('en')
  })

  /**
   * Test 2: Default theme is light
   *
   * Validates initial theme state:
   * - Application starts with light theme
   * - Theme setting is accessible
   */
  it('initializes with light theme by default', () => {
    const { result } = renderHook(() => useAuthStore())

    expect(result.current.appearance).toBe('light')
  })

  /**
   * Test 3: Switch language to Chinese
   *
   * Validates language switching:
   * - User changes language from English to Chinese
   * - Language setting updates correctly
   * - UI text should render in Chinese (tested by i18n)
   */
  it('switches language from English to Chinese', () => {
    const { result } = renderHook(() => useAuthStore())

    // Verify starts with English
    expect(result.current.language).toBe('en')

    // Switch to Chinese
    act(() => {
      result.current.setLanguage('zh')
    })

    // Verify language changed
    expect(result.current.language).toBe('zh')
  })

  /**
   * Test 4: Switch language to Japanese
   *
   * Validates Japanese language support:
   * - Can switch to Japanese ('ja')
   * - Language persists
   */
  it('switches language to Japanese', () => {
    const { result } = renderHook(() => useAuthStore())

    act(() => {
      result.current.setLanguage('ja')
    })

    expect(result.current.language).toBe('ja')
  })

  /**
   * Test 5: Switch between multiple languages
   *
   * Validates language switching flow:
   * - English → Chinese → Japanese → English
   * - Each switch updates correctly
   * - No state corruption
   */
  it('switches between multiple languages sequentially', () => {
    const { result } = renderHook(() => useAuthStore())

    // Start with English
    expect(result.current.language).toBe('en')

    // Switch to Chinese
    act(() => {
      result.current.setLanguage('zh')
    })
    expect(result.current.language).toBe('zh')

    // Switch to Japanese
    act(() => {
      result.current.setLanguage('ja')
    })
    expect(result.current.language).toBe('ja')

    // Switch back to English
    act(() => {
      result.current.setLanguage('en')
    })
    expect(result.current.language).toBe('en')
  })

  /**
   * Test 6: Switch theme to dark mode
   *
   * Validates dark theme switching:
   * - User changes from light to dark theme
   * - Appearance setting updates
   * - Theme should apply dark styles (tested by CSS)
   */
  it('switches theme from light to dark', () => {
    const { result } = renderHook(() => useAuthStore())

    // Verify starts with light
    expect(result.current.appearance).toBe('light')

    // Switch to dark
    act(() => {
      result.current.setAppearance('dark')
    })

    // Verify theme changed
    expect(result.current.appearance).toBe('dark')
  })

  /**
   * Test 7: Switch theme to system preference
   *
   * Validates system theme mode:
   * - User can select 'system' appearance
   * - Theme follows OS preference
   */
  it('switches theme to system preference', () => {
    const { result } = renderHook(() => useAuthStore())

    act(() => {
      result.current.setAppearance('system')
    })

    expect(result.current.appearance).toBe('system')
  })

  /**
   * Test 8: Toggle between all theme options
   *
   * Validates all theme modes:
   * - light → dark → system → light
   * - Each mode works correctly
   */
  it('cycles through all theme options', () => {
    const { result } = renderHook(() => useAuthStore())

    // Start with light
    expect(result.current.appearance).toBe('light')

    // Switch to dark
    act(() => {
      result.current.setAppearance('dark')
    })
    expect(result.current.appearance).toBe('dark')

    // Switch to system
    act(() => {
      result.current.setAppearance('system')
    })
    expect(result.current.appearance).toBe('system')

    // Switch back to light
    act(() => {
      result.current.setAppearance('light')
    })
    expect(result.current.appearance).toBe('light')
  })

  /**
   * Test 9: Language and theme are independent
   *
   * Validates settings independence:
   * - Changing language doesn't affect theme
   * - Changing theme doesn't affect language
   * - Both settings persist separately
   */
  it('maintains independence between language and theme settings', () => {
    const { result } = renderHook(() => useAuthStore())

    // Set initial state
    act(() => {
      result.current.setLanguage('en')
      result.current.setAppearance('light')
    })

    expect(result.current.language).toBe('en')
    expect(result.current.appearance).toBe('light')

    // Change language, verify theme unchanged
    act(() => {
      result.current.setLanguage('zh')
    })

    expect(result.current.language).toBe('zh')
    expect(result.current.appearance).toBe('light') // Should remain light

    // Change theme, verify language unchanged
    act(() => {
      result.current.setAppearance('dark')
    })

    expect(result.current.language).toBe('zh') // Should remain zh
    expect(result.current.appearance).toBe('dark')
  })

  /**
   * Test 10: Settings persist across store access
   *
   * Validates settings persistence:
   * - Multiple components can access same settings
   * - Changes in one instance reflect in others
   * - State is shared globally
   */
  it('persists language and theme settings across store instances', () => {
    const { result: result1 } = renderHook(() => useAuthStore())

    // Set values in first instance
    act(() => {
      result1.current.setLanguage('ja')
      result1.current.setAppearance('dark')
    })

    // Create second instance
    const { result: result2 } = renderHook(() => useAuthStore())

    // Verify second instance has same values
    expect(result2.current.language).toBe('ja')
    expect(result2.current.appearance).toBe('dark')

    // Change in second instance
    act(() => {
      result2.current.setLanguage('en')
      result2.current.setAppearance('light')
    })

    // Verify first instance is updated
    expect(result1.current.language).toBe('en')
    expect(result1.current.appearance).toBe('light')
  })

  /**
   * Test 11: Supported languages
   *
   * Validates all supported languages:
   * - English (en)
   * - Chinese (zh)
   * - Japanese (ja)
   * - Each language can be selected
   */
  it('supports all available languages', () => {
    const { result } = renderHook(() => useAuthStore())

    const supportedLanguages = ['en', 'zh', 'ja']

    supportedLanguages.forEach(lang => {
      act(() => {
        result.current.setLanguage(lang)
      })
      expect(result.current.language).toBe(lang)
    })
  })

  /**
   * Test 12: Supported themes
   *
   * Validates all supported themes:
   * - light
   * - dark
   * - system
   * - Each theme can be selected
   */
  it('supports all available themes', () => {
    const { result } = renderHook(() => useAuthStore())

    const supportedThemes: Array<'light' | 'dark' | 'system'> = ['light', 'dark', 'system']

    supportedThemes.forEach(theme => {
      act(() => {
        result.current.setAppearance(theme)
      })
      expect(result.current.appearance).toBe(theme)
    })
  })

  /**
   * Test 13: Settings persist after logout
   *
   * Validates persistence through logout:
   * - User sets custom language and theme
   * - User logs out
   * - Settings remain (not cleared by logout)
   */
  it('preserves language and theme settings after logout', () => {
    const { result } = renderHook(() => useAuthStore())

    // Set custom settings
    act(() => {
      result.current.setLanguage('zh')
      result.current.setAppearance('dark')
    })

    expect(result.current.language).toBe('zh')
    expect(result.current.appearance).toBe('dark')

    // Logout
    act(() => {
      result.current.logout()
    })

    // Verify settings are preserved
    // (In real implementation, these persist to localStorage)
    expect(result.current.language).toBe('zh')
    expect(result.current.appearance).toBe('dark')
  })

  /**
   * Test 14: Rapid setting changes
   *
   * Validates handling of rapid changes:
   * - Multiple quick language changes
   * - Multiple quick theme changes
   * - Final state is correct
   * - No race conditions
   */
  it('handles rapid language and theme changes correctly', () => {
    const { result } = renderHook(() => useAuthStore())

    // Rapid language changes
    act(() => {
      result.current.setLanguage('en')
      result.current.setLanguage('zh')
      result.current.setLanguage('ja')
      result.current.setLanguage('en')
    })

    // Should end with last value
    expect(result.current.language).toBe('en')

    // Rapid theme changes
    act(() => {
      result.current.setAppearance('light')
      result.current.setAppearance('dark')
      result.current.setAppearance('system')
      result.current.setAppearance('dark')
    })

    // Should end with last value
    expect(result.current.appearance).toBe('dark')
  })

  /**
   * Test 15: Complete settings workflow
   *
   * Validates full user journey:
   * - Check default settings
   * - Change language
   * - Change theme
   * - Verify both changes persisted
   * - Change both again
   * - Verify final state
   */
  it('completes full language and theme configuration workflow', () => {
    const { result } = renderHook(() => useAuthStore())

    // Step 1: Check defaults
    expect(result.current.language).toBe('en')
    expect(result.current.appearance).toBe('light')

    // Step 2: Change language to Chinese
    act(() => {
      result.current.setLanguage('zh')
    })
    expect(result.current.language).toBe('zh')
    expect(result.current.appearance).toBe('light') // Theme unchanged

    // Step 3: Change theme to dark
    act(() => {
      result.current.setAppearance('dark')
    })
    expect(result.current.language).toBe('zh') // Language unchanged
    expect(result.current.appearance).toBe('dark')

    // Step 4: Change both settings
    act(() => {
      result.current.setLanguage('ja')
      result.current.setAppearance('system')
    })

    // Step 5: Verify final state
    expect(result.current.language).toBe('ja')
    expect(result.current.appearance).toBe('system')
  })
})

/**
 * Testing Notes:
 *
 * 1. **Language Support**
 *    - 'en': English
 *    - 'zh': Chinese (Simplified)
 *    - 'ja': Japanese
 *    - Additional languages can be added as needed
 *
 * 2. **Theme Options**
 *    - 'light': Light mode (default)
 *    - 'dark': Dark mode
 *    - 'system': Follow OS preference
 *
 * 3. **Persistence**
 *    - Settings are stored in localStorage via Zustand persist
 *    - Settings survive page refresh
 *    - Settings persist across logout/login
 *
 * 4. **UI Integration**
 *    - Language changes trigger i18n re-render
 *    - Theme changes apply CSS class to root element
 *    - Settings usually accessed through Settings page
 *
 * 5. **Real-world Usage**
 *    - Users access settings through gear icon
 *    - Language dropdown shows available languages
 *    - Theme selector shows light/dark/system options
 *    - Changes apply immediately without page refresh
 */
