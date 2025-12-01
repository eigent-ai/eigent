/**
 * Integration Test: Case 1 - New Project
 * 
 * Tests the complete flow of creating a new project and sending the first message.
 * 
 * Flow:
 * 1. User creates a new project with initial message
 * 2. System automatically creates initial chatStore
 * 3. Task starts executing
 * 
 * This is the most common user journey and serves as the foundation for all other cases.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { generateUniqueId } from '../../../src/lib'

// Import proxy mock to enable API mocking
import '../../mocks/proxy.mock'
// Also Mock authStore & sse
import '../../mocks/authStore.mock'
import '../../mocks/sse.mock'

// Import chat store to ensure it's available
import '../../../src/store/chatStore'

import { useProjectStore } from '../../../src/store/projectStore'
import { mockFetchEventSource } from '../../mocks/sse.mock'

// Mock electron IPC
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

describe('Integration Test: Case 1 - New Project', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const { result } = renderHook(() => useProjectStore());
    //Reset projectStore
    result.current.getAllProjects().forEach(project => {
      result.current.removeProject(project.id)
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should create project with initial chatStore and task', async () => {
    const { result, rerender } = renderHook(() => useProjectStore())

    await act(async () => {
      // Step 1: Create new project
      const projectId = result.current.createProject(
        'My First Project',
        'A test project'
      )

      // Force a re-render to ensure state is updated
      rerender()

      // Debug: Log the store state immediately after creation
      console.log('Created projectId:', projectId)
      
      // Try to get project before asserting
      const debugProject = result.current.getProjectById(projectId)
      console.log('Retrieved project:', debugProject)

      // Verify project created
      expect(projectId).toBeDefined()
      
      // First check: activeProjectId should be set
      expect(debugProject?.id).toBe(projectId)

      const project = result.current.getProjectById(projectId)
      console.log('Retrieved project again:', project)
      expect(project).toBeDefined()
      expect(project?.name).toBe('My First Project')
      expect(project?.description).toBe('A test project')
    })
  })

  it('should automatically create initial chatStore in new project', () => {
    const { result } = renderHook(() => useProjectStore())

    act(() => {
      const projectId = result.current.createProject('Test Project')

      // Step 2: Verify chatStore created automatically
      const chatStore = result.current.getActiveChatStore(projectId)
      expect(chatStore).toBeDefined()

      // Verify initial task exists
      const chatState = chatStore!.getState()
      expect(chatState.activeTaskId).toBeDefined()
      expect(chatState.tasks[chatState.activeTaskId!]).toBeDefined()
    })
  })

  it('should have correct initial task state', () => {
    const { result } = renderHook(() => useProjectStore())

    act(() => {
      const projectId = result.current.createProject('Test Project')
      const chatStore = result.current.getActiveChatStore(projectId)!
      const chatState = chatStore.getState()
      const taskId = chatState.activeTaskId!
      const task = chatState.tasks[taskId]

      // Verify task initial state
      expect(task.status).toBe('pending')
      expect(task.messages).toEqual([])
      expect(task.tokens).toBe(0)
      expect(task.isPending).toBe(false)
      expect(task.hasMessages).toBe(false)
    })
  })

  it('should add user message to task', () => {
    const { result } = renderHook(() => useProjectStore())

    act(() => {
      const projectId = result.current.createProject('Test Project')
      const chatStore = result.current.getActiveChatStore(projectId)!
      const taskId = chatStore.getState().activeTaskId!

      // Step 3: User sends message
      const userMessage = {
        id: generateUniqueId(),
        role: 'user' as const,
        content: 'Create a todo app with React',
        attaches: [],
      }

      chatStore.getState().addMessages(taskId, userMessage)
      chatStore.getState().setHasMessages(taskId, true)

      // Verify message added
      const task = chatStore.getState().tasks[taskId]
      expect(task.messages).toHaveLength(1)
      expect(task.messages[0].content).toBe('Create a todo app with React')
      expect(task.hasMessages).toBe(true)
    })
  })

  it('should create historyId after starting task', async () => {
    const { result } = renderHook(() => useProjectStore())
    
    await act(async () => {
      const projectId = result.current.createProject('Test Project')
      const chatStore = result.current.getActiveChatStore(projectId)!
      const taskId = chatStore.getState().activeTaskId!

      // Add message
      chatStore.getState().addMessages(taskId, {
        id: generateUniqueId(),
        role: 'user',
        content: 'Test message',
      })

      // Mock SSE to immediately close (simulating startTask)
      mockFetchEventSource.mockImplementation((url: string, options: any) => {
        // Call onopen
        if (options.onopen) {
          options.onopen({ ok: true, status: 200 })
        }
        return Promise.resolve()
      })

      // Step 4: Start task
      await chatStore.getState().startTask(taskId)

      // Wait for historyId to be set
      await waitFor(() => {
        const historyId = result.current.getHistoryId(projectId)
        expect(historyId).toBeDefined()
        expect(historyId).toMatch(/^history-/)
      }, { timeout: 2000 })
    })
  })

  it('should handle complete user journey from project creation to task start', async () => {
    const { result } = renderHook(() => useProjectStore())

    await act(async () => {
      // Complete Flow Test
      
      // 1. Create project
      const projectId = result.current.createProject(
        'Complete Journey Test',
        'Testing full flow'
      )
      expect(projectId).toBeDefined()

      // 2. Get chatStore (automatically created)
      const chatStore = result.current.getActiveChatStore(projectId)!
      expect(chatStore).toBeDefined()

      const initiatorTaskId = chatStore.getState().activeTaskId!
      expect(initiatorTaskId).toBeDefined()

      // 3. Set user message
      const userMessage = 'Build a calculator app';

      // 4. Verify task ready to start
      const initialTask = chatStore.getState().tasks[initiatorTaskId]
      

      // 5. Mock SSE stream with to_sub_tasks event
      mockFetchEventSource.mockImplementation((url: string, options: any) => {
        setTimeout(() => {
          console.log("Sending to_sub_tasks SSE Event");
          // Simulate to_sub_tasks event
          if (options.onmessage) {
            options.onmessage({
              data: JSON.stringify({
                step: 'to_sub_tasks',
                data: {
                  summary_task: 'Calculator App|Build a simple calculator',
                  sub_tasks: [
                    { id: 'task-1', content: 'Create UI components', status: '' },
                    { id: 'task-2', content: 'Implement calculator logic', status: '' },
                  ],
                },
              }),
            })
          }
        }, 200)
      })

      // 6. Start task
      // NOTE: startTask creates a NEW chatStore and switches to it, the old chatStore is no longer active
      await chatStore.getState().startTask(initiatorTaskId, undefined, undefined, undefined, userMessage)

      // IMPORTANT: Get the NEW active chatStore after startTask creates it
      const newChatStore = result.current.getActiveChatStore()
      expect(newChatStore).toBeDefined()
      expect(newChatStore).not.toBe(chatStore) // Should be a different instance
      
      let taskId = newChatStore?.getState().activeTaskId!
      const task = newChatStore?.getState().tasks[taskId]
      expect(taskId).toBeDefined()
      if(task) {
        expect(task.hasMessages).toBe(true)
        expect(task.messages[0].content).toBe('Build a calculator app')
        expect(task.status).toBe('pending')
      }

      // 7. Wait for task breakdown
      await waitFor(() => {
        const updatedTask = newChatStore?.getState().tasks[taskId]
        expect(updatedTask?.summaryTask).toBe('Calculator App|Build a simple calculator')
        //Bcz of newTaskInfo { id: '', content: '', status: '' } we have 3 items
        expect(updatedTask?.taskInfo).toHaveLength(3)
        expect(updatedTask?.taskRunning).toHaveLength(3)
      }, { timeout: 2000 })
    })
  })

  it('should not create new project if empty project exists (optimization)', () => {
    const { result } = renderHook(() => useProjectStore())

    act(() => {
      // Create first empty project
      const projectId1 = result.current.createProject('First Project')

      // Before adding any messages, create another project
      // Should reuse the empty project
      const projectId2 = result.current.createProject('Second Project')

      // Should reuse the same project ID
      expect(projectId2).toBe(projectId1)

      // Project should be updated with new name
      const project = result.current.getProjectById(projectId2)
      expect(project?.name).toBe('Second Project')
    })
  })

  it('should create new project if existing project has messages', () => {
    const { result } = renderHook(() => useProjectStore())

    act(() => {
      // Create first project
      const projectId1 = result.current.createProject('First Project')

      // Add a message (making it non-empty)
      const chatStore = result.current.getActiveChatStore(projectId1)!
      const taskId = chatStore.getState().activeTaskId!
      chatStore.getState().addMessages(taskId, {
        id: generateUniqueId(),
        role: 'user',
        content: 'Test message',
      })

      // Now create second project
      const projectId2 = result.current.createProject('Second Project')

      // Should create new project
      expect(projectId2).not.toBe(projectId1)
      expect(result.current.getAllProjects()).toHaveLength(2)
    })
  })

  describe('Edge Cases', () => {
    it('should handle project creation with minimal data', async () => {
      const { result } = renderHook(() => useProjectStore())

      await act(async () => {
        const projectId = result.current.createProject('Minimal Project')

        // Wait a tick to ensure all state updates are complete
        await new Promise(resolve => setTimeout(resolve, 0))

        const project = result.current.getProjectById(projectId)
        expect(project?.name).toBe('Minimal Project')
        expect(project?.description).toBeUndefined()
      })
    })

    it('should handle empty message gracefully', async () => {
      const { result } = renderHook(() => useProjectStore())

      await act(async () => {
        const projectId = result.current.createProject('Test Project')
        
        // Wait a tick for project creation to complete
        await new Promise(resolve => setTimeout(resolve, 0))
        
        const chatStore = result.current.getActiveChatStore(projectId)!
        const taskId = chatStore.getState().activeTaskId!

        // Add empty message
        chatStore.getState().addMessages(taskId, {
          id: generateUniqueId(),
          role: 'user',
          content: '',
        })

        // Wait for message update to complete
        await new Promise(resolve => setTimeout(resolve, 0))

        const task = chatStore.getState().tasks[taskId]
        expect(task.messages).toHaveLength(1)
        expect(task.messages[0].content).toBe('')
      })
    })

    it('should handle rapid project creation', async () => {
      const { result } = renderHook(() => useProjectStore())

      await act(async () => {
        const projectIds = []
        for (let i = 0; i < 5; i++) {
          projectIds.push(result.current.createProject(`Project ${i}`))
          // Add small delay between each creation to ensure proper state updates
          await new Promise(resolve => setTimeout(resolve, 0))
        }

        // Only first should be created, rest reuse until messages added
        expect(new Set(projectIds).size).toBeLessThanOrEqual(1)
      })
    })
  })
})
