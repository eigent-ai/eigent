import { ExecutionStatus, TriggerType } from '@/types';
import { create } from 'zustand';

/**
 * Represents a task triggered by webhook or scheduled execution.
 * Contains all context needed to run the task programmatically.
 */
export interface TriggeredTask {
    /** Unique identifier for this triggered task */
    id: string;
    /** The trigger that initiated this task */
    triggerId: number;
    /** Human-readable name of the trigger */
    triggerName: string;
    /** The task prompt from the trigger configuration */
    taskPrompt: string;
    /** Execution ID from the backend */
    executionId: string;
    /** Type of trigger: webhook or scheduled */
    triggerType: TriggerType;
    /** 
     * Target project ID where this task should run.
     * If null, creates a new project or uses active project.
     * Future: triggers will be associated with specific projects.
     */
    projectId: string | null;
    /** Input data from webhook request or scheduled context */
    inputData: Record<string, any>;
    /** Timestamp when the task was triggered */
    timestamp: number;
    /** Current status of the triggered task */
    status: ExecutionStatus;
    /** Error message if task failed */
    errorMessage?: string;
}

/**
 * Formats the task message with context from webhook or schedule
 */
export function formatTriggeredTaskMessage(task: TriggeredTask): string {
    const parts: string[] = [];
    
    // Add the main task prompt
    parts.push(task.taskPrompt);
    
    // Add context separator if we have input data
    if (task.inputData && Object.keys(task.inputData).length > 0) {
        parts.push('\n\n---\n**Trigger Context:**');
        
        // Format webhook data nicely
        if (task.triggerType === 'webhook') {
            parts.push(`- **Source:** Webhook trigger "${task.triggerName}"`);
            
            // Include relevant webhook data
            if (task.inputData.method) {
                parts.push(`- **Method:** ${task.inputData.method}`);
            }
            if (task.inputData.query && Object.keys(task.inputData.query).length > 0) {
                parts.push(`- **Query Parameters:** \`${JSON.stringify(task.inputData.query)}\``);
            }
            if (task.inputData.body && Object.keys(task.inputData.body).length > 0) {
                parts.push(`- **Request Body:**\n\`\`\`json\n${JSON.stringify(task.inputData.body, null, 2)}\n\`\`\``);
            }
            if (task.inputData.headers && Object.keys(task.inputData.headers).length > 0) {
                // Filter out sensitive headers
                const safeHeaders = { ...task.inputData.headers };
                delete safeHeaders['authorization'];
                delete safeHeaders['cookie'];
                if (Object.keys(safeHeaders).length > 0) {
                    parts.push(`- **Headers:** \`${JSON.stringify(safeHeaders)}\``);
                }
            }
        } else if (task.triggerType === 'schedule') {
            parts.push(`- **Source:** Scheduled trigger "${task.triggerName}"`);
            if (task.inputData.scheduled_time) {
                parts.push(`- **Scheduled Time:** ${task.inputData.scheduled_time}`);
            }
        } else if (task.triggerType === 'slack_trigger') {
            parts.push(`- **Source:** Slack trigger "${task.triggerName}"`);
            
            // Slack event context
            if (task.inputData.event_type) {
                parts.push(`- **Event Type:** ${task.inputData.event_type}`);
            }
            if (task.inputData.text) {
                parts.push(`- **Message:** ${task.inputData.text}`);
            }
            if (task.inputData.channel_id) {
                parts.push(`- **Channel ID:** ${task.inputData.channel_id}`);
            }
            if (task.inputData.user_id) {
                parts.push(`- **Sender User ID:** ${task.inputData.user_id}`);
            }
            if (task.inputData.thread_ts) {
                parts.push(`- **Thread TS:** ${task.inputData.thread_ts}`);
            }
            if (task.inputData.message_ts) {
                parts.push(`- **Message TS:** ${task.inputData.message_ts}`);
            }
            if (task.inputData.team_id) {
                parts.push(`- **Team ID:** ${task.inputData.team_id}`);
            }
            if (task.inputData.reaction) {
                parts.push(`- **Reaction:** :${task.inputData.reaction}:`);
            }
            if (task.inputData.files && task.inputData.files.length > 0) {
                parts.push(`- **Files:** ${task.inputData.files.length} file(s) attached`);
            }
        }
    }
    
    return parts.join('\n');
}

interface TriggerTaskStore {
    /** Queue of triggered tasks waiting to be executed */
    taskQueue: TriggeredTask[];
    /** Currently running triggered task (if any) */
    currentTask: TriggeredTask | null;
    /** History of completed/failed tasks */
    taskHistory: TriggeredTask[];
    
