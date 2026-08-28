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

import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface UsageLimitBannerProps {
  message: string;
  actionLabel: string;
  severity: 'warning' | 'danger';
  onAction: () => void;
  onDismiss: () => void;
}

export function UsageLimitBanner({
  message,
  actionLabel,
  severity,
  onAction,
  onDismiss,
}: UsageLimitBannerProps) {
  const { t } = useTranslation();
  const isDanger = severity === 'danger';

  return (
    <div
      className={cn(
        'flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-x border-y border-solid px-4 py-2 shadow-ds-elevation-control',
        isDanger
          ? 'border-ds-border-error-default-default bg-ds-bg-error-subtle-default !text-ds-text-error-strong-default'
          : 'border-ds-border-warning-default-default bg-ds-bg-warning-subtle-default !text-ds-text-warning-strong-default'
      )}
    >
      <span className="min-w-0 flex-1 truncate text-ds-text-base font-medium">
        {message}
      </span>
      <button
        type="button"
        onClick={onAction}
        className={cn(
          'shrink-0 text-ds-text-base font-semibold whitespace-nowrap underline underline-offset-4',
          isDanger
            ? '!text-ds-text-error-strong-default'
            : '!text-ds-ink-default-default'
        )}
      >
        <span className="text-ds-text-base font-semibold">{actionLabel}</span>
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t('chat.dismiss-usage-notice', {
          defaultValue: 'Dismiss usage notice',
        })}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-ds-ink-muted-default transition-colors hover:bg-ds-neutral-subtle-hover hover:text-ds-ink-default-default"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
