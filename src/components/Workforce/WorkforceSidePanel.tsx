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

import { AgentFolderSection } from '@/components/SidePanelSections/AgentFolderSection';
import { AgentPoolSection } from '@/components/SidePanelSections/AgentPoolSection';
import { buildContextItems } from '@/components/SidePanelSections/buildContextItems';
import { collectSidePanelOutputFiles } from '@/components/SidePanelSections/collectSidePanelOutputFiles';
import { ContextSection } from '@/components/SidePanelSections/ContextSection';
import { ProgressSection } from '@/components/SidePanelSections/ProgressSection';
import { Button } from '@/components/ui/button';
import { TooltipSimple } from '@/components/ui/tooltip';
import ExpandedOverlay from '@/components/Workforce/ExpandedOverlay';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { cn } from '@/lib/utils';
import { usePageTabStore } from '@/store/pageTabStore';
import { Maximize2, X } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export const WORKFORCE_MAIN_SURFACE_CLASS =
  'min-w-0 flex h-full w-full flex-col overflow-hidden';

export interface WorkforceSidePanelProps {
  workforcePanelKey: string;
  hasAnyMessages: boolean;
  isSidePanelVisible: boolean;
  onToggleSidePanel: () => void;
  /** Controlled: whether the full-screen workforce overlay is open. */
  isExpandedOverlayOpen: boolean;
  onToggleExpandedOverlay: () => void;
  onCloseExpandedOverlay: () => void;
}

export function WorkforceSidePanel({
  workforcePanelKey,
  hasAnyMessages: _hasAnyMessages,
  isSidePanelVisible,
  onToggleSidePanel,
  isExpandedOverlayOpen,
  onToggleExpandedOverlay,
  onCloseExpandedOverlay,
}: WorkforceSidePanelProps) {
  const { t } = useTranslation();
  const { chatStore, projectStore } = useChatStoreAdapter();
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);
  const activeTask = chatStore?.activeTaskId
    ? chatStore.tasks[chatStore.activeTaskId]
    : undefined;

  const agents = activeTask?.taskAssigning ?? [];
  /** Subtask status is updated in `taskRunning` (e.g. TASK_STATE); `taskInfo` keeps plan text/order. */
  const subtasks = useMemo(() => {
    const taskInfo = activeTask?.taskInfo ?? [];
    const taskRunning = activeTask?.taskRunning ?? [];
    if (taskRunning.length === 0) return taskInfo;
    return taskInfo.map((t) => {
      const live = taskRunning.find((r) => r.id === t.id);
      if (!live) return t;
      return { ...t, ...live, content: t.content || live.content };
    });
  }, [activeTask?.taskInfo, activeTask?.taskRunning]);
  const files = useMemo(
    () => collectSidePanelOutputFiles(activeTask),
    [activeTask]
  );
  const contextItems = useMemo(
    () => buildContextItems(agents, activeTask?.taskRunning),
    [agents, activeTask?.taskRunning]
  );

  const handleOpenAgentFile = useCallback(
    (file: FileInfo) => {
      if (!chatStore?.activeTaskId) return;
      chatStore.setSelectedFile(chatStore.activeTaskId, file);
      setActiveWorkspaceTab('inbox', {
        clearInboxForProjectId: projectStore.activeProjectId ?? null,
      });
    },
    [chatStore, projectStore.activeProjectId, setActiveWorkspaceTab]
  );

  return (
    <>
      {isSidePanelVisible && (
        <div className={cn(WORKFORCE_MAIN_SURFACE_CLASS, 'relative')}>
          <div className="gap-2 py-2 pl-2 pr-4 relative z-50 flex w-full shrink-0 items-center justify-between">
            <span className="text-ds-text-neutral-default-default px-1 text-body-md font-semibold truncate">
              {t('layout.aiWorkforce')}
            </span>
            <div className="gap-1 flex shrink-0 items-center">
              <TooltipSimple
                content={
                  isExpandedOverlayOpen
                    ? t('layout.close')
                    : t('layout.expand-workforce', {
                        defaultValue: 'Expand workforce',
                      })
                }
                delayDuration={300}
                side="bottom"
              >
                <Button
                  variant="ghost"
                  size="sm"
                  buttonContent="icon-only"
                  buttonRadius="lg"
                  className="shrink-0"
                  onClick={onToggleExpandedOverlay}
                  aria-pressed={isExpandedOverlayOpen}
                  aria-label={
                    isExpandedOverlayOpen
                      ? t('layout.close')
                      : t('layout.expand-workforce', {
                          defaultValue: 'Expand workforce',
                        })
                  }
                >
                  {isExpandedOverlayOpen ? (
                    <X className="h-4 w-4" />
                  ) : (
                    <Maximize2 className="h-4 w-4" />
                  )}
                </Button>
              </TooltipSimple>
            </div>
          </div>

          <div className="gap-2 px-2 pb-2 min-h-0 min-w-0 flex flex-1 flex-col overflow-x-hidden overflow-y-auto">
            <AgentPoolSection
              title={t('layout.workforce-active-agent-pool', {
                defaultValue: 'Active Agent Pool',
              })}
              agents={agents}
            />
            <ProgressSection
              title={t('layout.workforce-progress', {
                defaultValue: 'Progress',
              })}
              subtasks={subtasks}
            />
            <ContextSection
              title={t('layout.workforce-context', {
                defaultValue: 'Context',
              })}
              items={contextItems}
            />
            <AgentFolderSection
              title={t('layout.workforce-agent-folder', {
                defaultValue: 'Agent Folder',
              })}
              files={files}
              onOpenFile={handleOpenAgentFile}
            />
          </div>
        </div>
      )}

      <ExpandedOverlay
        open={isExpandedOverlayOpen}
        onClose={onCloseExpandedOverlay}
        workforcePanelKey={workforcePanelKey}
        onToggleSidePanel={onToggleSidePanel}
        isSidePanelVisible={isSidePanelVisible}
      />
    </>
  );
}
