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
 * BottomBox "question and answer" wizard.
 *
 * All ask kinds are normalised into a flat list of 1..N questions and
 * shown one at a time. Layout per question:
 *
 *   ┌─────────────────────────────────────────┐
 *   │  [1 / 4]  Question text here …          │
 *   │                                         │
 *   │  [Option A]                             │
 *   │  [Option B]   ← or textarea for text    │
 *   │                                         │
 *   │  [← Back]               [Next →]        │
 *   └─────────────────────────────────────────┘
 *
 * Calls `onAnswer(reply, display)` exactly once when the user reaches
 * the last question and submits.
 */

import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import {
  labelForOption,
  type AskInputDescriptor,
  type AskOption,
} from '../../ask/askPayload';

export interface QuestionVariantProps {
  ask: AskInputDescriptor;
  onAnswer: (reply: string, display?: string) => void | Promise<void>;
  disabled?: boolean;
}

// ── Internal wizard question shape ──────────────────────────────────────────

interface WizardQuestion {
  id: string;
  text: string;
  inputKind: 'text' | 'single' | 'multi' | 'confirm';
  options: AskOption[];
}

type AnswerMap = Record<string, { selected: string[]; text: string }>;

/** Flatten any AskInputDescriptor into a 1..N question list. */
function normalizeQuestions(ask: AskInputDescriptor): WizardQuestion[] {
  if (ask.kind === 'followup' && ask.questions?.length) {
    return ask.questions.map((q) => ({
      id: q.id,
      text: q.prompt,
      inputKind: q.inputKind,
      options: q.options,
    }));
  }
  // Single-question kinds.
  const options =
    ask.options && ask.options.length > 0
      ? ask.options
      : ask.kind === 'confirm'
        ? [
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' },
          ]
        : [];
  return [
    {
      id: '__root__',
      text: ask.question,
      inputKind:
        ask.kind === 'confirm'
          ? 'confirm'
          : ask.kind === 'multi'
            ? 'multi'
            : ask.kind === 'text'
              ? 'text'
              : 'single',
      options,
    },
  ];
}

function hasAnswer(q: WizardQuestion, answers: AnswerMap): boolean {
  const a = answers[q.id];
  if (!a) return false;
  return q.inputKind === 'text'
    ? (a.text ?? '').trim().length > 0
    : (a.selected ?? []).length > 0;
}

function buildReply(
  ask: AskInputDescriptor,
  questions: WizardQuestion[],
  answers: AnswerMap
): { reply: string; display: string } {
  if (ask.kind === 'followup') {
    const payload = questions.map((q) => {
      const a = answers[q.id] ?? { selected: [], text: '' };
      const labels =
        q.inputKind === 'text'
          ? [a.text]
          : a.selected.map((v) => labelForOption(q.options, v));
      return { question: q.text, answer: labels };
    });
    const display = payload
      .map((p) => `${p.question} → ${p.answer.join(', ')}`)
      .join('\n');
    return { reply: JSON.stringify(payload), display };
  }

  const a = answers['__root__'] ?? { selected: [], text: '' };
  if (ask.kind === 'text') return { reply: a.text, display: a.text };
  const labels = a.selected.map((v) => labelForOption(ask.options ?? [], v));
  return { reply: a.selected.join(', '), display: labels.join(', ') };
}

// ── Styles ───────────────────────────────────────────────────────────────────

const optionBase =
  'w-full rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors disabled:opacity-50';
const optionIdle =
  'bg-ds-bg-neutral-subtle-default text-ds-text-neutral-default-default hover:bg-ds-bg-neutral-subtle-hover active:bg-ds-bg-neutral-subtle-hover';
const optionSelected =
  'bg-ds-bg-information-subtle-default text-ds-text-information-default-default';

// ── Main component ────────────────────────────────────────────────────────────

export function QuestionVariant({
  ask,
  onAnswer,
  disabled = false,
}: QuestionVariantProps) {
  const [submitting, setSubmitting] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<AnswerMap>({});

  const busy = disabled || submitting;
  const questions = normalizeQuestions(ask);
  const total = questions.length;
  const current = questions[currentIdx]!;
  const isLast = currentIdx === total - 1;
  const answered = hasAnswer(current, answers);

  const selectedForCurrent = answers[current.id]?.selected ?? [];
  const textForCurrent = answers[current.id]?.text ?? '';

  const toggleOption = (value: string) => {
    setAnswers((prev) => {
      const cur = prev[current.id]?.selected ?? [];
      const multi = current.inputKind === 'multi';
      const next = multi
        ? cur.includes(value)
          ? cur.filter((v) => v !== value)
          : [...cur, value]
        : [value];
      return {
        ...prev,
        [current.id]: { ...(prev[current.id] ?? { text: '' }), selected: next },
      };
    });
  };

  const setTextAnswer = (text: string) => {
    setAnswers((prev) => ({
      ...prev,
      [current.id]: { ...(prev[current.id] ?? { selected: [] }), text },
    }));
  };

  const handleNext = async () => {
    if (busy || !answered) return;
    if (!isLast) {
      setCurrentIdx((i) => i + 1);
      return;
    }
    setSubmitting(true);
    try {
      const { reply, display } = buildReply(ask, questions, answers);
      await onAnswer(reply, display);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="gap-3 rounded-3xl bg-ds-bg-neutral-default-default px-3 py-3 flex w-full flex-col">
      {/* ── Header: number tag + question ── */}
      <div className="gap-2 flex flex-col items-start">
        <span className="bg-ds-bg-neutral-subtle-default px-2 py-0.5 text-label-xs font-bold text-ds-text-neutral-muted-default mt-px shrink-0 rounded-full tabular-nums">
          {currentIdx + 1}&thinsp;/&thinsp;{total}
        </span>
        <span className="text-body-sm font-semibold leading-snug text-ds-text-neutral-default-default">
          {current.text}
        </span>
      </div>

      {/* ── Answer controls ── */}
      {current.inputKind === 'text' ? (
        <textarea
          value={textForCurrent}
          onChange={(e) => setTextAnswer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleNext();
            }
          }}
          disabled={busy}
          placeholder="Type your reply… (Enter to send, Shift+Enter for newline)"
          rows={2}
          className="rounded-xl bg-ds-bg-neutral-subtle-default px-3 py-2 text-sm text-ds-text-neutral-default-default placeholder:text-ds-text-neutral-muted-default w-full resize-none focus:outline-none disabled:opacity-50"
        />
      ) : (
        <div className="gap-1.5 flex flex-col">
          {current.options.map((opt) => {
            const isOn = selectedForCurrent.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                disabled={busy}
                className={`${optionBase} ${isOn ? optionSelected : optionIdle}`}
                onClick={() => toggleOption(opt.value)}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Footer: back | submit/next ── */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          disabled={currentIdx === 0 || busy}
          onClick={() => setCurrentIdx((i) => i - 1)}
          className="gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-ds-text-neutral-muted-default hover:bg-ds-bg-neutral-subtle-hover flex items-center transition-colors disabled:pointer-events-none disabled:opacity-0"
        >
          <ArrowLeft size={13} aria-hidden />
          Back
        </button>

        <Button
          variant="primary"
          size="sm"
          buttonRadius="full"
          disabled={busy || !answered}
          onClick={handleNext}
        >
          {isLast ? 'Submit' : 'Next\u00a0→'}
        </Button>
      </div>
    </div>
  );
}
