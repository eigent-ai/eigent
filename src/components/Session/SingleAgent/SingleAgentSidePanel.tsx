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
import { ExecutionContextSection } from '@/components/Session/SidePanelSections/ExecutionContextSection';
import { ProgressSection } from '@/components/Session/SidePanelSections/ProgressSection';
import { buildContextItems } from '@/components/Session/SidePanelSections/buildContextItems';
import { collectSidePanelOutputFiles } from '@/components/Session/SidePanelSections/collectSidePanelOutputFiles';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { cn } from '@/lib/utils';
import { usePageTabStore } from '@/store/pageTabStore';
import { useSkillsStore } from '@/store/skillsStore';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export function SingleAgentSidePanel() {
  const { t } = useTranslation();
  const { chatStore, projectStore } = useChatStoreAdapter();
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);

  const activeTask = chatStore?.activeTaskId
    ? chatStore.tasks[chatStore.activeTaskId]
    : undefined;

  const agents = activeTask?.taskAssigning ?? [];
  /** Prefer live `taskRunning` status (updated on TASK_STATE), keep plan order/text from agent tasks or taskInfo. */
  const subtasks = useMemo(() => {
    const base = agents[0]?.tasks ?? activeTask?.taskInfo ?? [];
    const taskRunning = activeTask?.taskRunning ?? [];
    if (taskRunning.length === 0) return base;
    return base.map((t) => {
      const live = taskRunning.find((r) => r.id === t.id);
      if (!live) return t;
      return { ...t, ...live, content: t.content || live.content };
    });
  }, [agents, activeTask?.taskInfo, activeTask?.taskRunning]);
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
  const skills = useSkillsStore((s) => s.skills);
  const contextItems = useMemo(
    () =>
      buildContextItems(agents, activeTask?.taskRunning, uploadedFiles, skills),
    [agents, activeTask?.taskRunning, uploadedFiles, skills]
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
    <div
      className={cn(
        'min-w-0 min-h-0 flex w-full flex-1 flex-col overflow-hidden',
        'relative'
      )}
    >
      <div className="gap-2 px-2 pb-2 min-h-0 min-w-0 flex flex-1 flex-col overflow-x-hidden overflow-y-auto">
        <ProgressSection
          title={t('layout.workforce-progress', { defaultValue: 'Progress' })}
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
  );
}
