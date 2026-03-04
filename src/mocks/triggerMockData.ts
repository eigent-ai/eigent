import { Trigger, TriggerStatus, TriggerType, ListenerType, TriggerExecution, ExecutionType, ExecutionStatus } from "@/types";

export const mockTriggers: Trigger[] = [
    {
        id: 1,
        user_id: "1",
        name: "Daily Report Generator",
        description: "Generates daily reports every morning at 9 AM",
        trigger_type: TriggerType.Schedule,
        custom_cron_expression: "0 9 * * *",
        listener_type: ListenerType.Workforce,
        status: TriggerStatus.Active,
        execution_count: 45,
        task_prompt: "Generate a daily summary report of all activities",
        agent_model: "gpt-4o-mini",
        is_single_execution: false,
        created_at: "2024-01-15T09:00:00Z",
        updated_at: "2024-01-20T09:00:00Z",
    },
    {
        id: 2,
        user_id: "1",
        name: "Webhook Data Processor",
        description: "Processes incoming webhook data from external services",
        trigger_type: TriggerType.Webhook,
        webhook_url: "https://dev.eigent.ai/webhook/abc123def456",
        listener_type: ListenerType.Workforce,
        status: TriggerStatus.Active,
        execution_count: 128,
        task_prompt: "Process and validate incoming webhook data",
        agent_model: "gpt-4o",
        is_single_execution: false,
        created_at: "2024-01-10T14:30:00Z",
        updated_at: "2024-01-22T16:45:00Z",
    },
    {
        id: 3,
        user_id: "1",
        name: "Slack Notification Handler",
        description: "Handles notifications from Slack channels",
        trigger_type: TriggerType.Slack,
        listener_type: ListenerType.Workforce,
        status: TriggerStatus.Inactive,
        execution_count: 0,
        task_prompt: "Monitor Slack messages and respond to mentions",
        agent_model: "gpt-4o-mini",
        is_single_execution: false,
        created_at: "2024-01-25T10:00:00Z",
        updated_at: "2024-01-25T10:00:00Z",
    },
];

export const mockExecutions: Record<number, TriggerExecution[]> = {
    1: [
        {
            id: 101,
            trigger_id: 1,
            execution_id: "exec_20240120_001",
            execution_type: ExecutionType.Scheduled,
            status: ExecutionStatus.Completed, // Completed
            started_at: "2024-01-20T09:00:00Z",
            completed_at: "2024-01-20T09:02:30Z",
            duration_seconds: 150,
            tokens_used: 1250,
            attempts: 0,
            max_retries: 3,
        },
        {
            id: 102,
            trigger_id: 1,
            execution_id: "exec_20240119_001",
            execution_type: ExecutionType.Scheduled,
            status: ExecutionStatus.Completed, // Completed
            started_at: "2024-01-19T09:00:00Z",
            completed_at: "2024-01-19T09:01:45Z",
            duration_seconds: 105,
            tokens_used: 980,
            attempts: 0,
            max_retries: 3,
        },
        {
            id: 103,
            trigger_id: 1,
            execution_id: "exec_20240118_001",
            execution_type: ExecutionType.Scheduled,
            status: ExecutionStatus.Failed, // Failed
            started_at: "2024-01-18T09:00:00Z",
            completed_at: "2024-01-18T09:00:15Z",
            duration_seconds: 15,
            tokens_used: 120,
            attempts: 0,
            max_retries: 3,
        },
    ],
    2: [
        {
            id: 201,
            trigger_id: 2,
            execution_id: "exec_webhook_001",
            execution_type: ExecutionType.Webhook,
            status: ExecutionStatus.Completed, // Completed
            started_at: "2024-01-22T16:45:00Z",
            completed_at: "2024-01-22T16:45:30Z",
            duration_seconds: 30,
            tokens_used: 450,
            attempts: 0,
            max_retries: 3,
        },
        {
            id: 202,
            trigger_id: 2,
            execution_id: "exec_webhook_002",
            execution_type: ExecutionType.Webhook,
            status: ExecutionStatus.Running, // Running
            started_at: "2024-01-22T17:00:00Z",
            completed_at: undefined,
            duration_seconds: undefined,
            tokens_used: undefined,
            attempts: 0,
            max_retries: 3,
        },
    ],
    3: [],
};

let nextTriggerId = 4;
let nextExecutionId = 300;

export const createMockTrigger = (triggerData: Partial<Trigger>): Trigger => {
    const newTrigger: Trigger = {
        id: nextTriggerId++,
        user_id: "1",
        name: triggerData.name || "New Trigger",
        description: triggerData.description || "",
        trigger_type: triggerData.trigger_type || TriggerType.Schedule,
        custom_cron_expression: triggerData.custom_cron_expression,
        webhook_url: triggerData.webhook_url,
        listener_type: triggerData.listener_type || ListenerType.Workforce,
        status: TriggerStatus.Inactive,
        execution_count: 0,
        task_prompt: triggerData.task_prompt,
        agent_model: triggerData.agent_model,
        max_executions_per_hour: triggerData.max_executions_per_hour,
        max_executions_per_day: triggerData.max_executions_per_day,
        is_single_execution: triggerData.is_single_execution || false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };

    // Initialize empty executions array for this trigger
    mockExecutions[newTrigger.id] = [];

    return newTrigger;
};

export const updateMockTriggerStatus = (triggerId: number, status: TriggerStatus): void => {
    const trigger = mockTriggers.find(t => t.id === triggerId);
    if (trigger) {
        trigger.status = status;
        trigger.updated_at = new Date().toISOString();
    }
};

export const deleteMockTrigger = (triggerId: number): void => {
    const index = mockTriggers.findIndex(t => t.id === triggerId);
    if (index !== -1) {
        mockTriggers.splice(index, 1);
        delete mockExecutions[triggerId];
    }
};

export const createMockExecution = (triggerId: number): TriggerExecution => {
    const execution: TriggerExecution = {
        id: nextExecutionId++,
        trigger_id: triggerId,
        execution_id: `exec_test_${Date.now()}`,
        execution_type: ExecutionType.Scheduled,
        status: ExecutionStatus.Running, // Running
        started_at: new Date().toISOString(),
        completed_at: undefined,
        duration_seconds: undefined,
        tokens_used: undefined,
        attempts: 0,
        max_retries: 3,
    };

    // Add to mockExecutions
    if (!mockExecutions[triggerId]) {
        mockExecutions[triggerId] = [];
    }
    mockExecutions[triggerId].unshift(execution);

    // Simulate completion after a delay
    setTimeout(() => {
        execution.status = ExecutionStatus.Completed; // Completed
        execution.completed_at = new Date().toISOString();
        execution.duration_seconds = Math.floor(Math.random() * 30) + 5;
        execution.tokens_used = Math.floor(Math.random() * 1000) + 100;
        execution.output_data = {
            message: "Test execution completed successfully",
            tasks_processed: Math.floor(Math.random() * 10) + 1
        };
    }, 3000);

    return execution;
};
