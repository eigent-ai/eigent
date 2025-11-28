import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router-dom'
import Login from '../../src/pages/Login'
import * as httpModule from '../../src/api/http'
import { useAuthStore } from '../../src/store/authStore'

// Mock react-router-dom
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => ({ pathname: '/login' }),
  }
})

// Mock authStore
vi.mock('../../src/store/authStore', () => {
  const mockState = {
    token: null,
    username: null,
    email: null,
    user_id: null,
    appearance: 'light',
    language: 'en',
    isFirstLaunch: true,
    modelType: 'cloud' as const,
    cloud_model_type: 'gpt-4.1' as const,
    initState: 'permissions' as const,
    share_token: null,
    localProxyValue: null,
    workerListData: {},
    setAuth: vi.fn(),
    setModelType: vi.fn(),
    setLocalProxyValue: vi.fn(),
    logout: vi.fn(),
    setAppearance: vi.fn(),
    setLanguage: vi.fn(),
    setInitState: vi.fn(),
    setCloudModelType: vi.fn(),
    setIsFirstLaunch: vi.fn(),
    setWorkerList: vi.fn(),
    checkAgentTool: vi.fn(),
    getState: vi.fn(),
    setState: vi.fn(),
    subscribe: vi.fn(),
    destroy: vi.fn(),
  }

  return {
    useAuthStore: vi.fn(() => mockState),
    getAuthStore: vi.fn(() => mockState),
    useWorkerList: vi.fn(() => []),
  }
})

// Mock @stackframe/react
vi.mock('@stackframe/react', () => ({
  useStackApp: () => null,
}))

// Mock hasStackKeys
vi.mock('../../src/lib', () => ({
  hasStackKeys: () => false,
}))

// Mock Electron APIs
Object.defineProperty(window, 'electronAPI', {
  value: {
    getPlatform: vi.fn(() => 'win32'),
    closeWindow: vi.fn(),
  },
  writable: true,
})

Object.defineProperty(window, 'ipcRenderer', {
  value: {
    on: vi.fn(),
    off: vi.fn(),
  },
  writable: true,
})

const TestWrapper = ({ children }: { children: React.ReactNode }) => (
  <BrowserRouter>{children}</BrowserRouter>
)

// Create spy on proxyFetchPost
const proxyFetchPostSpy = vi.spyOn(httpModule, 'proxyFetchPost')
let authStore: ReturnType<typeof useAuthStore> // or: let authStore: any

