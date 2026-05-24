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
import { Paperclip, X } from 'lucide-react';
import React, { useRef } from 'react';

interface Props {
  block: Extract<HitlInputBlock, { kind: 'file_upload' }>;
  value: globalThis.File[];
  onChange: (v: globalThis.File[]) => void;
  disabled?: boolean;
}

export const FileUploadBlock: React.FC<Props> = ({
  block,
  value = [],
  onChange,
  disabled,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    onChange([...value, ...Array.from(e.target.files)]);
    e.target.value = '';
  };

  const remove = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  return (
    <div className="gap-2 flex w-full flex-col">
      {block.label && (
        <span className="text-label-xs font-medium text-ds-text-neutral-muted-default">
          {block.label}
        </span>
      )}
      <div className="gap-2 flex flex-wrap">
        {value.map((f, i) => (
          <div
            key={`${f.name}-${i}`}
            className="gap-1 border-ds-border-neutral-default-default px-2 py-1 text-xs flex items-center rounded-full border"
          >
            <span className="max-w-[120px] truncate">{f.name}</span>
            <button type="button" onClick={() => remove(i)} disabled={disabled}>
              <X size={12} />
            </button>
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="gap-2 rounded-full"
        >
          <Paperclip size={14} />
          {value.length === 0 ? 'Attach file…' : 'Add more'}
        </Button>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={block.accept?.join(',')}
        className="hidden"
        onChange={handleFiles}
      />
    </div>
  );
};
