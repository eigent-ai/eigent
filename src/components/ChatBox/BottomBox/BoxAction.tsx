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
import { useTranslation } from 'react-i18next';

interface BoxActionProps {
  /** Token count to display */
  tokens: number;
  /** Whether replay is allowed (e.g., only when task finished) */
  disabled?: boolean;
  /** Loading state for replay action */
  loading?: boolean;
  /** Callback when replay button is clicked */
  onReplay?: () => void;
  /** Optional right-side content to replace replay */
  rightContent?: React.ReactNode;
  /** Task status for determining what button to show */
  status?: 'running' | 'finished' | 'pending' | 'pause';
  /** Task time display */
  taskTime?: string;
  /** Callback for pause/resume */
  onPauseResume?: () => void;
  /** Loading state for pause/resume */
  pauseResumeLoading?: boolean;
  className?: string;
}

export function BoxAction({
  tokens,
  disabled = false,
  loading: _loading = false,
  onReplay,
  rightContent: _rightContent,
  status: _status,
  taskTime: _taskTime,
  onPauseResume: _onPauseResume,
  pauseResumeLoading: _pauseResumeLoading = false,
  className,
}: BoxActionProps) {
  const { t } = useTranslation();

  return (
    <div
      className={`z-50 flex items-center justify-between gap-sm pl-4 ${className || ''}`}
    >
      <div className="text-xs font-semibold leading-17 text-text-information">
        # {t('chat.token')} {tokens || 0}
      </div>

      <Button onClick={onReplay} disabled={disabled} variant="ghost" size="sm">
        {t('chat.replay')}
      </Button>
    </div>
  );
}
