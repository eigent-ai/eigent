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
import ShinyText from '@/components/ui/ShinyText/ShinyText';
import { cn } from '@/lib/utils';
import type { VanillaChatStore } from '@/store/chatStore';
import { motion } from 'framer-motion';
import { Circle, CircleDashed, Maximize2 } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusRow } from './StatusRow';
import { parseStreamingTasks, planBlurFadeMotion } from './utils';

interface FoldedViewProps {
  chatStore: VanillaChatStore;
  taskId: string;
  summaryTask: string;
  taskInfo: TaskInfo[];
  streamingDecomposeText: string;
  isSplitting: boolean;
  canExpand?: boolean;
  onExpand: () => void;
}

const PREVIEW_MAX_HEIGHT_PX = 200;

export function FoldedView({
  chatStore,
  taskId,
  summaryTask,
  taskInfo,
  streamingDecomposeText,
  isSplitting,
  canExpand = true,
  onExpand,
}: FoldedViewProps) {
  const { t } = useTranslation();
  const streamingTasks = useMemo(
    () => parseStreamingTasks(streamingDecomposeText),
    [streamingDecomposeText]
  );

  const hasTaskInfo = taskInfo.length > 0;
  const hasStreaming = streamingTasks.tasks.length > 0;
  const showPreview = hasTaskInfo || hasStreaming;

  const headerText = summaryTask || t('chat.subtasks-planning');

  const previewRows = hasTaskInfo
    ? taskInfo
        .filter((t) => t.content !== '')
        .map((t, i) => ({
          key: t.id || `task-${i}`,
          content: t.content,
          streaming: false,
        }))
    : streamingTasks.tasks.map((content, i) => ({
        key: `stream-${i}`,
        content,
        streaming:
          i === streamingTasks.tasks.length - 1 && streamingTasks.isStreaming,
      }));

  return (
    <motion.div
      initial={planBlurFadeMotion.initial}
      animate={planBlurFadeMotion.animate}
      exit={planBlurFadeMotion.exit}
      transition={planBlurFadeMotion.transition}
      className={cn(
        'relative mx-sm flex flex-col overflow-hidden rounded-2xl bg-ds-bg-splitting-subtle-default'
      )}
    >
      <div className="flex items-center gap-2 border-x-0 border-b border-t-0 border-solid border-ds-border-neutral-subtle-default px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center justify-start truncate text-left">
          {isSplitting ? (
            <ShinyText
              text={headerText}
              className="block w-full truncate text-left !text-body-sm !font-bold"
              speed={3}
            />
          ) : (
            <div className="w-full truncate text-left text-body-sm font-bold text-ds-text-neutral-default-default">
              {headerText}
            </div>
          )}
        </div>
        {canExpand ? (
          <Button
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
            buttonRadius="full"
            onClick={onExpand}
            aria-label={t('chat.expand-plan')}
          >
            <Maximize2 size={14} />
          </Button>
        ) : null}
      </div>

      {isSplitting && !showPreview && (
        <div className="px-3 py-3">
          <StatusRow chatStore={chatStore} taskId={taskId} />
        </div>
      )}

      {showPreview && (
        <div
          className="scrollbar relative m-2 overflow-y-auto rounded-xl bg-transparent"
          style={{ height: PREVIEW_MAX_HEIGHT_PX }}
        >
          <div className="flex flex-col px-3 py-2">
            {previewRows.map((row) => (
              <div
                key={row.key}
                className="flex items-start gap-2 py-1.5 duration-300 animate-in fade-in-0 slide-in-from-left-2"
              >
                <div className="flex h-4 flex-shrink-0 items-center justify-center pt-0.5">
                  {row.streaming ? (
                    <Circle
                      size={13}
                      className="text-ds-icon-status-splitting-default-default"
                    />
                  ) : (
                    <CircleDashed
                      size={13}
                      className="text-ds-icon-neutral-muted-default"
                    />
                  )}
                </div>
                <span className="min-w-0 flex-1 text-label-xs text-ds-text-neutral-default-default">
                  {row.content}
                </span>
              </div>
            ))}
          </div>
          {canExpand ? (
            <div className="pointer-events-none absolute bottom-0 left-1/2 -mx-2 h-16 w-full -translate-x-1/2 bg-gradient-to-b from-transparent to-ds-bg-status-splitting-subtle-default">
              <Button
                variant="secondary"
                size="xs"
                buttonRadius="full"
                onClick={onExpand}
                aria-label={t('chat.expand-subtasks')}
                className="pointer-events-auto absolute bottom-3 left-1/2 -translate-x-1/2"
              >
                {t('chat.expand-subtasks')}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </motion.div>
  );
}
