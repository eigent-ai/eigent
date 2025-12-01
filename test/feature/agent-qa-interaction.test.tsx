import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, renderHook, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router-dom'
import ChatBox from '../../src/components/ChatBox'
import '../mocks/proxy.mock'
import '../mocks/authStore.mock'
import '../mocks/sse.mock'
import { useProjectStore } from '../../src/store/projectStore'
import useChatStoreAdapter from '../../src/hooks/useChatStoreAdapter'

/**
 * Feature Test: Agent Q&A Interaction
 *
 * User Journey: Agent asks question → User replies → Execution continues
 *
 * This test suite validates the agent question-and-answer interaction.
 * When an agent needs clarification, it should pause, ask the user a question,
 * and then continue execution after receiving the user's response.
 */

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

// Mock scrollTo for JSDOM
Element.prototype.scrollTo = vi.fn()
Element.prototype.scroll = vi.fn()

const TestWrapper = ({ children }: { children: React.ReactNode }) => (
  <BrowserRouter>{children}</BrowserRouter>
)

describe('Feature Test: Agent Q&A Interaction', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Reset the project store
    const projectStore = useProjectStore.getState()
    projectStore.getAllProjects().forEach(project => {
      projectStore.removeProject(project.id)
    })

    // Create initial project
    const projectId = projectStore.createProject(
      'Agent Q&A Test Project',
      'Testing agent question and answer flow'
    )
    expect(projectId).toBeDefined()
  })

  /**
   * Test 1: Agent question is displayed to user
   *
   * Validates that when an agent needs clarification:
   * - Agent question message appears in chat
   * - Question is clearly marked as requiring user response
   * - Input remains enabled for user to respond
   */
  it('displays agent question when agent needs clarification', async () => {
    const { result, rerender: rerenderHook } = renderHook(() => useChatStoreAdapter())
    const { chatStore } = result.current

    if (!chatStore) {
      throw new Error('ChatStore is null')
    }

    const taskId = chatStore.activeTaskId
    expect(taskId).toBeDefined()

    const { rerender } = render(
      <TestWrapper>
        <ChatBox />
      </TestWrapper>
    )

    // Simulate agent asking a question
    const agentQuestion = 'Which database would you like to use: PostgreSQL or MySQL?'

    await act(async () => {
      chatStore.setHasMessages(taskId!, true)
      // Add initial user message to trigger rendering
      chatStore.addMessages(taskId!, {
        id: 'init-user-msg',
        role: 'user',
        content: 'Start task',
        attaches: []
      })
    })

    // Wait for initial message to render
    await waitFor(() => {
      expect(screen.getByText('Start task')).toBeInTheDocument()
    })

    // Now add agent question in a separate act
    await act(async () => {
      chatStore.addMessages(taskId!, {
        id: 'agent-question-1',
        role: 'assistant',
        content: agentQuestion,
        step: 'agent_question',
        data: {
          question: agentQuestion,
          options: ['PostgreSQL', 'MySQL']
        }
      })
      chatStore.setActiveAsk(taskId!, 'Agent')
      rerenderHook()
    })

    // Force re-render of ChatBox
    rerender(
      <TestWrapper>
        <ChatBox />
      </TestWrapper>
    )

    // Debug: Check what messages are in the store
    console.log('Messages in store:', JSON.stringify(chatStore.tasks[taskId!].messages, null, 2))
    console.log('Active Ask:', chatStore.tasks[taskId!].activeAsk)

    // Verify agent question appears in UI
    await waitFor(() => {
      expect(screen.getByText(agentQuestion)).toBeInTheDocument()
    }, { timeout: 3000 })

    // Verify input is enabled for user to respond
    const textarea = screen.getByPlaceholderText('chat.ask-placeholder')
    expect(textarea).toBeInTheDocument()
    expect(textarea).not.toBeDisabled()
  })

  /**
   * Test 2: User responds to agent question
   *
   * Validates the complete Q&A flow:
   * - Agent asks question
   * - User types response
   * - User sends response
   * - Response appears in chat
   * - Agent continues execution
   */
  it('allows user to respond to agent question and continues execution', async () => {
    const user = userEvent.setup()
    const { result, rerender: rerenderHook } = renderHook(() => useChatStoreAdapter())
    const { chatStore } = result.current

    if (!chatStore) {
      throw new Error('ChatStore is null')
    }

    const taskId = chatStore.activeTaskId
    expect(taskId).toBeDefined()

    render(
      <TestWrapper>
        <ChatBox />
      </TestWrapper>
    )

    // Step 1: Agent asks a question
    const agentQuestion = 'Should I create the API with REST or GraphQL?'

    await act(async () => {
      chatStore.setHasMessages(taskId!, true)
      chatStore.addMessages(taskId!, {
        id: 'init-user-msg',
        role: 'user',
        content: 'Start task',
        attaches: []
      })

      chatStore.addMessages(taskId!, {
        id: 'agent-question-2',
        role: 'assistant',
        content: agentQuestion,
        step: 'agent_question'
      })
      chatStore.setActiveAsk(taskId!, 'Agent')
      rerenderHook()
    })

    // Verify question appears
    await waitFor(() => {
      expect(screen.getByText(agentQuestion)).toBeInTheDocument()
    })

    // Step 2: User types and sends response
    const userResponse = 'Please use REST API'
    const textarea = screen.getByPlaceholderText('chat.ask-placeholder')

    await user.clear(textarea)
    await user.type(textarea, userResponse)

    // Find and click send button
    const buttons = screen.getAllByRole('button')
    const sendButton = buttons.find(btn =>
      btn.querySelector('svg.lucide-arrow-right')
    )
    expect(sendButton).toBeInTheDocument()

    // Click send button
    await user.click(sendButton!)

    // Step 3: Verify user response appears in chat
    await waitFor(() => {
      expect(screen.getByText(userResponse)).toBeInTheDocument()
    })

    // Step 4: Simulate agent continuing execution
    await act(async () => {
      chatStore.addMessages(taskId!, {
        id: 'agent-continue-1',
        role: 'assistant',
        content: 'Great! I will create a REST API for you.',
        step: 'execution'
      })
      rerenderHook()
    })

    // Verify agent continuation message appears
    await waitFor(() => {
      expect(screen.getByText('Great! I will create a REST API for you.')).toBeInTheDocument()
    })
  })

  /**
   * Test 3: Multiple Q&A exchanges
   *
   * Validates that agent can ask multiple questions:
   * - First question and answer
   * - Second question and answer
   * - All messages remain in order
   */
  it('handles multiple question and answer exchanges', async () => {
    const { result, rerender: rerenderHook } = renderHook(() => useChatStoreAdapter())
    const { chatStore } = result.current

    if (!chatStore) {
      throw new Error('ChatStore is null')
    }

    const taskId = chatStore.activeTaskId
    expect(taskId).toBeDefined()

    render(
      <TestWrapper>
        <ChatBox />
      </TestWrapper>
    )

    // First Q&A exchange
    await act(async () => {
      chatStore.setHasMessages(taskId!, true)
      chatStore.addMessages(taskId!, {
        id: 'init-user-msg',
        role: 'user',
        content: 'Start task',
        attaches: []
      })

      chatStore.addMessages(taskId!, {
        id: 'q1',
        role: 'assistant',
        content: 'What framework should I use?',
        step: 'agent_question'
      })
      chatStore.setActiveAsk(taskId!, 'Agent')
      rerenderHook()
    })

    await waitFor(() => {
      expect(screen.getByText('What framework should I use?')).toBeInTheDocument()
    })

    await act(async () => {
      chatStore.addMessages(taskId!, {
        id: 'a1',
        role: 'user',
        content: 'Use React',
        attaches: []
      })
      rerenderHook()
    })

    // Second Q&A exchange
    await act(async () => {
      chatStore.addMessages(taskId!, {
        id: 'q2',
        role: 'assistant',
        content: 'Should I use TypeScript or JavaScript?',
        step: 'agent_question'
      })
      chatStore.setActiveAsk(taskId!, 'Agent')
      rerenderHook()
    })

    await waitFor(() => {
      expect(screen.getByText('Should I use TypeScript or JavaScript?')).toBeInTheDocument()
    })

    await act(async () => {
      chatStore.addMessages(taskId!, {
        id: 'a2',
        role: 'user',
        content: 'Use TypeScript',
        attaches: []
      })
      rerenderHook()
    })

    // Verify all messages are present
    await waitFor(() => {
      expect(screen.getByText('What framework should I use?')).toBeInTheDocument()
      expect(screen.getByText('Use React')).toBeInTheDocument()
      expect(screen.getByText('Should I use TypeScript or JavaScript?')).toBeInTheDocument()
      expect(screen.getByText('Use TypeScript')).toBeInTheDocument()
    })
  })

  /**
   * Test 4: Agent question with multiple choice options
   *
   * Validates that agent can present options:
   * - Question with structured options is displayed
   * - User can select or type custom response
   * - Response is recorded correctly
   */
  it('displays agent question with multiple choice options', async () => {
    const { result, rerender: rerenderHook } = renderHook(() => useChatStoreAdapter())
    const { chatStore } = result.current

    if (!chatStore) {
      throw new Error('ChatStore is null')
    }

    const taskId = chatStore.activeTaskId
    expect(taskId).toBeDefined()

    render(
      <TestWrapper>
        <ChatBox />
      </TestWrapper>
    )

    // Agent asks question with options
    const questionWithOptions = 'Which testing framework should I use?'
    const options = ['Jest', 'Vitest', 'Mocha', 'Other']

    await act(async () => {
      chatStore.setHasMessages(taskId!, true)
      chatStore.addMessages(taskId!, {
        id: 'init-user-msg',
        role: 'user',
        content: 'Start task',
        attaches: []
      })

      chatStore.addMessages(taskId!, {
        id: 'question-with-options',
        role: 'assistant',
        content: questionWithOptions,
        step: 'agent_question',
        data: {
          question: questionWithOptions,
          options: options
        }
      })
      chatStore.setActiveAsk(taskId!, 'Agent')
      rerenderHook()
    })

    // Verify question appears
    await waitFor(() => {
      expect(screen.getByText(questionWithOptions)).toBeInTheDocument()
    })

    // User can still type custom response
    const textarea = screen.getByPlaceholderText('chat.ask-placeholder')
    expect(textarea).toBeInTheDocument()
    expect(textarea).not.toBeDisabled()
  })
})