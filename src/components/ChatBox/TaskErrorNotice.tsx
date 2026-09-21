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
import { DsText } from '@/components/ui/ds-text';
import { SITE_URL } from '@/lib';
import { errorCopy, type ErrorReason } from '@/lib/usageErrors';
import {
  contactSupport,
  refreshUsage,
  useUsageNoticeStore,
} from '@/store/usageNoticeStore';
import { useTranslation } from 'react-i18next';

/** Historical task outcome. Sonner owns the live announcement and interruption. */
export function TaskErrorNotice({ reason }: { reason: ErrorReason }) {
  const { t } = useTranslation();
  const refreshing = useUsageNoticeStore((state) => state.refreshing);
  const sharedRefreshError = useUsageNoticeStore((state) => state.refreshError);
  const refreshError =
    sharedRefreshError === 'chat.notice-availability-unverified'
      ? reason === 'service'
        ? sharedRefreshError
        : null
      : sharedRefreshError === 'chat.notice-access-unverified'
        ? reason === 'model-access'
          ? sharedRefreshError
          : null
        : reason !== 'service'
          ? sharedRefreshError
          : null;
  const usage = [
    'credits',
    'trial-daily',
    'trial-total',
    'free-credits',
    'model-access',
  ].includes(reason);
  return (
    <aside
      data-task-error={reason}
      className="@container w-full rounded-ds-card border border-x border-y border-ds-border-error-default-default bg-ds-bg-error-subtle-default px-ds-16 py-ds-12 text-ds-text-error-strong-default"
    >
      <div className="flex flex-col gap-ds-12 @lg:flex-row @lg:items-center">
        <div className="min-w-0 flex-1 break-words">
          <DsText role="base" weight="medium">
            {errorCopy(reason)}
          </DsText>
          {reason === 'service' && (
            <DsText role="base">{t('chat.notice-contact-description')}</DsText>
          )}
          {usage && (
            <DsText role="base">{t('chat.notice-refresh-description')}</DsText>
          )}
          {(usage || reason === 'service') && refreshError && (
            <DsText role="meta">{t(refreshError)}</DsText>
          )}
        </div>
        {(usage || reason === 'service') && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-ds-control-gap self-end @lg:self-center">
            {reason === 'service' && (
              <Button size="sm" variant="secondary" onClick={contactSupport}>
                {t('chat.notice-contact-support')}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={refreshing}
              onClick={() => void refreshUsage()}
            >
              {t(refreshing ? 'chat.notice-refreshing' : 'chat.notice-refresh')}
            </Button>
            {reason === 'model-access' && (
              <Button
                size="sm"
                variant="text"
                onClick={() => {
                  window.location.href = `${SITE_URL}/pricing`;
                }}
              >
                {t('chat.notice-upgrade-plan')}
              </Button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
