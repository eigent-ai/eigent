/**
 * ChatStore Unit Tests - Core Functionality
 *
 * Tests basic chatStore operations:
 * - Task creation and removal
 * - Status management
 * - Token tracking
 * - Message handling
 *
 * Updated for single-task pattern (task instead of tasks dictionary)
 */

import { describe, it, expect, beforeEach, vi, MockedFunction } from 'vitest'
import { act, renderHook } from '@testing-library/react'

// Mock dependencies - moved to top before other imports
vi.mock('@/api/http', () => ({
  fetchPost: vi.fn(),
  fetchPut: vi.fn(),
  getBaseURL: vi.fn(() => Promise.resolve('http://localhost:8000')),
  proxyFetchPost: vi.fn(),
  proxyFetchPut: vi.fn(),
  proxyFetchGet: vi.fn(),
  uploadFile: vi.fn(),
  fetchDelete: vi.fn(),
}))

vi.mock('@microsoft/fetch-event-source', () => ({
  fetchEventSource: vi.fn(),
}))

vi.mock('../../../src/store/authStore', () => ({
  useAuthStore: {
    token: null,
    username: null,
    email: null,
    user_id: null,
    appearance: 'light',
    language: 'system',
    isFirstLaunch: true,
    modelType: 'cloud' as const,
    cloud_model_type: 'gpt-4.1' as const,
    initState: 'permissions' as const,
    share_token: null,
    workerListData: {},
  },
  getAuthStore: vi.fn(() => ({
    token: null,
    username: null,
    email: null,
    user_id: null,
    appearance: 'light',
    language: 'system',
    isFirstLaunch: true,
    modelType: 'cloud' as const,
    cloud_model_type: 'gpt-4.1' as const,
    initState: 'permissions' as const,
    share_token: null,
    workerListData: {},
  })),
  useWorkerList: vi.fn(() => [])
}))

import { useChatStore } from '../../../src/store/chatStore'
import { useProjectStore } from '../../../src/store/projectStore'
import { generateUniqueId } from '../../../src/lib'

// Mock electron IPC
(global as any).ipcRenderer = {
  invoke: vi.fn((channel, ...args) => {
    if (channel === 'get-system-language') return Promise.resolve('en')
    if (channel === 'get-browser-port') return Promise.resolve(9222)
    if (channel === 'get-env-path') return Promise.resolve('/path/to/env')
    if (channel === 'mcp-list') return Promise.resolve({})
    return Promise.resolve()
  }),
}

