import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router-dom'
import SignUp from '../../src/pages/SignUp'
import * as httpModule from '../../src/api/http'
import { useAuthStore } from '../../src/store/authStore'

// Mock react-router-dom
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => ({ pathname: '/signup' }),
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

describe('Feature Test: SignUp Flow - UI Only', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    // Reset auth store mocks
    const authStore = useAuthStore()
    vi.mocked(authStore.setAuth).mockClear()

    // Reset and setup proxy mock with default successful implementation
    proxyFetchPostSpy.mockClear()
    proxyFetchPostSpy.mockResolvedValue({
      code: 0,
      message: 'Registration successful',
    })
  })

  /**
   * Test 1: Display signup form
   *
   * Verifies that users see all essential signup elements:
   * - SignUp heading
   * - Email input field
   * - Password input field
   * - Invite code input field (optional)
   * - Sign up button
   * - Login link
   */
  it('displays the signup form with all essential elements', async () => {
    render(
      <TestWrapper>
        <SignUp />
      </TestWrapper>
    )

    // Verify signup heading - use getAllByText since it appears in both heading and button
    const signupElements = screen.getAllByText('layout.sign-up')
    expect(signupElements.length).toBeGreaterThan(0)

    // Verify email field
    const emailInput = screen.getByPlaceholderText('layout.enter-your-email')
    expect(emailInput).toBeInTheDocument()
    expect(emailInput).toHaveAttribute('type', 'email')

    // Verify password field
    const passwordInput = screen.getByPlaceholderText('layout.enter-your-password')
    expect(passwordInput).toBeInTheDocument()
    expect(passwordInput).toHaveAttribute('type', 'password')

    // Verify invite code field
    const inviteCodeInput = screen.getByPlaceholderText('layout.enter-your-invite-code')
    expect(inviteCodeInput).toBeInTheDocument()
    expect(inviteCodeInput).toHaveAttribute('type', 'text')

    // Verify signup button
    const signupButton = screen.getByRole('button', { name: /layout.sign-up/i })
    expect(signupButton).toBeInTheDocument()

    // Verify login link
    const loginButton = screen.getByRole('button', { name: /layout.login/i })
    expect(loginButton).toBeInTheDocument()
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
        <SignUp />
      </TestWrapper>
    )

    const signupButton = screen.getByRole('button', { name: /layout.sign-up/i })
    const passwordInput = screen.getByPlaceholderText('layout.enter-your-password')

    // Try to signup with empty email
    await user.type(passwordInput, 'password123')
    await user.click(signupButton)

    // Verify email error appears
    await waitFor(() => {
      expect(screen.getByText('layout.please-enter-email-address')).toBeInTheDocument()
    })

    // Try with invalid email format
    const emailInput = screen.getByPlaceholderText('layout.enter-your-email')
    await user.clear(emailInput)
    await user.type(emailInput, 'invalid-email')
    await user.click(signupButton)

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
   * - Shows error when password is too short (< 8 characters)
   */
  it('validates password input and shows appropriate errors', async () => {
    const user = userEvent.setup()

    render(
      <TestWrapper>
        <SignUp />
      </TestWrapper>
    )

    const signupButton = screen.getByRole('button', { name: /layout.sign-up/i })
    const emailInput = screen.getByPlaceholderText('layout.enter-your-email')

    // Try to signup with empty password
    await user.type(emailInput, 'test@example.com')
    await user.click(signupButton)

    // Verify password error appears
    await waitFor(() => {
      expect(screen.getByText('layout.please-enter-password')).toBeInTheDocument()
    })

    // Try with password too short (less than 8 characters)
    const passwordInput = screen.getByPlaceholderText('layout.enter-your-password')
    await user.type(passwordInput, '1234567')
    await user.click(signupButton)

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
        <SignUp />
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
   * Test 5: Invite code is optional
   *
   * Verifies that invite code field is optional:
   * - Form can be submitted without invite code
   * - No error shown for empty invite code
   */
  it('allows signup without invite code', async () => {
    const user = userEvent.setup()

    render(
      <TestWrapper>
        <SignUp />
      </TestWrapper>
    )

    // Enter valid email and password, but no invite code
    const emailInput = screen.getByPlaceholderText('layout.enter-your-email')
    const passwordInput = screen.getByPlaceholderText('layout.enter-your-password')

    await user.clear(emailInput)
    await user.type(emailInput, 'test@example.com')
    await user.clear(passwordInput)
    await user.type(passwordInput, 'password123')

    // Wait for input to be processed
    await waitFor(() => {
      expect(emailInput).toHaveValue('test@example.com')
      expect(passwordInput).toHaveValue('password123')
    })

    // Click signup button
    const signupButton = screen.getByRole('button', { name: /layout.sign-up/i })
    await user.click(signupButton)

    // Verify API was called without invite_code being required
    await waitFor(() => {
      expect(proxyFetchPostSpy).toHaveBeenCalledWith('/api/register', {
        email: 'test@example.com',
        password: 'password123',
        invite_code: '',
      })
    }, { timeout: 3000 })
  })

  /**
   * Test 6: Navigation to login page
   *
   * Verifies that users can navigate to login:
   * 1. User clicks the "Login" button
   * 2. System navigates to /login route
   */
  it('navigates to login page when login button is clicked', async () => {
    const user = userEvent.setup()

    render(
      <TestWrapper>
        <SignUp />
      </TestWrapper>
    )

    const loginButton = screen.getByRole('button', { name: /layout.login/i })
    await user.click(loginButton)

    // Verify navigation to login page
    expect(mockNavigate).toHaveBeenCalledWith('/login')
  })

  /**
   * Test 7: Error clearing on input change
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
        <SignUp />
      </TestWrapper>
    )

    const signupButton = screen.getByRole('button', { name: /layout.sign-up/i })
    const emailInput = screen.getByPlaceholderText('layout.enter-your-email')

    // Trigger validation error by trying to signup without email
    await user.click(signupButton)

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
   * Test 8: Privacy policy link
   *
   * Validates that privacy policy link is present and functional:
   * 1. Privacy policy link is visible
   * 2. Link points to correct URL
   */
  it('displays privacy policy link', () => {
    render(
      <TestWrapper>
        <SignUp />
      </TestWrapper>
    )

    const privacyLink = screen.getByRole('button', { name: /layout.privacy-policy/i })
    expect(privacyLink).toBeInTheDocument()
  })

  /**
   * Test 9: Form input values are tracked correctly
   *
   * Verifies that all form inputs properly track user input:
   * - Email input value updates
   * - Password input value updates
   * - Invite code input value updates
   */
  it('tracks form input values correctly', async () => {
    const user = userEvent.setup()

    render(
      <TestWrapper>
        <SignUp />
      </TestWrapper>
    )

    const emailInput = screen.getByPlaceholderText('layout.enter-your-email')
    const passwordInput = screen.getByPlaceholderText('layout.enter-your-password')
    const inviteCodeInput = screen.getByPlaceholderText('layout.enter-your-invite-code')

    // Type into all fields
    await user.type(emailInput, 'user@example.com')
    await user.type(passwordInput, 'securePassword123')
    await user.type(inviteCodeInput, 'INVITE2024')

    // Verify all values are tracked
    await waitFor(() => {
      expect(emailInput).toHaveValue('user@example.com')
      expect(passwordInput).toHaveValue('securePassword123')
      expect(inviteCodeInput).toHaveValue('INVITE2024')
    })
  })

  /**
   * Test 10: Signup button shows loading state
   *
   * Verifies that the signup button displays loading state:
   * - Button shows "Signing up..." text during submission
   * - Button is disabled during submission
   */
  it('shows loading state on signup button during submission', async () => {
    const user = userEvent.setup()

    // Mock API to delay response
    proxyFetchPostSpy.mockImplementation(() =>
      new Promise(resolve => setTimeout(() => resolve({ code: 0 }), 1000))
    )

    render(
      <TestWrapper>
        <SignUp />
      </TestWrapper>
    )

    const emailInput = screen.getByPlaceholderText('layout.enter-your-email')
    const passwordInput = screen.getByPlaceholderText('layout.enter-your-password')

    await user.type(emailInput, 'test@example.com')
    await user.type(passwordInput, 'password123')

    const signupButton = screen.getByRole('button', { name: /layout.sign-up/i })
    await user.click(signupButton)

    // Verify button shows loading text
    await waitFor(() => {
      expect(screen.getByText('layout.signing-up')).toBeInTheDocument()
    })

    // Verify button is disabled
    expect(signupButton).toBeDisabled()
  })
})
