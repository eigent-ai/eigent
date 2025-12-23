/**
 * Feature Testing Sample Documentation
 *
 * ============================================================================
 * What is Integration/Feature Testing?
 * ============================================================================
 *
 * Feature tests focus on what users can see and do, rather than how the code is implemented.
 *
 * ## Feature Tests vs Unit Tests
 *
 * ### Unit Tests
 * - Validate the internal logic of a single function or component
 * - Example: ensure `calculateTotal(price, quantity)` returns the correct product
 * - Pros: fast, isolated, precise failure signals
 * - Cons: cannot guarantee the entire feature works correctly
 *
 * ### Feature Tests
 * - Validate end-to-end user scenarios
 * - Example: “user enters price and quantity, clicks Calculate, and sees the total”
 * - Pros: mirrors real usage, one test covers multiple code paths
 * - Cons: comparatively slower, failures take longer to debug
 *
 * ## Why lean on feature tests?
 *
 * Feature tests deliver higher ROI:
 *
 * 1. **Fewer tests overall**: one feature test can replace several unit tests
 * 2. **Refactor friendly**: internal changes rarely require test updates
 * 3. **Higher confidence**: confirms real user journeys keep working
 * 4. **Lower maintenance**: fewer tests means less upkeep
 *
 * ============================================================================
 * Below is a feature-test example
 * ============================================================================
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, renderHook, waitFor, act } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import ChatBox from '../../src/components/ChatBox'
// Import necessary mocks
import '../mocks/proxy.mock'
import '../mocks/authStore.mock'
import '../mocks/sse.mock'

import { useProjectStore } from '../../src/store/projectStore'
import useChatStoreAdapter from '../../src/hooks/useChatStoreAdapter'
// Mock Electron IPC
(global as any).ipcRenderer = {
  invoke: vi.fn((channel) => {
    if (channel === 'get-system-language') return Promise.resolve('en')
    if (channel === 'get-browser-port') return Promise.resolve(9222)
    if (channel === 'get-env-path') return Promise.resolve('/path/to/env')
    if (channel === 'mcp-list') return Promise.resolve({})
    if (channel === 'get-file-list') return Promise.resolve([])
    return Promise.resolve()
  }),
}

// Mock window.electronAPI
Object.defineProperty(window, 'electronAPI', {
  value: {
    uploadLog: vi.fn().mockResolvedValue(undefined),
    selectFile: vi.fn().mockResolvedValue({ success: false }),
  },
  writable: true,
})

const TestWrapper = ({ children }: { children: React.ReactNode }) => (
  <BrowserRouter>{children}</BrowserRouter>
)

describe('Feature test example: chat experience', () => {
  /**
   * beforeEach runs before every spec
   * Purpose: reset application state so each test starts clean
   */
  beforeEach(() => {
    vi.clearAllMocks()

    // Reset the project store
    const projectStore = useProjectStore.getState()
    projectStore.getAllProjects().forEach(project => {
      projectStore.removeProject(project.id)
    })

    // Seed an initial project (mirrors the state when the app boots)
    const projectId = projectStore.createProject(
      'Feature Test Project',
      'Testing user message flow'
    )
    expect(projectId).toBeDefined()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  /**
   * Test 1: verify the initial UI
   *
   * This spec ensures:
   * - Users see the welcome copy on launch
   * - The input field renders correctly
   *
   * Acts as a smoke test for the base layout.
   */
  it('displays the welcome screen and input', async () => {
    // 1. Render the component (akin to opening the app)
    render(
      <TestWrapper>
        <ChatBox />
      </TestWrapper>
    )

    // 2. Assert the welcome text is visible
    expect(screen.getByText(/layout.welcome-to-eigent/i)).toBeInTheDocument()
    expect(screen.getByText(/layout.how-can-i-help-you/i)).toBeInTheDocument()

    // 3. Confirm the textarea exists so the user can type
    const textarea = screen.getByPlaceholderText('chat.ask-placeholder')
    expect(textarea).toBeInTheDocument()
  })

  /**
   * Test 2: validate the send button state
   *
   * This spec asserts:
   * - When the input is empty, the send button stays disabled to block empty submissions
   *
   * Captures a critical UX behavior.
   */
  it('disables the send button when the input is empty', async () => {
    // 1. Render the component
    render(
      <TestWrapper>
        <ChatBox />
      </TestWrapper>
    )

    // 2. Find the send button (via its icon)
    const buttons = screen.getAllByRole('button')
    const sendButton = buttons.find(btn =>
      btn.querySelector('svg.lucide-arrow-right')
    )

    expect(sendButton).toBeInTheDocument()

    // 3. Assert the button is disabled
    // Note: we do not care why it is disabled (privacy gate, empty input, etc.);
    // we only care that the observable behavior matches expectations.
    expect(sendButton).toBeDisabled()
  })

  /**
   * Test 3: verify legal links
   *
   * This spec ensures:
   * - Privacy Policy and Terms of Use links render
   * - Each link points to the correct URL
   * - Each link opens in a new tab
   */
  it('shows Terms of Use and Privacy Policy links', async () => {
    render(
      <TestWrapper>
        <ChatBox />
      </TestWrapper>
    )

    // Locate the anchor elements
    const termsLink = screen.getByRole('link', { name: /layout.terms-of-use/i })
    const privacyLink = screen.getByRole('link', { name: /layout.privacy-policy/i })

    // Verify link attributes
    expect(termsLink).toBeInTheDocument()
    expect(termsLink).toHaveAttribute('href', 'https://www.eigent.ai/terms-of-use')
    expect(termsLink).toHaveAttribute('target', '_blank')

    expect(privacyLink).toBeInTheDocument()
    expect(privacyLink).toHaveAttribute('href', 'https://www.eigent.ai/privacy-policy')
    expect(privacyLink).toHaveAttribute('target', '_blank')
  })

  /**
   * Test 4: TaskPlanning journey
   *
   * This spec validates the complete user workflow from sending a message to task breakdown:
   * - User sends a message
   * - System displays the user message
   * - System splits the task into subtasks (task planning phase)
   * - Task summary and subtasks are displayed to the user
   *
   * This test covers the core message-send and task-splitting workflow.
   */
  it('processes TaskPlanning journey with task splitting and subtask display', async () => {
    // 1. Get the chat store using the adapter hook
    const { result, rerender: rerenderHook } = renderHook(() => useChatStoreAdapter())
    const { chatStore } = result.current

    if (!chatStore) {
      throw new Error('ChatStore is null')
    }

    const taskId = chatStore.activeTaskId
    expect(taskId).toBeDefined()

    // 2. Render the component
    render(
      <TestWrapper>
        <ChatBox />
      </TestWrapper>
    )

    // 3. Simulate user sending a message
    const userMessage = 'Create a simple todo list application'

    await act(async () => {
      chatStore.setHasMessages(taskId!, true)
      chatStore.addMessages(taskId!, {
        id: 'user-msg-1',
        role: 'user',
        content: userMessage,
        attaches: []
      })
      rerenderHook()
    })

    // 4. Verify user message appears in the UI
    await waitFor(() => {
      expect(screen.getByText(userMessage)).toBeInTheDocument()
    })

    // 5. Simulate task splitting phase (to_sub_tasks SSE event)
    await act(async () => {
      chatStore.setSummaryTask(taskId!, 'Todo List Application|Create a simple todo list application')
      chatStore.addMessages(taskId!, {
        id: 'to-sub-tasks-msg',
        role: 'assistant',
        content: '',
        step: 'to_sub_tasks',
        data: {
          summary_task: 'Todo List Application|Create a simple todo list application',
          sub_tasks: [
            {
              id: 'subtask-1',
              content: 'Create HTML structure for todo list',
              status: '',
              subtasks: []
            },
            {
              id: 'subtask-2',
              content: 'Implement JavaScript functionality',
              status: '',
              subtasks: []
            },
            {
              id: 'subtask-3',
              content: 'Add CSS styling',
              status: '',
              subtasks: []
            }
          ]
        }
      })
      chatStore.setTaskInfo(taskId!, [
        { id: 'subtask-1', content: 'Create HTML structure for todo list', status: '' },
        { id: 'subtask-2', content: 'Implement JavaScript functionality', status: '' },
        { id: 'subtask-3', content: 'Add CSS styling', status: '' }
      ])
      rerenderHook()
    })

    // 6. Verify task summary and subtasks appear in the UI
    await waitFor(() => {
      expect(screen.getByText('Todo List Application')).toBeInTheDocument()
      expect(screen.getByText('Create HTML structure for todo list')).toBeInTheDocument()
      expect(screen.getByText('Implement JavaScript functionality')).toBeInTheDocument()
      expect(screen.getByText('Add CSS styling')).toBeInTheDocument()
    })

    // 7. Verify chatStore state is correct by getting fresh state
    const updatedChatStore = result.current.chatStore
    expect(updatedChatStore!.tasks[taskId!].summaryTask).toContain('Todo List Application')
    expect(updatedChatStore!.tasks[taskId!].taskInfo).toHaveLength(3)
  })
})

