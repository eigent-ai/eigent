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
import { cn } from '@/lib/utils';
import React from 'react';

interface Props {
  block: Extract<HitlInputBlock, { kind: 'choice' }>;
  value: string | string[];
  onChange: (v: string | string[]) => void;
  onSubmit?: (v: string) => void;
  disabled?: boolean;
}

export const ChoiceInputBlock: React.FC<Props> = ({
  block,
  value,
  onChange,
  onSubmit,
  disabled,
}) => {
  const selected: string[] = Array.isArray(value)
    ? value
    : value
      ? [value]
      : [];

  const toggle = (optValue: string) => {
    if (block.multiSelect) {
      const next = selected.includes(optValue)
        ? selected.filter((s) => s !== optValue)
        : [...selected, optValue];
      onChange(next);
    } else {
      onChange(optValue);
      onSubmit?.(optValue);
    }
  };

  return (
    <div className="gap-2 flex flex-wrap">
      {block.options.map((opt) => {
        const isSelected = selected.includes(opt.value);
        return (
          <Button
            key={opt.value}
            type="button"
            variant={isSelected ? 'primary' : 'secondary'}
            size="sm"
            disabled={disabled}
            onClick={() => toggle(opt.value)}
            className={cn(
              'rounded-full',
              isSelected &&
                'ring-ds-border-brand-default-default ring-2 ring-offset-1'
            )}
          >
            {opt.label}
          </Button>
        );
      })}
    </div>
  );
};
