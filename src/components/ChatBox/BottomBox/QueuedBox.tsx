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
import { ChevronDown, ChevronUp, Circle, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface QueuedMessage {
  id: string;
  content: string;
  timestamp?: number;
}

interface QueuedBoxProps {
  queuedMessages?: QueuedMessage[];
  onRemoveQueuedMessage?: (id: string) => void;
  className?: string;
}

export function QueuedBox({
  queuedMessages = [],
  onRemoveQueuedMessage,
  className,
}: QueuedBoxProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(true);
  const hasQueued = queuedMessages.length > 0;

  if (!hasQueued) return null;

  return (
    <div
      className={cn(
        'border-solid-80 gap-1 rounded-t-2xl border-input-border-default bg-input-bg-input py-1 flex w-full flex-col items-start justify-center border border-b-0',
        className
      )}
    >
      {/* Queuing Header Top */}
      <div className="gap-1 px-2.5 py-0 relative box-border flex w-full items-center">
        {/* Lead Button for expand/collapse */}
        <Button
          variant="ghost"
          size="xs"
          className="px-1 focus:ring-0 focus-visible:outline-none"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? (
            <ChevronUp size={16} className="text-icon-primary" />
          ) : (
            <ChevronDown size={16} className="text-icon-primary" />
          )}
        </Button>

        {/* Middle - Queued Title */}
        <div className="gap-0.5 relative flex min-h-px min-w-px flex-1 items-center">
          <div className="mr-1 relative flex shrink-0 flex-col justify-center">
            <span className="text-xs font-bold text-text-body">
              {queuedMessages.length}
            </span>
          </div>
          <div className="relative flex shrink-0 flex-col justify-center">
            <span className="text-xs font-bold text-text-body">
              {t('chat.queued-tasks')}
            </span>
          </div>
        </div>
      </div>

      {/* Header Content - Accordion Items for queued tasks */}
      <div
        className={cn(
          'scrollbar-always-visible gap-1 px-2 py-0 ease-in-out relative box-border flex w-full flex-col items-start overflow-y-auto transition-all duration-200',
          isExpanded && queuedMessages.length > 0
            ? 'max-h-[156px] opacity-100'
            : 'max-h-0 opacity-0'
        )}
      >
        {queuedMessages.map((msg) => (
          <QueueingItem
            key={msg.id}
            content={msg.content}
            onRemove={() => onRemoveQueuedMessage?.(msg.id)}
          />
        ))}
      </div>
    </div>
  );
}

interface QueueingItemProps {
  content: string;
  onRemove?: () => void;
}

function QueueingItem({ content, onRemove }: QueueingItemProps) {
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className="gap-2 rounded-md bg-surface-tertiary px-1 py-1 hover:bg-surface-secondary relative box-border flex w-full cursor-pointer items-center transition-all duration-200"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="h-5 w-5 rounded-md p-0.5 flex shrink-0 items-center justify-center bg-transparent">
        <Circle size={16} className="text-icon-secondary" />
      </div>

      <div className="relative flex min-h-px min-w-px flex-1 flex-col justify-center overflow-hidden overflow-ellipsis">
        <p className="m-0 text-xs font-normal overflow-hidden overflow-ellipsis whitespace-nowrap">
          {content}
        </p>
      </div>

      <Button
        variant="ghost"
        size="xs"
        buttonContent="icon-only"
        className={cn(
          'h-5 w-5 rounded-md p-0.5 shrink-0 transition-all duration-200',
          isHovered
            ? 'translate-x-0 hover:bg-button-transparent-fill-hover opacity-100'
            : 'translate-x-2 pointer-events-none opacity-0'
        )}
        onClick={(e) => {
          e.preventDefault();
          onRemove?.();
        }}
        aria-label={t('chat.remove-queued-message')}
      >
        <X size={16} className="text-icon-secondary" />
      </Button>
    </div>
  );
}

export default QueuedBox;
