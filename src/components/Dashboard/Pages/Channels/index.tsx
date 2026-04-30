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

import { PageSubTabsNav } from '@/components/Dashboard/HorizontalNav';
import {
  buildHistorySearchString,
  type ChannelsView,
} from '@/lib/historyNavConfig';
import { MessageSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import DashboardPageLayout from '../DashboardPageLayout';

const CHANNELS_TAB_IDS: ChannelsView[] = ['overview', 'whatsapp', 'lark'];

function isChannelsViewParam(v: string | null): v is ChannelsView {
  return v === 'overview' || v === 'whatsapp' || v === 'lark';
}

export default function Channels({
  embedded,
  channelsView,
}: {
  embedded?: boolean;
  channelsView?: ChannelsView;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const embeddedView: ChannelsView =
    channelsView && CHANNELS_TAB_IDS.includes(channelsView)
      ? channelsView
      : 'overview';

  const standaloneView: ChannelsView = isChannelsViewParam(
    searchParams.get('channelsView')
  )
    ? (searchParams.get('channelsView') as ChannelsView)
    : 'overview';

  const resolvedTab = embedded ? embeddedView : standaloneView;

  const handleTabChange = (value: string) => {
    const next: ChannelsView =
      value === 'overview' || value === 'whatsapp' || value === 'lark'
        ? value
        : 'overview';

    if (embedded) {
      navigate(
        {
          pathname: '/history',
          search: `?${buildHistorySearchString(searchParams, {
            tab: 'channels',
            channelsView: next,
          })}`,
        },
        { replace: true }
      );
      return;
    }

    navigate(`?tab=channels&channelsView=${next}`, { replace: true });
  };

  return (
    <DashboardPageLayout
      title={t('layout.channels')}
      tabs={
        <PageSubTabsNav
          tabs={CHANNELS_TAB_IDS.map((id) => ({
            id,
            label: t(
              id === 'overview'
                ? 'layout.channels-overview'
                : `layout.channels-${id}`
            ),
          }))}
          activeId={resolvedTab}
          onChange={handleTabChange}
        />
      }
    >
      <div className="gap-6 flex flex-col">
        <div className="rounded-2xl bg-ds-bg-neutral-default-default px-6 py-4 flex w-full flex-col items-center justify-between">
          <div className="h-16 w-16 flex items-center justify-center">
            <MessageSquare className="h-8 w-8 text-ds-icon-neutral-muted-default" />
          </div>
          <h2 className="mb-2 text-body-md font-bold text-ds-text-neutral-default-default">
            {t('layout.coming-soon')}
          </h2>
          <p className="max-w-md text-body-sm text-ds-text-neutral-muted-default text-center">
            {resolvedTab === 'overview'
              ? t('layout.channels-overview-coming-soon-description')
              : t('layout.channels-coming-soon-description')}
          </p>
        </div>
      </div>
    </DashboardPageLayout>
  );
}
