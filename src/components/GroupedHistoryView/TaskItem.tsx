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
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Tag } from '@/components/ui/tag';
import { TooltipSimple } from '@/components/ui/tooltip';
import { ChatTaskStatus } from '@/types/constants';
import { HistoryTask } from '@/types/history';
import {
  CheckCircle,
  CirclePause,
  CirclePlay,
  Clock,
  Ellipsis,
  Hash,
  Pin,
  Share,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface TaskItemProps {
  task: HistoryTask;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onShare: () => void;
  isLast: boolean;
  isOngoing?: boolean;
  onPause?: () => void;
  onResume?: () => void;
  showActions?: boolean;
}

export default function TaskItem({
  task,
  isActive,
  onSelect,
  onDelete,
  onShare,
  isLast,
  isOngoing = false,
  onPause,
  onResume,
  showActions = true,
}: TaskItemProps) {
  const { t } = useTranslation();

  // Check if task is paused (for ongoing tasks)
  const isPaused = (task as any)._taskData?.status === ChatTaskStatus.PAUSE;

  const getStatusTag = (status: number) => {
    // ChatStatus enum: ongoing = 1, done = 2
    switch (status) {
      case 1: // ChatStatus.ongoing
        return (
          <Tag variant="info" size="sm">
            <Clock />
            <span>{t('layout.running')}</span>
          </Tag>
        );
      case 2: // ChatStatus.done
        return (
          <Tag variant="success" size="sm">
            <CheckCircle />
            <span>{t('layout.completed')}</span>
          </Tag>
        );
      default: // Unknown status
        return (
          <Tag variant="default" size="sm">
            <Clock />
            <span>{t('layout.unknown')}</span>
          </Tag>
        );
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return (
      date.toLocaleDateString() +
      ' ' +
      date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    );
  };

  return (
    <div
      onClick={onSelect}
      className={` ${isActive ? '!bg-white-100%' : ''} relative flex h-14 w-full cursor-pointer items-center justify-between gap-md rounded-xl border border-solid border-border-disabled bg-white-30% p-3 shadow-history-item transition-all duration-300 hover:bg-white-100% ${!isLast ? 'mb-2' : ''} `}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <TooltipSimple content={t('layout.tasks')}>
          <Pin className="h-4 w-4 text-icon-primary" />
        </TooltipSimple>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <TooltipSimple
            align="start"
            className="pointer-events-auto max-w-xs select-text text-wrap break-words bg-surface-tertiary p-2 text-label-xs shadow-perfect"
            content={
              <div className="space-y-1">
                <div className="font-medium">
                  {task.summary || task.question}
                </div>
                <div className="text-xs opacity-60">
                  {t('layout.created')}: {formatDate(task.created_at)}
                </div>
                <div className="text-xs opacity-60">
                  {t('chat.token')}:{' '}
                  {task.tokens ? task.tokens.toLocaleString() : '0'}
                </div>
              </div>
            }
          >
            <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium text-text-body">
              {task.summary || task.question || t('layout.new-project')}
            </span>
          </TooltipSimple>
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-2">
        {!isOngoing && getStatusTag(task.status)}

        <Tag variant="info" size="sm">
          <Hash />
          <span>{task.tokens ? task.tokens.toLocaleString() : '0'}</span>
        </Tag>

        {isOngoing && (onPause || onResume) && (
          <Tag
            variant={isPaused ? 'info' : 'success'}
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              if (isPaused && onResume) {
                onResume();
              } else if (!isPaused && onPause) {
                onPause();
              }
            }}
          >
            {isPaused ? <CirclePlay /> : <CirclePause />}
            <span>{isPaused ? t('layout.continue') : t('layout.pause')}</span>
          </Tag>
        )}

        {showActions && (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                size="icon"
                onClick={(e) => e.stopPropagation()}
                variant="ghost"
                className="rounded-full"
              >
                <Ellipsis />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-[98px] rounded-[12px] border border-solid border-dropdown-border bg-dropdown-bg p-sm"
            >
              <div className="space-y-1">
                {!isOngoing && (
                  <PopoverClose asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start"
                      onClick={(e) => {
                        e.stopPropagation();
                        onShare();
                      }}
                    >
                      <Share size={14} />
                      {t('layout.share')}
                    </Button>
                  </PopoverClose>
                )}

                <PopoverClose asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete();
                    }}
                  >
                    <Trash2
                      size={14}
                      className="text-icon-primary group-hover:text-icon-cuation"
                    />
                    {t('layout.delete')}
                  </Button>
                </PopoverClose>
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}
