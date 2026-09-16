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
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface UsageLimitBannerProps {
  message: string;
  description?: string;
  actionLabel: string;
  severity: 'warning' | 'danger';
  refreshing?: boolean;
  refreshError?: string;
  onAction: () => void;
  onRefresh?: () => void;
  onDismiss?: () => void;
}

export function UsageLimitBanner({
  message,
  description,
  actionLabel,
  severity,
  refreshing,
  refreshError,
  onAction,
  onRefresh,
  onDismiss,
}: UsageLimitBannerProps) {
  const { t } = useTranslation();
  return (
    <aside
      data-usage-notice
      className={cn(
        '@container w-full rounded-ds-card border border-x border-y px-ds-16 py-ds-12',
        severity === 'danger'
          ? 'border-ds-border-error-default-default bg-ds-bg-error-subtle-default text-ds-text-error-strong-default'
          : 'border-ds-border-warning-default-default bg-ds-bg-warning-subtle-default text-ds-text-warning-strong-default'
      )}
    >
      <div className="flex flex-col gap-ds-12 @lg:flex-row @lg:items-center">
        <div className="min-w-0 flex-1 break-words">
          <DsText role="base" weight="medium">
            {message}
          </DsText>
          {description && <DsText role="base">{description}</DsText>}
          {refreshError && <DsText role="meta">{refreshError}</DsText>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-ds-control-gap self-end @lg:self-center">
          <Button
            size="sm"
            variant="secondary"
            disabled={!onRefresh && refreshing}
            onClick={onAction}
          >
            {actionLabel}
          </Button>
          {onRefresh && (
            <Button
              size="sm"
              variant="outline"
              disabled={refreshing}
              onClick={onRefresh}
            >
              {t(refreshing ? 'chat.notice-refreshing' : 'chat.notice-refresh')}
            </Button>
          )}
          {onDismiss && (
            <Button
              size="sm"
              variant="ghost"
              buttonContent="icon-only"
              onClick={onDismiss}
              aria-label={t('chat.dismiss-usage-notice')}
            >
              <DsIcon icon={X} />
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}
