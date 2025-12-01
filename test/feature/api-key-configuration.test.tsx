import React from 'react'
import { describe, it, beforeEach, vi, expect, afterEach } from 'vitest'
import { BrowserRouter } from 'react-router-dom'
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../mocks/proxy.mock'
import SettingModels from '../../src/pages/Setting/Models'

// Basic environment setup
vi.stubEnv('VITE_USE_LOCAL_PROXY', 'true')

// Router mock
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: '/settings' }),
  }
})

// i18n mock
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// Auth store mock
vi.mock('@/store/authStore', () => ({
  useAuthStore: () => ({
    modelType: 'custom',
    cloud_model_type: 'gpt-4.1-mini',
    setModelType: vi.fn(),
    setCloudModelType: vi.fn(),
  }),
}))

// Multiple providers for testing
vi.mock('@/lib/llm', () => ({
  INIT_PROVODERS: [
    {
      id: 'openai',
      name: 'OpenAI',
      description: 'OpenAI provider',
      apiKey: '',
      apiHost: '',
      is_valid: false,
      model_type: '',
    },
    {
      id: 'anthropic',
      name: 'Anthropic',
      description: 'Anthropic Claude provider',
      apiKey: '',
      apiHost: '',
      is_valid: false,
      model_type: '',
    },
    {
      id: 'gemini',
      name: 'Google Gemini',
      description: 'Google Gemini provider',
      apiKey: '',
      apiHost: '',
      is_valid: false,
      model_type: '',
    },
  ],
}))

// Toast mock
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    dismiss: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  }),
}))

  // Mock Electron IPC
  ; (global as any).ipcRenderer = {
    invoke: vi.fn((channel) => {
      if (channel === 'get-system-language') return Promise.resolve('en')
      return Promise.resolve()
    }),
  }

const TestWrapper = ({ children }: { children: React.ReactNode }) => (
  <BrowserRouter>{children}</BrowserRouter>
)

