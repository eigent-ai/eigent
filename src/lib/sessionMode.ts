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

import {
  AgentStep,
  SessionMode,
  type SessionModeType,
} from '@/types/constants';

type SessionModeAgent = {
  type?: string;
};

type SessionModeMessage = {
  step?: string;
  taskAssigning?: SessionModeAgent[];
};

type SessionModeTask = {
  sessionMode?: SessionModeType;
  taskAssigning?: SessionModeAgent[];
  taskInfo?: unknown[];
  taskRunning?: unknown[];
  messages?: SessionModeMessage[];
};

function hasSingleAgent(agents: SessionModeAgent[] | undefined) {
  return (agents ?? []).some((agent) => agent.type === 'single_agent');
}

function hasWorkforceAgent(agents: SessionModeAgent[] | undefined) {
  return (agents ?? []).some(
    (agent) => agent.type && agent.type !== 'single_agent'
  );
}

/**
 * Resolve a task's session mode from its data.
 *
 * Pass `fallback: null` to detect the "not yet determined" case — useful
 * while a project/session is still loading, so the UI can render a neutral
 * state instead of flashing the wrong mode (workforce → single-agent).
 */
export function inferSessionModeFromTask(
  task: SessionModeTask | null | undefined,
  fallback: SessionModeType | null = SessionMode.WORKFORCE
): SessionModeType | null {
  if (!task) return fallback;
  if (task.sessionMode) return task.sessionMode;

  if (hasSingleAgent(task.taskAssigning)) {
    return SessionMode.SINGLE_AGENT;
  }
  if (hasWorkforceAgent(task.taskAssigning)) {
    return SessionMode.WORKFORCE;
  }

  const messages = task.messages ?? [];
  if (
    messages.some(
      (message) =>
        message.step === AgentStep.TO_SUB_TASKS ||
        hasWorkforceAgent(message.taskAssigning)
    )
  ) {
    return SessionMode.WORKFORCE;
  }

  if ((task.taskInfo?.length ?? 0) > 0 || (task.taskRunning?.length ?? 0) > 0) {
    return SessionMode.WORKFORCE;
  }

  return fallback;
}
