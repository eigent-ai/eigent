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
import { cn } from '@/lib/utils';
import { ChevronLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Variant: Confirm
 */
export interface BoxHeaderConfirmProps {
  subtitle?: string;
  onStartTask?: () => void;
  onEdit?: () => void;
  className?: string;
  loading?: boolean;
  autoStartDeadline?: number | null;
}

export const BoxHeaderConfirm = ({
  subtitle: _subtitle,
  onStartTask,
  onEdit,
  className,
  loading = false,
  autoStartDeadline = null,
}: BoxHeaderConfirmProps) => {
  const { t } = useTranslation();
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (!autoStartDeadline) {
      setRemainingSeconds(null);
      return;
    }

    const updateRemainingSeconds = () => {
      setRemainingSeconds(
        Math.max(0, Math.ceil((autoStartDeadline - Date.now()) / 1000))
      );
    };

    updateRemainingSeconds();
    const intervalId = window.setInterval(updateRemainingSeconds, 250);
    return () => window.clearInterval(intervalId);
  }, [autoStartDeadline]);

  return (
    <div
      className={cn(
        'mb-2 gap-1 flex w-full flex-col items-start justify-between',
        className
      )}
    >
      <div className="gap-1 px-2.5 pt-2 relative box-border flex w-full items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          buttonContent="icon-only"
          tone="neutral"
          buttonRadius="full"
          className="focus:ring-0 focus-visible:outline-none"
          onClick={onEdit}
        >
          <ChevronLeft />
        </Button>

        <div className="gap-2 flex items-center">
          {remainingSeconds !== null && (
            <span
              className="text-body-xs font-medium text-ds-text-success-default-default whitespace-nowrap tabular-nums"
              aria-label={t('chat.auto-start-in', {
                seconds: remainingSeconds,
              })}
            >
              {t('chat.auto-start-in', { seconds: remainingSeconds })}
            </span>
          )}
          <Button
            variant="success"
            size="sm"
            className="rounded-full"
            onClick={onStartTask}
            disabled={loading}
          >
            {t('chat.start-task')}
          </Button>
        </div>
      </div>
    </div>
  );
};

/**
 * Variant: Save
 *
 * Mirrors `BoxHeaderConfirm` but the primary action is "Save" — used when the
 * plan editor has unsaved subtask edits.
 */
export interface BoxHeaderSaveProps {
  subtitle?: string;
  onSave?: () => void;
  onEdit?: () => void;
  className?: string;
  loading?: boolean;
}

export const BoxHeaderSave = ({
  subtitle: _subtitle,
  onSave,
  onEdit,
  className,
  loading = false,
}: BoxHeaderSaveProps) => {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        'mb-2 gap-1 flex w-full flex-col items-start justify-between',
        className
      )}
    >
      <div className="gap-1 px-2.5 pt-2 relative box-border flex w-full items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          buttonContent="icon-only"
          tone="neutral"
          buttonRadius="full"
          className="focus:ring-0 focus-visible:outline-none"
          onClick={onEdit}
        >
          <ChevronLeft />
        </Button>

        <Button
          variant="success"
          size="sm"
          className="rounded-full"
          onClick={onSave}
          disabled={loading}
        >
          {t('layout.save')}
        </Button>
      </div>
    </div>
  );
};
