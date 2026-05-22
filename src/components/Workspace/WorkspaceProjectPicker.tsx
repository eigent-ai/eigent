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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { loadProjectFromHistory } from '@/lib';
import { cn } from '@/lib/utils';
import { fetchGroupedHistoryTasks } from '@/service/historyApi';
import { usePageTabStore } from '@/store/pageTabStore';
import type { ProjectGroup } from '@/types/history';
import {
  ChevronDown,
  FolderIcon,
  FolderKanban,
  FolderOpen,
  PlusCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

/** Shared chrome so read-only and dropdown trigger stay the same height (Button md = 32px). */
const PROJECT_PICKER_SHELL_CLASS =
  'bg-ds-bg-neutral-subtle-default shadow-workspace-project-picker box-border inline-flex h-8 min-h-8 w-fit min-w-[180px] max-w-[300px] items-center gap-2 rounded-full px-3 py-0 font-semibold';

export interface WorkspaceProjectPickerProps {
  /** Display-only: render the current project name without the dropdown. */
  readOnly?: boolean;
}

/**
 * Project / task switcher for the workspace landing: opens the agent folder
 * tab, or picks a history project from a nested submenu (same data path as
 * HistorySidebar). When `readOnly`, renders the project name only.
 */
export function WorkspaceProjectPicker({
  readOnly = false,
}: WorkspaceProjectPickerProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { chatStore, projectStore } = useChatStoreAdapter();
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);

  const [historyTasks, setHistoryTasks] = useState<ProjectGroup[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!chatStore) return;
    fetchGroupedHistoryTasks(setHistoryTasks);
  }, [chatStore, chatStore?.updateCount]);

  const summaryTask =
    chatStore?.tasks[chatStore?.activeTaskId as string]?.summaryTask;
  const activeProjectId = projectStore.activeProjectId;
  const activeProjectName = activeProjectId
    ? projectStore.getProjectById(activeProjectId)?.name
    : undefined;

  const activeTaskTitle = useMemo(() => {
    const defaultLabel = t('layout.workspace-select-project');
    if (activeProjectName && activeProjectName !== 'new project') {
      return activeProjectName;
    }
    if (!chatStore) return defaultLabel;
    if (chatStore.activeTaskId && summaryTask) {
      return summaryTask.split('|')[0];
    }
    return defaultLabel;
  }, [activeProjectName, chatStore, summaryTask, t]);

  const handleLoadProject = async (
    projectId: string,
    question: string,
    historyId: string
  ) => {
    setMenuOpen(false);
    const project = historyTasks.find((p) => p.project_id === projectId);
    const taskIdsList = project?.tasks.map((task) => task.task_id) || [
      projectId,
    ];

    if (!taskIdsList || taskIdsList.length === 0) {
      projectStore.createProject(
        project?.project_name || 'Project',
        'Project with triggers but no tasks',
        projectId
      );
      navigate('/');
      return;
    }

    await loadProjectFromHistory(
      projectStore,
      navigate,
      projectId,
      question,
      historyId,
      taskIdsList,
      project?.project_name
    );
  };

  const handleSetActive = (
    projectId: string,
    question: string,
    historyId: string
  ) => {
    const project = projectStore.getProjectById(projectId);
    if (project) {
      projectStore.setHistoryId(projectId, historyId);
      projectStore.setActiveProject(projectId);
      navigate(`/`);
      setMenuOpen(false);
    } else {
      void handleLoadProject(projectId, question, historyId);
    }
  };

  const onSelectHistoryProject = (project: ProjectGroup) => {
    const historyId =
      project.tasks[0] != null ? String(project.tasks[0].id) : '';
    const question = project.last_prompt || project.project_name || '';
    if (!historyId) {
      void handleLoadProject(project.project_id, question, project.project_id);
      return;
    }
    handleSetActive(project.project_id, question, historyId);
  };

  const handleStartFromScratch = () => {
    projectStore.createProject('new project');
    navigate('/');
    setMenuOpen(false);
  };

  const openAgentFolderTab = () => {
    const pid = projectStore.activeProjectId;
    setActiveWorkspaceTab('inbox', {
      clearInboxForProjectId: pid ?? undefined,
    });
    setMenuOpen(false);
  };

  if (!chatStore) {
    return null;
  }

  if (readOnly) {
    const projectName =
      projectStore.getProjectById(projectStore.activeProjectId ?? '')?.name ||
      activeTaskTitle;
    return (
      <div
        className={cn(PROJECT_PICKER_SHELL_CLASS, 'justify-center')}
        aria-label={projectName}
      >
        <FolderIcon className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 truncate text-label-sm text-ds-text-neutral-default-default">
          {projectName}
        </span>
      </div>
    );
  }

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          id="workspace-project-picker-trigger"
          type="button"
          variant="ghost"
          size="md"
          buttonContent="text"
          buttonRadius="full"
          className={cn(
            PROJECT_PICKER_SHELL_CLASS,
            'no-drag justify-between hover:bg-ds-bg-neutral-default-hover'
          )}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          <FolderIcon className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 truncate text-label-sm text-ds-text-neutral-default-default">
            {activeTaskTitle}
          </span>
          <ChevronDown className="shrink-0 opacity-80" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-[min(100vw-2rem,180px)]"
        align="end"
        sideOffset={6}
      >
        <DropdownMenuItem
          className="cursor-pointer gap-2"
          onSelect={(e) => {
            e.preventDefault();
            handleStartFromScratch();
          }}
        >
          <PlusCircle className="h-4 w-4 shrink-0" aria-hidden />
          {t('layout.workspace-start-from-scratch')}
        </DropdownMenuItem>

        <DropdownMenuItem
          className="cursor-pointer gap-2"
          onSelect={(e) => {
            e.preventDefault();
            openAgentFolderTab();
          }}
        >
          <FolderOpen className="h-4 w-4 shrink-0" aria-hidden />
          {t('layout.workspace-select-folder')}
        </DropdownMenuItem>

        <DropdownMenuSeparator className="bg-ds-border-neutral-default-default" />

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2">
            <FolderKanban className="h-4 w-4 shrink-0" aria-hidden />
            {t('layout.workspace-project-submenu')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            className="max-h-64 w-[min(100vw-2rem,280px)] overflow-y-auto p-1"
            sideOffset={6}
            alignOffset={-4}
          >
            {historyTasks.length === 0 ? (
              <div className="px-2 py-3 text-center text-body-sm text-ds-text-neutral-muted-default">
                {t('layout.workspace-no-history-projects')}
              </div>
            ) : (
              historyTasks.map((project) => (
                <DropdownMenuItem
                  key={project.project_id}
                  className="min-h-9 cursor-pointer flex-col items-start gap-0.5 py-2"
                  onSelect={(e) => {
                    e.preventDefault();
                    onSelectHistoryProject(project);
                  }}
                >
                  <span className="text-body-sm font-medium leading-tight text-ds-text-neutral-default-default">
                    {project.project_name || t('layout.new-project')}
                  </span>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
