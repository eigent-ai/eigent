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
        'gap-3 p-4 border-ds-border-neutral-subtle-default rounded-2xl bg-ds-bg-neutral-default-default border',
        'min-h-40 flex flex-col justify-between',
        disabled
          ? 'pointer-events-none cursor-not-allowed opacity-50 select-none'
          : '',
      ].join(' ')}
    >
      <div className="gap-2 min-w-0 flex w-full items-center justify-between">
        <div className="gap-2 flex items-center">
          {leading}
          {icon && (
            <img
              src={icon}
              alt=""
              className="h-5 w-5 rounded shrink-0 object-contain"
              aria-hidden
            />
          )}
          <span className="text-body-sm font-semibold text-ds-text-neutral-default-default truncate">
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

      <div className="gap-2 flex items-center justify-between">
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
            className="no-drag gap-1.5 shrink-0"
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