describe('ChatStore - Core Functionality', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Task Creation', () => {
    it('should create a task with unique ID', () => {
      const { result } = renderHook(() => useChatStore())

      act(() => {
        const taskId = result.current.getState().create()

        expect(taskId).toBeDefined()
        expect(result.current.getState().task).toBeDefined()
        expect(result.current.getState().taskId).toBe(taskId)
      })
    })

    it('should create a task with custom ID', () => {
      const { result } = renderHook(() => useChatStore())
      const customId = 'custom-task-123'

      act(() => {
        const taskId = result.current.getState().create(customId)

        expect(taskId).toBe(customId)
        expect(result.current.getState().task).toBeDefined()
        expect(result.current.getState().taskId).toBe(customId)
      })
    })

    it('should initialize task with correct default state', () => {
      const { result } = renderHook(() => useChatStore())

      act(() => {
        result.current.getState().create()
        const task = result.current.getState().task

        expect(task).not.toBeNull()
        expect(task!.status).toBe('pending')
        expect(task!.messages).toEqual([])
        expect(task!.tokens).toBe(0)
        expect(task!.isPending).toBe(false)
        expect(task!.hasWaitComfirm).toBe(false)
        expect(task!.progressValue).toBe(0)
        expect(task!.taskInfo).toEqual([])
        expect(task!.taskRunning).toEqual([])
        expect(task!.taskAssigning).toEqual([])
      })
    })

    it('should set taskId when created', () => {
      const { result } = renderHook(() => useChatStore())

      act(() => {
        const taskId = result.current.getState().create()

        expect(result.current.getState().taskId).toBe(taskId)
      })
    })

    it('should replace existing task when creating new one', () => {
      const { result } = renderHook(() => useChatStore())

      act(() => {
        const taskId1 = result.current.getState().create()
        const taskId2 = result.current.getState().create()

        // New task replaces old one
        expect(result.current.getState().taskId).toBe(taskId2)
        expect(taskId1).not.toBe(taskId2)
      })
    })
  })

  describe('Task Removal', () => {
    it('should remove the current task', () => {
      const { result } = renderHook(() => useChatStore())

      act(() => {
        result.current.getState().create()
        expect(result.current.getState().task).toBeDefined()

        result.current.getState().removeTask()

        expect(result.current.getState().task).toBeNull()
        expect(result.current.getState().taskId).toBeNull()
      })
    })

    it('should handle removing when no task exists gracefully', () => {
      const { result } = renderHook(() => useChatStore())

      act(() => {
        // Should not throw
        result.current.getState().removeTask()
      })
    })

    it('should clear task and create fresh state', () => {
      const { result } = renderHook(() => useChatStore())

      act(() => {
        const originalTaskId = result.current.getState().create()
        expect(result.current.getState().task).not.toBeNull()

        // Add some state to the task
        result.current.getState().setHasMessages(true)
        expect(result.current.getState().task!.hasMessages).toBe(true)

        result.current.getState().clearTask()

        // clearTask creates a new fresh task, not null
        expect(result.current.getState().task).not.toBeNull()
        expect(result.current.getState().taskId).not.toBeNull()
        // The new task should have fresh state
        expect(result.current.getState().taskId).not.toBe(originalTaskId)
        expect(result.current.getState().task!.hasMessages).toBe(false)
      })
    })
  })

  describe('Status Management', () => {
    it('should update task status correctly', () => {
      const { result } = renderHook(() => useChatStore())

      act(() => {
        result.current.getState().create()

        result.current.getState().setStatus('running')
        expect(result.current.getState().task!.status).toBe('running')

        result.current.getState().setStatus('finished')
        expect(result.current.getState().task!.status).toBe('finished')

        result.current.getState().setStatus('pause')
        expect(result.current.getState().task!.status).toBe('pause')
      })
    })

    it('should set pending state independently of status', () => {
      const { result } = renderHook(() => useChatStore())

      act(() => {
        result.current.getState().create()

        result.current.getState().setIsPending(true)
        expect(result.current.getState().task!.isPending).toBe(true)
        expect(result.current.getState().task!.status).toBe('pending')

        result.current.getState().setStatus('running')
        expect(result.current.getState().task!.isPending).toBe(true)
        expect(result.current.getState().task!.status).toBe('running')
      })
    })
  })

  describe('Token Management', () => {
    it('should accumulate tokens correctly', () => {
      const { result } = renderHook(() => useChatStore())

      act(() => {
        result.current.getState().create()

        result.current.getState().addTokens(100)
        expect(result.current.getState().getTokens()).toBe(100)

        result.current.getState().addTokens(50)
        expect(result.current.getState().getTokens()).toBe(150)

        result.current.getState().addTokens(250)
        expect(result.current.getState().getTokens()).toBe(400)
      })
    })

    it('should handle negative token additions', () => {
      const { result } = renderHook(() => useChatStore())

      act(() => {
        result.current.getState().create()

        result.current.getState().addTokens(100)
        result.current.getState().addTokens(-50)

        expect(result.current.getState().getTokens()).toBe(50)
      })
    })

    it('should return 0 tokens when no task exists', () => {
      const { result } = renderHook(() => useChatStore())

      act(() => {
        result.current.getState().clearTask()
      })

      expect(result.current.getState().getTokens()).toBe(0)
    })
  })

  describe('Message Management', () => {
    it('should add messages to task', () => {
      const { result } = renderHook(() => useChatStore())

      act(() => {
        result.current.getState().create()

        result.current.getState().addMessages({
          id: generateUniqueId(),
          role: 'user',
          content: 'Hello, world!'
        })

        expect(result.current.getState().task!.messages).toHaveLength(1)
        expect(result.current.getState().task!.messages[0].content).toBe('Hello, world!')
      })
    })

    it('should maintain message order', () => {
      const { result } = renderHook(() => useChatStore())

      act(() => {
        result.current.getState().create()

        result.current.getState().addMessages({
          id: '1',
          role: 'user',
          content: 'First'
        })
        result.current.getState().addMessages({
          id: '2',
          role: 'agent',
          content: 'Second'
        })
        result.current.getState().addMessages({
          id: '3',
          role: 'user',
          content: 'Third'
        })

        const messages = result.current.getState().task!.messages
        expect(messages).toHaveLength(3)
        expect(messages[0].content).toBe('First')
        expect(messages[1].content).toBe('Second')
        expect(messages[2].content).toBe('Third')
      })
    })

    it('should get last user message', () => {
      const { result } = renderHook(() => useChatStore())

      act(() => {
        result.current.getState().create()

        result.current.getState().addMessages({
          id: '1',
          role: 'user',
          content: 'First user message'
        })
        result.current.getState().addMessages({
          id: '2',
          role: 'agent',
          content: 'Agent response'
        })
        result.current.getState().addMessages({
          id: '3',
          role: 'user',
          content: 'Second user message'
        })

        const lastUserMessage = result.current.getState().getLastUserMessage()
        expect(lastUserMessage?.content).toBe('Second user message')
      })
    })

    it('should return null when no user messages exist', () => {
      const { result } = renderHook(() => useChatStore())

      act(() => {
        result.current.getState().create()

        result.current.getState().addMessages({
          id: '1',
          role: 'agent',
          content: 'Agent message'
        })

        const lastUserMessage = result.current.getState().getLastUserMessage()
        expect(lastUserMessage).toBeNull()
      })
    })

    it('should set messages replacing existing ones', () => {
      const { result } = renderHook(() => useChatStore())

      act(() => {
        result.current.getState().create()

        result.current.getState().addMessages({
          id: '1',
          role: 'user',
          content: 'Original'
        })

        const newMessages = [
          { id: '2', role: 'user' as const, content: 'New 1' },
          { id: '3', role: 'agent' as const, content: 'New 2' }
        ]

        result.current.getState().setMessages(newMessages)

        expect(result.current.getState().task!.messages).toHaveLength(2)
        expect(result.current.getState().task!.messages[0].content).toBe('New 1')
      })
    })
  })

  describe('Task Time Tracking', () => {
    it('should track task time', () => {
      const { result } = renderHook(() => useChatStore())

      act(() => {
        result.current.getState().create()
        const startTime = Date.now()

        result.current.getState().setTaskTime(startTime)

        expect(result.current.getState().task!.taskTime).toBe(startTime)
      })
    })

    it('should track elapsed time', () => {
      const { result } = renderHook(() => useChatStore())

      act(() => {
        result.current.getState().create()

        result.current.getState().setElapsed(5000)

        expect(result.current.getState().task!.elapsed).toBe(5000)
      })
    })

    it('should format task time correctly', () => {
      const { result } = renderHook(() => useChatStore())

      act(() => {
        result.current.getState().create()

        // Test elapsed time formatting
        result.current.getState().setTaskTime(0)
        result.current.getState().setElapsed(3665000) // 1h 1m 5s

        const formatted = result.current.getState().getFormattedTaskTime()
        expect(formatted).toBe('01:01:05')
      })
    })
  })

  describe('Progress Tracking', () => {
    it('should update progress value', () => {
      const { result } = renderHook(() => useChatStore())

      act(() => {
        result.current.getState().create()

        result.current.getState().setProgressValue(50)
        expect(result.current.getState().task!.progressValue).toBe(50)

        result.current.getState().setProgressValue(100)
        expect(result.current.getState().task!.progressValue).toBe(100)
      })
    })

    it('should compute progress based on completed tasks', () => {
      const { result } = renderHook(() => useChatStore())

      act(() => {
        result.current.getState().create()

        // Set up task structure
        result.current.getState().setTaskRunning([
          { id: '1', content: 'Task 1', status: 'completed' },
          { id: '2', content: 'Task 2', status: 'completed' },
          { id: '3', content: 'Task 3', status: 'running' },
          { id: '4', content: 'Task 4', status: 'waiting' },
        ] as any)

        result.current.getState().computedProgressValue()

        // 2 out of 4 = 50%
        expect(result.current.getState().task!.progressValue).toBe(50)
      })
    })
  })

  describe('Update Counter', () => {
    it('should increment update count', () => {
      const { result } = renderHook(() => useChatStore())

      const initialCount = result.current.getState().updateCount

      act(() => {
        result.current.getState().setUpdateCount()
      })

      expect(result.current.getState().updateCount).toBe(initialCount + 1)

      act(() => {
        result.current.getState().setUpdateCount()
      })

      expect(result.current.getState().updateCount).toBe(initialCount + 2)
    })
  })
})
