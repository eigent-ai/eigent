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


describe('Integration Test: Case 2 - same session new chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    const { result } = renderHook(() => useProjectStore());
    //Reset projectStore
    result.current.getAllProjects().forEach(project => {
      result.current.removeProject(project.id)
    })

    //Create initial Project
    const projectId = result.current.createProject(
      'Complete Journey Test',
      'Testing full flow'
    )
    expect(projectId).toBeDefined()

    // 2. Get chatStore (automatically created)
    let chatStore = result.current.getActiveChatStore(projectId)!
    expect(chatStore).toBeDefined()
    const initiatorTaskId = chatStore.getState().activeTaskId!
    expect(initiatorTaskId).toBeDefined()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("Sequential startTask appends chatStores to same project", async () => {
    const { result, rerender } = renderHook(() => useChatStoreAdapter())
    
    // Setup the events sequence
    const eventSequence = createSSESequence([
      {
        event: {
          step: 'to_sub_tasks',
          data: {
            summary_task: 'Calculator App|Build a simple calculator',
            sub_tasks: [
              { id: 'task-1', content: 'Create UI components', status: '' },
              { id: 'task-2', content: 'Implement calculator logic', status: '' },
            ],
          },
        },
        delay: 100
      },
      {
        event: {
          step: "end", 
          data: "--- Subtask 1760647257350-6021.1 Result ---\nI'm doing well, thank you for asking! How are you today?"
        },
        delay: 400
      }
    ])

    // Mock SSE stream with controlled events
    mockFetchEventSource.mockImplementation(async (url: string, options: any) => {
      if (options.onmessage) {
        await eventSequence(options.onmessage)
      }
    })

    await act(async () => {
      // Complete Flow Test
      const {chatStore, projectStore} = result.current
      const initiatorTaskId = chatStore.activeTaskId;

      //User Message to send
      const userMessage = 'Build a calculator app';

      // 6. Start task
      // NOTE: startTask creates a NEW chatStore and switches to it, the old chatStore is no longer active
      await chatStore.startTask(initiatorTaskId, undefined, undefined, undefined, userMessage)

      //Rerender to get the latest chatStore
      rerender()
    })

    // Test 1: Check initial task creation and first SSE event (to_sub_tasks)
    await waitFor(() => {
      rerender()
      const {chatStore: newChatStore, projectStore} = result.current;
      expect(newChatStore).toBeDefined()
      
      let taskId = newChatStore?.activeTaskId!
      const task = newChatStore?.tasks[taskId]
      expect(taskId).toBeDefined()
      
      if(task) {
        expect(task.hasMessages).toBe(true)
        expect(task.messages[0].content).toBe('Build a calculator app')
        expect(task.status).toBe('pending')
      }

      const updatedTask = newChatStore?.tasks[taskId]
      expect(updatedTask?.summaryTask).toBe('Calculator App|Build a simple calculator')
      expect(updatedTask?.taskInfo).toHaveLength(3)
      expect(updatedTask?.taskRunning).toHaveLength(3)

      //Two chatStores - first initial
      expect(projectStore.getAllChatStores(projectStore.activeProjectId)).toHaveLength(2)
    }, { timeout: 1000 })

    // Test 2: Check progress event has been processed 
    await waitFor(() => {
      rerender()
      const {chatStore: newChatStore} = result.current;
      let taskId = newChatStore?.activeTaskId!
      const task = newChatStore?.tasks[taskId]
      
      // Check if progress message exists in messages or status updates
      // Adjust this based on how your app handles progress events
      expect(task).toBeDefined()
      console.log("Progress test - task status:", task?.status);
    }, { timeout: 1500 })

    // Test 3: Rerender untill status is "finished"
    await waitFor(() => {
      rerender()
      const {chatStore: newChatStore} = result.current;
      let taskId = newChatStore?.activeTaskId!
      const task = newChatStore?.tasks[taskId]
      
      if(task) {
        // Check if task is completed or has final result
        // Adjust these assertions based on your app's behavior
        console.log("End test - task status:", task?.status);
        console.log("End test - task messages:", task?.messages?.length);
      }
      expect(task.status).toBe("finished")
      console.log(task);
    }, { timeout: 2000 });

    //Before starting new chatStore
    const { chatStore, projectStore } = result.current;
    expect(Object.keys(chatStore.tasks)).toHaveLength(1);
    //Initial ChatStore + appendedOne
    expect(projectStore.getAllChatStores(projectStore.activeProjectId)).toHaveLength(2)
    //Make all tasks are skipped after end
    chatStore.tasks[chatStore.activeTaskId].taskRunning.forEach((task:any) => {
      expect(task.status).toBe("skipped")
    })
    chatStore.tasks[chatStore.activeTaskId].taskInfo.forEach((task:any) => {
      expect(task.status).toBe("skipped")
    })

    



    // Test: Start second chat session with different events
    await act(async () => {
      rerender()
      const {chatStore, projectStore} = result.current
      const initiatorTaskId = chatStore.activeTaskId;

      // Setup different events for second session
      const secondEventSequence = createSSESequence([
        {
          event: {
            "step": "confirmed", 
            "data": {"question": "how are you?"}
          },
          delay: 100
        },
        {
          event: {
            step: 'to_sub_tasks',
            data: {
              summary_task: 'Todo App|Build a todo application',
              sub_tasks: [
                { id: 'task-3', content: 'Design todo interface', status: '' },
                { id: 'task-4', content: 'Implement todo logic', status: '' },
              ],
            },
          },
          delay: 200
        },
        {
          event: {
            step: "end", 
            data: "--- Second Task Result ---\nTodo app planning completed!"
          },
          delay: 300
        },
        {
          event: {
            step: "end", 
            data: "--- Subtask 1760647257350-6021.1 Result ---\nI'm doing well, thank you for asking! How are you today?"
          },
          delay: 400
        }
      ])

      // Update the mock for the second call
      mockFetchEventSource.mockImplementation(async (url: string, options: any) => {
        if (options.onmessage) {
          await secondEventSequence(options.onmessage)
        }
      })

      const userMessage = 'Build a todo app';
      await chatStore.startTask(initiatorTaskId, undefined, undefined, undefined, userMessage)
      rerender()
    })

    // Test the second session results
    await waitFor(() => {
      rerender()
      const {chatStore: newChatStore, projectStore} = result.current;
      let taskId = newChatStore?.activeTaskId!
      const task = newChatStore?.tasks[taskId]
      
      if(task) {
        expect(task.messages[0].content).toBe('Build a todo app')
        // Check if the new summary task is set correctly
        expect(task.summaryTask).toBe('Todo App|Build a todo application')
      }
      
      // Should now have 3 chat stores (initial + 2 task sessions)
      expect(projectStore.getAllChatStores(projectStore.activeProjectId)).toHaveLength(3)
    }, { timeout: 1500 })

    // CHECK POST End State of Run 2
    await waitFor(() => {
      rerender()
      const {chatStore: newChatStore} = result.current;
      let taskId = newChatStore?.activeTaskId!
      const task = newChatStore?.tasks[taskId]
      
      if(task) {
        // Check if task is completed or has final result
        // Adjust these assertions based on your app's behavior
        console.log("End test 2 - task status:", task?.status);
        console.log("End test 2 - task messages:", task?.messages?.length);
      }
      expect(task.status).toBe("finished")
      console.log(task);
    }, { timeout: 2000 });

    //Before starting new chatStore
    const { chatStore:secondChatStore } = result.current;
    expect(Object.keys(secondChatStore.tasks)).toHaveLength(1);
    //Initial ChatStore + appendedOne
    expect(projectStore.getAllChatStores(projectStore.activeProjectId)).toHaveLength(3)
    //Make all tasks are skipped after end
    secondChatStore.tasks[secondChatStore.activeTaskId].taskRunning.forEach((task:any) => {
      expect(task.status).toBe("skipped")
    })
    secondChatStore.tasks[secondChatStore.activeTaskId].taskInfo.forEach((task:any) => {
      expect(task.status).toBe("skipped")
    })
  })

  it("should handle individual SSE events with precise timing", async () => {
    const { result, rerender } = renderHook(() => useChatStoreAdapter())
    
    let messageCallback: ((data: any) => void) | null = null
    
    // Mock SSE to capture the callback for manual event triggering
    mockFetchEventSource.mockImplementation((url: string, options: any) => {
      messageCallback = options.onmessage
      // Don't send any events automatically
    })

    // Start the task
    await act(async () => {
      const {chatStore} = result.current
      const initiatorTaskId = chatStore.activeTaskId;
      await chatStore.startTask(initiatorTaskId, undefined, undefined, undefined, 'Test manual events')
      rerender()
    })

    // Manually send first event and test result
    await act(async () => {
      messageCallback?.({
        data: JSON.stringify({
          step: 'to_sub_tasks',
          data: {
            summary_task: 'Manual Test|Testing manual event control',
            sub_tasks: [{ id: 'manual-1', content: 'Manual task 1', status: '' }],
          },
        })
      })
    })

    // Test first event result
    await waitFor(() => {
      rerender()
      const {chatStore} = result.current;
      let taskId = chatStore?.activeTaskId!
      const task = chatStore?.tasks[taskId]
      expect(task?.summaryTask).toBe('Manual Test|Testing manual event control')
    })

    // Send second event and test result
    await act(async () => {
      messageCallback?.({
        data: JSON.stringify({
          step: 'progress',
          data: 'Manual progress update'
        })
      })
    })

    // Test second event result
    await waitFor(() => {
      rerender()
      const {chatStore} = result.current;
      let taskId = chatStore?.activeTaskId!
      const task = chatStore?.tasks[taskId]
      // Add your specific assertions for progress events here
      expect(task).toBeDefined()
    })

    // Send final event
    await act(async () => {
      messageCallback?.({
        data: JSON.stringify({
          step: 'end',
          data: 'Manual test completed successfully'
        })
      })
    })

    // Test final state
    await waitFor(() => {
      rerender()
      const {chatStore} = result.current;
      let taskId = chatStore?.activeTaskId!
      const task = chatStore?.tasks[taskId]
      // Add your specific assertions for end state here
      expect(task).toBeDefined()
    })
  })

  //TODO: Don't let new startTask untill newChatStore appended
  it("Parallel startTask calls with separate chatStores (startTask -> wait for append -> startTask)", async () => {
    const { result, rerender } = renderHook(() => useChatStoreAdapter())
    
    let sseCallCount = 0
    let firstTaskChatStore: any = null
    let secondTaskChatStore: any = null
    
    // Setup SSE events for the first task
    const firstTaskEventSequence = createSSESequence([
      {
        event: {
          step: 'to_sub_tasks',
          data: {
            summary_task: 'First Task|Build a calculator app',
            sub_tasks: [
              { id: 'first-1', content: 'Create calculator UI', status: '' },
              { id: 'first-2', content: 'Implement calc logic', status: '' },
            ],
          },
        },
        delay: 100
      },
      {
        event: {
          step: "end", 
          data: "--- First Task Result ---\nCalculator app completed successfully!"
        },
        delay: 300
      }
    ])

    // Setup SSE events for the second task
    const secondTaskEventSequence = createSSESequence([
      {
        event: {
          step: 'to_sub_tasks',
          data: {
            summary_task: 'Second Task|Build a todo app',
            sub_tasks: [
              { id: 'second-1', content: 'Create todo UI', status: '' },
              { id: 'second-2', content: 'Implement todo logic', status: '' },
            ],
          },
        },
        delay: 100
      },
      {
        event: {
          step: "end", 
          data: "--- Second Task Result ---\nTodo app completed successfully!"
        },
        delay: 300
      }
    ])

    // Mock SSE to handle sequential calls with different events
    mockFetchEventSource.mockImplementation(async (url: string, options: any) => {
      sseCallCount++
      console.log(`SSE Call #${sseCallCount} initiated`)
      
      if (sseCallCount === 1) {
        // First task gets first event sequence
        console.log('Processing first task events')
        if (options.onmessage) {
          await firstTaskEventSequence(options.onmessage)
        }
      } else if (sseCallCount === 2) {
        // Second task gets second event sequence
        console.log('Processing second task events')
        if (options.onmessage) {
          await secondTaskEventSequence(options.onmessage)
        }
      }
    })

    // Get initial chatStore reference
    const { chatStore: initialChatStore, projectStore } = result.current
    const initialChatStoreRef = initialChatStore
    const initiatorTaskId = initialChatStore.activeTaskId

    // Step 1: Start first task
    await act(async () => {
      const userMessage1 = 'Build a calculator app'
      await initialChatStore.startTask(initiatorTaskId, undefined, undefined, undefined, userMessage1)
      rerender()
    })

    // Verify first task started and chatStore was created
    await waitFor(() => {
      rerender()
      const { chatStore: currentChatStore, projectStore } = result.current
      
      // Should have 2 chatStores: initial + first task
      const allChatStores = projectStore.getAllChatStores(projectStore.activeProjectId)
      expect(allChatStores).toHaveLength(2)
      
      // Current chatStore should be different from initial (new one created)
      expect(currentChatStore).not.toBe(initialChatStoreRef)
      firstTaskChatStore = currentChatStore
      
      // Verify first task details
      const activeTaskId = currentChatStore.activeTaskId
      const activeTask = currentChatStore.tasks[activeTaskId]
      expect(activeTask).toBeDefined()
      expect(activeTask.hasMessages).toBe(true)
      expect(activeTask.messages[0].content).toBe('Build a calculator app')
      
    }, { timeout: 1000 })

    // Wait for first task SSE events to process (summary_task)
    await waitFor(() => {
      rerender()
      const { chatStore: currentChatStore } = result.current
      const activeTaskId = currentChatStore.activeTaskId
      const activeTask = currentChatStore.tasks[activeTaskId]
      
      // Check that SSE events have been processed
      expect(activeTask.summaryTask).toBe('First Task|Build a calculator app')
      expect(activeTask.taskInfo).toHaveLength(3) // main task + 2 subtasks
      expect(activeTask.taskRunning).toHaveLength(3)
      
      console.log("First task SSE events processed")
    }, { timeout: 1500 })

    // Wait for first task to complete
    await waitFor(() => {
      rerender()
      const { chatStore: currentChatStore } = result.current
      const activeTaskId = currentChatStore.activeTaskId
      const activeTask = currentChatStore.tasks[activeTaskId]
      
      expect(activeTask.status).toBe("finished")
      
      console.log("First task completed")
    }, { timeout: 2000 })

    // Step 2: Wait for project append to complete before starting second task
    await waitFor(() => {
      rerender()
      const { projectStore } = result.current
      
      // Ensure the project has been properly updated with the appended first chatStore
      const allChatStores = projectStore.getAllChatStores(projectStore.activeProjectId)
      expect(allChatStores).toHaveLength(2)
      
      // Verify the active chatStore is properly set and ready for next task
      const activeChatStore = projectStore.getActiveChatStore(projectStore.activeProjectId)
      expect(activeChatStore).toBeDefined()
      expect(activeChatStore.getState()?.activeTaskId).toBeDefined()
      
      console.log("Project append completed, ready for second task")
    }, { timeout: 1000 })

    // Step 3: Start second task on the same chatStore
    await act(async () => {
      rerender()
      const { chatStore: currentChatStore } = result.current
      const currentInitiatorTaskId = currentChatStore.activeTaskId
      
      const userMessage2 = 'Build a todo app'
      await currentChatStore.startTask(currentInitiatorTaskId, undefined, undefined, undefined, userMessage2)
      rerender()
    })

    // Verify second task started and new chatStore was created
    await waitFor(() => {
      rerender()
      const { chatStore: currentChatStore, projectStore } = result.current
      
      // Should now have 3 chatStores: initial + first task + second task
      const allChatStores = projectStore.getAllChatStores(projectStore.activeProjectId)
      expect(allChatStores).toHaveLength(3)
      
      // Current chatStore should be different from first task chatStore
      expect(currentChatStore).not.toBe(firstTaskChatStore)
      secondTaskChatStore = currentChatStore
      
      // Verify second task details
      const activeTaskId = currentChatStore.activeTaskId
      const activeTask = currentChatStore.tasks[activeTaskId]
      expect(activeTask).toBeDefined()
      expect(activeTask.hasMessages).toBe(true)
      expect(activeTask.messages[0].content).toBe('Build a todo app')
      
    }, { timeout: 1000 })

    // Wait for second task SSE events to process (summary_task)
    await waitFor(() => {
      rerender()
      const { chatStore: currentChatStore } = result.current
      const activeTaskId = currentChatStore.activeTaskId
      const activeTask = currentChatStore.tasks[activeTaskId]
      
      // Check that SSE events have been processed
      expect(activeTask.summaryTask).toBe('Second Task|Build a todo app')
      expect(activeTask.taskInfo).toHaveLength(3) // main task + 2 subtasks
      expect(activeTask.taskRunning).toHaveLength(3)
      
      console.log("Second task SSE events processed")
    }, { timeout: 1500 })

    // Wait for second task to complete
    await waitFor(() => {
      rerender()
      const { chatStore: currentChatStore } = result.current
      const activeTaskId = currentChatStore.activeTaskId
      const activeTask = currentChatStore.tasks[activeTaskId]
      
      expect(activeTask.status).toBe("finished")
      
      console.log("Second task completed")
    }, { timeout: 2000 })

    // Final verification: Both chatStores should have separate states
    const { projectStore: finalProjectStore } = result.current
    const allFinalChatStores = finalProjectStore.getAllChatStores(finalProjectStore.activeProjectId)
    
    // Verify we have 3 separate chatStores with their own states
    expect(allFinalChatStores).toHaveLength(3)
    expect(sseCallCount).toBe(2) // Two separate SSE calls
    
    // Verify each chatStore has its own task with different content
    expect(firstTaskChatStore).not.toBe(secondTaskChatStore)
    
    // Get the current state of chatStores from the project store to verify final states
    const [initialChatStoreFromProject, firstChatStoreFromProject, secondChatStoreFromProject] = allFinalChatStores
    
    // Verify first chatStore state (should be the second in the array after initial)
    const firstTaskId = firstChatStoreFromProject.chatStore.getState().activeTaskId
    const firstTask = firstChatStoreFromProject.chatStore.getState().tasks[firstTaskId]
    expect(firstTask.messages[0].content).toBe('Build a calculator app')
    expect(firstTask.summaryTask).toBe('First Task|Build a calculator app')
    
    // Verify second chatStore state (should be the third in the array)
    const secondTaskId = secondChatStoreFromProject.chatStore.getState().activeTaskId
    const secondTask = secondChatStoreFromProject.chatStore.getState().tasks[secondTaskId]
    expect(secondTask.messages[0].content).toBe('Build a todo app')
    expect(secondTask.summaryTask).toBe('Second Task|Build a todo app')
    
    console.log('Sequential startTask test with separate chatStores completed successfully')
  })
})