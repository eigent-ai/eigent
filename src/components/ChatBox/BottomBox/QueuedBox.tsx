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
  processing?: boolean;
  canSendNow?: boolean;
}

interface QueuedBoxProps {
  queuedMessages?: QueuedMessage[];
  onRemoveQueuedMessage?: (id: string) => void;
  onSendQueuedMessageNow?: (id: string) => void;
  className?: string;
}

export function QueuedBox({
  queuedMessages = [],
  onRemoveQueuedMessage,
  onSendQueuedMessageNow,
  className,
}: QueuedBoxProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(true);
  const hasQueued = queuedMessages.length > 0;

  if (!hasQueued) return null;

  return (
    <div
      className={cn(
        'border-solid-80 flex w-full flex-col items-start justify-center gap-1 rounded-2xl border border-x border-y border-ds-hairline-default-default bg-ds-neutral-default-default py-1',
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
            <ChevronUp size={16} className="text-ds-ink-default-default" />
          ) : (
            <ChevronDown size={16} className="text-ds-ink-default-default" />
          )}
        </Button>

        {/* Middle - Queued Title */}
        <div className="relative flex min-h-px min-w-px flex-1 items-center gap-0.5">
          <div className="relative mr-1 flex shrink-0 flex-col justify-center">
            <span className="text-xs font-bold text-ds-ink-default-default">
              {queuedMessages.length}
            </span>
          </div>
          <div className="relative flex shrink-0 flex-col justify-center">
            <span className="text-xs font-bold text-ds-ink-default-default">
              {t('chat.queued-tasks')}
            </span>
          </div>
        </div>
      </div>

      {/* Header Content - Accordion Items for queued tasks */}
      <div
        className={cn(
          'scrollbar-always-visible relative box-border flex w-full flex-col items-start gap-1 overflow-y-auto px-2 py-0 transition-opacity duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)]',
          isExpanded && queuedMessages.length > 0
            ? 'max-h-[156px] opacity-100'
            : 'max-h-0 opacity-0'
        )}
      >
        {queuedMessages.map((msg) => (
          <QueueingItem
            key={msg.id}
            content={msg.content}
            processing={msg.processing}
            canSendNow={msg.canSendNow}
            onRemove={() => onRemoveQueuedMessage?.(msg.id)}
            onSendNow={() => onSendQueuedMessageNow?.(msg.id)}
          />
        ))}
      </div>
    </div>
  );
}

interface QueueingItemProps {
  content: string;
  processing?: boolean;
  canSendNow?: boolean;
  onRemove?: () => void;
  onSendNow?: () => void;
}

function QueueingItem({
  content,
  processing = false,
  canSendNow = true,
  onRemove,
  onSendNow,
}: QueueingItemProps) {
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className="relative box-border flex w-full cursor-pointer items-center gap-2 rounded-md bg-ds-neutral-strong-default px-1 py-1 transition-colors duration-200 hover:bg-ds-neutral-default-default"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-transparent p-0.5">
        <Circle size={16} className="text-ds-ink-muted-default" />
      </div>

      <div className="relative flex min-h-px min-w-px flex-1 flex-col justify-center overflow-hidden text-ellipsis">
        <span className="block overflow-hidden text-xs font-normal text-ellipsis whitespace-nowrap">
          {content}
        </span>
      </div>

      {canSendNow && (
        <Button
          variant="ghost"
          size="xs"
          disabled={processing || !isHovered}
          tabIndex={isHovered ? 0 : -1}
          className={cn(
            'h-5 shrink-0 rounded-md px-1.5 text-[11px] transition-opacity',
            isHovered ? 'opacity-100' : 'pointer-events-none opacity-0'
          )}
          onClick={(event) => {
            event.preventDefault();
            onSendNow?.();
          }}
        >
          {t('chat.send-now', { defaultValue: 'Send now' })}
        </Button>
      )}

      <Button
        variant="ghost"
        size="xs"
        buttonContent="icon-only"
        disabled={processing}
        className={cn(
          'h-5 w-5 shrink-0 rounded-md p-0.5 transition-[background-color,opacity,transform] duration-200',
          isHovered
            ? 'translate-x-0 opacity-100 hover:bg-ds-neutral-default-hover'
            : 'pointer-events-none translate-x-2 opacity-0'
        )}
        onClick={(e) => {
          e.preventDefault();
          onRemove?.();
        }}
        aria-label={t('chat.remove-queued-message')}
      >
        <X size={16} className="text-ds-ink-muted-default" />
      </Button>
    </div>
  );
}

export default QueuedBox;
