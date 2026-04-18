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
      <div className="gap-2 py-sm px-2 flex h-auto w-full flex-col transition-all duration-300">
        <div className="rounded-xl py-sm relative h-auto w-full overflow-hidden bg-[var(--ds-bg-neutral-strong-default)] backdrop-blur-[5px]">
          <div className="left-0 top-0 absolute w-full bg-transparent">
            <Progress value={100} className="h-[2px] w-full" />
          </div>
          <div className="gap-2 px-sm py-2 flex items-center">
            <LoaderCircle
              size={16}
              className="animate-spin text-[color:var(--ds-icon-information-default-default)]"
            />
            <span className="animate-pulse text-sm text-[color:var(--ds-text-neutral-muted-default)]">
              {t('layout.task-splitting')}...
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="gap-2 py-sm px-2 flex h-auto w-full flex-col transition-all duration-300">
      <div className="rounded-xl py-sm relative h-auto w-full overflow-hidden bg-[var(--ds-bg-neutral-strong-default)] backdrop-blur-[5px]">
        {/* Progress bar at top */}
        <div className="left-0 top-0 absolute w-full bg-transparent">
          <Progress value={100} className="h-[2px] w-full" />
        </div>

        {/* Task type badge */}
        <div className="mb-2 gap-2 px-sm flex items-center">
          <TaskType type={1} />
          <span className="text-xs font-medium text-[color:var(--ds-text-neutral-subtle-default)]">
            {t('layout.tasks')} {tasks.length}
          </span>
        </div>

        {/* Task list */}
        <div className="mt-sm px-sm flex flex-col">
          {tasks.map((task, index) => {
            const isLastTask = index === tasks.length - 1;
            const isCurrentlyStreaming = isLastTask && isStreaming;

            return (
              <div
                key={`streaming-task-${index}`}
                className="group min-h-2 rounded-lg p-sm animate-in fade-in-0 slide-in-from-left-2 relative flex items-start duration-300"
              >
                {/* Task indicator */}
                <div className="h-4 w-7 pr-sm pt-1 flex flex-shrink-0 items-center justify-center">
                  {isCurrentlyStreaming ? (
                    <LoaderCircle
                      size={13}
                      className="animate-spin text-[color:var(--ds-icon-information-default-default)]"
                    />
                  ) : (
                    <CircleDashed
                      size={13}
                      className="text-[color:var(--ds-icon-neutral-muted-default)]"
                    />
                  )}
                </div>

                {/* Task content */}
                <div className="min-h-4 pb-2 relative flex w-full items-start border-[0px] border-b border-solid border-[color:var(--ds-border-neutral-subtle-default)]">
                  <span className="text-xs leading-[20px] text-[color:var(--ds-text-neutral-default-default)]">
                    {task}
                    {isCurrentlyStreaming && (
                      <span className="ml-0.5 h-4 w-1 animate-pulse inline-block bg-[var(--ds-icon-information-default-default)]" />
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
