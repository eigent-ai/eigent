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

import { AnimateIcon } from '@/components/animate-ui/icons/icon';
import { Orbit } from '@/components/animate-ui/icons/orbit';
import { UserMessageRichContent } from '@/components/ChatBox/MessageItem/UserMessageRichContent';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ChevronLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Variant: Splitting
 */
export interface BoxHeaderSplittingProps {
  className?: string;
}

export const BoxHeaderSplitting = ({ className }: BoxHeaderSplittingProps) => {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        'mb-2 gap-1 flex w-full flex-col items-start justify-center',
        className
      )}
    >
      <div className="gap-1 px-2.5 pt-2 relative box-border flex w-full items-center">
        <Button
          variant="ghost"
          size="sm"
          className="px-1 focus:ring-0 focus-visible:outline-none"
        >
          <AnimateIcon
            animate
            loop
            className="h-4 w-4 items-center justify-center"
          >
            <Orbit size={16} className="text-icon-information" />
          </AnimateIcon>
        </Button>

        <div className="gap-0.5 relative flex min-h-px min-w-px flex-1 items-center">
          <span className="text-sm font-bold text-text-information whitespace-nowrap">
            {t('chat.splitting-tasks')}
          </span>
        </div>
      </div>
    </div>
  );
};

/**
 * Variant: Confirm
 */
export interface BoxHeaderConfirmProps {
  subtitle?: string;
  onStartTask?: () => void;
  onEdit?: () => void;
  className?: string;
  loading?: boolean;
}

export const BoxHeaderConfirm = ({
  subtitle,
  onStartTask,
  onEdit,
  className,
  loading = false,
}: BoxHeaderConfirmProps) => {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        'mb-2 gap-1 flex w-full flex-col items-start justify-center',
        className
      )}
    >
      <div className="gap-1 px-2.5 pt-2 relative box-border flex w-full items-center">
        <Button
          variant="ghost"
          size="sm"
          className="px-1 focus:ring-0 focus-visible:outline-none"
          onClick={onEdit}
        >
          <ChevronLeft size={16} className="text-icon-primary" />
        </Button>

        <div className="gap-0.5 relative flex min-h-px min-w-px flex-1 items-center">
          {subtitle ? (
            <div className="relative flex min-h-px min-w-px flex-1 flex-col justify-center overflow-hidden">
              <UserMessageRichContent
                content={subtitle}
                variant="compact"
                className="w-full"
              />
            </div>
          ) : null}
        </div>

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
  );
};
