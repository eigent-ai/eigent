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
import { TooltipSimple } from '@/components/ui/tooltip';
import { PlayCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface HeaderBoxProps {
  /** Token count for the current task */
  tokens: number;
  /** Total token count across the project (optional; when provided, tooltip shows both) */
  totalTokens?: number;
  /** Task status for determining what button to show */
  status?: 'running' | 'finished' | 'pending' | 'pause';
  /** Whether replay is loading */
  replayLoading?: boolean;
  /** Callback when replay button is clicked */
  onReplay?: () => void;
  /** Optional class name */
  className?: string;
}

export function HeaderBox({
  tokens,
  totalTokens,
  status,
  replayLoading = false,
  onReplay,
  className,
}: HeaderBoxProps) {
  const { t } = useTranslation();

  const taskTokens = tokens ?? 0;
  const hasTotal = totalTokens !== undefined && totalTokens !== null;
  const tooltipContent =
    t('chat.token-usage') +
    (hasTotal
      ? ` — ${t('chat.token-usage-this-task')}: ${taskTokens.toLocaleString()} · ${t('chat.token-usage-project-total')}: ${(totalTokens ?? 0).toLocaleString()}`
      : ` — ${t('chat.token-usage-this-task')}: ${taskTokens.toLocaleString()}`);

  // Replay button only appears when task is finished
  const showReplayButton = status === 'finished';
  // Replay button is disabled when task is running or pending
  const isReplayDisabled =
    status === 'running' || status === 'pending' || status === 'pause';

  return (
    <div
      className={`flex h-[44px] w-full flex-row items-center justify-between px-3 ${className || ''}`}
    >
      <div className="flex items-center gap-md">
        <div className="text-body-base font-bold leading-relaxed text-text-body">
          Chat
        </div>
        <TooltipSimple content={tooltipContent}>
          <div className="cursor-help text-xs font-semibold leading-17 text-text-information">
            # {taskTokens.toLocaleString()}
          </div>
        </TooltipSimple>
      </div>

      {showReplayButton && (
        <Button
          onClick={onReplay}
          disabled={isReplayDisabled || replayLoading}
          variant="ghost"
          size="sm"
          className="no-drag rounded-full bg-surface-information font-semibold !text-text-information"
        >
          <PlayCircle />
          {replayLoading ? t('common.loading') : t('chat.replay')}
        </Button>
      )}
    </div>
  );
}
