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

import { fetchGet } from '@/api/http';

const PAGE_LIMIT = 500;
const MAX_PAGES = 20;
const DEADLINE_MS = 5_000;
const MAX_DISPLAY_BYTES = 8 * 1024 * 1024;
const DISPLAY_STEPS = new Set([
  'create_agent',
  'assign_task',
  'task_state',
  'todo_state',
  'deactivate_toolkit',
  'terminal',
  'write_file',
  'notice',
]);
const DISPLAY_STEP_CONTEXT = new Set(['step.created', 'step.started']);
const TOOL_ORIGIN_CONTEXT = new Set([
  'tool.prepared',
  'tool.dispatched',
  'activate_toolkit',
]);
const TERMINAL_EVENTS = new Set([
  'run.completed',
  'run.failed',
  'run.deadline_reached',
  'run.cancelled',
]);

type UsageReconciliationInput = {
  projectId: string;
  runId: string;
  terminalEventTypes: readonly string[];
  throughSequence?: number;
  signal?: AbortSignal;
  expectedAccountKey?: string;
};

export type TerminalDisplayEvent = {
  eventId: string;
  step: string;
  payload: Record<string, unknown>;
};

type TerminalRunResult = {
  tokens: number;
  displayEvents: TerminalDisplayEvent[];
  assistantFinal?: {
    eventId: string;
    payload: Record<string, unknown>;
  };
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Run usage replay returned an invalid object');
  }
  return value as Record<string, unknown>;
}

function tokens(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Run usage replay returned an invalid token count');
  return value;
}

function sum(left: number, right: number): number {
  const total = left + right;
  if (!Number.isSafeInteger(total))
    throw new Error('Run usage replay exceeded the safe token count');
  return total;
}

/** Reconcile a known lower bound, never replaying execution/UI side effects. */
export async function reconcileRunUsage(
  input: UsageReconciliationInput
): Promise<number> {
  return (await readTerminalRunResult(input)).tokens;
}

