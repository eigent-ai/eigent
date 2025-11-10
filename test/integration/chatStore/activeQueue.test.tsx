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
import { mockFetchEventSource, createSSESequence } from '../../mocks/sse.mock'

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

describe("Case 3: Add to the workforce queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    const { result } = renderHook(() => useProjectStore());
    //Reset projectStore
    result.current.getAllProjects().forEach(project => {
      result.current.removeProject(project.id)
    })

    //Create initial Project
    const projectId = result.current.createProject(
      'Queue Test Project',
      'Testing message queue functionality'
    )
    expect(projectId).toBeDefined()

    // Get chatStore (automatically created)
    let chatStore = result.current.getActiveChatStore(projectId)!
    expect(chatStore).toBeDefined()
    const initiatorTaskId = chatStore.getState().activeTaskId!
    expect(initiatorTaskId).toBeDefined()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("should queue messages when task is busy and process them after completion", async () => {
    const { result, rerender } = renderHook(() => useChatStoreAdapter())

    let sseCallCount = 0
    let queuedTaskIds: string[] = []
    
    // Mock SSE stream with controlled events - delay setup until after task IDs are available
    mockFetchEventSource.mockImplementation(async (url: string, options: any) => {
      sseCallCount++
      console.log(`SSE Call #${sseCallCount} initiated`)
      
      if (options.onmessage) {
        // First send the immediate events (confirmed, to_sub_tasks, end)
        const immediateSequence = createSSESequence([
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
                  { id: 'task-1', content: 'Create UI components', status: '' },
                  { id: 'task-2', content: 'Implement calculator logic', status: '' },
                ],
              },
            },
            delay: 200
          },
          {
            event: {
              step: "end", 
              data: "--- Calculator Task Result ---\nCalculator app completed successfully!"
            },
            delay: 300
          }
        ])
        await immediateSequence(options.onmessage)
        
        // Wait for queuedTaskIds to be populated, then send queue-related events
        const checkForTaskIds = () => {
          return new Promise<void>((resolve, reject) => {
            const startTime = Date.now()
            const timeout = 5000 // 5 second timeout
            const pollForIds = () => {
              if (queuedTaskIds.length > 0) {
                console.log(`Found queued task IDs: ${queuedTaskIds}`)
                resolve()
              } else if (Date.now() - startTime > timeout) {
                reject(new Error('Timeout waiting for queued task IDs'))
              } else {
                setTimeout(pollForIds, 50) // Check every 50ms
              }
            }
            pollForIds()
          })
        }
        
        await checkForTaskIds()
        
        // Now send the queue-related events with actual task IDs
        const queueSequence = createSSESequence([
          {
            event: {
              step: 'new_task_state',
              data: {
                task_id: queuedTaskIds[0], // First queued task ID
                content: 'Build a calculator app 2',
                project_id: currentProjectId
              }
            },
            delay: 100
          },
          {
            event: {
              step: 'remove_task',
              data: {
                task_id: queuedTaskIds[0], // Remove first task from queue
                project_id: currentProjectId
              }
            },
            delay: 200
          },
          {
            event: {
              step: 'confirmed',
              data: { question: 'Build a calculator app 2' }
            },
            delay: 100
          },
          {
            event: {
              step: 'to_sub_tasks',
              data: {
                summary_task: 'Calculator App|Build a simple calculator 2',
                sub_tasks: [
                  { id: 'task-1', content: 'Create UI components 2', status: '' },
                  { id: 'task-2', content: 'Implement calculator logic 2', status: '' },
                ],
              },
            },
            delay: 200
          },
          {
            event: {
              step: "end", 
              data: "--- Queue Result ---\nCalculator app completed successfully!"
            },
            delay: 300
          }
        ])
        await queueSequence(options.onmessage)
      }
    })

    // Get initial state
    const { chatStore: initialChatStore, projectStore } = result.current
    const projectId = projectStore.activeProjectId as string
    const initiatorTaskId = initialChatStore.activeTaskId

    // Verify initial queue is empty
    expect(projectStore.getProjectById(projectId)?.queuedMessages).toEqual([])

    // Store projectId in outer scope for use in SSE mock
    let currentProjectId = projectId

    // Step 1: Start first task
    await act(async () => {
      const userMessage = 'Build a calculator app'
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
      expect(task.summaryTask).toBe('Calculator App|Build a simple calculator')
      expect(task.taskInfo).toHaveLength(3)
      console.log("Task reached to_sub_tasks phase - now busy")
    }, { timeout: 1500 })

    // Step 2: Add messages to queue while task is busy
    await act(async () => {
      rerender()
      const { projectStore } = result.current
      const projectId = projectStore.activeProjectId as string
      
      // Add first queued message
      const tempMessageContent1 = 'Build a todo app'
      const currentAttaches1: any[] = []
      const new_task_id_1 = projectStore.addQueuedMessage(
        projectId,
        tempMessageContent1,
        currentAttaches1
      )
      
      // Add second queued message
      const tempMessageContent2 = 'Create a weather app'
      const currentAttaches2: any[] = []
      const new_task_id_2 = projectStore.addQueuedMessage(
        projectId,
        tempMessageContent2,
        currentAttaches2
      )
      
      expect(new_task_id_1).toBeDefined()
      expect(new_task_id_2).toBeDefined()
      expect(new_task_id_1).not.toBe(new_task_id_2)
      
      // Store task IDs for SSE events
      queuedTaskIds = [new_task_id_1!, new_task_id_2!]
      
      console.log("Added messages to queue:", { new_task_id_1, new_task_id_2 })
    })

    // Step 3: Verify messages are in queue
    await waitFor(() => {
      rerender()
      const { projectStore } = result.current
      const project = projectStore.getProjectById(projectId)
      
      expect(project?.queuedMessages).toHaveLength(2)
      expect(project?.queuedMessages?.[0].content).toBe('Build a todo app')
      expect(project?.queuedMessages?.[1].content).toBe('Create a weather app')
      
      console.log("Queue verified with 2 messages")
    })

    // Step 4: Wait for task completion
    await waitFor(() => {
      rerender()
      const { chatStore } = result.current
      const taskId = chatStore.activeTaskId
      const task = chatStore.tasks[taskId]
      
      expect(task.status).toBe('finished')
      console.log("Main task completed")
    }, { timeout: 2000 })

    // Step 5: Wait for new_task_state event to process queue
    await waitFor(() => {
      rerender()
      //Get new appended chatStore
      const { chatStore } = result.current
      const taskId = chatStore.activeTaskId
      const task = chatStore.tasks[taskId]
      
      // Look for new_task_state in messages
      const hasNewTaskState = task.messages.some((m: any) => m.content === 'Build a calculator app 2')      
      expect(hasNewTaskState).toBe(true)
      console.log("new_task_state event detected - new chat created")
    }, { timeout: 3000 })

    // Step 6: Wait for remove_task event to clear queue
    await waitFor(() => {
      rerender()
      const { projectStore } = result.current
      const project = projectStore.getProjectById(projectId)
      
      // After remove_task event, first queued message should be removed, leaving 1 message
      expect(project?.queuedMessages).toHaveLength(1)
      expect(project?.queuedMessages?.[0].content).toBe('Create a weather app')
      
      console.log("Queue processed - first message removed")
    }, { timeout: 4000 });

    //Waitfor end sse
    await waitFor(() => {
      rerender()
      const { chatStore: finalChatStore, projectStore: finalProjectStore } = result.current;
      const finalTaskId = finalChatStore.activeTaskId;
      const finalTask = finalChatStore.tasks[finalTaskId];
      expect(finalTask.status).toBe('finished');
    }, { timeout: 2000 })

    // Step 7: Verify final state
    const { chatStore: finalChatStore, projectStore: finalProjectStore } = result.current
    const finalProject = finalProjectStore.getProjectById(projectId)
    
    // Queue should have 1 remaining message (the second one)
    expect(finalProject?.queuedMessages).toHaveLength(1)
    expect(finalProject?.queuedMessages?.[0].content).toBe('Create a weather app')
    
    // Verify task completed successfully
    const finalTaskId = finalChatStore.activeTaskId
    const finalTask = finalChatStore.tasks[finalTaskId]
    expect(finalTask.status).toBe('finished')
    //Not to be because its a new chatStore
    expect(finalTask.summaryTask).not.toBe('Calculator App|Build a simple calculator')
    expect(finalTask.summaryTask).toBe('Calculator App|Build a simple calculator 2')
    
    console.log("Test completed - queue management verified: one task processed, one remains")
  })

  it("should handle multiple queue additions and removals correctly", async () => {
    const { result, rerender } = renderHook(() => useChatStoreAdapter())
    const { projectStore } = result.current
    const projectId = projectStore.activeProjectId as string

    // Verify initial state
    expect(projectStore.getProjectById(projectId)?.queuedMessages).toEqual([])

    await act(async () => {
      // Add multiple messages to queue
      const messages = [
        'Build a calculator',
        'Create a todo app', 
        'Develop a weather app',
        'Make a chat application'
      ]

      const taskIds: string[] = []
      
      messages.forEach((message, index) => {
        const taskId = projectStore.addQueuedMessage(
          projectId,
          message,
          []
        )
        taskIds.push(taskId)
        expect(taskId).toBeDefined()
      })

      // Verify all messages are queued
      const project = projectStore.getProjectById(projectId)
      expect(project?.queuedMessages).toHaveLength(4)
      
      messages.forEach((message, index) => {
        expect(project?.queuedMessages?.[index].content).toBe(message)
        expect(project?.queuedMessages?.[index].task_id).toBe(taskIds[index])
      })

      // Remove middle message
      projectStore.removeQueuedMessage(projectId, taskIds[1])
      
      // Verify removal
      const updatedProject = projectStore.getProjectById(projectId)
      expect(updatedProject?.queuedMessages).toHaveLength(3)
      expect(updatedProject?.queuedMessages?.map((m: any) => m.content)).toEqual([
        'Build a calculator',
        'Develop a weather app',
        'Make a chat application'
      ])

      // Remove first message
      projectStore.removeQueuedMessage(projectId, taskIds[0])
      
      // Verify second removal
      const finalProject = projectStore.getProjectById(projectId)
      expect(finalProject?.queuedMessages).toHaveLength(2)
      expect(finalProject?.queuedMessages?.map((m: any) => m.content)).toEqual([
        'Develop a weather app',
        'Make a chat application'
      ])
    })
  })

  it("should restore queued message when removal fails", async () => {
    const { result, rerender } = renderHook(() => useChatStoreAdapter())
    const { projectStore } = result.current
    const projectId = projectStore.activeProjectId as string

    await act(async () => {
      // Add a message to queue
      const messageContent = 'Test message for restoration'
      const attachments: any[] = [{ fileName: 'test.txt', filePath: '/test/path' }]
      
      const taskId = projectStore.addQueuedMessage(
        projectId,
        messageContent,
        attachments
      )

      // Verify message is queued
      let project = projectStore.getProjectById(projectId)
      expect(project?.queuedMessages).toHaveLength(1)
      expect(project?.queuedMessages?.[0].content).toBe(messageContent)
      expect(project?.queuedMessages?.[0].attaches).toEqual(attachments)

      // Store original message for comparison
      const originalMessage = project?.queuedMessages?.[0]

      // Remove the message (this would normally trigger an API call)
      projectStore.removeQueuedMessage(projectId, taskId)

      // Verify optimistic removal
      project = projectStore.getProjectById(projectId)
      expect(project?.queuedMessages).toHaveLength(0)

      // Simulate restoration (as would happen on API failure)
      if (originalMessage) {
        projectStore.restoreQueuedMessage(projectId, {
          task_id: originalMessage.task_id,
          content: originalMessage.content,
          timestamp: originalMessage.timestamp,
          attaches: originalMessage.attaches
        })
      }

      // Verify message is restored
      project = projectStore.getProjectById(projectId)
      expect(project?.queuedMessages).toHaveLength(1)
      expect(project?.queuedMessages?.[0].content).toBe(messageContent)
      expect(project?.queuedMessages?.[0].attaches).toEqual(attachments)
      expect(project?.queuedMessages?.[0].task_id).toBe(taskId)
    })
  })

  it("should maintain queue order and timestamps correctly", async () => {
    const { result, rerender } = renderHook(() => useChatStoreAdapter())
    const { projectStore } = result.current
    const projectId = projectStore.activeProjectId as string

    await act(async () => {
      const messages = ['First message', 'Second message', 'Third message']
      const taskIds: string[] = []
      const timestamps: number[] = []

      // Add messages with small delays to ensure different timestamps
      for (let i = 0; i < messages.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 10))
        
        const taskId = projectStore.addQueuedMessage(
          projectId,
          messages[i],
          []
        )
        taskIds.push(taskId)

        const project = projectStore.getProjectById(projectId)
        const addedMessage = project?.queuedMessages?.find((m: any) => m.task_id === taskId)
        if (addedMessage) {
          timestamps.push(addedMessage.timestamp)
        }
      }

      // Verify order and timestamps
      const project = projectStore.getProjectById(projectId)
      expect(project?.queuedMessages).toHaveLength(3)

      project?.queuedMessages?.forEach((message: any, index: number) => {
        expect(message.content).toBe(messages[index])
        expect(message.task_id).toBe(taskIds[index])
        expect(message.timestamp).toBe(timestamps[index])
        
        // Verify timestamps are in ascending order
        if (index > 0) {
          expect(message.timestamp).toBeGreaterThanOrEqual(timestamps[index - 1])
        }
      })
    })
  })

  it("should handle confirmed -> subtasks -> end -> new_task_state -> remove_task sequence with queue processing", async () => {
    const { result, rerender } = renderHook(() => useChatStoreAdapter())
    
    let comprehensiveQueuedTaskIds: string[] = []

    // Get initial state
    const { chatStore: initialChatStore, projectStore } = result.current
    const projectId = projectStore.activeProjectId as string
    const initiatorTaskId = initialChatStore.activeTaskId

    // Verify initial queue is empty  
    expect(projectStore.getProjectById(projectId)?.queuedMessages).toEqual([])

    // Mock SSE stream with controlled events - delay queue-related events until task IDs are available
    mockFetchEventSource.mockImplementation(async (url: string, options: any) => {
      if (options.onmessage) {
        // First send the immediate events (confirmed, to_sub_tasks, end)
        const immediateSequence = createSSESequence([
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
                summary_task: 'Calculator App|Build a comprehensive calculator',
                sub_tasks: [
                  { id: 'calc-ui', content: 'Create calculator UI', status: '' },
                  { id: 'calc-logic', content: 'Implement calculation logic', status: '' },
                  { id: 'calc-tests', content: 'Write unit tests', status: '' },
                ],
              },
            },
            delay: 200
          },
          {
            event: {
              step: "end", 
              data: "--- Task Completed Successfully ---\nCalculator app development finished!"
            },
            delay: 300
          }
        ])
        await immediateSequence(options.onmessage)
        
        // Wait for comprehensiveQueuedTaskIds to be populated, then send queue-related events
        const checkForTaskIds = () => {
          return new Promise<void>((resolve, reject) => {
            const startTime = Date.now()
            const timeout = 5000 // 5 second timeout
            const pollForIds = () => {
              if (comprehensiveQueuedTaskIds.length > 0) {
                console.log(`Found comprehensive queued task IDs: ${comprehensiveQueuedTaskIds}`)
                resolve()
              } else if (Date.now() - startTime > timeout) {
                reject(new Error('Timeout waiting for comprehensive queued task IDs'))
              } else {
                setTimeout(pollForIds, 50) // Check every 50ms
              }
            }
            pollForIds()
          })
        }
        
        await checkForTaskIds()
        
        // Now send the queue-related events with actual task IDs
        const queueSequence = createSSESequence([
          {
            event: {
              step: 'confirmed',
              data: {
                task_id: comprehensiveQueuedTaskIds[0], // First queued task ID
                question: 'Build a todo application',
              }
            },
            delay: 100
          },
          {
            event: {
              step: 'new_task_state',
              data: {
                task_id: comprehensiveQueuedTaskIds[0], // First queued task ID
                content: 'Build a todo application',
                project_id: projectId
              }
            },
            delay: 100
          },
          {
            event: {
              step: 'remove_task',
              data: {
                task_id: comprehensiveQueuedTaskIds[0], // Remove first task from queue
                project_id: projectId
              }
            },
            delay: 200
          },
          {
            event: {
              step: "end", 
              data: "--- Task Completed Successfully ---\nCalculator app development finished! 2"
            },
            delay: 300
          }
        ])
        await queueSequence(options.onmessage)
      }
    })

    // Step 1: Start the main task
    await act(async () => {
      const userMessage = 'Build a calculator app'
      await initialChatStore.startTask(initiatorTaskId, undefined, undefined, undefined, userMessage)
      rerender()
    })    
    // Step 2: Wait for confirmed event
    await waitFor(() => {
      rerender()
      const { chatStore } = result.current
      const taskId = chatStore.activeTaskId
      const task = chatStore.tasks[taskId]
      
      // Check for confirmed step
      const hasContent = task.messages.some((m: any) => m.content === 'Build a calculator app')
      expect(hasContent).toBe(true)
      console.log("✓ Confirmed event received")
    }, { timeout: 1000 })

    // Step 3: Wait for subtasks event
    await waitFor(() => {
      rerender()
      const { chatStore } = result.current
      const taskId = chatStore.activeTaskId
      const task = chatStore.tasks[taskId]
      
      // Task should have subtasks
      expect(task.summaryTask).toBe('Calculator App|Build a comprehensive calculator')
      expect(task.taskInfo).toHaveLength(4) // main task + 3 subtasks
      expect(task.taskRunning).toHaveLength(4)
      console.log("✓ Subtasks created")
    }, { timeout: 1500 })

    // Step 4: Add messages to queue while task is in subtasks phase
    await act(async () => {
      rerender()
      const { projectStore } = result.current
      const projectId = projectStore.activeProjectId as string
      
      // Add queued messages
      const tempMessageContent1 = 'Build a todo application'
      const currentAttaches1: any[] = [{ fileName: 'requirements.txt', filePath: '/path/to/req.txt' }]
      const new_task_id_1 = projectStore.addQueuedMessage(
        projectId,
        tempMessageContent1,
        currentAttaches1
      )
      
      const tempMessageContent2 = 'Create a weather dashboard'
      const currentAttaches2: any[] = []
      const new_task_id_2 = projectStore.addQueuedMessage(
        projectId,
        tempMessageContent2,
        currentAttaches2
      )
      
      expect(new_task_id_1).toBeDefined()
      expect(new_task_id_2).toBeDefined()
      
      // Store task IDs for SSE events
      comprehensiveQueuedTaskIds = [new_task_id_1!, new_task_id_2!]
      
      console.log("✓ Messages added to queue during subtasks phase")
    })

    // Step 5: Verify messages are properly queued
    await waitFor(() => {
      rerender()
      const { projectStore } = result.current
      const project = projectStore.getProjectById(projectId)
      
      expect(project?.queuedMessages).toHaveLength(2)
      expect(project?.queuedMessages?.[0].content).toBe('Build a todo application')
      expect(project?.queuedMessages?.[1].content).toBe('Create a weather dashboard')
      expect(project?.queuedMessages?.[0].attaches).toHaveLength(1)
      expect(project?.queuedMessages?.[1].attaches).toHaveLength(0)
      console.log("✓ Queue contains expected messages with attachments")
    })

    // Step 6: Wait for task completion
    await waitFor(() => {
      rerender()
      const { chatStore } = result.current
      const taskId = chatStore.activeTaskId
      const task = chatStore.tasks[taskId]
      
      expect(task.status).toBe('finished')
      console.log("✓ Main task completed")
    }, { timeout: 2000 })

    // Step 7: Wait for new_task_state event (new chat creation)
    await waitFor(() => {
      rerender()
      const { chatStore } = result.current
      const taskId = chatStore.activeTaskId
      const task = chatStore.tasks[taskId]
      
      // Look for new_task_state event
      const hasNewTaskState = task.messages.some((m: any) => m.content === 'Build a todo application')
      expect(hasNewTaskState).toBe(true)
      console.log("✓ new_task_state event received - new chat created")
    }, { timeout: 3000 })

    // Step 8: Wait for remove_task event to process queue
    await waitFor(() => {
      rerender()
      const { projectStore } = result.current
      const project = projectStore.getProjectById(projectId)
      
      // After remove_task event, first queued message should be removed, leaving 1 message
      expect(project?.queuedMessages).toHaveLength(1)
      expect(project?.queuedMessages?.[0].content).toBe('Create a weather dashboard')
      
      console.log("✓ Queue processed - first message removed")
    }, { timeout: 4000 })

    //Waitfor end sse
    await waitFor(() => {
      rerender()
      const { chatStore: finalChatStore, projectStore: finalProjectStore } = result.current;
      const finalTaskId = finalChatStore.activeTaskId;
      const finalTask = finalChatStore.tasks[finalTaskId];
      expect(finalTask.status).toBe('finished');
    }, { timeout: 2000 })

    // Step 9: Final verification
    const { chatStore: finalChatStore, projectStore: finalProjectStore } = result.current
    const finalProject = finalProjectStore.getProjectById(projectId)
    const finalTaskId = finalChatStore.activeTaskId
    const finalTask = finalChatStore.tasks[finalTaskId]
    
    // Queue should have 1 remaining message (the second one)
    expect(finalProject?.queuedMessages).toHaveLength(1)
    expect(finalProject?.queuedMessages?.[0].content).toBe('Create a weather dashboard')
    
    expect(finalTask.status).toBe('finished')
    //This time lets not add sub_task sse
    expect(finalTask.summaryTask).not.toBe('Calculator App|Build a comprehensive calculator')
    
    //Get previous chatStore
    const allChatStores = finalProjectStore.getAllChatStores(finalProjectStore.activeProjectId);
    // Should have initial + first task + second task = 3 chat stores
    expect(allChatStores).toHaveLength(3);
    const [initial, first, second] = allChatStores;
    const originalTaskId = first.chatStore.getState().activeTaskId;
    const originalFinalTask = first.chatStore.getState().tasks[originalTaskId];
    expect(originalFinalTask.summaryTask).toBe('Calculator App|Build a comprehensive calculator')
    expect(originalFinalTask.taskInfo).toHaveLength(4)
    
    // Verify all subtasks are properly marked as skipped after completion
    originalFinalTask.taskRunning.forEach((task: any) => {
      expect(task.status).toBe("skipped")
    })
    originalFinalTask.taskInfo.forEach((task: any) => {
      expect(task.status).toBe("skipped")
    })
    
    console.log("✓ Complete test sequence verified: confirmed → subtasks → end → new_task_state → remove_task → one task processed, one remains")
  })
})