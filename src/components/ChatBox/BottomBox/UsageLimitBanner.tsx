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
  const isDanger = severity === 'danger';

  return (
    <div
      className={cn(
        'mb-2 flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border px-4 py-2 shadow-sm',
        isDanger
          ? 'border-text-error/30 bg-surface-error-subtle text-text-error'
          : 'border-border-warning bg-surface-warning text-text-warning'
      )}
    >
      <div className="min-w-0 flex-1 truncate text-body-sm font-medium">
        {message}
      </div>
      <button
        type="button"
        onClick={onAction}
        className={cn(
          'shrink-0 whitespace-nowrap text-body-sm font-semibold underline underline-offset-4',
          isDanger ? 'text-text-error' : 'text-text-heading'
        )}
      >
        {actionLabel}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss usage notice"
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-icon-secondary transition-colors hover:bg-fill-fill-transparent-hover hover:text-icon-primary"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
