// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

// SSE event step types (matches backend sse_json step values)
export const AgentStep = {
  CONFIRMED: 'confirmed',
  NEW_TASK_STATE: 'new_task_state',
  END: 'end',
  WAIT_CONFIRM: 'wait_confirm',
  DECOMPOSE_TEXT: 'decompose_text',
  TO_SUB_TASKS: 'to_sub_tasks',
  CREATE_AGENT: 'create_agent',
  TASK_STATE: 'task_state',
  ACTIVATE_AGENT: 'activate_agent',
  DEACTIVATE_AGENT: 'deactivate_agent',
  ASSIGN_TASK: 'assign_task',
  ACTIVATE_TOOLKIT: 'activate_toolkit',
  DEACTIVATE_TOOLKIT: 'deactivate_toolkit',
  TERMINAL: 'terminal',
  WRITE_FILE: 'write_file',
  BUDGET_NOT_ENOUGH: 'budget_not_enough',
  CONTEXT_TOO_LONG: 'context_too_long',
  ERROR: 'error',
  ADD_TASK: 'add_task',
  REMOVE_TASK: 'remove_task',
  NOTICE: 'notice',
  ASK: 'ask',
  SYNC: 'sync',
} as const;

export type AgentStepType = (typeof AgentStep)[keyof typeof AgentStep];

export interface SSEEvent {
  step: AgentStepType;
  data: Record<string, any>;
}

export interface CliConfig {
  apiUrl: string;
  apiKey: string;
  modelPlatform: string;
  modelType: string;
  email: string;
  workspace: string;
  apiEndpoint: string | null;
}

export interface ChatPayload {
  project_id: string;
  task_id: string;
  question: string;
  email: string;
  model_platform: string;
  model_type: string;
  api_key: string;
  api_url: string | null;
  language: string;
  allow_local_system: boolean;
  attaches: string[];
  browser_port: number;
  installed_mcp: { mcpServers: Record<string, unknown> };
  env_path: string | null;
  search_config: Record<string, string> | null;
  new_agents: never[];
  summary_prompt: string;
  workspace: string | null;
}
