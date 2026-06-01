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

export enum AgentStep {
  TO_SUB_TASKS = 'to_sub_tasks',
  NOTICE_CARD = 'notice_card',
  CONFIRMED = 'confirmed',
  NOTICE = 'notice',
  NEW_TASK_STATE = 'new_task_state',
  WAIT_CONFIRM = 'wait_confirm',
  END = 'end',
}

export enum ChatTaskStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  PAUSE = 'pause',
  FINISHED = 'finished',
}

export enum SessionMode {
  SINGLE_AGENT = 'single_agent',
  WORKFORCE = 'workforce',
}

export type SessionModeType = `${SessionMode}`;
