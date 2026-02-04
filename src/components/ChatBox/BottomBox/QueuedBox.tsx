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
        'border-solid-80 flex w-full flex-col items-start justify-center gap-1 rounded-t-2xl border border-b-0 border-input-border-default bg-input-bg-input py-1',
        className
      )}
    >
      {/* Queuing Header Top */}
      <div className="relative box-border flex w-full items-center gap-1 px-2.5 py-0">
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
        <div className="relative flex min-h-px min-w-px flex-1 items-center gap-0.5">
          <div className="relative mr-1 flex shrink-0 flex-col justify-center">
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
          'scrollbar-always-visible relative box-border flex w-full flex-col items-start gap-1 overflow-y-auto px-2 py-0 transition-all duration-200 ease-in-out',
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
      className="relative box-border flex w-full cursor-pointer items-center gap-2 rounded-md bg-surface-tertiary px-1 py-1 transition-all duration-200 hover:bg-surface-secondary"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-transparent p-0.5">
        <Circle size={16} className="text-icon-secondary" />
      </div>

      <div className="relative flex min-h-px min-w-px flex-1 flex-col justify-center overflow-hidden overflow-ellipsis">
        <p className="m-0 overflow-hidden overflow-ellipsis whitespace-nowrap text-xs font-normal">
          {content}
        </p>
      </div>

      <Button
        variant="ghost"
        size="icon"
        className={cn(
          'h-5 w-5 shrink-0 rounded-md p-0.5 transition-all duration-200',
          isHovered
            ? 'translate-x-0 opacity-100 hover:bg-button-transparent-fill-hover'
            : 'pointer-events-none translate-x-2 opacity-0'
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
