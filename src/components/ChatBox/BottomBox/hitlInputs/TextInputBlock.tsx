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
import type { HitlInputBlock } from '@/components/ChatBox/renderSession/types';
import { Button } from '@/components/ui/button';
import { Send } from 'lucide-react';
import React from 'react';

interface Props {
  block: Extract<HitlInputBlock, { kind: 'text' }>;
  value: string;
  onChange: (v: string) => void;
  onSubmit?: (v: string) => void;
  disabled?: boolean;
}

export const TextInputBlock: React.FC<Props> = ({
  block,
  value,
  onChange,
  onSubmit,
  disabled,
}) => {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && value.trim() && onSubmit) {
      e.preventDefault();
      onSubmit(value.trim());
    }
  };

  return (
    <div className="gap-2 flex w-full items-end">
      <textarea
        className="rounded-xl border-ds-border-neutral-default-default bg-ds-bg-neutral-default-default px-3 py-2 text-sm text-ds-text-neutral-default-default placeholder:text-ds-text-neutral-muted-default focus:ring-ds-border-brand-default-focus/40 min-h-[60px] flex-1 resize-none border focus:ring-2 focus:outline-none disabled:opacity-50"
        placeholder={block.placeholder ?? 'Type your reply…'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        autoFocus
      />
      {onSubmit && (
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
      )}
    </div>
  );
};
