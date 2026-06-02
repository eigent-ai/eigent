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

import type { RemoteControlStep } from '@/api/remoteControl';

export type CommandStatus = {
  id: string;
  content: string;
  type: string;
  status: string;
  error?: string;
};

export type TurnStatus = 'running' | 'done' | 'waiting_input' | 'error';

export type ConversationTurn = {
  /** Stable React key — built from first step_id in the turn. */
  id: string;
  /** The user's message text, if we can derive it. */
  userQuery: string | null;
  /** Intermediate agent activity steps (tool calls, agent lifecycle, etc.). */
  workLog: RemoteControlStep[];
  /** Terminal step: ask / done / finish / error — or null while still running. */
  agentResponse: RemoteControlStep | null;
  status: TurnStatus;
};

// Steps that begin a new conversation turn (user message acknowledged).
const TURN_BOUNDARY_STEPS = new Set(['confirmed']);

// Steps that are the agent's final response to the user. These mirror the
// desktop `AgentStep` values forwarded over the remote-control bridge:
//   - `end`          → task completion (workforce + single agent summary)
//   - `wait_confirm` → simple-query response (no task split)
//   - `ask`          → agent asks the human for input
//   - error variants → terminal failures
const AGENT_RESPONSE_STEPS = new Set([
  'ask',
  'end',
  'wait_confirm',
  'error',
  'failed',
  'budget_not_enough',
  'context_too_long',
]);

const ERROR_RESPONSE_STEPS = new Set([
  'error',
  'failed',
  'budget_not_enough',
  'context_too_long',
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

/** Extract text from a confirmed step's data payload. */
function extractQueryText(step: RemoteControlStep): string | null {
  const data = asRecord(step.data);
  for (const key of ['question', 'content', 'message', 'reply', 'text']) {
    const v = data[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function extractImplicitTurnQuery(step: RemoteControlStep): string | null {
  if (step.step !== 'wait_confirm') return null;
  const data = asRecord(step.data);
  const question = data.question;
  return typeof question === 'string' && question.trim()
    ? question.trim()
    : null;
}

function deriveTurnStatus(
  workLog: RemoteControlStep[],
  agentResponse: RemoteControlStep | null
): TurnStatus {
  if (!agentResponse) return 'running';
  const step = agentResponse.step;
  if (step === 'ask') return 'waiting_input';
  if (ERROR_RESPONSE_STEPS.has(step)) return 'error';
  return 'done';
}

/**
 * Message session channel: transforms a flat stream of backend steps into
 * structured conversation turns. Pure function — safe to call in useMemo.
 *
 * Turn boundaries are `confirmed` steps. Steps before the first `confirmed`
 * are grouped into an implicit opening turn (may represent an ongoing task
 * the user reconnected to).
 */
export function buildTurns(
  steps: RemoteControlStep[],
  commands: CommandStatus[]
): ConversationTurn[] {
  const turns: ConversationTurn[] = [];

  // Track user_message commands in order so we can match them to turns.
  const userMessages = commands.filter((c) => c.type === 'user_message');
  let userMsgIndex = 0;

  let current: Omit<ConversationTurn, 'status'> | null = null;

  const pushCurrent = () => {
    if (!current) return;
    turns.push({
      ...current,
      status: deriveTurnStatus(current.workLog, current.agentResponse),
    });
    current = null;
  };

  for (const step of steps) {
    if (TURN_BOUNDARY_STEPS.has(step.step)) {
      // Finalise the previous turn before starting a new one.
      pushCurrent();

      // Try to get query text from the step data first, then from commands.
      let queryText = extractQueryText(step);
      if (!queryText && userMsgIndex < userMessages.length) {
        queryText = userMessages[userMsgIndex]!.content || null;
        userMsgIndex++;
      }

      current = {
        id: `turn-${step.step_id}`,
        userQuery: queryText,
        workLog: [],
        agentResponse: null,
      };
      continue;
    }

    // Ensure there's always a current turn even if no `confirmed` arrived yet.
    if (!current) {
      current = {
        id: `turn-pre-${step.step_id}`,
        userQuery: extractImplicitTurnQuery(step),
        workLog: [],
        agentResponse: null,
      };
    }

    if (AGENT_RESPONSE_STEPS.has(step.step)) {
      // Only take the first terminal response per turn; extras go to the log.
      if (!current.agentResponse) {
        current.agentResponse = step;
      } else {
        current.workLog.push(step);
      }
    } else {
      current.workLog.push(step);
    }
  }

  pushCurrent();
  return turns;
}
