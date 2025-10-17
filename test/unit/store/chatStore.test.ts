/**
 * ChatStore Unit Tests - Core Functionality
 * 
 * Tests basic chatStore operations:
 * - Task creation and removal
 * - Status management
 * - Token tracking
 * - Message handling
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
        const taskId1 = result.current.getState().create()
        const taskId2 = result.current.getState().create()
        
        expect(taskId1).toBeDefined()
        expect(taskId2).toBeDefined()
        expect(taskId1).not.toBe(taskId2)
        expect(result.current.getState().tasks[taskId1]).toBeDefined()
        expect(result.current.getState().tasks[taskId2]).toBeDefined()
      })
    })

    it('should create a task with custom ID', () => {
      const { result } = renderHook(() => useChatStore())
      const customId = 'custom-task-123'
      
      act(() => {
        const taskId = result.current.getState().create(customId)
        
        expect(taskId).toBe(customId)
        expect(result.current.getState().tasks[customId]).toBeDefined()
      })
    })

    it('should initialize task with correct default state', () => {
      const { result } = renderHook(() => useChatStore())
      
      act(() => {
        const taskId = result.current.getState().create()
        const task = result.current.getState().tasks[taskId]
        
        expect(task.status).toBe('pending')
        expect(task.messages).toEqual([])
        expect(task.tokens).toBe(0)
        expect(task.isPending).toBe(false)
        expect(task.hasWaitComfirm).toBe(false)
        expect(task.progressValue).toBe(0)
        expect(task.taskInfo).toEqual([])
        expect(task.taskRunning).toEqual([])
        expect(task.taskAssigning).toEqual([])
      })
    })

    it('should set task as active when created', () => {
      const { result } = renderHook(() => useChatStore())
      
      act(() => {
        const taskId = result.current.getState().create()
        
        expect(result.current.getState().activeTaskId).toBe(taskId)
      })
    })
  })

  describe('Task Removal', () => {
    it('should remove a task by ID', () => {
      const { result } = renderHook(() => useChatStore())
      
      act(() => {
        const taskId = result.current.getState().create()
        expect(result.current.getState().tasks[taskId]).toBeDefined()
        
        result.current.getState().removeTask(taskId)
        
        expect(result.current.getState().tasks[taskId]).toBeUndefined()
      })
    })

    it('should handle removing non-existent task gracefully', () => {
      const { result } = renderHook(() => useChatStore())
      
      act(() => {
        // Should not throw
        result.current.getState().removeTask('non-existent-id')
      })
    })

    it('should clear all tasks and create new one', () => {
      const { result } = renderHook(() => useChatStore())
      
      act(() => {
        const taskId1 = result.current.getState().create()
        const taskId2 = result.current.getState().create()
        
        expect(Object.keys(result.current.getState().tasks)).toHaveLength(2)
        
        result.current.getState().clearTasks()
        
        const remainingTasks = Object.keys(result.current.getState().tasks)
        expect(remainingTasks).toHaveLength(1)
        expect(result.current.getState().activeTaskId).toBeDefined()
      })
    })
  })

  describe('Status Management', () => {
    it('should update task status correctly', () => {
      const { result } = renderHook(() => useChatStore())
      
      act(() => {
        const taskId = result.current.getState().create()
        
        result.current.getState().setStatus(taskId, 'running')
        expect(result.current.getState().tasks[taskId].status).toBe('running')
        
        result.current.getState().setStatus(taskId, 'finished')
        expect(result.current.getState().tasks[taskId].status).toBe('finished')
        
        result.current.getState().setStatus(taskId, 'pause')
        expect(result.current.getState().tasks[taskId].status).toBe('pause')
      })
    })

    it('should set pending state independently of status', () => {
      const { result } = renderHook(() => useChatStore())
      
      act(() => {
        const taskId = result.current.getState().create()
        
        result.current.getState().setIsPending(taskId, true)
        expect(result.current.getState().tasks[taskId].isPending).toBe(true)
        expect(result.current.getState().tasks[taskId].status).toBe('pending')
        
        result.current.getState().setStatus(taskId, 'running')
        expect(result.current.getState().tasks[taskId].isPending).toBe(true)
        expect(result.current.getState().tasks[taskId].status).toBe('running')
      })
    })
  })

  describe('Token Management', () => {
    it('should accumulate tokens correctly', () => {
      const { result } = renderHook(() => useChatStore())
      
      act(() => {
        const taskId = result.current.getState().create()
        
        result.current.getState().addTokens(taskId, 100)
        expect(result.current.getState().getTokens(taskId)).toBe(100)
        
        result.current.getState().addTokens(taskId, 50)
        expect(result.current.getState().getTokens(taskId)).toBe(150)
        
        result.current.getState().addTokens(taskId, 250)
        expect(result.current.getState().getTokens(taskId)).toBe(400)
      })
    })

    it('should handle negative token additions', () => {
      const { result } = renderHook(() => useChatStore())
      
      act(() => {
        const taskId = result.current.getState().create()
        
        result.current.getState().addTokens(taskId, 100)
        result.current.getState().addTokens(taskId, -50)
        
        expect(result.current.getState().getTokens(taskId)).toBe(50)
      })
    })

    it('should return 0 tokens for non-existent task', () => {
      const { result } = renderHook(() => useChatStore())
      
      expect(result.current.getState().getTokens('non-existent')).toBe(0)
    })

    it('should preserve tokens when creating new task with initial tokens', () => {
      const { result } = renderHook(() => useChatStore())
      
      act(() => {
        const taskId1 = result.current.getState().create()
        result.current.getState().addTokens(taskId1, 500)
        
        // Simulate new task in same project with accumulated tokens
        const taskId2 = result.current.getState().create()
        result.current.getState().addTokens(taskId2, 500) // Cumulative
        
        expect(result.current.getState().getTokens(taskId2)).toBe(500)
      })
    })
  })

  describe('Message Management', () => {
    it('should add messages to task', () => {
      const { result } = renderHook(() => useChatStore())
      
      act(() => {
        const taskId = result.current.getState().create()
        
        result.current.getState().addMessages(taskId, {
          id: generateUniqueId(),
          role: 'user',
          content: 'Hello, world!'
        })
        
        expect(result.current.getState().tasks[taskId].messages).toHaveLength(1)
        expect(result.current.getState().tasks[taskId].messages[0].content).toBe('Hello, world!')
      })
    })

    it('should maintain message order', () => {
      const { result } = renderHook(() => useChatStore())
      
      act(() => {
        const taskId = result.current.getState().create()
        
        result.current.getState().addMessages(taskId, {
          id: '1',
          role: 'user',
          content: 'First'
        })
        result.current.getState().addMessages(taskId, {
          id: '2',
          role: 'agent',
          content: 'Second'
        })
        result.current.getState().addMessages(taskId, {
          id: '3',
          role: 'user',
          content: 'Third'
        })
        
        const messages = result.current.getState().tasks[taskId].messages
        expect(messages).toHaveLength(3)
        expect(messages[0].content).toBe('First')
        expect(messages[1].content).toBe('Second')
        expect(messages[2].content).toBe('Third')
      })
    })

    it('should get last user message', () => {
      const { result } = renderHook(() => useChatStore())
      
      act(() => {
        const taskId = result.current.getState().create()
        result.current.getState().setActiveTaskId(taskId)
        
        result.current.getState().addMessages(taskId, {
          id: '1',
          role: 'user',
          content: 'First user message'
        })
        result.current.getState().addMessages(taskId, {
          id: '2',
          role: 'agent',
          content: 'Agent response'
        })
        result.current.getState().addMessages(taskId, {
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
        const taskId = result.current.getState().create()
        result.current.getState().setActiveTaskId(taskId)
        
        result.current.getState().addMessages(taskId, {
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
        const taskId = result.current.getState().create()
        
        result.current.getState().addMessages(taskId, {
          id: '1',
          role: 'user',
          content: 'Original'
        })
        
        const newMessages = [
          { id: '2', role: 'user' as const, content: 'New 1' },
          { id: '3', role: 'agent' as const, content: 'New 2' }
        ]
        
        result.current.getState().setMessages(taskId, newMessages)
        
        expect(result.current.getState().tasks[taskId].messages).toHaveLength(2)
        expect(result.current.getState().tasks[taskId].messages[0].content).toBe('New 1')
      })
    })
  })

  describe('Task Time Tracking', () => {
    it('should track task time', () => {
      const { result } = renderHook(() => useChatStore())
      
      act(() => {
        const taskId = result.current.getState().create()
        const startTime = Date.now()
        
        result.current.getState().setTaskTime(taskId, startTime)
        
        expect(result.current.getState().tasks[taskId].taskTime).toBe(startTime)
      })
    })

    it('should track elapsed time', () => {
      const { result } = renderHook(() => useChatStore())
      
      act(() => {
        const taskId = result.current.getState().create()
        
        result.current.getState().setElapsed(taskId, 5000)
        
        expect(result.current.getState().tasks[taskId].elapsed).toBe(5000)
      })
    })

    it('should format task time correctly', () => {
      const { result } = renderHook(() => useChatStore())
      
      act(() => {
        const taskId = result.current.getState().create()
        
        // Test elapsed time formatting
        result.current.getState().setTaskTime(taskId, 0)
        result.current.getState().setElapsed(taskId, 3665000) // 1h 1m 5s
        
        const formatted = result.current.getState().getFormattedTaskTime(taskId)
        expect(formatted).toBe('01:01:05')
      })
    })
  })

  describe('Progress Tracking', () => {
    it('should update progress value', () => {
      const { result } = renderHook(() => useChatStore())
      
      act(() => {
        const taskId = result.current.getState().create()
        
        result.current.getState().setProgressValue(taskId, 50)
        expect(result.current.getState().tasks[taskId].progressValue).toBe(50)
        
        result.current.getState().setProgressValue(taskId, 100)
        expect(result.current.getState().tasks[taskId].progressValue).toBe(100)
      })
    })

    it('should compute progress based on completed tasks', () => {
      const { result } = renderHook(() => useChatStore())
      
      act(() => {
        const taskId = result.current.getState().create()
        
        // Set up task structure
        result.current.getState().setTaskRunning(taskId, [
          { id: '1', content: 'Task 1', status: 'completed' },
          { id: '2', content: 'Task 2', status: 'completed' },
          { id: '3', content: 'Task 3', status: 'running' },
          { id: '4', content: 'Task 4', status: 'waiting' },
        ] as any)
        
        result.current.getState().computedProgressValue(taskId)
        
        // 2 out of 4 = 50%
        expect(result.current.getState().tasks[taskId].progressValue).toBe(50)
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
