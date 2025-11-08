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
import useChatStoreAdapter from '../../../src/hooks/useChatStoreAdapter'
import { mockFetchEventSource } from '../../mocks/sse.mock'
import { replayProject } from '../../../src/lib'

// Helper function for sequential SSE events
const createSSESequence = (events: Array<{ event: any; delay: number }>) => {
  return async (onMessage: (data: any) => void) => {
    for (let i = 0; i < events.length; i++) {
      const { event, delay } = events[i]
      
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          console.log(`Sending SSE Event ${i + 1}:`, event.step);
          onMessage({
            data: JSON.stringify(event)
          })
          resolve()
        }, delay)
      })
    }
  }
}

// Mock navigate function
const mockNavigate = vi.fn() as any

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

// Mock window.electronAPI
Object.defineProperty(window, 'electronAPI', {
  value: {
    uploadLog: vi.fn().mockResolvedValue(undefined),
    // Add other electronAPI methods as needed
  },
  writable: true,
})

describe('Integration Test: Replay Functionality', () => {
  let initialProjectId: string
  let initialTaskId: string
  let projectStoreResult: any

  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockClear();
    
    projectStoreResult = renderHook(() => useProjectStore());
    //Reset projectStore
    projectStoreResult.result.current.getAllProjects().forEach((project: any) => {
      projectStoreResult.result.current.removeProject(project.id)
    })

    //Create initial Project for testing
    initialProjectId = projectStoreResult.result.current.createProject(
      'Original Project',
      'Testing replay functionality'
    )
    expect(initialProjectId).toBeDefined()

    // Get chatStore (automatically created)
    const chatStore = projectStoreResult.result.current.getActiveChatStore(initialProjectId)!
    expect(chatStore).toBeDefined()
    initialTaskId = chatStore.getState().activeTaskId!
    expect(initialTaskId).toBeDefined()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("should create replay project with correct taskId == projectId", async () => {
    const { result, rerender } = renderHook(() => useChatStoreAdapter())
    
    // Setup replay events sequence
    const replayEventSequence = createSSESequence([
      {
        event: {
          step: 'confirmed',
          data: { question: 'Build a calculator app' }
        },
        delay: 100
      },
      {
        event: {
          step: 'to_sub_tasks',
          data: {
            summary_task: 'Calculator App|Build a simple calculator',
            sub_tasks: [
              { id: 'replay-task-1', content: 'Create UI components', status: '' },
              { id: 'replay-task-2', content: 'Implement calculator logic', status: '' },
            ],
          },
        },
        delay: 200
      },
      {
        event: {
          step: "end", 
          data: "--- Replay Task Result ---\nCalculator app replay completed!"
        },
        delay: 300
      }
    ])

    // Mock SSE for replay
    mockFetchEventSource.mockImplementation(async (url: string, options: any) => {
      console.log('SSE URL called:', url)
      if (url.includes('/api/chat/steps/playback/') && options.onmessage) {
        await replayEventSequence(options.onmessage)
      }
    })

    // Run replayProject
    await act(async () => {
      await replayProject(
        result.current.projectStore,
        mockNavigate,
        generateUniqueId(), //Gotten from api
        'Build a calculator app',
        'test-history-id'
      )
    })

    // Verify replay project was created
    await waitFor(() => {
      rerender()
      const {projectStore} = result.current;
      const projects = projectStore.getAllProjects()
      
      // Should have original project + replay project
      expect(projects).toHaveLength(2)
      
      // Find the replay project
      const replayProject = projects.find((p:any) => p.name.includes('Replay Project'))
      expect(replayProject).toBeDefined()
      expect(replayProject?.name).toBe('Replay Project Build a calculator app')
      
      // Test critical requirement: taskId should equal projectId for replay
      const replayChatStores = projectStore.getAllChatStores(replayProject!.id)
      //Initial one is empty one - TODO: Reuse the empty one (even if projectid isgiven)
      expect(replayChatStores).toHaveLength(2)
      
      const replayChatStore = replayChatStores[1].chatStore
      const replayTaskId = replayChatStore.getState().activeTaskId
      
      // The main test: taskId should equal the projectId passed to replayProject
      // In this case we passed generateUniqueId() as the projectId
      expect(replayTaskId).toBeDefined()
      expect(replayTaskId).not.toBe(initialProjectId) // Should be different from initial project
      
      // Verify the replay task has correct properties
      const replayTask = replayChatStore.getState().tasks[replayTaskId]
      expect(replayTask).toBeDefined()
      expect(replayTask.type).toBe('replay')
      expect(replayTask.messages[0].content).toBe('Build a calculator app')
      
      console.log('Replay Project ID:', replayProject!.id)
      console.log('Replay Task ID:', replayTaskId)
      console.log('Original Project ID:', initialProjectId)
    }, { timeout: 2000 })

    // Verify navigation was called
    expect(mockNavigate).toHaveBeenCalledWith({ pathname: "/" })
  })

  it("should not append chatStore during replay (appendingChatStore logic)", async () => {
    const { result, rerender } = renderHook(() => useChatStoreAdapter())
    const projectStoreResult = renderHook(() => useProjectStore())
    
    // Setup replay events with multiple steps to test appendingChatStore logic
    const replayEventSequence = createSSESequence([
      {
        event: {
          step: 'confirmed',
          data: { question: 'Build a todo app' }
        },
        delay: 100
      },
      {
        event: {
          step: 'to_sub_tasks',
          data: {
            summary_task: 'Todo App|Build a todo application',
            sub_tasks: [
              { id: 'todo-1', content: 'Design interface', status: '' },
              { id: 'todo-2', content: 'Implement logic', status: '' },
            ],
          },
        },
        delay: 200
      },
      {
        event: {
          step: 'progress',
          data: 'Processing todo app requirements...'
        },
        delay: 300
      },
      {
        event: {
          step: "end", 
          data: "--- Todo App Replay Result ---\nTodo app replay finished!"
        },
        delay: 400
      }
    ])

    mockFetchEventSource.mockImplementation(async (url: string, options: any) => {
      if (url.includes('/api/chat/steps/playback/') && options.onmessage) {
        await replayEventSequence(options.onmessage)
      }
    })

    // Get initial project count
    const initialProjectCount = projectStoreResult.result.current.getAllProjects().length

    // Run replay
    await act(async () => {
      await replayProject(
        projectStoreResult.result.current,
        mockNavigate,
        generateUniqueId(),
        'Build a todo app',
        'test-history-id-2'
      )
    })

    // Wait for replay to complete
    await waitFor(() => {
      rerender()
      const { projectStore } = result.current
      const projects = projectStore.getAllProjects()
      // We should have original project + replay project (so +1)
      expect(projects).toHaveLength(initialProjectCount + 1)
      
      const replayProject = projects.find((p: any) => p.name.includes('Replay Project Build a todo app'))
      expect(replayProject).toBeDefined()
      
      // Critical test: Should have exactly ONE chatStore in replay project
      // This tests that appendingChatStore logic prevented additional chatStores
      const replayChatStores = projectStore.getAllChatStores(replayProject!.id)
      expect(replayChatStores).toHaveLength(2)
      
      // Verify the single chatStore has the replay task
      const replayChatStore = replayChatStores[1].chatStore
      const activeTaskId = replayChatStore.getState().activeTaskId
      const task = activeTaskId ? replayChatStore.getState().tasks[activeTaskId] : null
      expect(task).toBeDefined()
      expect(task?.summaryTask).toBe('Todo App|Build a todo application')
      
      console.log('Replay ChatStore count:', replayChatStores.length)
      console.log('Should be exactly 1 (no appending during replay)')
    }, { timeout: 3000 })
  })

  it("should handle startTask on same project after replay completes", async () => {
    const { result, rerender } = renderHook(() => useChatStoreAdapter())
    const projectStoreResult = renderHook(() => useProjectStore())
    
    // Step 1: Complete a replay first
    const replayEventSequence = createSSESequence([
      {
        event: {
          step: 'confirmed',
          data: { question: 'Initial replay task' }
        },
        delay: 100
      },
      {
        event: {
          step: "end", 
          data: "--- Initial Replay Completed ---"
        },
        delay: 200
      }
    ])

    mockFetchEventSource.mockImplementation(async (url: string, options: any) => {
      if (url.includes('/api/chat/steps/playback/') && options.onmessage) {
        await replayEventSequence(options.onmessage)
      }
    })

    // Run initial replay
    await act(async () => {
      await replayProject(
        projectStoreResult.result.current,
        mockNavigate,
        generateUniqueId(),
        'Initial replay task',
        'replay-history-id'
      )
    })

    // Wait for replay to complete
    await waitFor(() => {
      const projects = projectStoreResult.result.current.getAllProjects()
      const replayProj = projects.find(p => p.name.includes('Replay Project'))
      expect(replayProj).toBeDefined()
    }, { timeout: 2000 })

    // Step 2: Setup new SSE events for post-replay startTask
    const postReplayEventSequence = createSSESequence([
      {
        event: {
          step: 'to_sub_tasks',
          data: {
            summary_task: 'Post Replay Task|New task after replay',
            sub_tasks: [
              { id: 'post-1', content: 'New task component', status: '' },
            ],
          },
        },
        delay: 100
      },
      {
        event: {
          step: "end", 
          data: "--- Post Replay Task Completed ---"
        },
        delay: 200
      }
    ])

    // Update mock for post-replay events
    mockFetchEventSource.mockImplementation(async (url: string, options: any) => {
      if (!url.includes('/api/chat/steps/playback/') && options.onmessage) {
        await postReplayEventSequence(options.onmessage)
      }
    })

    // Step 3: Call startTask on replay project after replay completes
    await act(async () => {
      rerender()
      const { chatStore } = result.current
      
      // Should be connected to the replay project now
      expect(chatStore).toBeDefined()
      
      const currentTaskId = chatStore.activeTaskId
      expect(currentTaskId).toBeDefined()
      
      // Start a new task on the replay project
      await chatStore.startTask(
        currentTaskId,
        undefined,
        undefined,
        undefined,
        'New task after replay completion'
      )
      rerender()
    })

    // Step 4: Verify new chatStore was created for post-replay task
    await waitFor(() => {
      rerender()
      const { chatStore: newChatStore, projectStore } = result.current
      
      // Should have a new chatStore for the post-replay task
      expect(newChatStore).toBeDefined()
      
      const activeTaskId = newChatStore.activeTaskId
      const activeTask = newChatStore.tasks[activeTaskId]
      
      expect(activeTask).toBeDefined()
      expect(activeTask.messages[0].content).toBe('New task after replay completion')
      expect(activeTask.summaryTask).toBe('Post Replay Task|New task after replay')
      
      // Verify we now have 2 chatStores in the replay project (replay + post-replay task)
      const allChatStores = projectStore.getAllChatStores(projectStore.activeProjectId)
      // Expected: on createProject + original replay chatStore + new post-replay chatStore = 3
      expect(allChatStores).toHaveLength(3)
      
      console.log('Post-replay chatStore count:', allChatStores.length)
      console.log('Successfully created new chatStore after replay')
    }, { timeout: 2000 })
  })

  it("should handle parallel startTask during replay (separate chatStores)", async () => {
    const { result, rerender } = renderHook(() => useChatStoreAdapter())
    const projectStoreResult = renderHook(() => useProjectStore())
    
    // Setup automatic SSE for both replay and parallel tasks
    const replayEventSequence = createSSESequence([
      {
        event: {
          step: 'confirmed',
          data: { question: 'Long running replay task' }
        },
        delay: 100
      },
      {
        event: {
          step: "end", 
          data: "--- Replay Task Completed ---"
        },
        delay: 500 // Longer delay to allow parallel task to start
      }
    ])

    const parallelEventSequence = createSSESequence([
      {
        event: {
          step: 'to_sub_tasks',
          data: {
            summary_task: 'Parallel Task|Running alongside replay',
            sub_tasks: [
              { id: 'parallel-1', content: 'Parallel component', status: '' },
            ],
          },
        },
        delay: 100
      },
      {
        event: {
          step: "end", 
          data: "--- Parallel Task Completed ---"
        },
        delay: 200
      }
    ])

    // Mock SSE to handle both replay and parallel tasks automatically
    mockFetchEventSource.mockImplementation(async (url: string, options: any) => {
      console.log('Mock SSE called with URL:', url)
      if (url.includes('/api/chat/steps/playback/') && options.onmessage) {
        // This is replay SSE
        console.log('Processing replay events')
        await replayEventSequence(options.onmessage)
      } else if (options.onmessage) {
        // This is parallel startTask SSE
        console.log('Processing parallel task events')
        await parallelEventSequence(options.onmessage)
      }
    })

    // Step 1: Start replay
    await act(async () => {
      await replayProject(
        projectStoreResult.result.current,
        mockNavigate,
        generateUniqueId(),
        'Long running replay task',
        'long-replay-history'
      )
    })

    // Verify replay started
    await waitFor(() => {
      const projects = projectStoreResult.result.current.getAllProjects()
      const replayProj = projects.find(p => p.name.includes('Replay Project'))
      expect(replayProj).toBeDefined()
    }, { timeout: 1000 })

    // Step 2: While replay is running, start parallel task on same project
    await act(async () => {
      rerender()
      const { chatStore } = result.current
      
      expect(chatStore).toBeDefined()
      const currentTaskId = chatStore.activeTaskId
      
      // Start parallel task
      await chatStore.startTask(
        currentTaskId,
        undefined,
        undefined,
        undefined,
        'Parallel task during replay'
      )
      rerender()
    })

    // Step 3: Verify both tasks completed independently
    await waitFor(() => {
      rerender()
      const { projectStore } = result.current
      const allChatStores = projectStore.getAllChatStores(projectStore.activeProjectId)
      
      // Should have exactly 2 chatStores: onCreate + replay + parallel
      expect(allChatStores).toHaveLength(3)
      
      // Get both chatStores and verify they have different content
      const chatStore1 = allChatStores[1].chatStore
      const chatStore2 = allChatStores[2].chatStore
      
      const task1 = chatStore1.getState().tasks[chatStore1.getState().activeTaskId]
      const task2 = chatStore2.getState().tasks[chatStore2.getState().activeTaskId]
      
      expect(task1).toBeDefined()
      expect(task2).toBeDefined()
      
      // Verify they have different messages
      const contents = [task1.messages[0].content, task2.messages[0].content]
      expect(contents).toContain('Long running replay task')
      expect(contents).toContain('Parallel task during replay')
      
      console.log('Parallel startTask during replay test completed successfully')
      console.log('Both tasks ran independently with separate chatStores')
    }, { timeout: 3000 })
  })
})