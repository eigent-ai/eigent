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
      <div className="flex w-auto flex-wrap items-center gap-1 bg-transparent">
        {/* All */}
        {all && (forceVisible || all > 0) ? (
          <div
            className={`group flex items-center gap-xs px-2 py-0.5 transition-all duration-200 hover:bg-tag-surface ${
              isSelected('all') ? 'bg-tag-surface' : 'bg-transparent'
            } ${clickable ? 'cursor-pointer' : ''}`}
            onClick={() => handleStateClick('all')}
          >
            <span className="text-xs font-normal text-text-body">
              {t('chat.all')} <span className={numberClass}>{all}</span>
            </span>
          </div>
        ) : null}

        {/* Done */}
        {done && (forceVisible || done > 0) ? (
          <div
            className={`group flex items-center gap-xs px-0.5 py-0.5 transition-all duration-200 hover:bg-tag-surface ${
              isSelected('done') && 'bg-tag-surface'
            } ${
              clickable && 'cursor-pointer transition-opacity hover:opacity-80'
            }`}
            onClick={() => handleStateClick('done')}
          >
            <CircleCheckBig
              className={`h-[10px] w-[10px] text-icon-secondary group-hover:text-icon-success ${
                (isSelected('done') || forceVisible) && '!text-icon-success'
              }`}
            />
            <span
              className={`text-xs font-normal leading-tight text-text-label transition-all duration-200 group-hover:text-text-success ${
                (isSelected('done') || forceVisible) && '!text-text-success'
              }`}
            >
              {t('chat.done')} <span className={numberClass}>{done}</span>
            </span>
          </div>
        ) : null}

        {/* Reassigned */}
        {reAssignTo && (forceVisible || reAssignTo > 0) ? (
          <div
            className={`group flex items-center gap-xs px-0.5 py-0.5 transition-all duration-200 hover:bg-tag-surface ${
              isSelected('reassigned') && 'bg-tag-surface'
            } ${
              clickable && 'cursor-pointer transition-opacity hover:opacity-80'
            }`}
            onClick={() => handleStateClick('reassigned')}
          >
            <CircleSlash2
              className={`h-[10px] w-[10px] text-icon-secondary group-hover:text-icon-warning ${
                (isSelected('reassigned') || forceVisible) &&
                '!text-icon-warning'
              }`}
            />
            <span
              className={`text-xs font-normal leading-tight text-text-label transition-all duration-200 group-hover:text-text-warning ${
                (isSelected('reassigned') || forceVisible) &&
                '!text-text-warning'
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
            className={`group flex items-center gap-xs px-0.5 py-0.5 hover:bg-tag-surface ${
              isSelected('ongoing') && 'bg-tag-surface'
            } ${
              clickable && 'cursor-pointer transition-opacity hover:opacity-80'
            }`}
            onClick={() => handleStateClick('ongoing')}
          >
            <LoaderCircle
              className={`h-[10px] w-[10px] text-icon-secondary group-hover:text-icon-information ${
                (isSelected('ongoing') || forceVisible) &&
                '!text-icon-information'
              } ${
                chatStore.tasks[chatStore.activeTaskId as string]?.status ===
                  'running' && 'animate-spin'
              }`}
            />
            <span
              className={`text-xs font-normal leading-tight text-text-label transition-all duration-200 group-hover:text-text-information ${
                (isSelected('ongoing') || forceVisible) &&
                '!text-text-information'
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
            className={`group flex items-center gap-xs px-0.5 py-0.5 transition-all duration-200 hover:bg-tag-surface ${
              isSelected('failed') && 'bg-tag-surface'
            } ${
              clickable && 'cursor-pointer transition-opacity hover:opacity-80'
            }`}
            onClick={() => handleStateClick('failed')}
          >
            <CircleSlash2
              className={`h-[10px] w-[10px] text-icon-secondary group-hover:text-icon-cuation ${
                (isSelected('failed') || forceVisible) && '!text-icon-cuation'
              }`}
            />
            <span
              className={`text-xs font-normal leading-tight text-text-label transition-all duration-200 group-hover:!text-icon-cuation ${
                (isSelected('failed') || forceVisible) && '!text-text-cuation'
              }`}
            >
              {t('chat.failed')} <span className={numberClass}>{failed}</span>
            </span>
          </div>
        ) : null}
        {/* Pending */}
        {skipped && (forceVisible || skipped > 0) ? (
          <div
            className={`group flex items-center gap-xs px-0.5 py-0.5 hover:bg-tag-surface ${
              isSelected('pending') ? 'bg-tag-surface' : 'bg-transparent'
            } ${
              clickable && 'cursor-pointer transition-opacity hover:opacity-80'
            }`}
            onClick={() => handleStateClick('pending')}
          >
            <LoaderCircle
              className={`group-hover:text-primary-foreground h-[10px] w-[10px] text-icon-secondary ${
                (isSelected('pending') || forceVisible) &&
                'text-primary-foreground'
              }`}
            />
            <span
              className={`group-hover:text-primary-foreground text-xs font-normal leading-tight text-text-label ${
                (isSelected('pending') || forceVisible) &&
                'text-primary-foreground'
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
