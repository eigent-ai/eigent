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
      className="inset-x-0 absolute z-30 flex justify-center"
      style={{
        top: 0,
        bottom: bottomOffsetPx + 8,
        transformOrigin: 'bottom center',
      }}
    >
      <div className="flex w-full max-w-[600px] flex-col">
        <div className="rounded-2xl bg-ds-bg-splitting-subtle-default border-ds-border-neutral-subtle-disabled min-h-0 flex h-full flex-col overflow-hidden border border-solid">
          <div className="gap-2 px-3 pt-2 flex shrink-0 items-center">
            <div className="text-body-sm font-bold text-ds-text-neutral-default-default min-w-0 flex-1">
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
            <div className="px-3 py-2 shrink-0">
              <UserMessageRichContent
                content={userPrompt}
                variant="compact"
                className="w-full"
              />
            </div>
          ) : null}

          {isSplitting && (
            <div className="px-3 py-2 shrink-0">
              <StatusRow chatStore={chatStore} taskId={taskId} />
            </div>
          )}

          <div className="scrollbar scrollbar-always-visible px-2 min-h-0 border-ds-border-neutral-subtle-disabled flex-1 overflow-x-hidden overflow-y-auto border border-x-0 border-t-1 border-b-0 border-solid bg-transparent">
            {hasTaskInfo ? (
              <SubtaskEditor
                taskInfo={taskInfo}
                onAdd={onAddTask}
                onUpdate={onUpdateTask}
                onDelete={onDeleteTask}
                onMarkDirty={onMarkDirty}
              />
            ) : (
              <div className="px-3 py-2 flex flex-col">
                {streamingTasks.tasks.map((content, i) => {
                  const isLast = i === streamingTasks.tasks.length - 1;
                  const streaming = isLast && streamingTasks.isStreaming;
                  return (
                    <div
                      key={`s-${i}`}
                      className="gap-2 py-1.5 animate-in fade-in-0 slide-in-from-left-2 flex items-start duration-300"
                    >
                      <div className="h-4 pt-0.5 flex flex-shrink-0 items-center justify-center">
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
                      <span className="text-label-xs text-ds-text-neutral-default-default min-w-0 flex-1">
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
