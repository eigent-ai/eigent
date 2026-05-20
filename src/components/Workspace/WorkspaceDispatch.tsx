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

import larkIcon from '@/assets/icon/lark.png';
import telegramIcon from '@/assets/icon/telegram.svg';
import whatsappIcon from '@/assets/icon/whatsapp.svg';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { WebSocketConnectionStatus } from '@/store/triggerStore';
import { useTriggerStore } from '@/store/triggerStore';
import { Copy, MonitorSmartphone } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

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

function DispatchChannelCard({
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

export function WorkspaceDispatch() {
  const { t } = useTranslation();
  const wsConnectionStatus = useTriggerStore((s) => s.wsConnectionStatus);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success(
        t('layout.dispatch-link-copied', { defaultValue: 'Link copied' })
      );
    } catch {
      toast.error(
        t('layout.dispatch-copy-failed', {
          defaultValue: 'Failed to copy link',
        })
      );
    }
  };

  return (
    <div className="min-h-0 flex h-full w-full flex-col overflow-y-auto">
      <div className="gap-3 p-4 max-w-3xl mx-auto grid h-full w-full grid-cols-2 grid-rows-2">
        <DispatchChannelCard
          name={t('layout.workspace-work-with-remote-control', {
            defaultValue: 'Remote control',
          })}
          leading={
            <MonitorSmartphone
              className="h-4 w-4 text-ds-text-neutral-muted-default shrink-0"
              aria-hidden
            />
          }
          connectionStatus={wsConnectionStatus}
          action={{
            label: t('layout.dispatch-copy-link', {
              defaultValue: 'Copy link',
            }),
            icon: <Copy className="h-3.5 w-3.5" aria-hidden />,
            onClick: handleCopyLink,
          }}
        />
        <DispatchChannelCard
          icon={telegramIcon}
          name={t('layout.channels-telegram', { defaultValue: 'Telegram' })}
          disabled
          badgeText={t('layout.dispatch-coming-soon', {
            defaultValue: 'Coming soon',
          })}
        />
        <DispatchChannelCard
          icon={larkIcon}
          name={t('layout.channels-lark', { defaultValue: 'Lark' })}
          disabled
          badgeText={t('layout.dispatch-coming-soon', {
            defaultValue: 'Coming soon',
          })}
        />
        <DispatchChannelCard
          icon={whatsappIcon}
          name={t('layout.channels-whatsapp', { defaultValue: 'WhatsApp' })}
          disabled
          badgeText={t('layout.dispatch-coming-soon', {
            defaultValue: 'Coming soon',
          })}
        />
      </div>
    </div>
  );
}
