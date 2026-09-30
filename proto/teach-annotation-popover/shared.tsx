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
import { DsIcon } from '@/components/ui/ds-icon';
import { Textarea } from '@/components/ui/textarea';
import { MessageSquarePlus } from 'lucide-react';
import type { FormEvent, KeyboardEvent } from 'react';

export type VariantProps = {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
};

export function AnnotationHeader() {
  return (
    <header className="proto-annotation-header">
      <span className="proto-annotation-icon" aria-hidden="true">
        <DsIcon icon={MessageSquarePlus} recipe="detailed" />
      </span>
      <span className="proto-annotation-heading">
        <span className="proto-annotation-title">Final answer</span>
        <span className="proto-annotation-detail">Whole run</span>
      </span>
    </header>
  );
}

export function CommentInput({
  id,
  value,
  onChange,
  onSave,
}: VariantProps & { id: string }) {
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      if (value.trim()) onSave();
    }
  };
  return (
    <>
      <label className="proto-field-label" htmlFor={id}>
        Your comment
      </label>
      <Textarea
        id={id}
        variant="outlined"
        size="sm"
        rows={3}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="What was done well, or what should improve?"
        className="proto-comment-input"
      />
    </>
  );
}

export function FormFooter({ value }: { value: string }) {
  const shortcut = /Mac/.test(navigator.platform) ? '⌘ Enter' : 'Ctrl Enter';
  return (
    <footer className="proto-annotation-footer">
      <span className="proto-shortcut-hint">{shortcut}</span>
      <Button
        type="submit"
        variant="primary"
        size="sm"
        disabled={!value.trim()}
      >
        Save comment
      </Button>
    </footer>
  );
}

export function handleSubmit(
  event: FormEvent<HTMLFormElement>,
  onSave: () => void
) {
  event.preventDefault();
  onSave();
}
