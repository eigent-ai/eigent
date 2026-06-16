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

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { WebSocketConnectionStatus } from '@/store/triggerStore';
import type { ReactNode } from 'react';

function statusDotClass(status: WebSocketConnectionStatus): string {
  switch (status) {
    case 'connected':
      return 'bg-green-500';
    case 'connecting':
      return 'bg-yellow-400 animate-pulse';
    case 'unhealthy':
    case 'disconnected':
    default:
      return 'bg-red-500';
  }
}

interface DispatchChannelCardProps {
  name: string;
  icon?: string;
  leading?: ReactNode;
  disabled?: boolean;
  connectionStatus?: WebSocketConnectionStatus;
  badgeText?: string;
  action?: {
    label: string;
    icon?: ReactNode;
    onClick: () => void;
  };
}

export function DispatchChannelCard({
  name,
  icon,
  leading,
  disabled,
  connectionStatus,
  badgeText,
  action,
}: DispatchChannelCardProps) {
  return (
    <div
      className={[
        'gap-3 rounded-2xl border border-ds-border-neutral-subtle-default bg-ds-bg-neutral-default-default p-4',
        'flex min-h-40 flex-col justify-between',
        disabled
          ? 'pointer-events-none cursor-not-allowed select-none opacity-50'
          : '',
      ].join(' ')}
    >
      <div className="flex w-full min-w-0 items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {leading}
          {icon && (
            <img
              src={icon}
              alt=""
              className="h-5 w-5 shrink-0 rounded object-contain"
              aria-hidden
            />
          )}
          <span className="truncate text-body-sm font-semibold text-ds-text-neutral-default-default">
            {name}
          </span>
        </div>
        {connectionStatus && (
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusDotClass(connectionStatus)}`}
            aria-hidden
          />
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        {badgeText ? (
          <Badge variant="secondary" size="xs">
            {badgeText}
          </Badge>
        ) : (
          <div />
        )}

        {action && (
          <Button
            type="button"
            variant="secondary"
            size="xs"
            buttonContent="text"
            className="no-drag shrink-0 gap-1.5"
            onClick={action.onClick}
          >
            {action.icon}
            {action.label}
          </Button>
        )}
      </div>
    </div>
  );
}
