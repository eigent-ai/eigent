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
  SlackTrigger = "slack_trigger"
}

export enum TriggerStatus {
  Inactive = 0,
  Active = 1,
  Stale = 2,
  Completed = 3
}

export enum ListenerType {
  Workforce = "workforce",
  ChatAgent = "chat_agent"
}

export enum ExecutionType {
  Scheduled = "scheduled",
  Webhook = "webhook",
  Manual = "manual",
  Slack = "slack"
}

export enum ExecutionStatus {
  Pending = 0,
  Running = 1,
  Completed = 2,
  Failed = 3,
  Cancelled = 4
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
  system_message?: string
  agent_model?: string
  task_prompt?: string
  custom_task?: Record<string, any>
  max_executions_per_hour?: number
  max_executions_per_day?: number
  is_single_execution: boolean
  last_executed_at?: string
  last_execution_status?: string
  execution_count: number
  error_count: number
  created_at?: string
  updated_at?: string
}

export type TriggerInput = {
  name: string
  description?: string
  trigger_type: TriggerType
  custom_cron_expression?: string
  webhook_url?: string
  listener_type?: ListenerType
  system_message?: string
  agent_model?: string
  task_prompt?: string
  custom_task?: Record<string, any>
  max_executions_per_hour?: number
  max_executions_per_day?: number
  is_single_execution?: boolean
}

export type TriggerUpdate = {
  name?: string
  description?: string
  status?: TriggerStatus
  custom_cron_expression?: string
  listener_type?: ListenerType
  system_message?: string
  agent_model?: string
  task_prompt?: string
  custom_task?: Record<string, any>
  max_executions_per_hour?: number
  max_executions_per_day?: number
  is_single_execution?: boolean
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
  retry_count: number
  max_retries: number
  tokens_used?: number
  tools_executed?: Record<string, any>
  worker_id?: string
  created_at?: string
  updated_at?: string
}