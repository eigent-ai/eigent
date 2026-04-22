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

import { AgentFolderSection } from '@/components/Session/SidePanelSections/AgentFolderSection';
import { AgentPoolSection } from '@/components/Session/SidePanelSections/AgentPoolSection';
import { buildContextItems } from '@/components/Session/SidePanelSections/buildContextItems';
import { collectSidePanelOutputFiles } from '@/components/Session/SidePanelSections/collectSidePanelOutputFiles';
import { ExecutionContextSection } from '@/components/Session/SidePanelSections/ExecutionContextSection';
import { ProgressSection } from '@/components/Session/SidePanelSections/ProgressSection';
import ExpandedOverlay from '@/components/Session/Workforce/ExpandedOverlay';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { cn } from '@/lib/utils';
import { usePageTabStore } from '@/store/pageTabStore';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

/** Main column under `SessionSidePanel` header: fills remaining height in flex parent */
export const WORKFORCE_MAIN_SURFACE_CLASS =
  'min-w-0 flex w-full min-h-0 flex-1 flex-col overflow-hidden';

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
    const runById = new Map(
      taskRunning.map((r) => [r.id, r] as [string, TaskInfo])
    );
    return taskInfo.map((t) => {
      const live = runById.get(t.id);
      if (!live) return t;
      return { ...t, ...live, content: t.content || live.content };
    });
  }, [activeTask?.taskInfo, activeTask?.taskRunning]);
  const files = useMemo(
    () => collectSidePanelOutputFiles(activeTask),
    [activeTask]
  );
  const uploadedFiles = useMemo(() => {
    if (!activeTask) return [];
    const all = [
      ...(activeTask.messages ?? [])
        .filter((m) => m.role === 'user')
        .flatMap((m) => m.attaches ?? []),
      ...(activeTask.attaches ?? []),
    ];
    const seen = new Set<string>();
    return all.filter((file) => {
      const key = file.filePath;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [activeTask]);
  const contextItems = useMemo(
    () => buildContextItems(agents, activeTask?.taskRunning, uploadedFiles),
    [agents, activeTask?.taskRunning, uploadedFiles]
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
      <div className={cn(WORKFORCE_MAIN_SURFACE_CLASS, 'relative')}>
        <div className="gap-2 px-2 pb-2 min-h-0 min-w-0 flex flex-1 flex-col overflow-x-hidden overflow-y-auto">
          <AgentPoolSection
            title={t('layout.workforce-agent-pool', {
              defaultValue: 'Agent Pool',
            })}
            agents={agents}
          />
          <ProgressSection
            title={t('layout.workforce-progress', {
              defaultValue: 'Progress',
            })}
            subtasks={subtasks}
          />
          <ExecutionContextSection
            title={t('layout.execution-context', {
              defaultValue: 'Execution Context',
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
