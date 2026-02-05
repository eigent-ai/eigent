import { proxyFetchGet } from '@/api/http';
import { useProjectStore } from '@/store/projectStore';
import { useTriggerStore } from '@/store/triggerStore';
import {
  TriggeredTask,
  formatTriggeredTaskMessage,
  useTriggerTaskStore,
} from '@/store/triggerTaskStore';
import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';

/**
 * Hook that queues triggered tasks to their target projects.
 *
 * This provides a modular way to enqueue tasks from:
 * - Webhook triggers
 * - Scheduled triggers
 * - Future: per-project triggers
 *
 * The actual execution is handled by ChatBox's handleSend via the
 * project's queuedMessages system.
 */
export function useTriggerTaskExecutor() {
  const projectStore = useProjectStore();
  const triggerTaskStore = useTriggerTaskStore();

  // Subscribe specifically to webSocketEvent to ensure re-renders when it changes
  const webSocketEvent = useTriggerStore((state) => state.webSocketEvent);
  const clearWebSocketEvent = useTriggerStore(
    (state) => state.clearWebSocketEvent
  );

  // Track if we're currently processing to avoid race conditions
  const isProcessingRef = useRef(false);

  // Keep stable references to store states
  const projectStoreRef = useRef(projectStore);
  const triggerTaskStoreRef = useRef(triggerTaskStore);

  useEffect(() => {
    projectStoreRef.current = projectStore;
    triggerTaskStoreRef.current = triggerTaskStore;
  });

  /**
   * Helper function to load a project from history if it doesn't exist locally.
   * Similar to handleSetActive in HistorySidebar.
   */
  const loadProjectFromHistory = useCallback(
    async (
      projectId: string,
      store: typeof projectStoreRef.current
    ): Promise<boolean> => {
      try {
        console.log(
          '[TriggerTaskExecutor] Project not found locally, attempting to load from history:',
          projectId
        );

        // Fetch grouped history to find the project
        const historyProject = await proxyFetchGet(
          `/api/chat/histories/grouped/${projectId}?include_tasks=true`
        );

        if (!historyProject) {
          console.warn(
            '[TriggerTaskExecutor] Project not found in history:',
            projectId
          );
          return false;
        }

        // Get task IDs and question from history
        const taskIdsList = historyProject.tasks.map(
          (task: any) => task.task_id
        );
        const question =
          historyProject.last_prompt ||
          historyProject.tasks[0]?.question ||
          'Triggered task';
        const historyId = String(historyProject.tasks[0]?.id || '');

        console.log('[TriggerTaskExecutor] Loading project from history:', {
          projectId,
          taskCount: taskIdsList.length,
          historyId,
        });

        // Use replayProject to load the project from history
        store.replayProject(taskIdsList, question, projectId, historyId);

        return true;
      } catch (error) {
        console.error(
          '[TriggerTaskExecutor] Failed to load project from history:',
          error
        );
        return false;
      }
    },
    []
  );

  /**
   * Execute a triggered task by:
   * 1. Creating or selecting a project (loading from history if needed)
   * 2. Adding the message to the project's queue via addQueuedMessage
   * 3. ChatBox will consume and process the queued message via handleSend
   */
  const executeTask = useCallback(
    async (task: TriggeredTask) => {
      console.log(
        '[TriggerTaskExecutor] Executing task:',
        task.id,
        task.triggerName
      );

      // Show toast when execution starts
      toast.info(`Execution started: ${task.triggerName}`, {
        description: 'Processing trigger task...',
      });

      try {
        const store = projectStoreRef.current;
        let targetProjectId = task.projectId;

        // If no project specified, create a new project for this trigger
        if (!targetProjectId) {
          // Create a new project for this triggered task
          const projectName = `Trigger: ${task.triggerName}`;
          const projectDescription = `Auto-created project for ${task.triggerType} trigger execution`;
          targetProjectId = store.createProject(
            projectName,
            projectDescription
          );
          console.log(
            '[TriggerTaskExecutor] Created new project:',
            targetProjectId
          );
        } else {
          // Project ID is specified, check if it exists locally
          const existingProject = store.getProjectById(targetProjectId);

          if (!existingProject) {
            // Project doesn't exist locally, try to load from history
            const loaded = await loadProjectFromHistory(targetProjectId, store);

            if (!loaded) {
              // Could not load from history, create a new project with the same ID
              console.log(
                '[TriggerTaskExecutor] Creating new project for specified ID:',
                targetProjectId
              );
              const projectName = `Trigger: ${task.triggerName}`;
              const projectDescription = `Auto-created project for ${task.triggerType} trigger execution`;
              targetProjectId = store.createProject(
                projectName,
                projectDescription,
                targetProjectId
              );
            }
          }
        }

        // Set this project as active so ChatBox will process the queue
        store.setActiveProject(targetProjectId);

        // Format the message with all context (uses task.taskPrompt from the server)
        const formattedMessage = formatTriggeredTaskMessage(task);

        console.log(
          '[TriggerTaskExecutor] Adding message to project queue:',
          formattedMessage.substring(0, 100) + '...'
        );

        // Add message to the project's queue - ChatBox will process it via handleSend
        const queuedTaskId = store.addQueuedMessage(
          targetProjectId,
          formattedMessage,
          [],
          task.executionId
        );

        if (!queuedTaskId) {
          throw new Error('Failed to add message to project queue');
        }

        // NOTE: We don't mark the trigger task as completed here.
        // The task remains in triggerTaskStore.currentTask until the chat task actually completes.
        // This allows us to track the execution status properly.
        // The execution mapping will be registered in ChatBox when we know the actual chat task ID.

        toast.success(`Queued: ${task.triggerName}`, {
          description: 'Task has been added to the project queue',
        });

        console.log(
          '[TriggerTaskExecutor] Task queued successfully:',
          task.id,
          '-> queuedTaskId:',
          queuedTaskId
        );
      } catch (error: any) {
        console.error('[TriggerTaskExecutor] Task queueing failed:', error);
        triggerTaskStoreRef.current.failTask(
          task.id,
          error?.message || 'Queueing failed'
        );
        toast.error(`Trigger failed: ${task.triggerName}`, {
          description: error?.message || 'Unknown error',
        });
      }
    },
    [loadProjectFromHistory]
  );

  /**
   * Process the next task in the queue
   */
  const processNextTask = useCallback(async () => {
    if (isProcessingRef.current) {
      console.log('[TriggerTaskExecutor] Already processing, skipping');
      return;
    }

    // Use getState() to get the latest Zustand state directly
    // This is important because the React-subscribed state may be stale
    // when this function is called immediately after enqueueTask
    const store = useTriggerTaskStore.getState();

    // Check if there's a current task running
    if (store.currentTask) {
      console.log('[TriggerTaskExecutor] Task already running, waiting');
      return;
    }

    // Dequeue the next pending task
    const nextTask = store.dequeueTask();
    if (!nextTask) {
      console.log('[TriggerTaskExecutor] No pending tasks to dequeue');
      return; // No pending tasks
    }

    isProcessingRef.current = true;
    try {
      await executeTask(nextTask);
    } finally {
      isProcessingRef.current = false;

      // Check if there are more tasks to process
      // Small delay to avoid overwhelming the system
      setTimeout(() => {
        const currentState = useTriggerTaskStore.getState();
        const remaining = currentState.taskQueue.filter(
          (t) => t.status === 'pending'
        );
        if (remaining.length > 0) {
          processNextTask();
        }
      }, 1000);
    }
  }, [executeTask]);

  // Watch for new tasks added to the queue via WebSocket events
  useEffect(() => {
    if (webSocketEvent) {
      console.log(
        '[TriggerTaskExecutor] WebSocket event received:',
        webSocketEvent
      );

      // Format the message before enqueuing
      const formattedMessage = formatTriggeredTaskMessage({
        id: '', // Will be assigned by enqueueTask
        triggerId: webSocketEvent.triggerId,
        triggerName: webSocketEvent.triggerName,
        taskPrompt: webSocketEvent.taskPrompt,
        executionId: webSocketEvent.executionId,
        triggerType: webSocketEvent.triggerType,
        projectId: webSocketEvent.projectId,
        inputData: webSocketEvent.inputData,
        timestamp: Date.now(),
        status: 'pending' as import('@/types').ExecutionStatus,
      });

      // Enqueue the task (convert triggerType literal to TriggerType enum)
      triggerTaskStore.enqueueTask({
        triggerId: webSocketEvent.triggerId,
        triggerName: webSocketEvent.triggerName,
        taskPrompt: webSocketEvent.taskPrompt,
        executionId: webSocketEvent.executionId,
        triggerType: webSocketEvent.triggerType,
        projectId: webSocketEvent.projectId,
        inputData: webSocketEvent.inputData,
        formattedMessage,
      });

      // Clear the event after processing
      clearWebSocketEvent();

      // Start processing
      processNextTask();
    }
  }, [webSocketEvent, clearWebSocketEvent, processNextTask, triggerTaskStore]);

  // Also process on mount if there are pending tasks
  // useEffect(() => {
  //     const pending = triggerTaskStore.taskQueue.filter(t => t.status === 'pending');
  //     if (pending.length > 0) {
  //         processNextTask();
  //     }
  // }, []);

  return {
    /** Manually trigger a task execution (useful for testing) */
    executeTask,
    /** Process pending tasks */
    processNextTask,
    /** Current task being executed */
    currentTask: triggerTaskStore.currentTask,
    /** Pending tasks in queue */
    pendingTasks: triggerTaskStore.taskQueue.filter(
      (t) => t.status === 'pending'
    ),
    /** Task execution history */
    taskHistory: triggerTaskStore.taskHistory,
  };
}
