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

import { useRenderSession } from '@/components/ChatBox/renderSession/RenderSessionProvider';
import type { QuestionChatBlock } from '@/components/ChatBox/renderSession/types';
import { Button } from '@/components/ui/button';
import { CircleUser, Clock, Send } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

const AUTO_SKIP_MS = 30_000;

interface QuestionBlockProps {
  block: QuestionChatBlock;
}

// ---------------------------------------------------------------------------
// ChoiceInput
// ---------------------------------------------------------------------------

const ChoiceInput: React.FC<{
  choices: string[];
  disabled: boolean;
  onSubmit: (choice: string) => void;
}> = ({ choices, disabled, onSubmit }) => (
  <div className="gap-2 flex flex-wrap">
    {choices.map((choice) => (
      <Button
        key={choice}
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled}
        onClick={() => onSubmit(choice)}
        className="rounded-full"
      >
        {choice}
      </Button>
    ))}
  </div>
);

// ---------------------------------------------------------------------------
// TextInput
// ---------------------------------------------------------------------------

const TextInput: React.FC<{
  disabled: boolean;
  onSubmit: (value: string) => void;
  placeholder?: string;
}> = ({ disabled, onSubmit, placeholder = 'Type your reply…' }) => {
  const [value, setValue] = useState('');

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && value.trim()) {
      e.preventDefault();
      onSubmit(value.trim());
    }
  };

  return (
    <div className="gap-2 flex items-end">
      <textarea
        className="rounded-xl border-ds-border-neutral-default-default bg-ds-bg-neutral-default-default px-3 py-2 text-sm text-ds-text-neutral-default-default placeholder:text-ds-text-neutral-muted-default focus:ring-ds-border-brand-default-focus/40 min-h-[80px] flex-1 resize-none border focus:ring-2 focus:outline-none"
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <Button
        type="button"
        variant="primary"
        size="sm"
        disabled={disabled || !value.trim()}
        onClick={() => onSubmit(value.trim())}
        className="shrink-0 rounded-full"
      >
        <Send size={14} />
      </Button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// ContextInput
// ---------------------------------------------------------------------------

const ContextInput: React.FC<{
  disabled: boolean;
  onSubmit: (value: string) => void;
}> = ({ disabled, onSubmit }) => (
  <TextInput
    disabled={disabled}
    onSubmit={onSubmit}
    placeholder="Add more context… (Shift+Enter for new line)"
  />
);

// ---------------------------------------------------------------------------
// Countdown ring
// ---------------------------------------------------------------------------

const CountdownRing: React.FC<{ secondsLeft: number; total: number }> = ({
  secondsLeft,
  total,
}) => {
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const progress = secondsLeft / total;
  const dash = circumference * progress;

  return (
    <svg width={20} height={20} className="rotate-[-90deg]">
      <circle
        cx={10}
        cy={10}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        className="text-ds-border-neutral-default-default opacity-30"
        strokeDasharray={circumference}
        strokeDashoffset={0}
      />
      <circle
        cx={10}
        cy={10}
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
// QuestionBlock
// ---------------------------------------------------------------------------

export const QuestionBlock: React.FC<QuestionBlockProps> = ({ block }) => {
  const { submitReply } = useRenderSession();
  const [submitted, setSubmitted] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(AUTO_SKIP_MS / 1000);
  const submitRef = useRef<((reply: string) => Promise<void>) | null>(null);

  const isDisabled = !block.isActive || submitted || skipped;

  const handleSubmit = useCallback(
    async (reply: string) => {
      if (isDisabled) return;
      setSubmitted(true);
      try {
        await submitReply(reply, block.agentName);
      } catch {
        // submission failed — re-enable so user can retry
        setSubmitted(false);
      }
    },
    [block.agentName, isDisabled, submitReply]
  );

  // Keep ref stable for the timer callback without adding handleSubmit as a dep
  useEffect(() => {
    submitRef.current = handleSubmit;
  });

  // Auto-skip countdown: only runs when this question is the active one
  useEffect(() => {
    if (!block.isActive || submitted || skipped) return;

    setSecondsLeft(AUTO_SKIP_MS / 1000);

    const interval = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);

    const timer = setTimeout(() => {
      setSkipped(true);
      submitRef.current?.('skip');
    }, AUTO_SKIP_MS);

    return () => {
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, [block.isActive, block.id, submitted, skipped]);

  const agentLabel = block.agentName || 'Agent';

  return (
    <div
      className="rounded-2xl border-ds-border-neutral-default-default bg-ds-bg-neutral-subtle-default p-4 gap-3 flex flex-col border"
      data-question-id={block.id}
      data-active={block.isActive ? 'true' : undefined}
    >
      {/* Header */}
      <div className="gap-2 flex items-center">
        <CircleUser
          size={14}
          className="text-ds-icon-neutral-muted-default shrink-0"
        />
        <span className="text-label-xs font-medium text-ds-text-neutral-muted-default">
          {agentLabel} asks
        </span>

        {/* Countdown — only when active */}
        {block.isActive && !submitted && !skipped && (
          <span className="gap-1 text-label-xs text-ds-text-neutral-muted-default ml-auto flex items-center">
            <CountdownRing
              secondsLeft={secondsLeft}
              total={AUTO_SKIP_MS / 1000}
            />
            <Clock size={10} className="ml-1" />
            {secondsLeft}s
          </span>
        )}

        {/* Submitted / skipped badge */}
        {(submitted || (!block.isActive && !skipped)) && (
          <span className="text-label-xs text-ds-text-neutral-muted-default ml-auto">
            Answered
          </span>
        )}
        {skipped && (
          <span className="text-label-xs text-ds-text-brand-muted-default ml-auto">
            Skipped — task continues
          </span>
        )}
      </div>

      {/* Question text */}
      <p className="text-body-sm text-ds-text-neutral-default-default whitespace-pre-wrap">
        {block.content}
      </p>

      {/* Input control */}
      {!skipped && (
        <div className={isDisabled ? 'pointer-events-none opacity-50' : ''}>
          {block.inputType === 'choice_input' && block.choices ? (
            <ChoiceInput
              choices={block.choices}
              disabled={isDisabled}
              onSubmit={handleSubmit}
            />
          ) : block.inputType === 'context_input' ? (
            <ContextInput disabled={isDisabled} onSubmit={handleSubmit} />
          ) : (
            <TextInput disabled={isDisabled} onSubmit={handleSubmit} />
          )}
        </div>
      )}
    </div>
  );
};