    // Actions
    /** Add a new triggered task to the queue */
    enqueueTask: (task: Omit<TriggeredTask, 'id' | 'status' | 'timestamp'>) => string;
    /** Get the next pending task from the queue */
    dequeueTask: () => TriggeredTask | null;
    /** Mark current task as running */
    setCurrentTask: (task: TriggeredTask | null) => void;
    /** Mark a task as completed */
    completeTask: (taskId: string) => void;
    /** Mark a task as failed */
    failTask: (taskId: string, errorMessage: string) => void;
    /** Get task by ID */
    getTaskById: (taskId: string) => TriggeredTask | undefined;
    /** Get all pending tasks for a specific project */
    getTasksForProject: (projectId: string) => TriggeredTask[];
    /** Clear completed tasks from history */
    clearHistory: () => void;
}

export const useTriggerTaskStore = create<TriggerTaskStore>((set, get) => ({
    taskQueue: [],
    currentTask: null,
    taskHistory: [],

    enqueueTask: (taskData) => {
        const id = `triggered-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        // Check for duplicate event_id (Slack deduplication)
        const eventId = taskData.inputData?.event_id;
        if (eventId) {
            const { taskQueue, taskHistory, currentTask } = get();
            
            // Check if event_id exists in queue, current task, or history
            const isDuplicate = 
                taskQueue.some(t => t.inputData?.event_id === eventId) ||
                (currentTask?.inputData?.event_id === eventId) ||
                taskHistory.some(t => t.inputData?.event_id === eventId);
            
            if (isDuplicate) {
                console.warn('[TriggerTaskStore] Duplicate event_id detected, marking as missed:', eventId);
                
                const failedTask: TriggeredTask = {
                    ...taskData,
                    id,
                    status: ExecutionStatus.Missed,
                    timestamp: Date.now(),
                    errorMessage: `Duplicate event_id: ${eventId}`,
                };
                
                // Add to history as failed
                set((state) => ({
                    taskHistory: [...state.taskHistory, failedTask]
                }));
                
                return id;
            }
        }
        
        const newTask: TriggeredTask = {
            ...taskData,
            id,
            status: ExecutionStatus.Pending,
            timestamp: Date.now(),
        };

        set((state) => ({
            taskQueue: [...state.taskQueue, newTask]
        }));

        console.log('[TriggerTaskStore] Task enqueued:', id, taskData.triggerName);
        return id;
    },

    dequeueTask: () => {
        const { taskQueue } = get();
        const nextTask = taskQueue.find(t => t.status === ExecutionStatus.Pending);
        
        if (nextTask) {
            // Mark as running and move to current
            set((state) => ({
                taskQueue: state.taskQueue.filter(t => t.id !== nextTask.id),
                currentTask: { ...nextTask, status: ExecutionStatus.Running }
            }));
            console.log('[TriggerTaskStore] Task dequeued:', nextTask.id);
            return { ...nextTask, status: ExecutionStatus.Running };
        }
        return null;
    },

    setCurrentTask: (task) => {
        set({ currentTask: task });
    },

    completeTask: (taskId) => {
        set((state) => {
            const completedTask = state.currentTask?.id === taskId 
                ? { ...state.currentTask, status: ExecutionStatus.Completed as const }
                : state.taskQueue.find(t => t.id === taskId);
            
            if (!completedTask) return state;

            return {
                currentTask: state.currentTask?.id === taskId ? null : state.currentTask,
                taskQueue: state.taskQueue.filter(t => t.id !== taskId),
                taskHistory: [{ ...completedTask, status: ExecutionStatus.Completed as const }, ...state.taskHistory].slice(0, 50)
            };
        });
        console.log('[TriggerTaskStore] Task completed:', taskId);
    },

    failTask: (taskId, errorMessage) => {
        set((state) => {
            const failedTask = state.currentTask?.id === taskId 
                ? { ...state.currentTask, status: ExecutionStatus.Failed as const, errorMessage }
                : state.taskQueue.find(t => t.id === taskId);
            
            if (!failedTask) return state;

            return {
                currentTask: state.currentTask?.id === taskId ? null : state.currentTask,
                taskQueue: state.taskQueue.filter(t => t.id !== taskId),
                taskHistory: [{ ...failedTask, status: ExecutionStatus.Failed as const, errorMessage }, ...state.taskHistory].slice(0, 50)
            };
        });
        console.log('[TriggerTaskStore] Task failed:', taskId, errorMessage);
    },

    getTaskById: (taskId) => {
        const { taskQueue, currentTask, taskHistory } = get();
        return taskQueue.find(t => t.id === taskId) 
            || (currentTask?.id === taskId ? currentTask : undefined)
            || taskHistory.find(t => t.id === taskId);
    },

    getTasksForProject: (projectId) => {
        const { taskQueue } = get();
        return taskQueue.filter(t => t.projectId === projectId);
    },

    clearHistory: () => {
        set({ taskHistory: [] });
    }
}));
