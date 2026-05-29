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

import type {
  AskPayload,
  HitlInputBlock,
} from '@/components/ChatBox/renderSession/types';
import { Button } from '@/components/ui/button';
import { CircleUser, Send } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChoiceInputBlock, TextInputBlock } from './hitlInputs';

const AUTO_SKIP_MS = 30_000;

// ---------------------------------------------------------------------------
// Countdown ring (visible 30-second timer)
// ---------------------------------------------------------------------------

const CountdownRing: React.FC<{ secondsLeft: number; total: number }> = ({
  secondsLeft,
  total,
}) => {
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * (secondsLeft / total);

  return (
    <svg width={18} height={18} className="shrink-0 rotate-[-90deg]">
      <circle
        cx={9}
        cy={9}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        className="text-ds-border-neutral-default-default opacity-30"
        strokeDasharray={circumference}
        strokeDashoffset={0}
      />
      <circle
        cx={9}
        cy={9}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        className="text-ds-border-brand-default-default transition-all duration-1000"
        strokeDasharray={`${dash} ${circumference}`}
        strokeDashoffset={0}
      />
    </svg>
  );
};

// ---------------------------------------------------------------------------
// Block renderer — text and choice only (core-only scope)
// ---------------------------------------------------------------------------

interface BlockRendererProps {
  block: HitlInputBlock;
  value: unknown;
  onChange: (v: unknown) => void;
  onSubmit?: (v: string) => void;
  disabled?: boolean;
}

function renderBlock({
  block,
  value,
  onChange,
  onSubmit,
  disabled,
}: BlockRendererProps): React.ReactNode {
  switch (block.kind) {
    case 'text':
      return (
        <TextInputBlock
          key={block.id}
          block={block}
          value={(value as string) ?? ''}
          onChange={(v) => onChange(v)}
          onSubmit={onSubmit}
          disabled={disabled}
        />
      );
    case 'choice':
      return (
        <ChoiceInputBlock
          key={block.id}
          block={block}
          value={(value as string | string[]) ?? ''}
          onChange={(v) => onChange(v)}
          onSubmit={onSubmit}
          disabled={disabled}
        />
      );
    default:
      // Forward-compat: render nothing for unrecognised block kinds
      return null;
  }
}

// ---------------------------------------------------------------------------
// BoxHeaderAsk
// ---------------------------------------------------------------------------

interface BoxHeaderAskProps {
  askPayload: AskPayload;
  onSubmit: (reply: string) => void;
}

export const BoxHeaderAsk: React.FC<BoxHeaderAskProps> = ({
  askPayload,
  onSubmit,
}) => {
  const [secondsLeft, setSecondsLeft] = useState(AUTO_SKIP_MS / 1000);
  const [submitted, setSubmitted] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const onSubmitRef = useRef(onSubmit);

  useEffect(() => {
    onSubmitRef.current = onSubmit;
  });

  // Reset state when the question prompt changes
  useEffect(() => {
    setSecondsLeft(AUTO_SKIP_MS / 1000);
    setSubmitted(false);
    setValues({});
  }, [askPayload.prompt]);

  // Countdown tick + auto-skip at 0s
  useEffect(() => {
    if (submitted) return;

    const interval = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);

    const timer = setTimeout(() => {
      setSubmitted(true);
      onSubmitRef.current('skip');
    }, AUTO_SKIP_MS);

    return () => {
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, [askPayload.prompt, submitted]);

  const handleSubmit = useCallback(
    (reply?: string) => {
      if (submitted) return;
      if (reply !== undefined) {
        setSubmitted(true);
        onSubmit(reply);
        return;
      }
      const firstBlock = askPayload.inputs[0];
      if (askPayload.inputs.length === 1 && firstBlock?.kind === 'text') {
        const v = ((values[firstBlock.id] as string) ?? '').trim();
        if (!v) return;
        setSubmitted(true);
        onSubmit(v);
        return;
      }
      setSubmitted(true);
      onSubmit(JSON.stringify({ inputs: values }));
    },
    [submitted, onSubmit, values, askPayload.inputs]
  );

  const setBlockValue = (id: string, v: unknown) => {
    setValues((prev) => ({ ...prev, [id]: v }));
  };

  const showSubmitButton =
    askPayload.inputs.length > 1 ||
    (askPayload.inputs.length === 1 && askPayload.inputs[0]!.kind !== 'choice');

  const agentLabel = askPayload.agentName || 'Agent';

  return (
    <div className="flex flex-col">
      {/* Question display */}
      <div className="border-ds-border-neutral-default-default px-4 pb-2 pt-3 border-b">
        <div className="mb-1 gap-1.5 flex items-center">
          <CircleUser
            size={13}
            className="text-ds-icon-neutral-muted-default shrink-0"
          />
          <span className="text-label-xs font-medium text-ds-text-neutral-muted-default">
            {agentLabel} asks
          </span>
        </div>
        <p className="text-body-sm text-ds-text-neutral-default-default whitespace-pre-wrap">
          {askPayload.prompt}
        </p>
      </div>

      {/* Input + countdown */}
      <div className="gap-3 px-4 pb-2 pt-3 flex flex-col">
        {askPayload.inputs.map((block) =>
          renderBlock({
            block,
            value: values[block.id],
            onChange: (v) => setBlockValue(block.id, v),
            onSubmit:
              askPayload.inputs.length === 1 &&
              (block.kind === 'choice' || block.kind === 'text')
                ? handleSubmit
                : undefined,
            disabled: submitted,
          })
        )}

        {showSubmitButton && (
          <div className="flex justify-end">
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={submitted}
              onClick={() => handleSubmit()}
              className="gap-2 rounded-full"
            >
              <Send size={14} />
              {askPayload.submitLabel ?? 'Send'}
            </Button>
          </div>
        )}

        <div className="gap-1.5 flex items-center justify-end">
          <CountdownRing
            secondsLeft={secondsLeft}
            total={AUTO_SKIP_MS / 1000}
          />
          <span className="text-label-xs text-ds-text-neutral-muted-default">
            {secondsLeft}s auto-skip
          </span>
        </div>
      </div>
    </div>
  );
};
