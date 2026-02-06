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

import { Textarea } from '@/components/ui/textarea';
import { Check, CircleDashed, PenLine, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/button';

interface TaskItemProps {
  taskInfo: {
    id: string;
    content: string;
  };
  taskIndex: number;
  onUpdate: (content: string) => void;
  onSave: () => void;
  onDelete: () => void;
}

export function TaskItem({
  taskInfo,
  taskIndex,
  onUpdate,
  onSave,
  onDelete,
}: TaskItemProps) {
  const { t } = useTranslation();
  const [isFocus, setIsFocus] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const handleFocus = (e: React.MouseEvent<any>, isFocus: boolean) => {
    e.stopPropagation();
    if (isFocus) {
      setIsFocus(true);
      textareaRef.current?.focus();
    } else {
      setIsFocus(false);
      textareaRef.current?.blur();
    }
  };

  // auto adjust height
  const adjustHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  };

  // when content changes, adjust height
  useEffect(() => {
    adjustHeight();
  }, [taskInfo.content]);

  return (
    <div key={`task-item-${taskIndex}`}>
      <div
        onDoubleClick={(e) => handleFocus(e, true)}
        className={`group relative flex min-h-2 items-start rounded-lg border border-solid border-transparent p-sm hover:bg-task-fill-hover ${
          isFocus ? 'border-task-border-focus-default bg-task-fill-default' : ''
        }`}
      >
        <div className="flex h-4 w-7 flex-shrink-0 cursor-pointer items-center justify-center pr-sm pt-1">
          {taskInfo.id === '' ? (
            <CircleDashed size={13} className="text-icon-secondary" />
          ) : (
            <div className="h-2 w-2 rounded-full bg-icon-information"></div>
          )}
        </div>
        <div
          className={`relative flex min-h-4 w-full items-start border-[0px] border-b border-solid border-task-border-default pb-2 transition-all duration-300 group-hover:border-transparent`}
        >
          <Textarea
            ref={textareaRef}
            placeholder={t('layout.add-new-task')}
            className={`${
              isFocus && 'w-[calc(100%-52px)]'
            } min-h-2 resize-none overflow-hidden rounded-none border-none bg-transparent p-0 text-xs leading-[20px] shadow-none ring-0 focus-visible:ring-0 focus-visible:ring-offset-0`}
            value={taskInfo.content}
            onChange={(e) => onUpdate(e.target.value)}
            onBlur={() => {
              setTimeout(() => {
                onSave();
                setIsFocus(false);
              }, 100);
            }}
            rows={1}
          />
          {!isFocus && (
            <div className="absolute inset-0 h-full w-full bg-transparent"></div>
          )}
        </div>
        <div
          className={`absolute right-2 top-2 flex items-center gap-xs group-hover:opacity-100 ${
            isFocus ? 'opacity-100' : 'opacity-0'
          } transition-opacity duration-300`}
        >
          {!isFocus ? (
            <Button
              onClick={(e) => handleFocus(e, true)}
              className="rounded-full"
              variant="outline"
              size="icon"
            >
              <PenLine size={16} className="" />
            </Button>
          ) : (
            <Button
              onClick={(e) => {
                onSave();
                handleFocus(e, false);
              }}
              className="rounded-full"
              variant="success"
              size="icon"
            >
              <Check
                size={16}
                className="text-button-fill-success-foreground"
              />
            </Button>
          )}
          <Button
            onClick={() => onDelete()}
            className="rounded-full"
            variant="cuation"
            size="icon"
          >
            <Trash2 size={16} className="text-icon-tertiary" />
          </Button>
        </div>
      </div>
    </div>
  );
}
