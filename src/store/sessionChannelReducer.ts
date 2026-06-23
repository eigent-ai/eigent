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
 * Session-channel derivation.
 *
 * Stage 1 strategy: rather than re-implement the ~1,950-line SSE switch in
 * `chatStore.startTask`, we **fold the already-accumulated per-turn `Task`
 * state into a typed, ordered `ChannelItem[]`**. The live SSE handler already
 * parses every event into clean per-turn fields (`messages[]`,
 * `taskAssigning[].log[]`, `taskInfo[]`, `fileList`, `askList`, …); this module
 * is the pure function that reads those fields and produces the channel the
 * renderers consume.
 *
 * Because each turn is one chatStore `Task` today, "turnId" in shadow mode is
 * just that task's id. The derivation is deterministic and idempotent: the same
 * turns in the same state always yield the same items (stable ids + seq), so it
 * is safe to re-run on every store update and on replay.
 *
 * At cut-over (Stage 5) the upstream becomes a true `ingest(event)` reducer and
 * this fold is replaced by direct appends; the item shapes stay identical.
 */

import { parseAskMessage } from '@/components/ChatBox/ask/askPayload';
import {
  buildAgentBlocks,
  mergeTaggedAgentLogs,
} from '@/components/ChatBox/MessageItem/TaskWorkLogAccordion';
import type { ChatStore } from '@/store/chatStore';
import {
  AgentStep,
  SessionMode,
  type SessionModeType,
} from '@/types/constants';
import type {
  AgentMessageItem,
  AskInputKind,
  ChannelItem,
  ChannelItemKind,
  ChannelItemOfKind,
} from '@/types/sessionChannel';

/** A single turn's fully-accumulated task state (one chatStore `Task`). */
export type TurnTask = ChatStore['tasks'][string];

/** Ordered turn input: `turnId` is authoritative (the task id in shadow mode). */
export interface TurnInput {
  turnId: string;
  task: TurnTask;
}

/**
 * Structural / tool-lifecycle / state steps. In the live flow these are folded
 * into the work-log (`taskAssigning[].log`) and never appear as standalone
 * conversation messages. If one does leak into `messages[]` (legacy project
 * shape), it must NOT render as a free-text agent answer — it would surface a
 * raw internal payload. We demote it to an `unsupported` item instead.
 */
const STRUCTURAL_STEPS: ReadonlySet<string> = new Set<string>([
  AgentStep.CREATE_AGENT,
  AgentStep.NEW_TASK_STATE,
  AgentStep.TASK_STATE,
  AgentStep.ACTIVATE_AGENT,
  AgentStep.DEACTIVATE_AGENT,
  AgentStep.ASSIGN_TASK,
  AgentStep.ACTIVATE_TOOLKIT,
  AgentStep.DEACTIVATE_TOOLKIT,
  AgentStep.TERMINAL,
  AgentStep.WRITE_FILE,
  AgentStep.TODO_STATE,
  AgentStep.ADD_TASK,
  AgentStep.REMOVE_TASK,
  AgentStep.DECOMPOSE_TEXT,
  AgentStep.CONFIRMED,
  AgentStep.WAIT_CONFIRM,
]);

/** Truncate original content for the (dev-only) inspect chip. */
function previewOf(content: string | undefined): string | undefined {
  if (!content) return undefined;
  return content.length > 120 ? `${content.slice(0, 120)}…` : content;
}

/** Steps that map to an `error`/`failed` channel item. */
function errorTypeFor(step: string): {
  kind: 'error' | 'failed';
  errorType: 'budget' | 'context_too_long' | 'generic';
} | null {
  switch (step) {
    case AgentStep.BUDGET_NOT_ENOUGH:
      return { kind: 'error', errorType: 'budget' };
    case AgentStep.CONTEXT_TOO_LONG:
      return { kind: 'error', errorType: 'context_too_long' };
    case AgentStep.ERROR:
      return { kind: 'error', errorType: 'generic' };
    case AgentStep.FAILED:
      return { kind: 'failed', errorType: 'generic' };
    default:
      return null;
  }
}

