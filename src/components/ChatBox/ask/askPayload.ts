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
 * Shared parser for human-in-the-loop `ask` events.
 *
 * Frontend-only contract: the backend ask event is unchanged. When the model
 * wants a richer answer than free text it emits the structured ask as a JSON
 * block inside the ask message *content*; we parse `message.content` here. A
 * plain-text ask (today's behavior) simply yields `kind: 'text'`.
 *
 * Supported shapes (inside a ```json … ``` fence or as a bare object):
 *   single  → { question, input_kind?: 'single', options: [...] }
 *   multi   → { question, input_kind: 'multi',   options: [...] }
 *   confirm → { question, input_kind: 'confirm', options?: [...] }
 *   followup→ { question?, questions: [{ question, input_kind?, options }] }
 *
 * `options` entries may be `"value"` strings or `{ value, label }` objects.
 *
 * This is the single source both the session-channel reducer (to derive
 * `ask` / `followup-questions` channel items) and the BottomBox question
 * variant (to render the answer controls) read from — they never diverge.
 */

import { AgentStep } from '@/types/constants';

/** Answer shape requested by an ask. `followup` carries N sub-questions. */
export type AskKind = 'text' | 'single' | 'multi' | 'confirm' | 'followup';

export interface AskOption {
  value: string;
  label: string;
}

export interface AskSubQuestion {
  id: string;
  prompt: string;
  inputKind: 'single' | 'multi';
  options: AskOption[];
}

/** Unified read-model of the active ask, consumed by every renderer. */
export interface AskInputDescriptor {
  /** Agent the reply is addressed to (matches `task.activeAsk`). */
  agent: string;
  /** Headline question (for `followup` this is the optional intro). */
  question: string;
  kind: AskKind;
  /** Present for single / multi / confirm. */
  options?: AskOption[];
  /** Present for followup. */
  questions?: AskSubQuestion[];
}

/** Pull the first balanced `{ … }` object out of text (fenced or bare). */
function extractJsonObject(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1]! : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeOptions(raw: unknown): AskOption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((o): AskOption | null => {
      if (typeof o === 'string') return { value: o, label: o };
      if (o && typeof o === 'object') {
        const value = (o as any).value ?? (o as any).label;
        const label = (o as any).label ?? (o as any).value;
        if (value == null) return null;
        return { value: String(value), label: String(label) };
      }
      return null;
    })
    .filter((o): o is AskOption => o !== null && o.label.length > 0);
}

/** Parse a single ASK message into a descriptor (defaults to free text). */
export function parseAskMessage(message: Message): AskInputDescriptor {
  const agent = message.agent_id ?? message.agent_name ?? '';
  const content = message.content ?? '';
  const parsed = extractJsonObject(content);

  // Follow-up questionnaire: N sub-questions answered together.
  if (parsed && Array.isArray((parsed as any).questions)) {
    const questions: AskSubQuestion[] = (parsed as any).questions
      .map(
        (q: any, i: number): AskSubQuestion => ({
          id: String(q?.id ?? `q${i}`),
          prompt: String(q?.question ?? q?.prompt ?? ''),
          inputKind:
            q?.input_kind === 'multi' || q?.type === 'multi'
              ? 'multi'
              : 'single',
          options: normalizeOptions(q?.options),
        })
      )
      .filter((q: AskSubQuestion) => q.prompt && q.options.length > 0);
    if (questions.length > 0) {
      return {
        agent,
        kind: 'followup',
        question: String(
          (parsed as any).question ?? (parsed as any).prompt ?? ''
        ),
        questions,
      };
    }
  }

  // Single / multi / confirm choice.
  if (parsed && Array.isArray((parsed as any).options)) {
    const options = normalizeOptions((parsed as any).options);
    if (options.length > 0) {
      const rawKind = (parsed as any).input_kind ?? (parsed as any).type;
      const kind: AskKind =
        rawKind === 'multi'
          ? 'multi'
          : rawKind === 'confirm'
            ? 'confirm'
            : 'single';
      return {
        agent,
        kind,
        question: String(
          (parsed as any).question ?? (parsed as any).prompt ?? content
        ),
        options,
      };
    }
  }

  return { agent, kind: 'text', question: content };
}

/**
 * Resolve the ask currently awaiting an answer on a live task. `task.activeAsk`
 * holds the agent name; the matching ask is the most recent ASK message.
 */
export function deriveActiveAsk(
  task: { activeAsk?: string; messages?: Message[] } | null | undefined
): AskInputDescriptor | null {
  if (!task?.activeAsk) return null;
  const messages = task.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.step === AgentStep.ASK) {
      return { ...parseAskMessage(messages[i]!), agent: task.activeAsk };
    }
  }
  return null;
}

/** Resolve an option value to its display label. */
export function labelForOption(options: AskOption[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}
