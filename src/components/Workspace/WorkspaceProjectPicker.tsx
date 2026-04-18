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
import { fetchGroupedHistoryTasks } from '@/service/historyApi';
import { usePageTabStore } from '@/store/pageTabStore';
import type { ProjectGroup } from '@/types/history';
import {
  ChevronDown,
  FolderKanban,
  FolderOpen,
  PlusCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

/**
 * Project / task switcher for the workspace landing: opens the agent folder
 * tab, or picks a history project from a nested submenu (same data path as
 * HistorySidebar).
 */
export function WorkspaceProjectPicker() {
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

  const activeTaskTitle = useMemo(() => {
    const defaultLabel = t('layout.workspace-work-in-project', {
      defaultValue: 'Work in a project',
    });
    if (!chatStore) return defaultLabel;
    if (chatStore.activeTaskId && summaryTask) {
      return summaryTask.split('|')[0];
    }
    return defaultLabel;
  }, [chatStore, summaryTask, t]);

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

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          id="workspace-project-picker-trigger"
          type="button"
          variant="outline"
          className="no-drag min-h-10 gap-2 rounded-xl border-ds-border-neutral-default-default bg-ds-bg-neutral-subtle-default px-3 py-2 font-semibold shadow-sm hover:bg-ds-bg-neutral-default-default/80 inline-flex h-auto w-fit max-w-[300px] justify-between text-left"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          <span className="text-ds-text-neutral-default-default min-w-0 text-label-sm truncate">
            {activeTaskTitle}
          </span>
          <ChevronDown
            className="text-ds-icon-neutral-muted-default h-4 w-4 shrink-0 opacity-80"
            aria-hidden
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-[min(100vw-2rem,200px)]"
        align="start"
        sideOffset={6}
      >
        <DropdownMenuItem
          className="gap-2 cursor-pointer"
          onSelect={(e) => {
            e.preventDefault();
            handleStartFromScratch();
          }}
        >
          <PlusCircle className="h-4 w-4 shrink-0" aria-hidden />
          {t('layout.workspace-start-from-scratch', {
            defaultValue: 'Start from scratch',
          })}
        </DropdownMenuItem>

        <DropdownMenuItem
          className="gap-2 cursor-pointer"
          onSelect={(e) => {
            e.preventDefault();
            openAgentFolderTab();
          }}
        >
          <FolderOpen className="h-4 w-4 shrink-0" aria-hidden />
          {t('layout.workspace-select-folder', {
            defaultValue: 'Select a folder',
          })}
        </DropdownMenuItem>

        <DropdownMenuSeparator className="bg-ds-border-neutral-default-default" />

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2">
            <FolderKanban className="h-4 w-4 shrink-0" aria-hidden />
            {t('layout.workspace-project-submenu', {
              defaultValue: 'Project',
            })}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            className="max-h-64 p-1 w-[min(100vw-2rem,280px)] overflow-y-auto"
            sideOffset={6}
            alignOffset={-4}
          >
            {historyTasks.length === 0 ? (
              <div className="text-ds-text-neutral-muted-default px-2 py-3 text-body-sm text-center">
                {t('layout.workspace-no-history-projects', {
                  defaultValue: 'No history projects yet',
                })}
              </div>
            ) : (
              historyTasks.map((project) => (
                <DropdownMenuItem
                  key={project.project_id}
                  className="min-h-9 gap-0.5 py-2 cursor-pointer flex-col items-start"
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
