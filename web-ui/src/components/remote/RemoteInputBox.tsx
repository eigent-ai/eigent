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

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ArrowRight, Gamepad2, Joystick, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/** Read-only agent-mode chip — mirrors the desktop `ProjectModeToggle` read-only state. */
function AgentModeChip({ mode }: { mode: string }) {
  const isSingle = mode === 'single-agent';
  const Icon = isSingle ? Joystick : Gamepad2;
  const label = isSingle ? 'Single Agent' : 'Workforce';
  return (
    <div
      role="status"
      aria-label={`Agent mode: ${label}`}
      className="gap-1.5 px-1 text-ds-text-neutral-muted-default pointer-events-none inline-flex items-center"
    >
      <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
      <span className="!text-label-xs font-semibold whitespace-nowrap">
        {label}
      </span>
    </div>
  );
}

interface RemoteInputBoxProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  placeholder?: string;
  disabled?: boolean;
  /** Agent mode of the active project (read-only display). */
  agentMode?: string | null;
}

export function RemoteInputBox({
  value,
  onChange,
  onSend,
  placeholder = 'Send a message…',
  disabled = false,
  agentMode,
}: RemoteInputBoxProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasContent = value.trim().length > 0;

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !disabled && !isComposing) {
      e.preventDefault();
      if (hasContent) onSend();
    }
  };

  return (
    <div
      className={cn(
        'rounded-3xl border-ds-border-neutral-default-default bg-ds-bg-neutral-subtle-default p-3 shadow-lg relative flex w-full flex-col border border-solid transition-colors',
        isFocused && 'border-ds-border-information-default-default'
      )}
    >
      {/* Text input */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={() => setIsComposing(false)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        className={cn(
          'font-sans text-body-sm pb-3 text-ds-text-neutral-default-default w-full resize-none bg-transparent outline-none',
          'placeholder:font-sans placeholder:text-ds-text-neutral-subtle-disabled',
          'max-h-[200px] min-h-[40px]',
          'disabled:cursor-not-allowed disabled:opacity-60',
          'border-none shadow-none focus-visible:ring-0'
        )}
      />

      {/* Action row */}
      <div className="flex w-full items-center justify-between">
        {/* Left: attachment placeholder */}
        <Button
          type="button"
          variant="ghost"
          size="xs"
          buttonContent="icon-only"
          buttonRadius="lg"
          disabled
          aria-label="Attach"
        >
          <Plus />
        </Button>

        {/* Right: agent mode chip + send button */}
        <div className="gap-2 flex items-center">
          {agentMode ? <AgentModeChip mode={agentMode} /> : null}
          <Button
            type="button"
            size="xs"
            buttonContent="icon-only"
            buttonRadius="full"
            variant="primary"
            tone={hasContent ? 'success' : 'neutral'}
            onClick={onSend}
            disabled={disabled || !hasContent}
            aria-label="Send"
          >
            <ArrowRight
              className={cn(
                'text-current transition-transform duration-200',
                hasContent && '-rotate-90'
              )}
            />
          </Button>
        </div>
      </div>
    </div>
  );
}