/**
 * ============================================================================
 * Testing best-practice recap
 * ============================================================================
 *
 * 1. **Exercise user behavior, not implementation details**
 *    ❌ Wrong: expect(component.state.messages).toHaveLength(1)
 *    ✅ Correct: expect(screen.getByText('Hello')).toBeInTheDocument()
 *
 * 2. **Query elements the way users perceive them**
 *    ❌ Wrong: screen.getByTestId('message-list')
 *    ✅ Correct: screen.getByText('Messages') or screen.getByRole('list')
 *
 * 3. **Assert full user flows**
 *    ❌ Wrong: test handleInput, handleSubmit, addMessage separately
 *    ✅ Correct: test the flow “user types a message and sends it”
 *
 * 4. **Pick descriptive test names**
 *    ❌ Wrong: it('test 1', ...)
 *    ✅ Correct: it('disables the send button when the input is empty', ...)
 *
 * 5. **Avoid over-mocking**
 *    - Mock only external dependencies (APIs, Electron APIs)
 *    - Keep application functions/components real
 *    - Let as much code run as possible
 *
 * ============================================================================
 * How to extend these tests
 * ============================================================================
 *
 * Suggested follow-up feature tests:
 *
 * 1. Full message-send journey
 *    - User types copy
 *    - Clicks the send button or presses Ctrl+Enter
 *    - Message appears in the chat history
 *    - Input resets to empty
 *
 * 2. File upload flow
 *    - User clicks the attachment button
 *    - Chooses a file
 *    - File appears in the attachment list
 *
 * 3. Error-handling path
 *    - Simulate an API error
 *    - Confirm the user-facing error surface renders
 *
 * 4. Task state transitions
 *    - Task moves from pending to running
 *    - UI reflects the correct state changes
 *
 * Remember: each spec should cover a complete user scenario.
 */