/**
 * Fold an ordered list of per-turn tasks into the project's session channel.
 * Items carry a monotonically increasing `seq` across the whole channel.
 */
export function buildProjectChannel(turns: TurnInput[]): ChannelItem[] {
  const items: ChannelItem[] = [];
  let seq = 0;

  // Generic on the `kind` discriminant so the object literal is checked against
  // the concrete item type (proper excess-property checking per kind).
  const push = <K extends ChannelItemKind>(
    item: Omit<ChannelItemOfKind<K>, 'seq'> & { kind: K }
  ): void => {
    items.push({ ...item, seq: seq++ } as ChannelItem);
  };

  turns.forEach(({ turnId, task }, turnIdx) => {
    const createdAt = task.createdAt ?? 0;
    const sessionMode: SessionModeType =
      task.sessionMode ?? SessionMode.WORKFORCE;

    // 1. Turn boundary — opens the turn.
    push({
      id: `tb-${turnId}`,
      kind: 'turn-boundary',
      turnId,
      createdAt,
      turnNumber: turnIdx + 1,
      source: task.source,
      executionId: task.executionId,
      sessionMode,
      status: task.status,
    });

    let planEmitted = false;
    const emitPlan = () => {
      if (planEmitted) return;
      planEmitted = true;
      push({
        id: `plan-${turnId}`,
        kind: 'plan',
        turnId,
        createdAt,
        subTasks: task.taskInfo ?? [],
        summaryTask: task.summaryTask ?? '',
        confirmed: !task.planDirty,
        planDirty: !!task.planDirty,
        streamingDecomposeText: task.streamingDecomposeText ?? '',
      });
    };

    let workLogEmitted = false;
    const emitWorkLog = () => {
      if (workLogEmitted) return;
      const blocks = buildAgentBlocks(
        mergeTaggedAgentLogs(task.taskAssigning),
        sessionMode === SessionMode.SINGLE_AGENT
      );
      // Reserve the slot in the channel while the task is still running even
      // if no blocks have arrived yet — this locks the position BEFORE any
      // agent-message/ask items so the order is always:
      //   plan → work-log → agent-message / ask
      // The WorkLogRenderer shows a preparing spinner for empty running blocks.
      if (!blocks.length && task.status !== 'running') return;
      workLogEmitted = true;
      push({
        id: `wl-${turnId}-0`,
        kind: 'work-log',
        turnId,
        createdAt,
        sectionIndex: 0,
        blocks,
        status: task.status === 'running' ? 'running' : 'done',
      });
    };

    // 2. Walk the turn's high-level conversation messages in order. Tool-call
    //    detail lives in `taskAssigning[].log`, not here, so there is no
    //    double counting between messages and the work-log item.
    const messages = task.messages ?? [];
    messages.forEach((message) => {
      if (message.step === AgentStep.SYNC) return;

      if (message.role === 'user') {
        push({
          id: `um-${message.id}`,
          kind: 'user-message',
          turnId,
          createdAt,
          content: message.content ?? '',
          attaches: message.attaches,
        });
        return;
      }

      if (message.step === AgentStep.TO_SUB_TASKS) {
        emitPlan();
        emitWorkLog();
        return;
      }

      if (message.content === 'skip') {
        push({
          id: `skip-${message.id}`,
          kind: 'skip-marker',
          turnId,
          createdAt,
          reason: 'timeout',
        });
        return;
      }

      const err = errorTypeFor(message.step ?? '');
      if (err) {
        push({
          id: `err-${message.id}`,
          kind: err.kind,
          turnId,
          createdAt,
          content: message.content ?? '',
          errorType: err.errorType,
        });
        return;
      }

      if (message.step === AgentStep.ASK) {
        // Ensure plan and work-log appear BEFORE the ask in the channel
        // (same anchor used for answer/end messages above).
        emitPlan();
        emitWorkLog();

        const desc = parseAskMessage(message);
        const agentId = message.agent_id ?? message.agent_name ?? '';
        // `activeAsk` holds the agent name; an ask is unanswered while it is the
        // task's active ask. (Previously compared against the question text,
        // which is never equal, so `answered` was always true.)
        const answered = task.activeAsk !== agentId;

        if (desc.kind === 'followup') {
          push({
            id: `fq-${message.id}`,
            kind: 'followup-questions',
            turnId,
            createdAt,
            agent: agentId,
            question: desc.question,
            questions: desc.questions ?? [],
            answered,
          });
          return;
        }

        push({
          id: `ask-${message.id}`,
          kind: 'ask',
          turnId,
          createdAt,
          question: desc.question,
          agent: agentId,
          // `followup` is handled above; the rest map 1:1 onto AskInputKind.
          inputKind: desc.kind as AskInputKind,
          options: desc.options,
          answered,
        });
        return;
      }

      // Everything reaching here should be displayable agent narration: a known
      // answer/end/agent-end/notice step, or a plain streamed answer (empty
      // step). Any other step is either a structural/tool event that leaked into
      // `messages[]` or an unknown/renamed step from a legacy project — demote it
      // to a hidden `unsupported` item rather than render its raw payload.
      const step = message.step ?? '';
      const isDisplayableStep =
        step === '' ||
        step === AgentStep.END ||
        step === AgentStep.AGENT_END ||
        step === AgentStep.AGENT_SUMMARY_END ||
        step === AgentStep.NOTICE ||
        step === AgentStep.NOTICE_CARD;

      if (!isDisplayableStep) {
        push({
          id: `unsup-${message.id}`,
          kind: 'unsupported',
          turnId,
          createdAt,
          reason: STRUCTURAL_STEPS.has(step)
            ? 'structural-step'
            : 'unknown-step',
          sourceStep: step || undefined,
          sourceRole: message.role,
          preview: previewOf(message.content),
          messageId: message.id,
        });
        return;
      }

      const variant: AgentMessageItem['variant'] =
        message.step === AgentStep.END
          ? 'end'
          : message.step === AgentStep.AGENT_END ||
              message.step === AgentStep.AGENT_SUMMARY_END
            ? 'agent-end'
            : message.step === AgentStep.NOTICE ||
                message.step === AgentStep.NOTICE_CARD
              ? 'notice'
              : 'answer';

      // The very first agent narration after planning is a good anchor for the
      // work-log section in turns that never emit TO_SUB_TASKS (single-agent /
      // todo flows): make sure plan + work-log exist before the first answer.
      if (variant === 'answer' || variant === 'end') {
        emitPlan();
        emitWorkLog();
      }

      push({
        id: `am-${message.id}`,
        kind: 'agent-message',
        turnId,
        createdAt,
        content: message.content ?? '',
        agentName: message.agent_name,
        variant,
        fileList: message.fileList,
        streaming: false,
        messageId: message.id,
      });
    });

    // 3. Trailing fallbacks: a turn may have accumulated a plan / work-log /
    //    chain-of-thought without a matching message (e.g. still planning, or
    //    a single-agent turn that produced only tool logs).
    if (
      !planEmitted &&
      ((task.taskInfo?.length ?? 0) > 0 ||
        (task.summaryTask ?? '').length > 0 ||
        (task.streamingDecomposeText ?? '').length > 0)
    ) {
      emitPlan();
    }
    if (!workLogEmitted) emitWorkLog();

    if ((task.cotList?.length ?? 0) > 0) {
      push({
        id: `cot-${turnId}`,
        kind: 'chain-of-thought',
        turnId,
        createdAt,
        cot: task.cotList ?? [],
      });
    }
  });

  return items;
}
