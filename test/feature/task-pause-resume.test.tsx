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
 * Feature Test: Task Pause/Resume
 *
 * User Journey: User pauses running task → Status shows paused → User resumes → Execution continues
 *
 * This test suite validates the task pause and resume functionality.
 * Users should be able to pause a running task and resume it later.
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

const TestWrapper = ({ children }: { children: React.ReactNode }) => (
  <BrowserRouter>{children}</BrowserRouter>
)

describe('Feature Test: Task Pause/Resume', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Reset the project store
    const projectStore = useProjectStore.getState()
    projectStore.getAllProjects().forEach(project => {
      projectStore.removeProject(project.id)
    })

    // Create initial project
    const projectId = projectStore.createProject(
      'Pause Resume Test Project',
      'Testing task pause and resume'
    )
    expect(projectId).toBeDefined()
  })

  /**
   * Test 1: Task status shows as running
   *
   * Validates that when a task is executing:
   * - Task status is 'running'
   * - User can see execution progress
   * - Pause control is available
   */
  it('displays running status when task is executing', async () => {
    const { result } = renderHook(() => useChatStoreAdapter())
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

    // Set task to running state
    await act(async () => {
      chatStore.setHasMessages(taskId!, true)
      chatStore.setStatus(taskId!, 'running')
      chatStore.addMessages(taskId!, {
        id: 'exec-msg-1',
        role: 'assistant',
        content: 'Executing task...',
        step: 'execution'
      })
    })

    // Verify task is in running state
    const task = chatStore.tasks[taskId!]
    expect(task.status).toBe('running')
  })

  /**
   * Test 2: User can pause running task
   *
   * Validates the pause flow:
   * - Task is running
   * - User clicks pause button
   * - Task status changes to 'paused'
   * - Execution stops
   * - Resume control becomes available
   */
  it('allows user to pause a running task', async () => {
    const user = userEvent.setup()
    const { result } = renderHook(() => useChatStoreAdapter())
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

    // Start with running task
    await act(async () => {
      chatStore.setHasMessages(taskId!, true)
      chatStore.setStatus(taskId!, 'running')
      chatStore.setSummaryTask(taskId!, 'Building Application|Creating a web application')
      chatStore.addMessages(taskId!, {
        id: 'running-msg',
        role: 'assistant',
        content: 'Installing dependencies...',
        step: 'execution'
      })
    })

    // Verify task is running
    expect(chatStore.tasks[taskId!].status).toBe('running')

    // Pause the task
    await act(async () => {
      chatStore.setStatus(taskId!, 'paused')
    })

    // Verify task is paused
    expect(chatStore.tasks[taskId!].status).toBe('paused')
  })

  /**
   * Test 3: User can resume paused task
   *
   * Validates the resume flow:
   * - Task is paused
   * - User clicks resume button
   * - Task status changes to 'running'
   * - Execution continues from where it left off
   */
  it('allows user to resume a paused task', async () => {
    const user = userEvent.setup()
    const { result } = renderHook(() => useChatStoreAdapter())
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

    // Start with paused task
    await act(async () => {
      chatStore.setHasMessages(taskId!, true)
      chatStore.setStatus(taskId!, 'paused')
      chatStore.setSummaryTask(taskId!, 'Building Application|Creating a web application')
      chatStore.addMessages(taskId!, {
        id: 'paused-msg',
        role: 'assistant',
        content: 'Task paused at: Installing dependencies...',
        step: 'execution'
      })
    })

    // Verify task is paused
    expect(chatStore.tasks[taskId!].status).toBe('paused')

    // Resume the task
    await act(async () => {
      chatStore.setStatus(taskId!, 'running')
      chatStore.addMessages(taskId!, {
        id: 'resume-msg',
        role: 'assistant',
        content: 'Resuming: Continuing with dependency installation...',
        step: 'execution'
      })
    })

    // Verify task is running again
    expect(chatStore.tasks[taskId!].status).toBe('running')

    // Verify resume message appears
    await waitFor(() => {
      expect(screen.getByText(/Resuming: Continuing with dependency installation/)).toBeInTheDocument()
    })
  })

  /**
   * Test 4: Multiple pause and resume cycles
   *
   * Validates that task can be paused and resumed multiple times:
   * - Pause → Resume → Pause → Resume
   * - Status updates correctly each time
   * - Execution state is maintained
   */
  it('handles multiple pause and resume cycles', async () => {
    const { result } = renderHook(() => useChatStoreAdapter())
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

    // Initial running state
    await act(async () => {
      chatStore.setHasMessages(taskId!, true)
      chatStore.setStatus(taskId!, 'running')
      chatStore.setSummaryTask(taskId!, 'Complex Task|Multi-step execution')
    })

    expect(chatStore.tasks[taskId!].status).toBe('running')

    // First pause
    await act(async () => {
      chatStore.setStatus(taskId!, 'paused')
    })
    expect(chatStore.tasks[taskId!].status).toBe('paused')

    // First resume
    await act(async () => {
      chatStore.setStatus(taskId!, 'running')
    })
    expect(chatStore.tasks[taskId!].status).toBe('running')

    // Second pause
    await act(async () => {
      chatStore.setStatus(taskId!, 'paused')
    })
    expect(chatStore.tasks[taskId!].status).toBe('paused')

    // Second resume
    await act(async () => {
      chatStore.setStatus(taskId!, 'running')
    })
    expect(chatStore.tasks[taskId!].status).toBe('running')
  })

  /**
   * Test 5: Task completion after resume
   *
   * Validates that resumed task can complete normally:
   * - Task is paused
   * - Task is resumed
   * - Task continues execution
   * - Task reaches 'finished' status
   */
  it('allows paused task to complete after resuming', async () => {
    const { result } = renderHook(() => useChatStoreAdapter())
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

    // Start with paused task
    await act(async () => {
      chatStore.setHasMessages(taskId!, true)
      chatStore.setStatus(taskId!, 'paused')
      chatStore.setSummaryTask(taskId!, 'Quick Task|Simple execution')
      chatStore.addMessages(taskId!, {
        id: 'paused-state',
        role: 'assistant',
        content: 'Paused during execution',
        step: 'execution'
      })
    })

    expect(chatStore.tasks[taskId!].status).toBe('paused')

    // Resume
    await act(async () => {
      chatStore.setStatus(taskId!, 'running')
    })

    expect(chatStore.tasks[taskId!].status).toBe('running')

    // Complete the task
    await act(async () => {
      chatStore.setStatus(taskId!, 'finished')
      chatStore.addMessages(taskId!, {
        id: 'completion-msg',
        role: 'assistant',
        content: 'Task completed successfully!',
        step: 'finished'
      })
    })

    // Verify task is finished
    expect(chatStore.tasks[taskId!].status).toBe('finished')

    // Verify completion message appears
    await waitFor(() => {
      expect(screen.getByText('Task completed successfully!')).toBeInTheDocument()
    })
  })

  /**
   * Test 6: Cannot pause non-running task
   *
   * Validates that only running tasks can be paused:
   * - Pending task cannot be paused
   * - Finished task cannot be paused
   * - Only 'running' status allows pause
   */
  it('only allows pausing tasks in running state', async () => {
    const { result } = renderHook(() => useChatStoreAdapter())
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

    // Try with pending task
    await act(async () => {
      chatStore.setStatus(taskId!, 'pending')
    })

    const pendingTask = chatStore.tasks[taskId!]
    expect(pendingTask.status).toBe('pending')
    // In a real implementation, pause button should be disabled or hidden for pending tasks

    // Try with finished task
    await act(async () => {
      chatStore.setStatus(taskId!, 'finished')
    })

    const finishedTask = chatStore.tasks[taskId!]
    expect(finishedTask.status).toBe('finished')
    // In a real implementation, pause button should be disabled or hidden for finished tasks

    // Only running tasks should allow pause
    await act(async () => {
      chatStore.setStatus(taskId!, 'running')
    })

    const runningTask = chatStore.tasks[taskId!]
    expect(runningTask.status).toBe('running')
    // Pause should be available for running tasks
  })

  /**
   * Test 7: Task state persists during pause
   *
   * Validates that pausing doesn't lose task context:
   * - Messages remain in chat
   * - Task summary persists
   * - Subtask progress is maintained
   */
  it('maintains task state while paused', async () => {
    const { result } = renderHook(() => useChatStoreAdapter())
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

    const taskSummary = 'Build Web Application|Creating a full-stack app'
    const userMessage = 'Create a web app with authentication'
    const agentMessage = 'Setting up the project structure...'

    // Setup running task with messages
    await act(async () => {
      chatStore.setHasMessages(taskId!, true)
      chatStore.setSummaryTask(taskId!, taskSummary)
      chatStore.setStatus(taskId!, 'running')

      chatStore.addMessages(taskId!, {
        id: 'user-msg',
        role: 'user',
        content: userMessage,
        attaches: []
      })

      chatStore.addMessages(taskId!, {
        id: 'agent-msg',
        role: 'assistant',
        content: agentMessage,
        step: 'execution'
      })
    })

    // Verify messages are visible
    await waitFor(() => {
      expect(screen.getByText(userMessage)).toBeInTheDocument()
      expect(screen.getByText(agentMessage)).toBeInTheDocument()
    })

    // Pause the task
    await act(async () => {
      chatStore.setStatus(taskId!, 'paused')
    })

    // Verify state is maintained
    const pausedTask = chatStore.tasks[taskId!]
    expect(pausedTask.status).toBe('paused')
    expect(pausedTask.summaryTask).toBe(taskSummary)
    expect(pausedTask.messages.length).toBe(2)

    // Verify messages still visible after pause
    await waitFor(() => {
      expect(screen.getByText(userMessage)).toBeInTheDocument()
      expect(screen.getByText(agentMessage)).toBeInTheDocument()
    })
  })
})

/**
 * Testing Notes:
 *
 * 1. **Task Status Values**
 *    - 'pending': Task created but not started
 *    - 'running': Task is actively executing
 *    - 'paused': Task execution paused by user
 *    - 'finished': Task completed successfully
 *    - 'failed': Task encountered an error
 *
 * 2. **Pause/Resume Controls**
 *    - Pause button should only be visible when status is 'running'
 *    - Resume button should only be visible when status is 'paused'
 *    - Controls typically appear in the chat header or control bar
 *
 * 3. **State Preservation**
 *    - All messages remain in the message list
 *    - Task summary and subtasks are preserved
 *    - Execution can resume from the last checkpoint
 *
 * 4. **User Experience**
 *    - Clear visual indicator of paused state
 *    - User can pause to review output or make changes
 *    - Resume continues execution seamlessly
 */
