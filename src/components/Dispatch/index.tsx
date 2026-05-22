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
import { DispatchChannelCard } from '@/components/Dispatch/DispatchChannelCard';
import { useTriggerStore } from '@/store/triggerStore';
import { Copy, MonitorSmartphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

export function WorkspaceDispatch() {
  const { t } = useTranslation();
  const wsConnectionStatus = useTriggerStore((s) => s.wsConnectionStatus);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success(t('layout.dispatch-link-copied'));
    } catch {
      toast.error(t('layout.dispatch-copy-failed'));
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="border-b-1 box-border flex h-[45.5px] w-full shrink-0 items-center justify-between gap-2 border-x-0 border-t-0 border-solid border-ds-border-neutral-subtle-default px-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 px-1 text-body-md font-bold text-ds-text-neutral-muted-default">
          <span className="truncate">
            {t('layout.workspace-work-with-title')}
          </span>
        </div>
      </div>
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto">
        <div className="mx-auto grid h-full w-full max-w-3xl grid-cols-2 grid-rows-2 gap-3 p-4">
          <DispatchChannelCard
            name={t('layout.workspace-work-with-remote-control')}
            leading={
              <MonitorSmartphone
                className="h-4 w-4 shrink-0 text-ds-text-neutral-muted-default"
                aria-hidden
              />
            }
            connectionStatus={wsConnectionStatus}
            action={{
              label: t('layout.dispatch-copy-link'),
              icon: <Copy className="h-3.5 w-3.5" aria-hidden />,
              onClick: handleCopyLink,
            }}
          />
          <DispatchChannelCard
            icon={telegramIcon}
            name={t('layout.channels-telegram')}
            disabled
            badgeText={t('layout.dispatch-coming-soon')}
          />
          <DispatchChannelCard
            icon={larkIcon}
            name={t('layout.channels-lark')}
            disabled
            badgeText={t('layout.dispatch-coming-soon')}
          />
          <DispatchChannelCard
            icon={whatsappIcon}
            name={t('layout.channels-whatsapp')}
            disabled
            badgeText={t('layout.dispatch-coming-soon')}
          />
        </div>
      </div>
    </div>
  );
}
