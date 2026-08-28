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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { getToolkitIcon } from '@/lib/toolkitIcons';
import type { ChatStore } from '@/store/chatStore';
import { AgentStatusValue, ChatTaskStatus } from '@/types/constants';
import { Copy, LoaderCircle } from 'lucide-react';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { MarkDown } from './MarkDown';

type ToolkitEntry = NonNullable<TaskInfo['toolkits']>[number] & {
  toolkitId?: string;
};

export function TaskLogPanelContent({
  selectedTask,
  chatStore,
  isEditMode = false,
  reportRef,
}: {
  selectedTask: TaskInfo;
  chatStore: ChatStore;
  isEditMode?: boolean;
  reportRef?: RefObject<HTMLDivElement>;
}) {
  const { t } = useTranslation();
  const activeTaskId = chatStore.activeTaskId as string;

  return (
    <>
      {selectedTask.toolkits &&
        selectedTask.toolkits.length > 0 &&
        selectedTask.toolkits.map((toolkit: ToolkitEntry, index: number) => (
          <div key={`toolkit-${toolkit.toolkitId ?? index}`}>
            {toolkit.toolkitName === 'notice' ? (
              <div
                key={`notice-${index}`}
                className="flex w-full flex-col gap-sm px-2 py-1"
              >
                <MarkDown
                  content={toolkit?.message}
                  enableTypewriter={false}
                  pTextSize="text-ds-text-meta"
                />
              </div>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    key={`toolkit-${index}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (toolkit.toolkitMethods === 'write to file') {
                        chatStore.tasks[activeTaskId].activeWorkspace =
                          'documentWorkSpace';
                      } else if (toolkit.toolkitMethods === 'visit page') {
                        const parts = toolkit.message.split('\n');
                        const url = parts[0];
                        window.location.href = url;
                      } else if (toolkit.toolkitMethods === 'scrape') {
                        window.location.href = toolkit.message;
                      }
                    }}
                    className="flex flex-col items-start justify-center gap-1 rounded-lg p-1 px-2 transition-opacity duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] hover:opacity-50"
                  >
                    <div className="flex w-full items-center justify-start gap-sm">
                      {toolkit.toolkitStatus === AgentStatusValue.RUNNING ? (
                        <LoaderCircle
                          size={16}
                          className={
                            chatStore.tasks[activeTaskId]?.status ===
                            ChatTaskStatus.RUNNING
                              ? 'animate-spin'
                              : ''
                          }
                        />
                      ) : (
                        getToolkitIcon(toolkit.toolkitName)
                      )}
                      <span className="flex items-center gap-sm text-ds-text-meta font-bold text-nowrap text-ds-ink-default-default">
                        {toolkit.toolkitName}
                      </span>
                    </div>
                    <div className="pointer-events-auto flex w-full items-start justify-center gap-sm overflow-hidden pl-6 select-text">
                      <div className="text-ds-text-meta font-bold text-nowrap text-ds-ink-default-default">
                        {toolkit.toolkitMethods
                          ? toolkit.toolkitMethods.charAt(0).toUpperCase() +
                            toolkit.toolkitMethods.slice(1)
                          : ''}
                      </div>
                      <div
                        className={`max-w-full flex-1 truncate text-ds-text-meta font-normal text-ds-ink-default-default ${
                          isEditMode
                            ? 'overflow-hidden'
                            : 'truncate overflow-hidden'
                        }`}
                      >
                        {toolkit.message}
                      </div>
                    </div>
                  </div>
                </TooltipTrigger>
                {toolkit.message && (
                  <TooltipContent
                    align="start"
                    className="scrollbar pointer-events-auto !fixed left-6 z-[9999] max-h-[200px] w-max max-w-[296px] overflow-y-auto rounded-lg border border-x border-y border-solid border-ds-hairline-default-default bg-ds-neutral-strong-default p-2 text-ds-text-meta text-wrap break-words select-text"
                    side="bottom"
                    sideOffset={4}
                  >
                    <MarkDown
                      content={toolkit.message}
                      enableTypewriter={false}
                      pTextSize="text-ds-text-meta"
                      olPadding="pl-4"
                    />
                  </TooltipContent>
                )}
              </Tooltip>
            )}
          </div>
        ))}
      {selectedTask.report && (
        <div
          ref={reportRef}
          onWheel={(e) => {
            e.stopPropagation();
          }}
          className="group relative my-2 flex w-full flex-col rounded-lg bg-ds-neutral-subtle-default"
        >
          <div className="sticky top-0 z-10 flex items-center justify-between rounded-lg bg-ds-neutral-subtle-default py-2 pr-2 pl-2">
            <div className="text-ds-text-base font-bold text-ds-ink-default-default">
              {t('chat.completion-report', {
                defaultValue: 'Completion Report',
              })}
            </div>
            <Button
              variant="ghost"
              size="xs"
              onClick={(e) => {
                e.stopPropagation();
                const reportText =
                  typeof selectedTask?.report === 'string'
                    ? selectedTask.report
                    : '';
                if (reportText && navigator.clipboard?.writeText) {
                  navigator.clipboard.writeText(reportText).catch(() => {
                    // silently fail if clipboard is unavailable
                  });
                }
              }}
              className="text-ds-text-meta"
            >
              <Copy className="text-ds-ink-muted-default" />
              <span className="text-ds-ink-muted-default">
                {t('setting.copy', { defaultValue: 'Copy' })}
              </span>
            </Button>
          </div>
          <div className="px-2 py-2">
            <MarkDown
              content={selectedTask?.report}
              enableTypewriter={false}
              pTextSize="text-ds-text-meta"
            />
          </div>
        </div>
      )}
    </>
  );
}
