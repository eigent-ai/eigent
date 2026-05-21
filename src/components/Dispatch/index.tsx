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
    <div className="min-h-0 flex h-full w-full flex-col overflow-hidden">
      <div className="gap-2 px-2 border-ds-border-neutral-subtle-default box-border flex h-[45.5px] w-full shrink-0 items-center justify-between border-x-0 border-t-0 border-b-1 border-solid">
        <div className="text-ds-text-neutral-muted-default min-w-0 gap-2 px-1 text-body-md font-bold flex flex-1 items-center">
          <span className="truncate">
            {t('layout.workspace-work-with-title')}
          </span>
        </div>
      </div>
      <div className="min-h-0 flex w-full flex-1 flex-col overflow-y-auto">
        <div className="gap-3 p-4 max-w-3xl mx-auto grid h-full w-full grid-cols-2 grid-rows-2">
          <DispatchChannelCard
            name={t('layout.workspace-work-with-remote-control')}
            leading={
              <MonitorSmartphone
                className="h-4 w-4 text-ds-text-neutral-muted-default shrink-0"
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
