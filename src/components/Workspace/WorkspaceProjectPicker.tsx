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

import { fetchGet, fetchPost } from '@/api/http';
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
import { createHost } from '@/host/createHost';
import { generateUniqueId, loadProjectFromHistory } from '@/lib';
import { fetchGroupedHistoryTasks } from '@/service/historyApi';
import { useAuthStore } from '@/store/authStore';
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
import { toast } from 'sonner';

type WorkspaceCapabilities = {
  binding_enabled?: boolean;
  binding_persistence?: string;
  deployment?: string;
  label?: string;
};

type WorkspaceCurrent = {
  bound?: boolean;
  workspace_root?: string;
};

function getFolderNameFromPath(path?: string): string {
  if (!path) return '';
  const normalized = path.replace(/[\\/]+$/, '');
  return normalized.split(/[\\/]/).filter(Boolean).pop() || normalized;
}

function isDesktopShell(electronAPI: any, ipcRenderer: any): boolean {
  return (
    electronAPI?.isDesktopShell === true &&
    typeof ipcRenderer?.invoke === 'function'
  );
}

function workspaceBindErrorMessage(
  error: any,
  t: ReturnType<typeof useTranslation>['t']
): string {
  const status = error?.response?.status;
  const detail = error?.response?.data?.detail;
  const code = typeof detail === 'object' ? detail?.code : undefined;
  const reason =
    typeof detail === 'object'
      ? detail?.reason || detail?.message || detail?.code
      : typeof detail === 'string'
        ? detail
        : error?.message;

  switch (status) {
    case 400:
      return t('layout.workspace-folder-invalid-path', {
        defaultValue: 'The selected path is not a valid folder.',
      });
    case 403:
      return t('layout.workspace-folder-denied', {
        defaultValue: `This folder cannot be used as a workspace${reason ? `: ${reason}` : '.'}`,
      });
    case 409:
      if (code === 'workspace_already_bound') {
        return t('layout.workspace-folder-already-bound', {
          defaultValue:
            'This project already has a workspace folder. Start from scratch to select another folder.',
        });
      }
      return t('layout.workspace-folder-active-task', {
        defaultValue:
          'Please wait for the current task to finish before changing the workspace folder.',
      });
    case 412:
      return t('layout.workspace-folder-cloud-disabled', {
        defaultValue: 'Folder selection is only available for Local Brain.',
      });
    default:
      return (
        reason ||
        t('layout.workspace-folder-select-failed', {
          defaultValue: 'Failed to select workspace folder.',
        })
      );
  }
}

/**
 * Project / task switcher for the workspace landing: opens the agent folder
 * tab, or picks a history project from a nested submenu (same data path as
 * HistorySidebar).
 */
