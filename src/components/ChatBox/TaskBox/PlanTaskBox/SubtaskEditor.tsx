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

import { CircleDashed } from 'lucide-react';
import { KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface SubtaskEditorProps {
  taskInfo: TaskInfo[];
  onAdd: () => void;
  onUpdate: (index: number, content: string) => void;
  onDelete: (index: number) => void;
  onMarkDirty: () => void;
}

export function SubtaskEditor({
  taskInfo,
  onAdd,
  onUpdate,
  onDelete,
  onMarkDirty,
}: SubtaskEditorProps) {
  const { t } = useTranslation();
  const inputRefs = useRef<Array<HTMLTextAreaElement | null>>([]);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);

  useEffect(() => {
    if (focusIndex === null) return;
    const el = inputRefs.current[focusIndex];
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
    setFocusIndex(null);
  }, [focusIndex, taskInfo.length]);

  const handleKey = (
    e: KeyboardEvent<HTMLTextAreaElement>,
    index: number,
    content: string
  ) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onMarkDirty();
      onAdd();
      setFocusIndex(taskInfo.length);
      return;
    }
    if (e.key === 'Backspace' && content === '' && taskInfo.length > 1) {
      e.preventDefault();
      onMarkDirty();
      onDelete(index);
      setFocusIndex(Math.max(0, index - 1));
    }
  };

  const autoResize = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  return (
    <div className="px-1 py-1 flex flex-col">
      {taskInfo.map((task, index) => (
        <div
          key={task.id || `row-${index}`}
          className="gap-2 p-1 flex items-start"
        >
          <div className="h-6 flex shrink-0 items-center justify-center">
            <CircleDashed
              size={16}
              className="text-ds-icon-status-splitting-default-default mt-0.5 fill-current"
            />
          </div>
          <textarea
            ref={(el) => {
              inputRefs.current[index] = el;
              autoResize(el);
            }}
            value={task.content}
            placeholder={
              index === taskInfo.length - 1
                ? t('chat.add-subtask-placeholder')
                : ''
            }
            onChange={(e) => {
              onMarkDirty();
              onUpdate(index, e.target.value);
              autoResize(e.currentTarget);
            }}
            onKeyDown={(e) => handleKey(e, index, task.content)}
            rows={1}
            className="text-body-sm font-normal text-ds-text-neutral-default-default placeholder:text-ds-text-neutral-subtle-disabled min-w-0 leading-10 flex-1 resize-none border-none bg-transparent focus:outline-none"
          />
        </div>
      ))}
    </div>
  );
}