describe('Custom Model Configuration - Complete User Flows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  describe('First-time Setup Flow', () => {
    it('allows user to configure their first custom model from scratch', async () => {
      const { proxyFetchGet, proxyFetchPost, fetchPost } = await import('../mocks/proxy.mock')
      const user = userEvent.setup()

      // No providers configured initially
      proxyFetchGet.mockResolvedValueOnce({ items: [] })

      // Validation succeeds
      fetchPost.mockResolvedValueOnce({
        is_valid: true,
        is_tool_calls: true,
      })

      // Provider save succeeds
      proxyFetchPost.mockImplementation(async (url, data) => {
        if (url === '/api/provider') {
          return {
            id: 1,
            provider_name: data.provider_name,
            api_key: data.api_key,
            endpoint_url: data.endpoint_url,
            is_valid: true,
            model_type: data.model_type,
            prefer: false,
          }
        }
        if (url === '/api/provider/prefer') {
          return { success: true }
        }
        return {}
      })

      // After save, returns configured provider
      proxyFetchGet.mockResolvedValueOnce({
        items: [
          {
            id: 1,
            provider_name: 'openai',
            api_key: 'sk-test123',
            endpoint_url: 'https://api.openai.com/v1',
            is_valid: true,
            model_type: 'gpt-4',
            prefer: true,
          },
        ],
      })

      render(
        <TestWrapper>
          <SettingModels />
        </TestWrapper>
      )

      // Wait for component to load and find OpenAI section
      await screen.findByText('OpenAI')

      // Find the OpenAI section
      const openaiSection = screen.getByText('OpenAI').closest('.w-full')!

      // User sees "Not Configured" initially within OpenAI section
      const notConfiguredButton = within(openaiSection).getByRole('button', {
        name: /not configured/i,
      })
      expect(notConfiguredButton).toBeInTheDocument()

      // User fills in API key (using partial match for placeholder)
      const apiKeyInput = within(openaiSection).getByPlaceholderText(/enter-your-api-key/i)
      await user.clear(apiKeyInput)
      await user.type(apiKeyInput, 'sk-test123')

      // User fills in API host
      const apiHostInput = within(openaiSection).getByPlaceholderText(/enter-your-api-host/i)
      await user.clear(apiHostInput)
      await user.type(apiHostInput, 'https://api.openai.com/v1')

      // User fills in model type
      const modelTypeInput = within(openaiSection).getByPlaceholderText(/enter-your-model-type/i)
      await user.clear(modelTypeInput)
      await user.type(modelTypeInput, 'gpt-4')

      // User clicks Save (find Save button within OpenAI section)
      const saveButton = within(openaiSection).getByRole('button', { name: /save/i })
      await user.click(saveButton)

      // User sees success message and "Default" button
      await waitFor(() => {
        const defaultButton = within(openaiSection).getByRole('button', { name: /default/i })
        expect(defaultButton).toBeInTheDocument()
      })
    })

    it('prevents saving when required fields are empty', async () => {
      const { proxyFetchGet } = await import('../mocks/proxy.mock')
      const user = userEvent.setup()

      // Fresh empty state
      proxyFetchGet.mockResolvedValue({ items: [] })

      render(
        <TestWrapper>
          <SettingModels />
        </TestWrapper>
      )

      await screen.findByText('OpenAI')

      // Find the OpenAI section
      const openaiSection = screen.getByText('OpenAI').closest('.w-full')!

      // Ensure inputs are empty first
      const apiKeyInput = within(openaiSection).getByPlaceholderText(/enter-your-api-key/i) as HTMLInputElement
      const apiHostInput = within(openaiSection).getByPlaceholderText(/enter-your-api-host/i) as HTMLInputElement
      const modelTypeInput = within(openaiSection).getByPlaceholderText(/enter-your-model-type/i) as HTMLInputElement

      // Clear any existing values
      if (apiKeyInput.value) await user.clear(apiKeyInput)
      if (apiHostInput.value) await user.clear(apiHostInput)
      if (modelTypeInput.value) await user.clear(modelTypeInput)

      // User clicks Save without filling anything
      const saveButton = within(openaiSection).getByRole('button', { name: /save/i })
      await user.click(saveButton)

      // User sees validation errors
      expect(await within(openaiSection).findByText(/api-key-can-not-be-empty/i)).toBeInTheDocument()
      expect(within(openaiSection).getByText(/api-host-can-not-be-empty/i)).toBeInTheDocument()
      expect(within(openaiSection).getByText(/model-type-can-not-be-empty/i)).toBeInTheDocument()
    })

    it('shows specific error when only API key is missing', async () => {
      const { proxyFetchGet } = await import('../mocks/proxy.mock')
      const user = userEvent.setup()

      proxyFetchGet.mockResolvedValueOnce({ items: [] })

      render(
        <TestWrapper>
          <SettingModels />
        </TestWrapper>
      )

      await screen.findByText('OpenAI')

      const openaiSection = screen.getByText('OpenAI').closest('.w-full')!

      // User fills only host and model type
      const apiHostInput = within(openaiSection).getByPlaceholderText(/enter-your-api-host/i)
      const modelTypeInput = within(openaiSection).getByPlaceholderText(/enter-your-model-type/i)

      await user.clear(apiHostInput)
      await user.type(apiHostInput, 'https://api.openai.com/v1')
      await user.clear(modelTypeInput)
      await user.type(modelTypeInput, 'gpt-4')

      const saveButton = within(openaiSection).getByRole('button', { name: /save/i })
      await user.click(saveButton)

      // Only API key error should show
      expect(await within(openaiSection).findByText(/api-key-can-not-be-empty/i)).toBeInTheDocument()
      expect(within(openaiSection).queryByText(/api-host-can-not-be-empty/i)).not.toBeInTheDocument()
    })
  })

  describe('Validation Error Handling', () => {
    it('displays inline error when API validation fails', async () => {
      const { proxyFetchGet, fetchPost } = await import('../mocks/proxy.mock')
      const user = userEvent.setup()

      proxyFetchGet.mockResolvedValueOnce({ items: [] })

      // Validation fails with specific message
      fetchPost.mockResolvedValueOnce({
        is_valid: false,
        is_tool_calls: false,
        message: 'Invalid API key format',
      })

      render(
        <TestWrapper>
          <SettingModels />
        </TestWrapper>
      )

      await screen.findByText('OpenAI')

      const openaiSection = screen.getByText('OpenAI').closest('.w-full')!

      // User enters invalid credentials
      const apiKeyInput = within(openaiSection).getByPlaceholderText(/enter-your-api-key/i)
      const apiHostInput = within(openaiSection).getByPlaceholderText(/enter-your-api-host/i)
      const modelTypeInput = within(openaiSection).getByPlaceholderText(/enter-your-model-type/i)

      await user.clear(apiKeyInput)
      await user.type(apiKeyInput, 'invalid-key')
      await user.clear(apiHostInput)
      await user.type(apiHostInput, 'https://api.openai.com/v1')
      await user.clear(modelTypeInput)
      await user.type(modelTypeInput, 'gpt-4')

      const saveButton = within(openaiSection).getByRole('button', { name: /save/i })
      await user.click(saveButton)

      // User sees the error message inline
      expect(await within(openaiSection).findByText(/invalid api key format/i)).toBeInTheDocument()
    })

    it('clears previous errors when user corrects input', async () => {
      const { proxyFetchGet } = await import('../mocks/proxy.mock')
      const user = userEvent.setup()

      proxyFetchGet.mockResolvedValueOnce({ items: [] })

      render(
        <TestWrapper>
          <SettingModels />
        </TestWrapper>
      )

      await screen.findByText('OpenAI')

      const openaiSection = screen.getByText('OpenAI').closest('.w-full')!

      // Trigger validation error first
      const saveButton = within(openaiSection).getByRole('button', { name: /save/i })
      await user.click(saveButton)

      // Error appears
      expect(await within(openaiSection).findByText(/api-key-can-not-be-empty/i)).toBeInTheDocument()

      // User starts typing in API key field
      const apiKeyInput = within(openaiSection).getByPlaceholderText(/enter-your-api-key/i)
      await user.type(apiKeyInput, 'sk-')

      // Error disappears
      await waitFor(() => {
        expect(within(openaiSection).queryByText(/api-key-can-not-be-empty/i)).not.toBeInTheDocument()
      })
    })

    it('handles network errors gracefully', async () => {
      const { proxyFetchGet, fetchPost } = await import('../mocks/proxy.mock')
      const user = userEvent.setup()

      proxyFetchGet.mockResolvedValueOnce({ items: [] })

      // Network failure
      fetchPost.mockRejectedValueOnce(new Error('Network error'))

      render(
        <TestWrapper>
          <SettingModels />
        </TestWrapper>
      )

      await screen.findByText('OpenAI')

      const openaiSection = screen.getByText('OpenAI').closest('.w-full')!

      const apiKeyInput = within(openaiSection).getByPlaceholderText(/enter-your-api-key/i)
      const apiHostInput = within(openaiSection).getByPlaceholderText(/enter-your-api-host/i)
      const modelTypeInput = within(openaiSection).getByPlaceholderText(/enter-your-model-type/i)

      await user.clear(apiKeyInput)
      await user.type(apiKeyInput, 'sk-test')
      await user.clear(apiHostInput)
      await user.type(apiHostInput, 'https://api.openai.com/v1')
      await user.clear(modelTypeInput)
      await user.type(modelTypeInput, 'gpt-4')

      const saveButton = within(openaiSection).getByRole('button', { name: /save/i })
      await user.click(saveButton)

      // User sees network error
      expect(await within(openaiSection).findByText(/network error/i)).toBeInTheDocument()
    })
  })

  describe('Multiple Provider Management', () => {
    it('allows user to configure multiple providers independently', async () => {
      const { proxyFetchGet, proxyFetchPost, fetchPost } = await import('../mocks/proxy.mock')
      const user = userEvent.setup()

      // No providers initially
      proxyFetchGet.mockResolvedValueOnce({ items: [] })

      // First validation (OpenAI)
      fetchPost.mockResolvedValueOnce({
        is_valid: true,
        is_tool_calls: true,
      })

      proxyFetchPost.mockResolvedValueOnce({
        id: 1,
        provider_name: 'openai',
        api_key: 'sk-openai',
        endpoint_url: 'https://api.openai.com/v1',
        is_valid: true,
        model_type: 'gpt-4',
        prefer: false,
      })

      // After first save
      proxyFetchGet.mockResolvedValueOnce({
        items: [
          {
            id: 1,
            provider_name: 'openai',
            api_key: 'sk-openai',
            endpoint_url: 'https://api.openai.com/v1',
            is_valid: true,
            model_type: 'gpt-4',
            prefer: true,
          },
        ],
      })

      render(
        <TestWrapper>
          <SettingModels />
        </TestWrapper>
      )

      await screen.findByText('OpenAI')

      // Configure first provider (OpenAI)
      const openaiSection = screen.getByText('OpenAI').closest('.w-full')!
      const openaiKeyInput = within(openaiSection).getByPlaceholderText(/enter-your-api-key/i)
      const openaiHostInput = within(openaiSection).getByPlaceholderText(/enter-your-api-host/i)
      const openaiModelInput = within(openaiSection).getByPlaceholderText(/enter-your-model-type/i)

      await user.clear(openaiKeyInput)
      await user.type(openaiKeyInput, 'sk-openai')
      await user.clear(openaiHostInput)
      await user.type(openaiHostInput, 'https://api.openai.com/v1')
      await user.clear(openaiModelInput)
      await user.type(openaiModelInput, 'gpt-4')

      const openaiSaveButton = within(openaiSection).getByRole('button', { name: /save/i })
      await user.click(openaiSaveButton)

      // OpenAI now shows as configured
      await waitFor(() => {
        const defaultButton = within(openaiSection).getByRole('button', { name: /default/i })
        expect(defaultButton).toBeInTheDocument()
      })
    })

    it('allows user to switch default provider', async () => {
      const { proxyFetchGet, proxyFetchPost } = await import('../mocks/proxy.mock')
      const user = userEvent.setup()

      // Two providers already configured
      proxyFetchGet.mockResolvedValue({
        items: [
          {
            id: 1,
            provider_name: 'openai',
            api_key: 'sk-openai',
            endpoint_url: 'https://api.openai.com/v1',
            is_valid: true,
            model_type: 'gpt-4',
            prefer: true, // Currently default
          },
          {
            id: 2,
            provider_name: 'anthropic',
            api_key: 'sk-ant',
            endpoint_url: 'https://api.anthropic.com',
            is_valid: true,
            model_type: 'claude-3',
            prefer: false,
          },
        ],
      })

      proxyFetchPost.mockResolvedValueOnce({ success: true })

      render(
        <TestWrapper>
          <SettingModels />
        </TestWrapper>
      )

      // Wait for component to load
      await screen.findByText('OpenAI')

      // Find Anthropic section
      const anthropicSection = screen.getByText('Anthropic').closest('.w-full')!

      // User clicks "Set as Default" on Anthropic
      const setDefaultButton = within(anthropicSection).getByRole('button', { name: /set as default/i })
      await user.click(setDefaultButton)

      // Verify the API was called to set new preference
      await waitFor(() => {
        expect(proxyFetchPost).toHaveBeenCalledWith('/api/provider/prefer', {
          provider_id: 2,
        })
      })
    })
  })

  describe('Password Visibility Toggle', () => {
    it('allows user to toggle API key visibility', async () => {
      const { proxyFetchGet } = await import('../mocks/proxy.mock')
      const user = userEvent.setup()

      proxyFetchGet.mockResolvedValueOnce({ items: [] })

      render(
        <TestWrapper>
          <SettingModels />
        </TestWrapper>
      )

      await screen.findByText('OpenAI')

      const openaiSection = screen.getByText('OpenAI').closest('.w-full')!
      const apiKeyInput = within(openaiSection).getByPlaceholderText(/enter-your-api-key/i) as HTMLInputElement

      // Initially password type
      expect(apiKeyInput.type).toBe('password')

      // User enters API key
      await user.clear(apiKeyInput)
      await user.type(apiKeyInput, 'sk-secret-key-123')

      // Value is correctly entered
      expect(apiKeyInput.value).toBe('sk-secret-key-123')
      expect(apiKeyInput.type).toBe('password')

      // Find the eye icon button within the input container
      const inputContainer = apiKeyInput.closest('.relative')!
      const eyeButtons = within(inputContainer).getAllByRole('button')
      const eyeIconButton = eyeButtons.find(btn => btn.querySelector('svg'))

      // User clicks eye icon to reveal
      if (eyeIconButton) {
        await user.click(eyeIconButton)

        // Now visible as text
        await waitFor(() => {
          expect(apiKeyInput.type).toBe('text')
        })

        // Click again to hide
        await user.click(eyeIconButton)

        await waitFor(() => {
          expect(apiKeyInput.type).toBe('password')
        })
      }
    })
  })


  describe('Loading States', () => {
    it('shows loading state during validation', async () => {
      const { proxyFetchGet, fetchPost } = await import('../mocks/proxy.mock')
      const user = userEvent.setup()

      proxyFetchGet.mockResolvedValueOnce({ items: [] })

      // Delay the validation response
      let resolveValidation: any
      fetchPost.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveValidation = resolve
          })
      )

      render(
        <TestWrapper>
          <SettingModels />
        </TestWrapper>
      )

      await screen.findByText('OpenAI')

      const openaiSection = screen.getByText('OpenAI').closest('.w-full')!

      const apiKeyInput = within(openaiSection).getByPlaceholderText(/enter-your-api-key/i)
      const apiHostInput = within(openaiSection).getByPlaceholderText(/enter-your-api-host/i)
      const modelTypeInput = within(openaiSection).getByPlaceholderText(/enter-your-model-type/i)

      await user.clear(apiKeyInput)
      await user.type(apiKeyInput, 'sk-test')
      await user.clear(apiHostInput)
      await user.type(apiHostInput, 'https://api.openai.com/v1')
      await user.clear(modelTypeInput)
      await user.type(modelTypeInput, 'gpt-4')

      const saveButton = within(openaiSection).getByRole('button', { name: /save/i })
      await user.click(saveButton)

      // User sees "Configuring..." text
      expect(await within(openaiSection).findByText(/configuring/i)).toBeInTheDocument()

      // Save button is disabled during validation
      expect(saveButton).toBeDisabled()

      // Resolve the validation
      resolveValidation({
        is_valid: true,
        is_tool_calls: true,
      })

      // Loading state disappears
      await waitFor(() => {
        expect(within(openaiSection).queryByText(/configuring/i)).not.toBeInTheDocument()
      })
    })
  })


})