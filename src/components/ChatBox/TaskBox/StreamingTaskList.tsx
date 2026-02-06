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

import { Progress } from '@/components/ui/progress';
import { CircleDashed, LoaderCircle } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TaskType } from './TaskType';

interface StreamingTaskListProps {
  streamingText: string;
}

/**
 * Parse streaming task text and extract task content
 * Supports formats:
 * - <task>content</task>
 * - <task>content (incomplete, still streaming)
 */
function parseStreamingTasks(text: string): {
  tasks: string[];
  isStreaming: boolean;
} {
  const tasks: string[] = [];

  // Match complete tasks: <task>content</task>
  const completeTaskRegex = /<task>([\s\S]*?)<\/task>/g;
  let match;
  while ((match = completeTaskRegex.exec(text)) !== null) {
    const content = match[1].trim();
    if (content) {
      tasks.push(content);
    }
  }

  // Check for incomplete task (streaming): <task>content without closing tag
  const lastOpenTag = text.lastIndexOf('<task>');
  const lastCloseTag = text.lastIndexOf('</task>');

  let isStreaming = false;
  if (lastOpenTag > lastCloseTag) {
    // There's an unclosed <task> tag - extract its content
    const incompleteContent = text.substring(lastOpenTag + 6).trim();
    if (incompleteContent) {
      tasks.push(incompleteContent);
      isStreaming = true;
    }
  }

  return { tasks, isStreaming };
}

export function StreamingTaskList({ streamingText }: StreamingTaskListProps) {
  const { t } = useTranslation();
  const { tasks, isStreaming } = useMemo(
    () => parseStreamingTasks(streamingText),
    [streamingText]
  );

  if (tasks.length === 0) {
    // Show a loading state when no tasks have been parsed yet
    return (
      <div className="flex h-auto w-full flex-col gap-2 py-sm pl-2 transition-all duration-300">
        <div className="relative h-auto w-full overflow-hidden rounded-xl bg-task-surface py-sm backdrop-blur-[5px]">
          <div className="absolute left-0 top-0 w-full bg-transparent">
            <Progress value={100} className="h-[2px] w-full" />
          </div>
          <div className="flex items-center gap-2 px-sm py-2">
            <LoaderCircle
              size={16}
              className="animate-spin text-icon-information"
            />
            <span className="text-text-secondary animate-pulse text-sm">
              {t('layout.task-splitting')}...
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-auto w-full flex-col gap-2 py-sm pl-2 transition-all duration-300">
      <div className="relative h-auto w-full overflow-hidden rounded-xl bg-task-surface py-sm backdrop-blur-[5px]">
        {/* Progress bar at top */}
        <div className="absolute left-0 top-0 w-full bg-transparent">
          <Progress value={100} className="h-[2px] w-full" />
        </div>

        {/* Task type badge */}
        <div className="mb-2 flex items-center gap-2 px-sm">
          <TaskType type={1} />
          <span className="text-text-tertiary text-xs font-medium">
            {t('layout.tasks')} {tasks.length}
          </span>
        </div>

        {/* Task list */}
        <div className="mt-sm flex flex-col px-sm">
          {tasks.map((task, index) => {
            const isLastTask = index === tasks.length - 1;
            const isCurrentlyStreaming = isLastTask && isStreaming;

            return (
              <div
                key={`streaming-task-${index}`}
                className="group relative flex min-h-2 items-start rounded-lg p-sm duration-300 animate-in fade-in-0 slide-in-from-left-2"
              >
                {/* Task indicator */}
                <div className="flex h-4 w-7 flex-shrink-0 items-center justify-center pr-sm pt-1">
                  {isCurrentlyStreaming ? (
                    <LoaderCircle
                      size={13}
                      className="animate-spin text-icon-information"
                    />
                  ) : (
                    <CircleDashed size={13} className="text-icon-secondary" />
                  )}
                </div>

                {/* Task content */}
                <div className="relative flex min-h-4 w-full items-start border-[0px] border-b border-solid border-task-border-default pb-2">
                  <span className="text-text-primary text-xs leading-[20px]">
                    {task}
                    {isCurrentlyStreaming && (
                      <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-icon-information" />
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
