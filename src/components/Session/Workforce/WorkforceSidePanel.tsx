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
import {
  collectSidePanelOutputFiles,
  mergeSidePanelOutputFiles,
} from '@/components/Session/SidePanelSections/collectSidePanelOutputFiles';
import { ExecutionContextSection } from '@/components/Session/SidePanelSections/ExecutionContextSection';
import { ProgressSection } from '@/components/Session/SidePanelSections/ProgressSection';
import { useProjectOutputFiles } from '@/components/Session/SidePanelSections/useProjectOutputFiles';
import ExpandedOverlay from '@/components/Session/Workforce/ExpandedOverlay';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useSelectedProjectTurn } from '@/hooks/useSelectedProjectTurn';
import { cn } from '@/lib/utils';
import { usePageTabStore } from '@/store/pageTabStore';
import { useSkillsStore } from '@/store/skillsStore';
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
  onToggleExpandedOverlay: _onToggleExpandedOverlay,
  onCloseExpandedOverlay,
}: WorkforceSidePanelProps) {
  const { t } = useTranslation();
  const { projectStore } = useChatStoreAdapter();
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);

  const selectedTurn = useSelectedProjectTurn(projectStore.activeProjectId);
  const selectedTask = selectedTurn.task;
  const selectedTaskId = selectedTurn.taskId;

  const agents = useMemo(
    () => selectedTask?.taskAssigning ?? [],
    [selectedTask?.taskAssigning]
  );
  const projectFiles = useProjectOutputFiles(
    projectStore.activeProjectId,
    selectedTask,
    selectedTaskId
  );
  /** Subtask status is updated in `taskRunning` (e.g. TASK_STATE); `taskInfo` keeps plan text/order. */
  const subtasks = useMemo(() => {
    const taskInfo = selectedTask?.taskInfo ?? [];
    const taskRunning = selectedTask?.taskRunning ?? [];
    if (taskRunning.length === 0) return taskInfo;
    const runById = new Map(
      taskRunning.map((r) => [r.id, r] as [string, TaskInfo])
    );
    return taskInfo.map((t) => {
      const live = runById.get(t.id);
      if (!live) return t;
      return { ...t, ...live, content: t.content || live.content };
    });
  }, [selectedTask?.taskInfo, selectedTask?.taskRunning]);
  const files = useMemo(
    () =>
      mergeSidePanelOutputFiles(
        collectSidePanelOutputFiles(selectedTask),
        projectFiles
      ),
    [selectedTask, projectFiles]
  );
  const uploadedFiles = useMemo(() => {
    if (!selectedTask) return [];
    const all = [
      ...(selectedTask.messages ?? [])
        .filter((m) => m.role === 'user')
        .flatMap((m) => m.attaches ?? []),
      ...(selectedTask.attaches ?? []),
    ];
    const seen = new Set<string>();
    return all.filter((file) => {
      const key = file.filePath;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [selectedTask]);
  const skills = useSkillsStore((s) => s.skills);
  const contextItems = useMemo(
    () =>
      buildContextItems(
        agents,
        selectedTask?.taskRunning,
        uploadedFiles,
        skills
      ),
    [agents, selectedTask?.taskRunning, uploadedFiles, skills]
  );

  const handleOpenAgentFile = useCallback(
    (file: FileInfo) => {
      if (!selectedTaskId || !selectedTurn.chatStore) return;
      selectedTurn.chatStore.getState().setSelectedFile(selectedTaskId, file);
      setActiveWorkspaceTab('inbox', {
        clearInboxForProjectId: projectStore.activeProjectId ?? null,
      });
    },
    [
      projectStore.activeProjectId,
      selectedTaskId,
      selectedTurn.chatStore,
      setActiveWorkspaceTab,
    ]
  );

  return (
    <>
      <div className={cn(WORKFORCE_MAIN_SURFACE_CLASS, 'relative')}>
        <div className="min-h-0 min-w-0 gap-2 px-2 pb-2 flex flex-1 flex-col overflow-x-hidden overflow-y-auto">
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
            projectId={projectStore.activeProjectId}
            taskId={selectedTaskId}
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
        selectedTurn={selectedTurn}
      />
    </>
  );
}
