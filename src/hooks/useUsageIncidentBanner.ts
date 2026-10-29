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

import type { UsageLimitBannerProps } from '@/components/ChatBox/BottomBox/UsageLimitBanner';
import {
  creditRecoveryAction,
  isCreditRecoveryReason,
} from '@/lib/creditRecovery';
import {
  activeUsageIncident,
  contactSupport,
  isUsageToastOpen,
  liveUsageNoticeCopy,
  refreshUsage,
  useUsageNoticeStore,
} from '@/store/usageNoticeStore';
import { useTranslation } from 'react-i18next';

/**
 * The same recovery actions remain available in existing and new Sessions.
 * While the toast announces the incident, the composer stays quiet so the
 * user sees one notice; dismissing the toast leaves this one in place.
 */
export function useUsageIncidentBanner(
  modelType: string
): UsageLimitBannerProps | null {
  const { t } = useTranslation();
  const usage = useUsageNoticeStore();
  const incident = activeUsageIncident(usage);
  if (modelType !== 'cloud' || !incident || isUsageToastOpen(usage))
    return null;
  const serviceUnavailable = incident.reason === 'service';
  const { message, description } = liveUsageNoticeCopy(incident.reason, usage);
  return {
    message,
    description,
    actionLabel: t(
      serviceUnavailable
        ? 'chat.notice-contact-support'
        : usage.refreshing
          ? 'chat.notice-refreshing'
          : 'chat.notice-refresh'
    ),
    severity: 'danger',
    refreshing: usage.refreshing,
    refreshError: usage.refreshError ? t(usage.refreshError) : undefined,
    onAction: serviceUnavailable ? contactSupport : () => void refreshUsage(),
    onRefresh: serviceUnavailable ? () => void refreshUsage() : undefined,
    recoveryAction: isCreditRecoveryReason(incident.reason)
      ? creditRecoveryAction(usage.subscription)
      : undefined,
  };
}
