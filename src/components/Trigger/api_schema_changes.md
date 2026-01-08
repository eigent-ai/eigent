# Trigger API Schema - Backend Update Required

This document summarizes the API schema changes needed for the backend based on recent frontend changes.

---

## Enums

### TriggerType
```typescript
enum TriggerType {
  Schedule = "schedule",
  Webhook = "webhook",
  SlackTrigger = "slack_trigger"
}
```

### TriggerStatus
```typescript
enum TriggerStatus {
  Inactive = 0,
  Active = 1,
  Stale = 2,
  Completed = 3
}
```

### ListenerType
```typescript
enum ListenerType {
  Workforce = "workforce",
  ChatAgent = "chat_agent"
}
```

### ExecutionType
```typescript
enum ExecutionType {
  Scheduled = "scheduled",
  Webhook = "webhook",
  Manual = "manual",
  Slack = "slack"
}
```

### ExecutionStatus
```typescript
enum ExecutionStatus {
  Pending = 0,
  Running = 1,
  Completed = 2,
  Failed = 3,
  Cancelled = 4
}
```

---

## Data Types

### Trigger

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| [id](file:///Users/douglas/Desktop/Code%20Base/eigent/src/types/index.ts#11-25) | `number` | ✅ | Unique identifier |
| `user_id` | `string` | ✅ | Owner user ID |
| `name` | `string` | ✅ | Trigger name |
| `description` | `string` | ✅ | Trigger description |
| `trigger_type` | [TriggerType](file:///Users/douglas/Desktop/Code%20Base/eigent/src/components/Trigger/TriggerListItem.tsx#35-47) | ✅ | Type of trigger |
| `status` | `TriggerStatus` | ✅ | Active status |
| `webhook_url` | `string` | ❌ | Webhook URL (for webhook type) |
| `custom_cron_expression` | `string` | ❌ | Cron expression (for schedule type) |
| `listener_type` | `ListenerType` | ❌ | Listener type |
| `system_message` | `string` | ❌ | System message for agent |
| `agent_model` | `string` | ❌ | AI model to use |
| `task_prompt` | `string` | ❌ | Task prompt text |
| `custom_task` | `Record<string, any>` | ❌ | Custom task configuration |
| `max_executions_per_hour` | `number` | ❌ | Rate limit per hour |
| `max_executions_per_day` | `number` | ❌ | Rate limit per day |
| `is_single_execution` | `boolean` | ✅ | Run only once flag |
| `last_executed_at` | `string` | ❌ | ISO timestamp of last execution |
| `last_execution_status` | `string` | ❌ | Status of last execution |
| `execution_count` | `number` | ✅ | Total execution count |
| `error_count` | `number` | ✅ | Total error count |
| `created_at` | `string` | ❌ | ISO timestamp |
| `updated_at` | `string` | ❌ | ISO timestamp |

---

### TriggerInput (Create Request)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | ✅ | Trigger name |
| `description` | `string` | ❌ | Trigger description |
| `trigger_type` | [TriggerType](file:///Users/douglas/Desktop/Code%20Base/eigent/src/components/Trigger/TriggerListItem.tsx#35-47) | ✅ | Type of trigger |
| `custom_cron_expression` | `string` | ❌ | Cron expression |
| `webhook_url` | `string` | ❌ | Webhook URL |
| `listener_type` | `ListenerType` | ❌ | Listener type |
| `system_message` | `string` | ❌ | System message |
| `agent_model` | `string` | ❌ | AI model |
| `task_prompt` | `string` | ❌ | Task prompt |
| `custom_task` | `Record<string, any>` | ❌ | Custom task config |
| `max_executions_per_hour` | `number` | ❌ | Rate limit |
| `max_executions_per_day` | `number` | ❌ | Rate limit |
| `is_single_execution` | `boolean` | ❌ | Single execution flag |

---

### TriggerUpdate (Update Request)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | ❌ | Trigger name |
| `description` | `string` | ❌ | Description |
| `status` | `TriggerStatus` | ❌ | Active status |
| `custom_cron_expression` | `string` | ❌ | Cron expression |
| `listener_type` | `ListenerType` | ❌ | Listener type |
| `system_message` | `string` | ❌ | System message |
| `agent_model` | `string` | ❌ | AI model |
| `task_prompt` | `string` | ❌ | Task prompt |
| `custom_task` | `Record<string, any>` | ❌ | Custom task config |
| `max_executions_per_hour` | `number` | ❌ | Rate limit |
| `max_executions_per_day` | `number` | ❌ | Rate limit |
| `is_single_execution` | `boolean` | ❌ | Single execution flag |

---

### TriggerExecution

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| [id](file:///Users/douglas/Desktop/Code%20Base/eigent/src/types/index.ts#11-25) | `number` | ✅ | Unique identifier |
| `trigger_id` | `number` | ✅ | Parent trigger ID |
| `execution_id` | `string` | ✅ | Execution UUID |
| `execution_type` | `ExecutionType` | ✅ | How it was triggered |
| `status` | [ExecutionStatus](file:///Users/douglas/Desktop/Code%20Base/eigent/src/components/Trigger/TriggerDialog.tsx#181-189) | ✅ | Execution status |
| `started_at` | `string` | ❌ | ISO timestamp |
| `completed_at` | `string` | ❌ | ISO timestamp |
| `duration_seconds` | `number` | ❌ | Execution duration |
| `input_data` | `Record<string, any>` | ❌ | Input payload |
| `output_data` | `Record<string, any>` | ❌ | Output/result data |
| `error_message` | `string` | ❌ | Error details |
| `retry_count` | `number` | ✅ | Current retry count |
| `max_retries` | `number` | ✅ | Max retry limit |
| `tokens_used` | `number` | ❌ | Token consumption |
| `tools_executed` | `Record<string, any>` | ❌ | Tools that were used |
| `worker_id` | `string` | ❌ | Worker/agent ID |
| `created_at` | `string` | ❌ | ISO timestamp |
| `updated_at` | `string` | ❌ | ISO timestamp |

---

## API Endpoints Required

### Triggers

| Method | Endpoint | Request Body | Response |
|--------|----------|--------------|----------|
| `GET` | `/api/triggers` | - | `Trigger[]` |
| `GET` | `/api/triggers/:id` | - | [Trigger](file:///Users/douglas/Desktop/Code%20Base/eigent/src/types/index.ts#67-91) |
| `POST` | `/api/triggers` | [TriggerInput](file:///Users/douglas/Desktop/Code%20Base/eigent/src/types/index.ts#92-107) | [Trigger](file:///Users/douglas/Desktop/Code%20Base/eigent/src/types/index.ts#67-91) |
| `PATCH` | `/api/triggers/:id` | [TriggerUpdate](file:///Users/douglas/Desktop/Code%20Base/eigent/src/types/index.ts#108-122) | [Trigger](file:///Users/douglas/Desktop/Code%20Base/eigent/src/types/index.ts#67-91) |
| `DELETE` | `/api/triggers/:id` | - | `void` |
| `POST` | `/api/triggers/:id/duplicate` | - | [Trigger](file:///Users/douglas/Desktop/Code%20Base/eigent/src/types/index.ts#67-91) |
| `POST` | `/api/triggers/:id/test` | - | [TriggerExecution](file:///Users/douglas/Desktop/Code%20Base/eigent/src/types/index.ts#123-143) |

### Executions

| Method | Endpoint | Request Body | Response |
|--------|----------|--------------|----------|
| `GET` | `/api/triggers/:id/executions` | - | `TriggerExecution[]` |
| `GET` | `/api/executions/:id` | - | [TriggerExecution](file:///Users/douglas/Desktop/Code%20Base/eigent/src/types/index.ts#123-143) |

---

## Query Parameters

### `GET /api/triggers`

| Param | Type | Description |
|-------|------|-------------|
| `sort_by` | `"created_at" \| "last_executed_at" \| "execution_count"` | Sort field |
| `order` | `"asc" \| "desc"` | Sort order |
| `status` | `TriggerStatus` | Filter by status |
| `trigger_type` | [TriggerType](file:///Users/douglas/Desktop/Code%20Base/eigent/src/components/Trigger/TriggerListItem.tsx#35-47) | Filter by type |