export function WorkspaceProjectPicker() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { chatStore, projectStore } = useChatStoreAdapter();
  const userEmail = useAuthStore((s) => s.email);
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);
  const host = useMemo(() => createHost(), []);
  const electronAPI = host.electronAPI;
  const ipcRenderer = host.ipcRenderer;

  const [historyTasks, setHistoryTasks] = useState<ProjectGroup[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [workspaceCapabilities, setWorkspaceCapabilities] =
    useState<WorkspaceCapabilities | null>(null);
  const [currentWorkspace, setCurrentWorkspace] =
    useState<WorkspaceCurrent | null>(null);
  const [folderBindingBusy, setFolderBindingBusy] = useState(false);

  useEffect(() => {
    if (!chatStore) return;
    fetchGroupedHistoryTasks(setHistoryTasks);
  }, [chatStore, chatStore?.updateCount]);

  useEffect(() => {
    let cancelled = false;
    fetchGet('/workspace/capabilities')
      .then((capabilities) => {
        if (!cancelled) {
          setWorkspaceCapabilities(capabilities);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWorkspaceCapabilities(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!projectStore.activeProjectId || !userEmail) {
      setCurrentWorkspace(null);
      return;
    }
    let cancelled = false;
    fetchGet('/workspace/current', {
      project_id: projectStore.activeProjectId,
      email: userEmail,
    })
      .then((workspace) => {
        if (!cancelled) {
          setCurrentWorkspace(workspace);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCurrentWorkspace(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectStore.activeProjectId, userEmail]);

  const summaryTask =
    chatStore?.tasks[chatStore?.activeTaskId as string]?.summaryTask;
  const hasBoundWorkspace = Boolean(currentWorkspace?.bound);
  const boundFolderName = getFolderNameFromPath(
    currentWorkspace?.workspace_root
  );

  const activeTaskTitle = useMemo(() => {
    const defaultLabel = t('layout.workspace-select-project', {
      defaultValue: 'Select a project',
    });
    if (hasBoundWorkspace && boundFolderName) {
      return boundFolderName;
    }
    if (!chatStore) return defaultLabel;
    if (chatStore.activeTaskId && summaryTask) {
      return summaryTask.split('|')[0];
    }
    return defaultLabel;
  }, [boundFolderName, chatStore, hasBoundWorkspace, summaryTask, t]);

  const handleLoadProject = async (
    projectId: string,
    question: string,
    historyId: string
  ) => {
    setCurrentWorkspace(null);
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
      setActiveWorkspaceTab('session');
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
    setActiveWorkspaceTab('session');
  };

  const handleSetActive = (
    projectId: string,
    question: string,
    historyId: string
  ) => {
    const project = projectStore.getProjectById(projectId);
    if (project) {
      setCurrentWorkspace(null);
      projectStore.setHistoryId(projectId, historyId);
      projectStore.setActiveProject(projectId);
      navigate(`/`);
      setActiveWorkspaceTab('session');
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
    projectStore.createProject('new project', undefined, generateUniqueId());
    setCurrentWorkspace(null);
    setActiveWorkspaceTab('session');
    navigate('/');
    setMenuOpen(false);
  };

  const canSelectFolder =
    Boolean(workspaceCapabilities?.binding_enabled) &&
    isDesktopShell(electronAPI, ipcRenderer) &&
    typeof electronAPI?.selectFolder === 'function';

  const openWorkspaceContext = (projectId?: string | null) => {
    setActiveWorkspaceTab('inbox', {
      clearInboxForProjectId: projectId ?? undefined,
    });
    setMenuOpen(false);
  };

  const handleSelectFolder = async () => {
    if (hasBoundWorkspace) {
      openWorkspaceContext(projectStore.activeProjectId);
      return;
    }
    if (!canSelectFolder) {
      toast.error(
        t('layout.workspace-select-folder-desktop-only', {
          defaultValue: 'Folder selection is available in Desktop mode only.',
        })
      );
      return;
    }
    if (!userEmail) {
      toast.error(
        t('layout.workspace-select-folder-login-required', {
          defaultValue: 'Please sign in before selecting a folder.',
        })
      );
      return;
    }

    setFolderBindingBusy(true);
    try {
      const result = await electronAPI.selectFolder({
        title: t('layout.workspace-select-folder', {
          defaultValue: 'Select a folder',
        }),
      });
      if (!result?.success || !result.folderPath) {
        return;
      }

      const projectId =
        projectStore.activeProjectId ??
        projectStore.createProject(result.folderName || 'new project');
      await fetchPost('/workspace/bind', {
        project_id: projectId,
        email: userEmail,
        path: result.folderPath,
      });
      setCurrentWorkspace({
        bound: true,
        workspace_root: result.folderPath,
      });
      navigate('/');
      openWorkspaceContext(projectId);
      toast.success(
        t('layout.workspace-folder-selected', {
          defaultValue: 'Workspace folder selected.',
        })
      );
      setMenuOpen(false);
    } catch (error: any) {
      toast.error(workspaceBindErrorMessage(error, t));
    } finally {
      setFolderBindingBusy(false);
    }
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
          variant="ghost"
          size="md"
          buttonContent="text"
          buttonRadius="full"
          className="no-drag inline-flex h-auto w-fit min-w-[180px] max-w-[300px] justify-between bg-ds-bg-neutral-subtle-default px-3 py-1 font-semibold shadow-workspace-project-picker hover:bg-ds-bg-neutral-default-hover"
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
          {t('layout.workspace-start-from-scratch', {
            defaultValue: 'Start from scratch',
          })}
        </DropdownMenuItem>

        <DropdownMenuItem
          className="cursor-pointer gap-2"
          disabled={
            folderBindingBusy || (!hasBoundWorkspace && !canSelectFolder)
          }
          onSelect={(e) => {
            e.preventDefault();
            void handleSelectFolder();
          }}
          title={
            hasBoundWorkspace
              ? currentWorkspace?.workspace_root
              : t('layout.workspace-select-folder', {
                  defaultValue: 'Select a folder',
                })
          }
        >
          <FolderOpen className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">
            {hasBoundWorkspace
              ? boundFolderName ||
                t('layout.workspace-bound-folder', {
                  defaultValue: 'Selected folder',
                })
              : t('layout.workspace-select-folder', {
                  defaultValue: 'Select a folder',
                })}
          </span>
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
            className="max-h-64 w-[min(100vw-2rem,280px)] overflow-y-auto p-1"
            sideOffset={6}
            alignOffset={-4}
          >
            {historyTasks.length === 0 ? (
              <div className="px-2 py-3 text-center text-body-sm text-ds-text-neutral-muted-default">
                {t('layout.workspace-no-history-projects', {
                  defaultValue: 'No history projects yet',
                })}
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
