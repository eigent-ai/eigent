import { useEffect, useRef, useCallback } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useTriggerTaskStore, TriggeredTask, formatTriggeredTaskMessage } from '@/store/triggerTaskStore';
import { useTriggerStore } from '@/store/triggerStore';
import { generateUniqueId } from '@/lib';
import { toast } from 'sonner';

/**
 * Hook that executes triggered tasks by creating new projects/chats
 * and running them as if a user sent a message.
 * 
 * This provides a modular way to programmatically run tasks from:
 * - Webhook triggers
 * - Scheduled triggers
 * - Future: per-project triggers
 */
export function useTriggerTaskExecutor() {
    const projectStore = useProjectStore();
    const triggerTaskStore = useTriggerTaskStore();
    const triggerStore = useTriggerStore();
    
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
     * Execute a triggered task by:
     * 1. Creating or selecting a project
     * 2. Creating a new chat store in that project
     * 3. Starting the task with the formatted message
     */
    const executeTask = useCallback(async (task: TriggeredTask) => {
        console.log('[TriggerTaskExecutor] Executing task:', task.id, task.triggerName);
        
        try {
            const store = projectStoreRef.current;
            let targetProjectId = task.projectId;
            
            // If no project specified, create a new project for this trigger
            if (!targetProjectId) {
                // Create a new project for this triggered task
                const projectName = `Trigger: ${task.triggerName}`;
                const projectDescription = `Auto-created project for ${task.triggerType} trigger execution`;
                targetProjectId = store.createProject(projectName, projectDescription);
                console.log('[TriggerTaskExecutor] Created new project:', targetProjectId);
            }
            
            // Set this project as active
            store.setActiveProject(targetProjectId);
            
            // Get the chat store for this project
            const chatStore = store.getActiveChatStore(targetProjectId);
            if (!chatStore) {
                throw new Error(`Failed to get chat store for project ${targetProjectId}`);
            }
            
            const chatState = chatStore.getState();
            const taskId = chatState.activeTaskId;
            
            if (!taskId) {
                throw new Error('No active task ID in chat store');
            }
            
            // Format the message with all context
            const formattedMessage = formatTriggeredTaskMessage(task);
            
            console.log('[TriggerTaskExecutor] Starting task with message:', formattedMessage.substring(0, 100) + '...');
            
            // Add the message to chat and mark as having messages
            chatState.setHasMessages(taskId, true);
            
            // Start the task (similar to handleSend flow)
            try {
                await chatState.startTask(taskId, undefined, undefined, undefined, formattedMessage, []);
                chatState.setHasWaitComfirm(taskId, true);
                
                // Mark task as completed in our store
                triggerTaskStoreRef.current.completeTask(task.id);
                
                toast.success(`Started: ${task.triggerName}`, {
                    description: 'Triggered task is now running',
                });
                
                console.log('[TriggerTaskExecutor] Task started successfully:', task.id);
            } catch (err: any) {
                console.error('[TriggerTaskExecutor] Failed to start task:', err);
                triggerTaskStoreRef.current.failTask(task.id, err?.message || 'Failed to start task');
                toast.error(`Failed to start: ${task.triggerName}`, {
                    description: err?.message || 'Unknown error',
                });
            }
            
        } catch (error: any) {
            console.error('[TriggerTaskExecutor] Task execution failed:', error);
            triggerTaskStoreRef.current.failTask(task.id, error?.message || 'Execution failed');
            toast.error(`Trigger failed: ${task.triggerName}`, {
                description: error?.message || 'Unknown error',
            });
        }
    }, []);

    /**
     * Process the next task in the queue
     */
    const processNextTask = useCallback(async () => {
        if (isProcessingRef.current) {
            console.log('[TriggerTaskExecutor] Already processing, skipping');
            return;
        }
        
        const store = triggerTaskStoreRef.current;
        
        // Check if there's a current task running
        if (store.currentTask) {
            console.log('[TriggerTaskExecutor] Task already running, waiting');
            return;
        }
        
        // Dequeue the next pending task
        const nextTask = store.dequeueTask();
        if (!nextTask) {
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
                const remaining = triggerTaskStoreRef.current.taskQueue.filter(t => t.status === 'pending');
                if (remaining.length > 0) {
                    processNextTask();
                }
            }, 1000);
        }
    }, [executeTask]);

    // Watch for new tasks added to the queue via WebSocket events
    useEffect(() => {
        const { webSocketEvent } = triggerStore;
        
        if (webSocketEvent) {
            console.log('[TriggerTaskExecutor] WebSocket event received:', webSocketEvent);
            
            // Enqueue the task
            triggerTaskStore.enqueueTask({
                triggerId: webSocketEvent.triggerId,
                triggerName: webSocketEvent.triggerName,
                taskPrompt: webSocketEvent.taskPrompt,
                executionId: webSocketEvent.executionId,
                triggerType: webSocketEvent.triggerType,
                projectId: webSocketEvent.projectId,
                inputData: webSocketEvent.inputData,
            });
            
            // Clear the event after processing
            triggerStore.clearWebSocketEvent();
            
            // Start processing
            processNextTask();
        }
    }, [triggerStore.webSocketEvent, processNextTask]);

    // Also process on mount if there are pending tasks
    useEffect(() => {
        const pending = triggerTaskStore.taskQueue.filter(t => t.status === 'pending');
        if (pending.length > 0) {
            processNextTask();
        }
    }, []);

    return {
        /** Manually trigger a task execution (useful for testing) */
        executeTask,
        /** Process pending tasks */
        processNextTask,
        /** Current task being executed */
        currentTask: triggerTaskStore.currentTask,
        /** Pending tasks in queue */
        pendingTasks: triggerTaskStore.taskQueue.filter(t => t.status === 'pending'),
        /** Task execution history */
        taskHistory: triggerTaskStore.taskHistory,
    };
}
