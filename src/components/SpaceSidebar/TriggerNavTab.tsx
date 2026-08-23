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

import { TooltipSimple } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { WebSocketConnectionStatus } from '@/store/triggerStore';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function triggerListenerLeadIconClass(
  status: WebSocketConnectionStatus
): string {
  switch (status) {
    case 'connected':
      return 'text-ds-ink-muted-default';
    case 'connecting':
      return 'text-ds-icon-warning-default-default animate-pulse';
    case 'unhealthy':
      return 'text-ds-icon-status-error-default-default';
    case 'disconnected':
    default:
      return '!text-ds-icon-status-error-default-default';
  }
}

export interface NavTabReconnectSuffixProps {
  wsConnectionStatus: WebSocketConnectionStatus;
  onReconnect: () => void;
}

/** Reconnect button for the triggers tab — direct click, no dropdown. */
export function NavTabReconnectSuffix({
  wsConnectionStatus,
  onReconnect,
}: NavTabReconnectSuffixProps) {
  const { t } = useTranslation();
  const reconnectLabel = t('layout.triggers-reconnect-hint');
  return (
    <TooltipSimple content={reconnectLabel} side="top" sideOffset={8}>
      <button
        type="button"
        className={cn(
          'no-drag flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-ds-ink-muted-default transition-colors outline-none hover:bg-ds-neutral-strong-default',
          'focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ds-hairline-subtle-default focus-visible:outline-none'
        )}
        aria-label={reconnectLabel}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onReconnect();
        }}
      >
        <RefreshCw
          className={cn(
            'h-3.5 w-3.5',
            wsConnectionStatus === 'connecting' && 'animate-spin'
          )}
          aria-hidden
        />
      </button>
    </TooltipSimple>
  );
}
