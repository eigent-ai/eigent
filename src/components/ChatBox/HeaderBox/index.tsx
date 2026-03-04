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
import { PanelLeft, PlayCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface HeaderBoxProps {
  /** Token count to display */
  tokens: number;
  /** Task status for determining what button to show */
  status?: 'running' | 'finished' | 'pending' | 'pause';
  /** Whether replay is loading */
  replayLoading?: boolean;
  /** Callback when replay button is clicked */
  onReplay?: () => void;
  /** Callback when sidebar toggle button is clicked */
  onToggleSidebar?: () => void;
  /** Whether the left sidebar is open */
  isLeftSidebarOpen?: boolean;
  /** Optional class name */
  className?: string;
}

export function HeaderBox({
  tokens,
  status,
  replayLoading = false,
  onReplay,
  onToggleSidebar,
  isLeftSidebarOpen,
  className,
}: HeaderBoxProps) {
  const { t } = useTranslation();

  // Replay button only appears when task is finished
  const showReplayButton = status === 'finished';
  // Replay button is disabled when task is running or pending
  const isReplayDisabled =
    status === 'running' || status === 'pending' || status === 'pause';

  return (
    <div
      className={`px-3 flex h-[44px] w-full flex-row items-center justify-between ${className || ''}`}
    >
      <div className="gap-2 flex items-center">
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            className={`no-drag h-6 w-6 rounded-md hover:bg-surface-tertiary flex items-center justify-center transition-colors ${isLeftSidebarOpen ? 'text-text-heading' : 'text-text-tertiary'}`}
            title={isLeftSidebarOpen ? 'Hide task list' : 'Show task list'}
          >
            <PanelLeft className="h-4 w-4" />
          </button>
        )}
        <div className="text-text-body font-bold text-body-base leading-relaxed">
          Chat
        </div>
        <div className="text-text-information text-xs font-semibold leading-17">
          # {tokens || 0}
        </div>
      </div>

      {showReplayButton && (
        <Button
          onClick={onReplay}
          disabled={isReplayDisabled || replayLoading}
          variant="ghost"
          size="sm"
          className="no-drag !text-text-information bg-surface-information font-semibold rounded-full"
        >
          <PlayCircle />
          {replayLoading ? t('common.loading') : t('chat.replay')}
        </Button>
      )}
    </div>
  );
}
