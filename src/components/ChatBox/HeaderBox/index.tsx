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

import tokenDarkIcon from '@/assets/token-dark.svg';
import tokenLightIcon from '@/assets/token-light.svg';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/authStore';
import { PlayCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AnimatedTokenNumber } from '../TokenUtils';

interface HeaderBoxProps {
  /** Total token count for the current project */
  totalTokens?: number;
  /** Task status – controls visibility of replay button */
  status?: 'running' | 'finished' | 'pending' | 'pause';
  /** Whether the replay action is in a loading state */
  replayLoading?: boolean;
  /** Callback fired when the replay button is clicked */
  onReplay?: () => void;
  /** Optional extra class names for the outer container */
  className?: string;
}

export function HeaderBox({
  totalTokens = 0,
  status,
  replayLoading = false,
  onReplay,
  className,
}: HeaderBoxProps) {
  const { t } = useTranslation();
  const { appearance } = useAuthStore();
  const tokenIcon = appearance === 'dark' ? tokenDarkIcon : tokenLightIcon;

  const showReplayButton = status === 'finished';
  const isReplayDisabled =
    status === 'running' || status === 'pending' || status === 'pause';

  return (
    <div
      className={`flex h-[44px] w-full flex-row items-center justify-between px-3 ${className || ''}`}
    >
      {/* Left: title + replay button */}
      <div className="flex items-center gap-2">
        <span className="text-body-base font-bold leading-relaxed text-text-body">
          {t('chat.chat-title')}
        </span>

        {showReplayButton && (
          <Button
            onClick={onReplay}
            disabled={isReplayDisabled || replayLoading}
            variant="ghost"
            size="sm"
            className="no-drag rounded-full bg-surface-information font-semibold !text-text-information"
          >
            <PlayCircle className="mr-1 h-3.5 w-3.5" />
            {replayLoading ? t('common.loading') : t('chat.replay')}
          </Button>
        )}
      </div>

      {/* Right: project total token count */}
      <div className="flex items-center gap-1 text-text-label">
        <img src={tokenIcon} alt="" className="h-3.5 w-3.5" />
        <span className="text-xs font-medium">
          {t('chat.token-total-label')}{' '}
          <AnimatedTokenNumber value={totalTokens} />
        </span>
      </div>
    </div>
  );
}
