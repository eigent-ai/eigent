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
import { ChatTaskStatus, type ChatTaskStatusType } from '@/types/constants';
import { useTranslation } from 'react-i18next';

export interface FloatingActionProps {
  /** Current task status */
  status: ChatTaskStatusType;
  /** Callback when pause button is clicked */
  // onPause?: () => void;  // Commented out - temporary not needed
  /** Callback when resume button is clicked */
  // onResume?: () => void;  // Commented out - temporary not needed
  /** Callback when skip to next is clicked */
  onSkip?: () => void;
  /** Loading state for pause/resume actions */
  loading?: boolean;
  /** When true, do not show Stop even if status is still "running" (e.g. direct @-agent after AGENT_END). */
  hideStop?: boolean;
  /** Additional CSS classes */
  className?: string;
}

export const FloatingAction = ({
  status,
  // onPause,  // Commented out - temporary not needed
  // onResume,  // Commented out - temporary not needed
  onSkip,
  loading = false,
  hideStop = false,
  className,
}: FloatingActionProps) => {
  const { t } = useTranslation();
  // Only show when task is running (removed pause state)
  if (status !== ChatTaskStatus.RUNNING || hideStop) {
    return null;
  }

  return (
    <div
      className={cn(
        'pointer-events-none sticky top-2 right-0 bottom-40 left-0 z-20 mt-4 flex w-full items-center justify-center',
        className
      )}
    >
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-x border-y border-ds-hairline-default-default bg-ds-neutral-subtle-default p-1 shadow-button-shadow backdrop-blur-md">
        {/* Always show Stop Task button when running (removed pause/resume logic) */}
        <Button
          variant="outline"
          size="sm"
          onClick={onSkip}
          disabled={loading}
          className="gap-1.5 rounded-full"
        >
          <span className="!text-ds-text-base font-semibold">
            {t('chat.stop-task', { defaultValue: 'Stop Task' })}
          </span>
        </Button>

        {/* Commented out pause/resume functionality
				{status === "running" ? (
					// State 1: Running - Show Pause button
					<Button
						variant="primary"
						tone="error"
						size="sm"
						onClick={onPause}
						disabled={loading}
						className="rounded-full"
					>
						<span className="text-sm font-semibold">Pause</span>
					</Button>
				) : (
					// State 2: Paused - Show Resume and Skip buttons
					<>
						<Button
							variant="success"
							size="sm"
							onClick={onResume}
							disabled={loading}
							className="gap-1.5 rounded-full min-w-[80px]"
						>
							<Play className="size-ds-icon-md" />
							<span className="text-sm font-semibold">Resume</span>
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={onSkip}
							disabled={loading}
							className="gap-1.5 rounded-full"
						>
							<span className="text-sm font-semibold">Next Task</span>
						</Button>
					</>
				)}
				*/}
      </div>
    </div>
  );
};
