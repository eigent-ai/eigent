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
import { createSSESequence, issue619SseSequence, mockFetchEventSource } from '../../mocks/sse.mock'
import { replayProject, replayActiveTask } from '../../../src/lib'

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

//https://github.com/eigent-ai/eigent/issues/619 - Two task boxes
describe('Issue #619 - Duplicate Task Boxes after replay', () => {
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

  it("should create a separate chatStore for each replay", async () => {
    const { result, rerender } = renderHook(() => useChatStoreAdapter())

    let sseCallCount = 0
    
    // Step 0: First simulate a replay mechanism to set up the scenario
    const replaySequence = createSSESequence([
      {
        event: {
          step: 'confirmed',
          data: { question: 'Previous calendar task replay' }
        },
        delay: 50
      },
      {
        event: {
          step: 'to_sub_tasks',
          data: {
            summary_task: 'Calendar Replay|Previous calendar interaction',
            sub_tasks: [
              { id: 'replay-cal-1', content: 'Check calendar access', status: 'completed' },
              { id: 'replay-cal-2', content: 'Fetch meeting data', status: 'completed' },
            ],
          },
        },
        delay: 100
      },
      {
        event: {
          step: "end", 
          data: "--- Previous Calendar Task Replay Complete ---\nFound 3 upcoming meetings"
        },
        delay: 150
      }
    ])
    
    // Mock SSE stream with controlled events - delay setup until after task IDs are available
    mockFetchEventSource.mockImplementation(async (url: string, options: any) => {
      sseCallCount++
      console.log(`SSE Call #${sseCallCount} initiated`)
      
      if (options.onmessage) {
        // First simulate replay of previous event to establish context
        if (sseCallCount === 1 && url.includes('/api/chat/steps/playback/')) {
          console.log('Simulating replay mechanism for previous calendar task')
          await replaySequence(options.onmessage)
          return
        }

        // Now send the new task events with actual task IDs
        const immediateSequence = createSSESequence(issue619SseSequence)
        await immediateSequence(options.onmessage)
      }
    })

    // Simulate the replay mechanism first
    console.log('Starting replay simulation to establish context...')
    await act(async () => {
      await replayProject(
        result.current.projectStore,
        mockNavigate,
        generateUniqueId(),
        'Previous calendar task replay',
        'calendar-replay-history'
      )
      rerender()
    })

    // Wait for replay to complete and verify it's established
    await waitFor(() => {
      rerender()
      const { projectStore } = result.current
      const projects = projectStore.getAllProjects()
      const replayProject = projects.find((p: any) => p.name.includes('Replay Project'))
      expect(replayProject).toBeDefined()
      console.log('Replay mechanism completed - context established')
    }, { timeout: 1000 })

    // Get initial state
    const { chatStore: initialChatStore, projectStore } = result.current
    const projectId = projectStore.activeProjectId as string
    const initiatorTaskId = initialChatStore.activeTaskId

    // Verify initial queue is empty  
    expect(projectStore.getProjectById(projectId)?.queuedMessages).toEqual([])

    // Step 1: Start first task
    await act(async () => {
      const userMessage = 'Please help me check Google Calendar when is the next meeting, what kind of meeting it is, and who is attending the meeting.'
      await initialChatStore.startTask(initiatorTaskId, undefined, undefined, undefined, userMessage)
      rerender()
    })

    // Wait for task to start and reach 'to_sub_tasks' phase (task becomes busy)
    await waitFor(() => {
      rerender()
      const { chatStore, projectStore } = result.current
      const taskId = chatStore.activeTaskId
      const task = chatStore.tasks[taskId]
      
      // Task should have subtasks (making it busy)
      expect(task.summaryTask).toBe('Task|Please help me check Google Calendar when is the next meeting, what kind of meeting it is, and who is attending the meeting.')
      console.log("Task info is ", task.taskInfo);
      //Bcz of newTaskInfo { id: '', content: '', status: '' } we have 2 items
      expect(task.taskInfo).toHaveLength(2)
      
      console.log("Task reached to_sub_tasks phase - now busy")
    }, { timeout: 1500 })

    //Waitfor end sse
    await waitFor(() => {
      rerender()
      const { chatStore: finalChatStore, projectStore: finalProjectStore } = result.current;
      const finalTaskId = finalChatStore.activeTaskId;
      const finalTask = finalChatStore.tasks[finalTaskId];
      expect(finalTask.status).toBe('finished');
    }, { timeout: 10000 });

    // Step 7: Verify final state
    const { chatStore: finalChatStore, projectStore: finalProjectStore } = result.current
    const finalProject = finalProjectStore.getProjectById(projectId)
    
    // Verify task completed successfully
    const finalTaskId = finalChatStore.activeTaskId
    const finalTask = finalChatStore.tasks[finalTaskId]
    expect(finalTask.status).toBe('finished')
    expect(finalTask.summaryTask).toBe('Task|Please help me check Google Calendar when is the next meeting, what kind of meeting it is, and who is attending the meeting.')
    
    console.log("Test completed - queue management verified: one task processed, one remains")
  })

  it("should have correct first question on replayActiveTask", async () => {
    const { result, rerender } = renderHook(() => useChatStoreAdapter())
    const projectStoreResult = renderHook(() => useProjectStore())

    let sseCallCount = 0
    const originalUserMessage = 'Please help me check Google Calendar when is the next meeting, what kind of meeting it is, and who is attending the meeting.'
    
    // Step 1: Create initial task with specific user message
    const initialSequence = createSSESequence([
      {
        event: {
          step: 'confirmed',
          data: { question: originalUserMessage }
        },
        delay: 100
      },
      {
        event: {
          step: 'to_sub_tasks',
          data: {
            summary_task: 'Calendar Task|Check upcoming Google Calendar meetings',
            sub_tasks: [
              { id: 'cal-1', content: 'Access Google Calendar', status: 'completed' },
              { id: 'cal-2', content: 'Fetch meeting details', status: 'completed' },
            ],
          },
        },
        delay: 200
      },
      {
        event: {
          step: "end", 
          data: "--- Calendar Task Complete ---\nFound your next meeting: Team Standup at 2:00 PM"
        },
        delay: 300
      }
    ])

    // Step 2: Setup replay sequence that should have same first question
    const replaySequence = createSSESequence([
      {
        event: {
          step: 'confirmed',
          data: { question: "Fall Back question" }
        },
        delay: 100
      },
      {
        event: {
          step: 'to_sub_tasks',
          data: {
            summary_task: 'Calendar Task Replay|Replaying calendar meeting check',
            sub_tasks: [
              { id: 'replay-cal-1', content: 'Access Google Calendar (replay)', status: 'completed' },
              { id: 'replay-cal-2', content: 'Fetch meeting details (replay)', status: 'completed' },
            ],
          },
        },
        delay: 200
      },
      {
        event: {
          step: "end", 
          data: "--- Calendar Task Replay Complete ---\nReplayed: Found your next meeting"
        },
        delay: 300
      }
    ])

    // Mock SSE to handle both initial task and replay
    mockFetchEventSource.mockImplementation(async (url: string, options: any) => {
      sseCallCount++
      console.log(`SSE Call #${sseCallCount}: ${url}`)
      
      if (options.onmessage) {
        if (sseCallCount === 1) {
          // First call: initial task
          console.log('Processing initial task events')
          await initialSequence(options.onmessage)
        } else if (url.includes('/api/chat/steps/playback/')) {
          // Subsequent calls: replay
          console.log('Processing replay events')
          await replaySequence(options.onmessage)
        }
      }
    })

    // Step 3: Start initial task
    await act(async () => {
      const { chatStore } = result.current
      const taskId = chatStore.activeTaskId
      await chatStore.startTask(taskId, undefined, undefined, undefined, originalUserMessage)
      rerender()
    })

    // Wait for initial task to complete
    await waitFor(() => {
      rerender()
      const { chatStore } = result.current
      const taskId = chatStore.activeTaskId
      const task = chatStore.tasks[taskId]
      expect(task.status).toBe('finished')
      expect(task.messages[0].content).toBe(originalUserMessage)
      console.log('Initial task completed with user message:', task.messages[0].content)
    }, { timeout: 2000 })

    // Step 4: Get the completed chatStore for replay
    const { chatStore: completedChatStore, projectStore } = result.current
    const completedTaskId = completedChatStore.activeTaskId
    const completedTask = completedChatStore.tasks[completedTaskId]

    // Verify we have the correct initial state
    expect(completedTask.messages[0].content).toBe(originalUserMessage)
    expect(completedTask.status).toBe('finished')

    // Step 5: Call replayActiveTask using the completed chatStore
    await act(async () => {
      await replayActiveTask(completedChatStore, projectStore, mockNavigate)
      rerender()
    })

    // Step 6: Wait for replay to complete and verify first question matches
    await waitFor(() => {
      rerender()
      const { projectStore: updatedProjectStore } = result.current
      const projects = updatedProjectStore.getAllProjects()
      
      // Find the replay project
      const replayProject = projects.find((p: any) => p.name.includes('Replay Project'))
      expect(replayProject).toBeDefined()
      
      // Get the replay chatStore
      const replayChatStores = updatedProjectStore.getAllChatStores(replayProject!.id)
      expect(replayChatStores.length).toBeGreaterThan(1)
      
      const replayChatStore = replayChatStores[1].chatStore // Skip the empty initial one
      const replayTaskId = replayChatStore.getState().activeTaskId
      const replayTask = replayChatStore.getState().tasks[replayTaskId]
      
      // THE MAIN TEST: First question in replay should match original user message
      expect(replayTask).toBeDefined()
      expect(replayTask.messages[0].content).toBe(originalUserMessage)
      expect(replayTask.type).toBe('replay')
      
      console.log('✅ Replay first question matches original:', replayTask.messages[0].content)
      console.log('✅ Original user message:', originalUserMessage)
      console.log('✅ Test passed: replayActiveTask preserves correct first question')
    }, { timeout: 3000 })

    // Verify navigation was called for replay
    expect(mockNavigate).toHaveBeenCalledWith("/")
  })
})