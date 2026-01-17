type externalConfig = {
  key: string
  name: string
  value: string
  options?: {
    label: string
    value: string
  }[]
}

export type Provider = {
  id: string
  provider_id?: number
  name: string
  apiKey: string
  apiHost: string
  description: string | ""
  hostPlaceHolder?: string
  externalConfig?: externalConfig[]
  is_valid?: boolean,
  model_type?: string,
  prefer?: boolean,
  azure_deployment?: string
}

export type Model = {
  id: string
  name: string
  provider: string
  [key: string]: any
}

// Trigger types
export enum TriggerType {
  Schedule = "schedule",
  Webhook = "webhook",
  Slack = "slack_trigger",
}

export enum TriggerStatus {
  PendingAuth = "pending_authentication",
  Inactive = "inactive",
  Active = "active",
}

export enum ListenerType {
  Workforce = "workforce",
}

export enum ExecutionType {
  Scheduled = "scheduled",
  Webhook = "webhook",
  Slack = "slack",
}

export enum RequestType {
  GET = "GET",
  POST = "POST"
}

export enum ExecutionStatus {
  Pending = "pending",
  Running = "running",
  Completed = "completed",
  Failed = "failed",
  Cancelled = "cancelled",
  Missed = "missed",
}

export type Trigger = {
  id: number
  user_id: string
  name: string
  description: string
  trigger_type: TriggerType
  status: TriggerStatus
  webhook_url?: string
  custom_cron_expression?: string
  listener_type?: ListenerType
  webhook_method?: RequestType
  agent_model?: string
  task_prompt?: string
  custom_task?: Record<string, any>
  max_executions_per_hour?: number
  max_executions_per_day?: number
  is_single_execution: boolean
  last_executed_at?: string
  last_execution_status?: string
  next_run_at?: string
  created_at?: string
  updated_at?: string
  execution_count?: number
  config?: Record<string, any>
}

export type TriggerInput = {
  name: string
  description?: string
  project_id?: string
  trigger_type: TriggerType
  custom_cron_expression?: string
  webhook_url?: string
  webhook_method?: RequestType
  listener_type?: ListenerType
  agent_model?: string
  task_prompt?: string
  custom_task?: Record<string, any>
  max_executions_per_hour?: number
  max_executions_per_day?: number
  is_single_execution?: boolean
  config?: Record<string, any>
}

export type TriggerUpdate = {
  name?: string
  description?: string
  status?: TriggerStatus
  custom_cron_expression?: string
  listener_type?: ListenerType
  webhook_method?: RequestType
  agent_model?: string
  task_prompt?: string
  custom_task?: Record<string, any>
  max_executions_per_hour?: number
  max_executions_per_day?: number
  is_single_execution?: boolean
  config?: Record<string, any>
}

export type TriggerExecution = {
  id: number
  trigger_id: number
  execution_id: string
  execution_type: ExecutionType
  status: ExecutionStatus
  started_at?: string
  completed_at?: string
  duration_seconds?: number
  input_data?: Record<string, any>
  output_data?: Record<string, any>
  error_message?: string
  attempts: number
  max_retries: number
  tokens_used?: number
  tools_executed?: Record<string, any>
  created_at?: string
  updated_at?: string
}