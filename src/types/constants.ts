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

/**
 * SSE step values received from the backend in AgentMessage.step.
 */
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
  COMMAND_APPROVAL: 'command_approval',
  SYNC: 'sync',
  NOTICE_CARD: 'notice_card',
  FAILED: 'failed',
  AGENT_SUMMARY_END: 'agent_summary_end',
} as const;

export type AgentStepType = (typeof AgentStep)[keyof typeof AgentStep];

/**
 * User responses for dangerous operation approval.
 * Mirrors backend ApprovalAction enum in app/model/enums.py.
 */
export const ApprovalAction = {
  APPROVE_ONCE: 'approve_once',
  AUTO_APPROVE: 'auto_approve',
  REJECT: 'reject',
} as const;

export type ApprovalActionType =
  (typeof ApprovalAction)[keyof typeof ApprovalAction];

/**
 * Status values on AgentMessage.status (SSE message lifecycle).
 */
export const AgentMessageStatus = {
  RUNNING: 'running',
  FILLED: 'filled',
  COMPLETED: 'completed',
} as const;

export type AgentMessageStatusType =
  (typeof AgentMessageStatus)[keyof typeof AgentMessageStatus];

/**
 * Status values for TaskInfo (individual sub-task progress).
 */
export const TaskStatus = {
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  WAITING: 'waiting',
  RUNNING: 'running',
  BLOCKED: 'blocked',
  EMPTY: '',
} as const;

export type TaskStatusType = (typeof TaskStatus)[keyof typeof TaskStatus];

/**
 * Top-level task status in the ChatStore Task interface.
 */
export const ChatTaskStatus = {
  RUNNING: 'running',
  FINISHED: 'finished',
  PENDING: 'pending',
  PAUSE: 'pause',
} as const;

export type ChatTaskStatusType =
  (typeof ChatTaskStatus)[keyof typeof ChatTaskStatus];

/**
 * Status values for individual agent lifecycle (toolkit operations, agent progress).
 */
export const AgentStatusValue = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export type AgentStatusType =
  (typeof AgentStatusValue)[keyof typeof AgentStatusValue];
