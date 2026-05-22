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

import { UserMessageRichContent } from '@/components/ChatBox/MessageItem/UserMessageRichContent';
import { Button } from '@/components/ui/button';
import type { VanillaChatStore } from '@/store/chatStore';
import { motion } from 'framer-motion';
import { CircleDashed, LoaderCircle, Minimize2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusRow } from './StatusRow';
import { SubtaskEditor } from './SubtaskEditor';
import { parseStreamingTasks, planOverlayScaleMotion } from './utils';

interface ExpandedOverlayProps {
  chatStore: VanillaChatStore;
  taskId: string;
  userPrompt?: string;
  taskInfo: TaskInfo[];
  streamingDecomposeText: string;
  isSplitting: boolean;
  bottomOffsetPx: number;
  onMinimize: () => void;
  onAddTask: () => void;
  onUpdateTask: (index: number, content: string) => void;
  onDeleteTask: (index: number) => void;
  onMarkDirty: () => void;
}

export function ExpandedOverlay({
  chatStore,
  taskId,
  userPrompt,
  taskInfo,
  streamingDecomposeText,
  isSplitting,
  bottomOffsetPx,
  onMinimize,
  onAddTask,
  onUpdateTask,
  onDeleteTask,
  onMarkDirty,
}: ExpandedOverlayProps) {
  const { t } = useTranslation();
  const streamingTasks = useMemo(
    () => parseStreamingTasks(streamingDecomposeText),
    [streamingDecomposeText]
  );

  const hasTaskInfo = taskInfo.length > 0;
  // Ensure the editor always has at least one trailing row to type into.
  const [trailingRowAdded, setTrailingRowAdded] = useState(false);
  useEffect(() => {
    if (
      hasTaskInfo &&
      !trailingRowAdded &&
      taskInfo.every((t) => t.content.trim() !== '')
    ) {
      onAddTask();
      setTrailingRowAdded(true);
    }
  }, [hasTaskInfo, taskInfo, trailingRowAdded, onAddTask]);

  return (
    <motion.div
      initial={planOverlayScaleMotion.initial}
      animate={planOverlayScaleMotion.animate}
      exit={planOverlayScaleMotion.exit}
      transition={planOverlayScaleMotion.transition}
      className="absolute inset-x-0 z-30 flex justify-center"
      style={{
        top: 0,
        bottom: bottomOffsetPx + 8,
        transformOrigin: 'bottom center',
      }}
    >
      <div className="flex w-full max-w-[600px] flex-col">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-solid border-ds-border-neutral-subtle-disabled bg-ds-bg-splitting-subtle-default">
          <div className="flex shrink-0 items-center gap-2 px-3 pt-2">
            <div className="min-w-0 flex-1 text-body-sm font-bold text-ds-text-neutral-default-default">
              {t('chat.subtasks-planning')}
            </div>
            <Button
              variant="ghost"
              size="sm"
              buttonContent="icon-only"
              buttonRadius="full"
              onClick={onMinimize}
              aria-label={t('chat.minimize-plan')}
            >
              <Minimize2 size={14} />
            </Button>
          </div>

          {userPrompt ? (
            <div className="shrink-0 px-3 py-2">
              <UserMessageRichContent
                content={userPrompt}
                variant="compact"
                className="w-full"
              />
            </div>
          ) : null}

          {isSplitting && (
            <div className="shrink-0 px-3 py-2">
              <StatusRow chatStore={chatStore} taskId={taskId} />
            </div>
          )}

          <div className="scrollbar scrollbar-always-visible border-t-1 min-h-0 flex-1 overflow-y-auto overflow-x-hidden border border-x-0 border-b-0 border-solid border-ds-border-neutral-subtle-disabled bg-transparent px-2">
            {hasTaskInfo ? (
              <SubtaskEditor
                taskInfo={taskInfo}
                onAdd={onAddTask}
                onUpdate={onUpdateTask}
                onDelete={onDeleteTask}
                onMarkDirty={onMarkDirty}
              />
            ) : (
              <div className="flex flex-col px-3 py-2">
                {streamingTasks.tasks.map((content, i) => {
                  const isLast = i === streamingTasks.tasks.length - 1;
                  const streaming = isLast && streamingTasks.isStreaming;
                  return (
                    <div
                      key={`s-${i}`}
                      className="flex items-start gap-2 py-1.5 duration-300 animate-in fade-in-0 slide-in-from-left-2"
                    >
                      <div className="flex h-4 flex-shrink-0 items-center justify-center pt-0.5">
                        {streaming ? (
                          <LoaderCircle
                            size={13}
                            className="animate-spin text-ds-icon-information-default-default"
                          />
                        ) : (
                          <CircleDashed
                            size={13}
                            className="text-ds-icon-neutral-muted-default"
                          />
                        )}
                      </div>
                      <span className="min-w-0 flex-1 text-label-xs text-ds-text-neutral-default-default">
                        {content}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