/** Return only receipts covered by the validated terminal boundary. */
export async function readTerminalRunResult({
  projectId,
  runId,
  terminalEventTypes,
  throughSequence,
  signal,
  expectedAccountKey,
}: UsageReconciliationInput): Promise<TerminalRunResult> {
  if (
    !projectId ||
    !runId ||
    terminalEventTypes.length === 0 ||
    terminalEventTypes.some((type) => !TERMINAL_EVENTS.has(type)) ||
    (throughSequence !== undefined &&
      (!Number.isSafeInteger(throughSequence) || throughSequence < 1))
  ) {
    throw new Error('Run usage reconciliation requires an exact terminal Run');
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const deadline = setTimeout(
    () =>
      controller.abort(
        new DOMException('Run usage reconciliation timed out', 'TimeoutError')
      ),
    DEADLINE_MS
  );
  const readPage = async (cursor: number, limit: number) => {
    if (controller.signal.aborted) throw controller.signal.reason;
    let rejectOnAbort!: () => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectOnAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', rejectOnAbort, {
        once: true,
      });
    });
    try {
      return await Promise.race([
        fetchGet(
          `/runs/${encodeURIComponent(runId)}/events`,
          { after_sequence: cursor, limit },
          undefined,
          {
            signal: controller.signal,
            ...(expectedAccountKey !== undefined && { expectedAccountKey }),
          }
        ),
        aborted,
      ]);
    } finally {
      controller.signal.removeEventListener('abort', rejectOnAbort);
    }
  };

  const seenEvents = new Set<string>();
  const invocations = new Map<string, number>();
  const agentTurns = new Map<string, { requests: number; summary: number }>();
  let assistantFinal: TerminalRunResult['assistantFinal'];
  const displayEvents: TerminalDisplayEvent[] = [];
  let displayBytes = 0;
  const retainDisplay = (value: unknown) => {
    displayBytes += JSON.stringify(value).length * 2;
    if (displayBytes > MAX_DISPLAY_BYTES)
      throw new Error('Run result replay exceeded the display byte bound');
  };
  let completedLegacyTokens = 0;
  const finishTurn = (key: string) => {
    const turn = agentTurns.get(key);
    if (!turn) return;
    completedLegacyTokens = sum(
      completedLegacyTokens,
      Math.max(turn.requests, turn.summary)
    );
    agentTurns.delete(key);
  };
  const total = () => {
    let legacy = completedLegacyTokens;
    for (const turn of agentTurns.values()) {
      legacy = sum(legacy, Math.max(turn.requests, turn.summary));
    }
    let model = 0;
    for (const count of invocations.values()) model = sum(model, count);
    // Both lanes describe the same provider calls; adding them double-counts.
    return Math.max(model, legacy);
  };

  try {
    let cursor = 0;
    for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex += 1) {
      const limit = Math.min(
        PAGE_LIMIT,
        throughSequence === undefined ? PAGE_LIMIT : throughSequence - cursor
      );
      const page = object(await readPage(cursor, limit));
      if (controller.signal.aborted) throw controller.signal.reason;
      if (
        page.run_id !== runId ||
        (page.project_id !== undefined && page.project_id !== projectId) ||
        page.after_sequence !== cursor ||
        !Array.isArray(page.events) ||
        page.events.length > limit ||
        typeof page.has_more !== 'boolean'
      ) {
        throw new Error('Run usage replay returned an invalid page scope');
      }
      const events = page.events.map(object);
      let expected = cursor;
      for (const event of events) {
        expected += 1;
        if (
          event.project_id !== projectId ||
          event.run_id !== runId ||
          event.sequence !== expected ||
          (event.run_sequence !== undefined &&
            event.run_sequence !== expected) ||
          typeof event.event_id !== 'string' ||
          !event.event_id ||
          seenEvents.has(event.event_id) ||
          typeof event.event_type !== 'string'
        ) {
          throw new Error(
            'Run usage replay returned an invalid event scope or sequence'
          );
        }
        object(event.payload);
        seenEvents.add(event.event_id);
      }
      if (
        page.next_sequence !== expected ||
        (page.has_more && expected <= cursor)
      ) {
        throw new Error('Run usage replay cursor did not advance correctly');
      }

      for (const event of events) {
        const payload = object(event.payload);
        if (
          event.event_type === 'assistant.final' &&
          terminalEventTypes.includes('run.completed')
        ) {
          if (
            assistantFinal ||
            (event.legacy_step !== undefined &&
              event.legacy_step !== null &&
              event.legacy_step !== 'end')
          ) {
            throw new Error(
              'Run result replay returned an ambiguous final answer'
            );
          }
          assistantFinal = {
            eventId: event.event_id as string,
            payload,
          };
          retainDisplay(assistantFinal);
        }
        // Durable tool checkpoints have no legacy_step. Retain their safe
        // output and authored Step identity, never their execution controls.
        const displayStep = DISPLAY_STEPS.has(String(event.legacy_step))
          ? (event.legacy_step as string)
          : ['tool.completed', 'tool.failed'].includes(String(event.event_type))
            ? 'deactivate_toolkit'
            : DISPLAY_STEP_CONTEXT.has(String(event.event_type)) ||
                TOOL_ORIGIN_CONTEXT.has(String(event.event_type))
              ? (event.event_type as string)
              : event.legacy_step === 'activate_toolkit'
                ? 'activate_toolkit'
                : undefined;
        if (terminalEventTypes.includes('run.completed') && displayStep) {
          // Initiation is ownership context only. Do not retain execution
          // arguments or render its input/output as a completed tool result.
          const displayPayload = TOOL_ORIGIN_CONTEXT.has(displayStep)
            ? Object.fromEntries(
                Object.entries(payload).filter(([key]) =>
                  [
                    'tool_call_id',
                    'step_id',
                    'run_id',
                    'process_task_id',
                    'task_id',
                    'agent_id',
                    'assignee_id',
                    'agent_name',
                    'semantic',
                  ].includes(key)
                )
              )
            : payload;
          const displayEvent = {
            eventId: event.event_id as string,
            step: displayStep,
            payload: displayPayload,
          };
          retainDisplay(displayEvent);
          displayEvents.push(displayEvent);
        }
        if (event.event_type === 'model.invocation.completed') {
          if (
            typeof payload.invocation_id !== 'string' ||
            !payload.invocation_id
          )
            throw new Error('Run usage replay is missing invocation identity');
          const usage = object(payload.usage ?? {});
          const count = sum(
            tokens(usage.prompt_tokens),
            tokens(usage.completion_tokens)
          );
          invocations.set(
            payload.invocation_id,
            Math.max(invocations.get(payload.invocation_id) ?? 0, count)
          );
        }
        const step =
          event.legacy_step ??
          (event.event_type === 'legacy.request_usage'
            ? 'request_usage'
            : null);
        if (
          ['request_usage', 'activate_agent', 'deactivate_agent'].includes(
            String(step)
          )
        ) {
          const key = JSON.stringify([
            payload.agent_id ?? null,
            payload.process_task_id ?? null,
          ]);
          if (step === 'activate_agent') finishTurn(key);
          const turn = agentTurns.get(key) ?? { requests: 0, summary: 0 };
          if (step === 'request_usage')
            turn.requests = sum(turn.requests, tokens(payload.tokens));
          else turn.summary = sum(turn.summary, tokens(payload.tokens));
          agentTurns.set(key, turn);
          if (step === 'deactivate_agent') finishTurn(key);
        }

        if (
          terminalEventTypes.includes(event.event_type as string) &&
          (throughSequence === undefined || event.sequence === throughSequence)
        ) {
          return {
            tokens: total(),
            displayEvents:
              event.event_type === 'run.completed' ? displayEvents : [],
            ...(event.event_type === 'run.completed' && assistantFinal
              ? { assistantFinal }
              : {}),
          };
        }
      }
      cursor = expected;
      if (cursor === throughSequence || !page.has_more) {
        throw new Error(
          'Run usage replay ended before the matching terminal boundary'
        );
      }
    }
    throw new Error('Run usage replay exceeded the 10000-event scan bound');
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener('abort', onAbort);
  }
}
