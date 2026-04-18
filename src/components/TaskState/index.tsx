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

import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { CircleCheckBig, CircleSlash2, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type TaskStateType =
  | 'all'
  | 'done'
  | 'reassigned'
  | 'ongoing'
  | 'pending'
  | 'failed';

export interface TaskStateProps {
  all?: number;
  done: number;
  progress: number;
  skipped: number;
  reAssignTo?: number;
  failed?: number;
  forceVisible?: boolean;
  selectedState?: TaskStateType;
  onStateChange?: (selectedState: TaskStateType) => void;
  clickable?: boolean;
}

export const TaskState = ({
  all,
  done,
  reAssignTo,
  progress,
  skipped,
  failed,
  forceVisible = false,
  selectedState = 'all',
  onStateChange,
  clickable = true,
}: TaskStateProps) => {
  //Get Chatstore for the active project's task
  const { chatStore } = useChatStoreAdapter();

  const { t } = useTranslation();
  const handleStateClick = (state: TaskStateType) => {
    if (!clickable || !onStateChange) return;
    onStateChange(state || 'all');
  };

  const isSelected = (state: TaskStateType) => {
    return selectedState === state;
  };

  const numberClass = `rounded-lg inline-block align-bottom transition-all duration-300 ease-in-out max-w-[40px] group-hover:max-w-[40px] group-hover:opacity-100`;

  if (!chatStore) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <div className="gap-1 flex w-auto flex-wrap items-center bg-transparent">
        {/* All */}
        {all && (forceVisible || all > 0) ? (
          <div
            className={`group gap-xs px-2 py-0.5 hover:bg-ds-bg-neutral-subtle-default flex items-center transition-all duration-200 ${
              isSelected('all')
                ? 'bg-ds-bg-neutral-subtle-default'
                : 'bg-transparent'
            } ${clickable ? 'cursor-pointer' : ''}`}
            onClick={() => handleStateClick('all')}
          >
            <span className="text-xs font-normal text-ds-text-neutral-default-default">
              {t('chat.all')} <span className={numberClass}>{all}</span>
            </span>
          </div>
        ) : null}

        {/* Done */}
        {done && (forceVisible || done > 0) ? (
          <div
            className={`group gap-xs px-0.5 py-0.5 hover:bg-ds-bg-neutral-subtle-default flex items-center transition-all duration-200 ${
              isSelected('done') && 'bg-ds-bg-neutral-subtle-default'
            } ${
              clickable && 'cursor-pointer transition-opacity hover:opacity-80'
            }`}
            onClick={() => handleStateClick('done')}
          >
            <CircleCheckBig
              className={`text-ds-icon-neutral-muted-default group-hover:text-ds-icon-status-completed-default-default h-[10px] w-[10px] ${
                (isSelected('done') || forceVisible) &&
                '!text-ds-icon-status-completed-default-default'
              }`}
            />
            <span
              className={`text-xs font-normal leading-tight text-ds-text-neutral-muted-default group-hover:text-ds-text-status-completed-strong-default transition-all duration-200 ${
                (isSelected('done') || forceVisible) &&
                '!text-ds-text-status-completed-strong-default'
              }`}
            >
              {t('chat.done')} <span className={numberClass}>{done}</span>
            </span>
          </div>
        ) : null}

        {/* Reassigned */}
        {reAssignTo && (forceVisible || reAssignTo > 0) ? (
          <div
            className={`group gap-xs px-0.5 py-0.5 hover:bg-ds-bg-neutral-subtle-default flex items-center transition-all duration-200 ${
              isSelected('reassigned') && 'bg-ds-bg-neutral-subtle-default'
            } ${
              clickable && 'cursor-pointer transition-opacity hover:opacity-80'
            }`}
            onClick={() => handleStateClick('reassigned')}
          >
            <CircleSlash2
              className={`text-ds-icon-neutral-muted-default group-hover:text-ds-icon-status-pending-default-default h-[10px] w-[10px] ${
                (isSelected('reassigned') || forceVisible) &&
                '!text-ds-icon-status-pending-default-default'
              }`}
            />
            <span
              className={`text-xs font-normal leading-tight text-ds-text-neutral-muted-default group-hover:text-ds-text-warning-strong-default transition-all duration-200 ${
                (isSelected('reassigned') || forceVisible) &&
                '!text-ds-text-warning-strong-default'
              }`}
            >
              {t('chat.reassigned')}{' '}
              <span className={numberClass}>{reAssignTo}</span>
            </span>
          </div>
        ) : null}

        {/* Ongoing */}
        {progress && (forceVisible || progress > 0) ? (
          <div
            className={`group gap-xs px-0.5 py-0.5 hover:bg-ds-bg-neutral-subtle-default flex items-center ${
              isSelected('ongoing') && 'bg-ds-bg-neutral-subtle-default'
            } ${
              clickable && 'cursor-pointer transition-opacity hover:opacity-80'
            }`}
            onClick={() => handleStateClick('ongoing')}
          >
            <LoaderCircle
              className={`text-ds-icon-neutral-muted-default group-hover:text-ds-icon-status-splitting-default-default h-[10px] w-[10px] ${
                (isSelected('ongoing') || forceVisible) &&
                '!text-ds-icon-status-splitting-default-default'
              } ${
                chatStore.tasks[chatStore.activeTaskId as string]?.status ===
                  'running' && 'animate-spin'
              }`}
            />
            <span
              className={`text-xs font-normal leading-tight text-ds-text-neutral-muted-default group-hover:text-ds-text-status-splitting-strong-default transition-all duration-200 ${
                (isSelected('ongoing') || forceVisible) &&
                '!text-ds-text-status-splitting-strong-default'
              }`}
            >
              {t('chat.ongoing')}{' '}
              <span className={numberClass}>{progress}</span>
            </span>
          </div>
        ) : null}

        {/* Failed */}
        {failed && (forceVisible || failed > 0) ? (
          <div
            className={`group gap-xs px-0.5 py-0.5 hover:bg-ds-bg-neutral-subtle-default flex items-center transition-all duration-200 ${
              isSelected('failed') && 'bg-ds-bg-neutral-subtle-default'
            } ${
              clickable && 'cursor-pointer transition-opacity hover:opacity-80'
            }`}
            onClick={() => handleStateClick('failed')}
          >
            <CircleSlash2
              className={`text-ds-icon-neutral-muted-default group-hover:text-ds-icon-status-error-default-default h-[10px] w-[10px] ${
                (isSelected('failed') || forceVisible) &&
                '!text-ds-icon-status-error-default-default'
              }`}
            />
            <span
              className={`text-xs font-normal leading-tight text-ds-text-neutral-muted-default group-hover:text-ds-text-status-error-strong-default transition-all duration-200 ${
                (isSelected('failed') || forceVisible) &&
                '!text-ds-text-status-error-strong-default'
              }`}
            >
              {t('chat.failed')} <span className={numberClass}>{failed}</span>
            </span>
          </div>
        ) : null}
        {/* Pending */}
        {skipped && (forceVisible || skipped > 0) ? (
          <div
            className={`group gap-xs px-0.5 py-0.5 hover:bg-ds-bg-neutral-subtle-default flex items-center ${
              isSelected('pending')
                ? 'bg-ds-bg-neutral-subtle-default'
                : 'bg-transparent'
            } ${
              clickable && 'cursor-pointer transition-opacity hover:opacity-80'
            }`}
            onClick={() => handleStateClick('pending')}
          >
            <LoaderCircle
              className={`text-ds-icon-neutral-muted-default group-hover:text-ds-icon-status-pending-default-default h-[10px] w-[10px] ${
                (isSelected('pending') || forceVisible) &&
                'text-ds-icon-status-pending-default-default'
              }`}
            />
            <span
              className={`text-xs font-normal leading-tight text-ds-text-neutral-muted-default group-hover:text-ds-text-status-pending-strong-default ${
                (isSelected('pending') || forceVisible) &&
                'text-ds-text-status-pending-strong-default'
              }`}
            >
              {t('chat.pending')} <span className={numberClass}>{skipped}</span>
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
};