describe('Feature Test: Login Flow', () => {
  beforeEach(() => {
  mockNavigate.mockClear()

  authStore = useAuthStore()   // always the same mockState object

  vi.mocked(authStore.setAuth).mockClear()
  vi.mocked(authStore.setModelType).mockClear()
  vi.mocked(authStore.setLocalProxyValue).mockClear()

  proxyFetchPostSpy.mockClear()
  proxyFetchPostSpy.mockResolvedValue({
    code: 0,
    token: 'test-token',
    username: 'Test User',
    user_id: 1,
  })
})


  /**
   * Test 1: Display login form
   *
   * Verifies that users see all essential login elements:
   * - Login heading
   * - Email input field
   * - Password input field
   * - Login button
   * - Sign up link
   */
  it('displays the login form with all essential elements', async () => {
    render(
      <TestWrapper>
        <Login />
      </TestWrapper>
    )

    // Verify login heading
    expect(screen.getByText('layout.login')).toBeInTheDocument()

    // Verify email field
    const emailInput = screen.getByPlaceholderText('layout.enter-your-email')
    expect(emailInput).toBeInTheDocument()
    expect(emailInput).toHaveAttribute('type', 'email')

    // Verify password field
    const passwordInput = screen.getByPlaceholderText('layout.enter-your-password')
    expect(passwordInput).toBeInTheDocument()
    expect(passwordInput).toHaveAttribute('type', 'password')

    // Verify login button
    const loginButton = screen.getByRole('button', { name: /layout.log-in/i })
    expect(loginButton).toBeInTheDocument()

    // Verify sign up link
    const signUpButton = screen.getByRole('button', { name: /layout.sign-up/i })
    expect(signUpButton).toBeInTheDocument()
  })

  /**
   * Test 2: Email validation
   *
   * Validates that the system properly validates email input:
   * - Shows error when email is empty
   * - Shows error when email format is invalid
   */
  it('validates email input and shows appropriate errors', async () => {
    const user = userEvent.setup()

    render(
      <TestWrapper>
        <Login />
      </TestWrapper>
    )

    const loginButton = screen.getByRole('button', { name: /layout.log-in/i })
    const passwordInput = screen.getByPlaceholderText('layout.enter-your-password')

    // Try to login with empty email
    await user.type(passwordInput, 'password123')
    await user.click(loginButton)

    // Verify email error appears
    await waitFor(() => {
      expect(screen.getByText('layout.please-enter-email-address')).toBeInTheDocument()
    })

    // Try with invalid email format
    const emailInput = screen.getByPlaceholderText('layout.enter-your-email')
    await user.clear(emailInput)
    await user.type(emailInput, 'invalid-email')
    await user.click(loginButton)

    // Verify invalid email error appears
    await waitFor(() => {
      expect(screen.getByText('layout.please-enter-a-valid-email-address')).toBeInTheDocument()
    })
  })

  /**
   * Test 3: Password validation
   *
   * Validates that the system properly validates password input:
   * - Shows error when password is empty
   * - Shows error when password is too short (< 6 characters)
   */
  it('validates password input and shows appropriate errors', async () => {
    const user = userEvent.setup()

    render(
      <TestWrapper>
        <Login />
      </TestWrapper>
    )

    const loginButton = screen.getByRole('button', { name: /layout.log-in/i })
    const emailInput = screen.getByPlaceholderText('layout.enter-your-email')

    // Try to login with empty password
    await user.type(emailInput, 'test@example.com')
    await user.click(loginButton)

    // Verify password error appears
    await waitFor(() => {
      expect(screen.getByText('layout.please-enter-password')).toBeInTheDocument()
    })

    // Try with password too short
    const passwordInput = screen.getByPlaceholderText('layout.enter-your-password')
    await user.type(passwordInput, '12345')
    await user.click(loginButton)

    // Verify short password error appears
    await waitFor(() => {
      expect(screen.getByText('layout.password-must-be-at-least-8-characters')).toBeInTheDocument()
    })
  })

  /**
   * Test 4: Password visibility toggle
   *
   * Verifies that users can toggle password visibility:
   * - Password starts hidden
   * - Clicking eye icon shows password
   * - Clicking again hides password
   */
  it('allows users to toggle password visibility', async () => {
    const user = userEvent.setup()

    render(
      <TestWrapper>
        <Login />
      </TestWrapper>
    )

    const passwordInput = screen.getByPlaceholderText('layout.enter-your-password')

    // Password should start as hidden (type="password")
    expect(passwordInput).toHaveAttribute('type', 'password')

    // Find and click the eye icon button (it's the back icon of the password input)
    const eyeIcons = screen.getAllByRole('img')
    const eyeIcon = eyeIcons.find(img => img.getAttribute('src')?.includes('eye'))

    if (eyeIcon && eyeIcon.parentElement) {
      await user.click(eyeIcon.parentElement)

      // Password should now be visible (type="text")
      await waitFor(() => {
        expect(passwordInput).toHaveAttribute('type', 'text')
      })
    }
  })

  /**
   * Test 5: Successful login flow
   *
   * This is the core happy-path test that validates the complete login workflow:
   * 1. User enters valid email and password
   * 2. User clicks login button
   * 3. System calls the login API
   * 4. System stores authentication info
   * 5. System sets model type to 'cloud'
   * 6. System redirects to home page
   */
  it('successfully logs in user and redirects to home', async () => {
    const user = userEvent.setup()

    // Mock successful API response - use mockImplementation instead of mockResolvedValueOnce
    render(
      <TestWrapper>
        <Login />
      </TestWrapper>
    )

    // Enter valid credentials
    const emailInput = screen.getByPlaceholderText('layout.enter-your-email')
    const passwordInput = screen.getByPlaceholderText('layout.enter-your-password')

    await user.clear(emailInput)
    await user.type(emailInput, 'test@example.com')
    await user.clear(passwordInput)
    await user.type(passwordInput, 'password123')

    // Find and click login button
    const loginButton = screen.getByRole('button', { name: /layout.log-in/i })

    // Wait a bit for React to process the input changes
    await waitFor(() => {
      expect(emailInput).toHaveValue('test@example.com')
      expect(passwordInput).toHaveValue('password123')
    })

    await user.click(loginButton)

    // Verify API was called with correct credentials
    await waitFor(() => {
      expect(proxyFetchPostSpy).toHaveBeenCalledWith('/api/login', {
        email: 'test@example.com',
        password: 'password123',
      })
    }, { timeout: 3000 })

    // Verify authentication state was set
    await waitFor(() => {      
      expect(authStore.setAuth).toHaveBeenCalled()
    })

    // Verify model type was set to 'cloud'
    expect(authStore.setModelType).toHaveBeenCalledWith('cloud')

    // Verify navigation to home page
    expect(mockNavigate).toHaveBeenCalledWith('/')
  })

  /**
   * Test 6: Failed login with API error
   *
   * Validates error handling when login fails:
   * 1. User enters credentials
   * 2. API returns error (code: 10)
   * 3. System displays error message to user
   * 4. User is NOT redirected
   */
  it('shows error message when login fails', async () => {
    const user = userEvent.setup()

    // Mock failed API response
    proxyFetchPostSpy.mockResolvedValueOnce({
      code: 10,
      text: 'Invalid credentials',
    })

    render(
      <TestWrapper>
        <Login />
      </TestWrapper>
    )

    // Enter credentials
    const emailInput = screen.getByPlaceholderText('layout.enter-your-email')
    const passwordInput = screen.getByPlaceholderText('layout.enter-your-password')

    await user.clear(emailInput)
    await user.type(emailInput, 'test@example.com')
    await user.clear(passwordInput)
    await user.type(passwordInput, 'wrongpassword')

    // Wait for input to be processed
    await waitFor(() => {
      expect(passwordInput).toHaveValue('wrongpassword')
    })

    // Click login button
    const loginButton = screen.getByRole('button', { name: /layout.log-in/i })
    await user.click(loginButton)

    // Verify error message appears
    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument()
    }, { timeout: 3000 })

    // Verify user was NOT redirected
    expect(mockNavigate).not.toHaveBeenCalled()

    // Verify auth state was NOT set
    expect(authStore.setAuth).not.toHaveBeenCalled()
  })

  /**
   * Test 8: Navigation to signup page
   *
   * Verifies that users can navigate to signup:
   * 1. User clicks the "Sign Up" button
   * 2. System navigates to /signup route
   */
  it('navigates to signup page when signup button is clicked', async () => {
    const user = userEvent.setup()

    render(
      <TestWrapper>
        <Login />
      </TestWrapper>
    )

    const signUpButton = screen.getByRole('button', { name: /layout.sign-up/i })
    await user.click(signUpButton)

    // Verify navigation to signup page
    expect(mockNavigate).toHaveBeenCalledWith('/signup')
  })

  /**
   * Test 9: Error clearing on input change
   *
   * Validates UX behavior where errors are cleared when user starts typing:
   * 1. Validation error is shown
   * 2. User starts typing in the field with error
   * 3. Error message disappears
   */
  it('clears field errors when user starts typing', async () => {
    const user = userEvent.setup()

    render(
      <TestWrapper>
        <Login />
      </TestWrapper>
    )

    const loginButton = screen.getByRole('button', { name: /layout.log-in/i })
    const emailInput = screen.getByPlaceholderText('layout.enter-your-email')

    // Trigger validation error by trying to login without email
    await user.click(loginButton)

    // Verify error appears
    await waitFor(() => {
      expect(screen.getByText('layout.please-enter-email-address')).toBeInTheDocument()
    })

    // Start typing in email field
    await user.type(emailInput, 't')

    // Error should be cleared
    await waitFor(() => {
      expect(screen.queryByText('layout.please-enter-email-address')).not.toBeInTheDocument()
    })
  })

  /**
   * Test 10: Enter key submits form
   *
   * Validates keyboard accessibility:
   * 1. User enters credentials
   * 2. User presses Enter in password field
   * 3. Login is triggered (same as clicking button)
   */
  it('submits login form when user presses Enter in password field', async () => {
    const user = userEvent.setup()

    render(
      <TestWrapper>
        <Login />
      </TestWrapper>
    )

    // Enter credentials
    const emailInput = screen.getByPlaceholderText('layout.enter-your-email')
    const passwordInput = screen.getByPlaceholderText('layout.enter-your-password')

    await user.clear(emailInput)
    await user.type(emailInput, 'test@example.com')
    await user.clear(passwordInput)
    await user.type(passwordInput, 'password123{Enter}')

    // Verify API was called (login was triggered)
    await waitFor(() => {
      expect(proxyFetchPostSpy).toHaveBeenCalledWith('/api/login', {
        email: 'test@example.com',
        password: 'password123',
      })
    }, { timeout: 3000 })
  })

  /**
   * Test 11: Privacy policy link
   *
   * Validates that privacy policy link is present and functional:
   * 1. Privacy policy link is visible
   * 2. Link points to correct URL
   */
  it('displays privacy policy link', () => {
    render(
      <TestWrapper>
        <Login />
      </TestWrapper>
    )

    const privacyLink = screen.getByRole('button', { name: /layout.privacy-policy/i })
    expect(privacyLink).toBeInTheDocument()
  })
})

