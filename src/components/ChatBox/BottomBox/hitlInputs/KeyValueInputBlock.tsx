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
import { Eye, EyeOff } from 'lucide-react';
import React, { useState } from 'react';

interface Props {
  block: Extract<HitlInputBlock, { kind: 'key_value' }>;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}

export const KeyValueInputBlock: React.FC<Props> = ({
  block,
  value,
  onChange,
  disabled,
}) => {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="gap-1 flex w-full flex-col">
      {block.label && (
        <span className="text-label-xs font-medium text-ds-text-neutral-muted-default">
          {block.label}
        </span>
      )}
      <div className="gap-2 flex items-center">
        <input
          type={block.secret && !revealed ? 'password' : 'text'}
          className="rounded-xl border-ds-border-neutral-default-default bg-ds-bg-neutral-default-default px-3 py-2 text-sm text-ds-text-neutral-default-default placeholder:text-ds-text-neutral-muted-default focus:ring-ds-border-brand-default-focus/40 flex-1 border focus:ring-2 focus:outline-none disabled:opacity-50"
          placeholder={block.secret ? '••••••••' : 'Enter value…'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          autoFocus
        />
        {block.secret && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
            onClick={() => setRevealed((v) => !v)}
            disabled={disabled}
          >
            {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
          </Button>
        )}
      </div>
    </div>
  );
};
