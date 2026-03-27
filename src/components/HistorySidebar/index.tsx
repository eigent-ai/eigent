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

import { proxyFetchDelete } from '@/api/http';
import { Sparkle } from '@/components/animate-ui/icons/sparkle';
import { Button } from '@/components/ui/button';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { loadProjectFromHistory } from '@/lib';
import { share } from '@/lib/share';
import { fetchGroupedHistoryTasks } from '@/service/historyApi';
import { getAuthStore } from '@/store/authStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { ChatTaskStatus } from '@/types/constants';
import { HistoryTask, ProjectGroup } from '@/types/history';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Ellipsis,
  Hash,
  Pin,
  Plus,
  Share,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import AlertDialog from '../ui/alertDialog';
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from '../ui/popover';
import { Tag } from '../ui/tag';
import { TooltipSimple } from '../ui/tooltip';
import SearchInput from './SearchInput';

export default function HistorySidebar() {
  const { t } = useTranslation();
  const { isOpen, close } = useSidebarStore();
  const projectSidebarCollapsed = usePageTabStore(
    (s) => s.projectSidebarCollapsed
  );
  const navigate = useNavigate();
  //Get Chatstore for the active project's task
  const { chatStore, projectStore } = useChatStoreAdapter();
  const [searchValue, setSearchValue] = useState('');
  const [_historyOpen, setHistoryOpen] = useState(true);
  const [historyTasks, setHistoryTasks] = useState<ProjectGroup[]>([]);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [anchorStyle, setAnchorStyle] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [currentProjectId, setCurrentProjectId] = useState('');

  useEffect(() => {
    if (!chatStore) return;
    fetchGroupedHistoryTasks(setHistoryTasks);
  }, [chatStore?.updateCount]);

  // Group ongoing tasks by project
  const ongoingProjects = useMemo(() => {
    if (!chatStore) return [];
    const projectMap = new Map<string, any>();

    // Iterate through all projects
    const allProjects = projectStore.getAllProjects();
    allProjects.forEach((project) => {
      // Get all chat stores for this project
      const chatStores = projectStore.getAllChatStores(project.id);

      let hasOngoingTasks = false;
      let totalTokens = 0;
      let taskCount = 0;
      let lastPrompt = '';

      // Check all chat stores for ongoing tasks
      chatStores.forEach(({ chatStore: cs }) => {
        const csState = cs.getState();
        Object.keys(csState.tasks || {}).forEach((taskId) => {
          const task = csState.tasks[taskId];
          // Only include ongoing tasks
          if (task.status !== ChatTaskStatus.FINISHED && !task.type) {
            hasOngoingTasks = true;
            taskCount++;
            if (task.tokens) {
              totalTokens += task.tokens;
            }
            if (!lastPrompt && task.messages?.[0]?.content) {
              lastPrompt = task.messages[0].content;
            }
          }
        });
      });

      // Only add project if it has ongoing tasks
      if (hasOngoingTasks) {
        projectMap.set(project.id, {
          project_id: project.id,
          project_name: project.name,
          tasks: [],
          task_count: taskCount,
          total_tokens: totalTokens,
          last_prompt: lastPrompt,
          isOngoing: true,
        });
      }
    });

    return Array.from(projectMap.values());
  }, [projectStore, chatStore]);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.value) {
      setHistoryOpen(true);
    }
    setSearchValue(e.target.value);
  };

  const createChat = () => {
    close();
    //Create a new project
    //Handles refocusing id & non duplicate logic internally
    projectStore.createProject('new project');
    navigate('/');
  };

  const handleLoadProject = async (
    projectId: string,
    question: string,
    historyId: string
  ) => {
    close();
    const project = historyTasks.find((p) => p.project_id === projectId);
    const taskIdsList = project?.tasks.map(
      (task: HistoryTask) => task.task_id
    ) || [projectId];

    // If no tasks to replay, create an empty project
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

  const handleDelete = (id: string) => {
    console.log('Delete task:', id);
    setCurrentProjectId(id);
    setDeleteModalOpen(true);
  };

  // Deletes whole Project
  const confirmDelete = async () => {
    await deleteWholeProject(currentProjectId);
    setHistoryTasks((list) =>
      list.filter((item) => item.project_id !== currentProjectId)
    );
    setCurrentProjectId('');
    setDeleteModalOpen(false);
  };

  const _deleteHistoryTask = async (
    project: ProjectGroup,
    historyId: string
  ) => {
    try {
      const res = await proxyFetchDelete(`/api/v1/chat/history/${historyId}`);
      console.log(res);
      // also delete local files for this task if available (via Electron IPC)
      const { email } = getAuthStore();
      const history = project.tasks.find(
        (item: HistoryTask) => String(item.id) === historyId
      );
      if (history?.task_id && (window as any).ipcRenderer) {
        try {
          //TODO(file): rename endpoint to use project_id
          //TODO(history): make sure to sync to projectId when updating endpoint
          await (window as any).ipcRenderer.invoke(
            'delete-task-files',
            email,
            history.task_id,
            history.project_id ?? undefined
          );
        } catch (error) {
          console.warn('Local file cleanup failed:', error);
        }
      }
    } catch (error) {
      console.error('Failed to delete history task:', error);
    }
  };

  // Deletes whole project by using the tasks from historyTasks state
  const deleteWholeProject = async (projectId: string) => {
    try {
      // Find the project in our existing data
      const targetProject = historyTasks.find(
        (project) => project.project_id === projectId
      );

      if (targetProject && targetProject.tasks) {
        console.log(
          `Found project ${projectId} with ${targetProject.tasks.length} tasks to delete`
        );

        // Delete each task one by one
        for (const history of targetProject.tasks) {
          console.log(
            `Deleting task: ${history.task_id} (history ID: ${history.id})`
          );
          try {
            const deleteRes = await proxyFetchDelete(
              `/api/v1/chat/history/${history.id}`
            );
            console.log(
              `Successfully deleted task ${history.task_id}:`,
              deleteRes
            );

            // Also delete local files for this task if available (via Electron IPC)
            const { email } = getAuthStore();
            if (history.task_id && (window as any).ipcRenderer) {
              try {
                await (window as any).ipcRenderer.invoke(
                  'delete-task-files',
                  email,
                  history.task_id,
                  history.project_id ?? undefined
                );
                console.log(
                  `Successfully cleaned up local files for task ${history.task_id}`
                );
              } catch (error) {
                console.warn(
                  `Local file cleanup failed for task ${history.task_id}:`,
                  error
                );
              }
            }
          } catch (error) {
            console.error(`Failed to delete task ${history.task_id}:`, error);
          }
        }

        projectStore.removeProject(projectId);
        console.log(`Completed deletion of project ${projectId}`);
      } else {
        console.warn(`Project ${projectId} not found or has no tasks`);
      }
    } catch (error) {
      console.error('Failed to delete whole project:', error);
    }
  };

  const handleShare = async (taskId: string) => {
    close();
    share(taskId);
  };

  const handleSetActive = (
    projectId: string,
    question: string,
    historyId: string
  ) => {
    const project = projectStore.getProjectById(projectId);
    //If project exists
    if (project) {
      // if there is record, show result
      projectStore.setHistoryId(projectId, historyId);
      projectStore.setActiveProject(projectId);
      navigate(`/`);
      close();
    } else {
      // if there is no record, load final state (no replay animation)
      handleLoadProject(projectId, question, historyId);
    }
  };

  useLayoutEffect(() => {
    const PANEL_WIDTH = 360;
    const GAP = 8;
    const MARGIN = 8;

    const updateAnchor = () => {
      const sidebarTitleEl = document.getElementById(
        'sidebar-active-task-title-btn'
      );
      const topBarTitleEl = document.getElementById('active-task-title-btn');

      let anchorEl: HTMLElement | null = null;
      if (!projectSidebarCollapsed && sidebarTitleEl) {
        const r = sidebarTitleEl.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          anchorEl = sidebarTitleEl;
        }
      }
      if (!anchorEl && topBarTitleEl) {
        anchorEl = topBarTitleEl;
      }

      if (anchorEl) {
        const rect = anchorEl.getBoundingClientRect();
        let left = rect.left;
        if (left + PANEL_WIDTH > window.innerWidth - MARGIN) {
          left = window.innerWidth - MARGIN - PANEL_WIDTH;
        }
        if (left < MARGIN) {
          left = MARGIN;
        }
        const top = rect.bottom + GAP;
        setAnchorStyle({ left, top });
      } else {
        setAnchorStyle(null);
      }
    };

    if (isOpen) {
      updateAnchor();
      window.addEventListener('resize', updateAnchor);
    }

    return () => {
      window.removeEventListener('resize', updateAnchor);
    };
  }, [isOpen, projectSidebarCollapsed]);

  if (!chatStore) {
    return <div>Loading...</div>;
  }

  return (
    <AnimatePresence>
      {isOpen && anchorStyle && (
        <>
          {/* alert dialog */}
          <AlertDialog
            isOpen={deleteModalOpen}
            onClose={() => setDeleteModalOpen(false)}
            onConfirm={confirmDelete}
            title={t('layout.delete-task')}
            message={t('layout.are-you-sure-you-want-to-delete')}
            confirmText={t('layout.delete')}
            cancelText={t('layout.cancel')}
          />
          {/* background cover */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="inset-0 fixed z-40 bg-transparent"
            onClick={close}
          />
          {/* History panel below project title (sidebar when expanded, else TopBar) */}
          <motion.div
            initial={false}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -8, opacity: 0 }}
            transition={{ type: 'spring', damping: 22, stiffness: 220 }}
            onMouseLeave={close}
            ref={panelRef}
            className="bg-surface-tertiary rounded-xl p-2 shadow-perfect fixed z-50 flex max-h-[80vh] w-[360px] flex-col overflow-hidden"
            style={{
              left: anchorStyle.left,
              top: anchorStyle.top,
            }}
          >
            <div className="py-2 pl-2 flex items-center justify-between">
              {/* Search */}
              <SearchInput value={searchValue} onChange={handleSearch} />
              <Button variant="ghost" size="md" onClick={createChat}>
                <Plus className="text-icon-tertiary h-8 w-8 group-hover:text-icon-primary transition-all duration-300" />
              </Button>
            </div>
            <div className="scrollbar-hide mt-2 min-h-0 flex-1 overflow-y-auto">
              <div className="gap-3 px-sm flex flex-col">
                {/* Ongoing Projects */}
                {ongoingProjects
                  .filter(
                    (project) =>
                      project.last_prompt
                        ?.toLowerCase()
                        .includes(searchValue.toLowerCase()) ||
                      project.project_name
                        ?.toLowerCase()
                        .includes(searchValue.toLowerCase())
                  )
                  .map((project) => (
                    <div
                      key={project.project_id}
                      onClick={() => {
                        projectStore.setActiveProject(project.project_id);
                        navigate(`/`);
                        close();
                      }}
                      className="gap-sm rounded-xl border-border-disabled bg-project-surface-default px-4 py-3 shadow-history-item hover:bg-project-surface-hover relative flex w-full max-w-full cursor-pointer items-center justify-between border border-solid transition-all duration-300"
                    >
                      <Sparkles
                        size={20}
                        className="text-icon-information flex-shrink-0"
                      />

                      <div className="min-w-0 gap-1 flex flex-1 flex-col">
                        <TooltipSimple
                          align="start"
                          className="bg-surface-tertiary p-2 text-label-xs shadow-perfect pointer-events-auto w-[300px] text-wrap break-words select-text"
                          content={
                            <div>
                              {project.project_name || t('layout.new-project')}
                            </div>
                          }
                        >
                          <span className="text-body-sm font-semibold text-text-heading block overflow-hidden text-ellipsis whitespace-nowrap">
                            {project.project_name || t('layout.new-project')}
                          </span>
                        </TooltipSimple>
                      </div>

                      <div className="gap-2 flex flex-shrink-0 items-center">
                        <TooltipSimple content={t('chat.token')}>
                          <Tag variant="info" size="sm">
                            <Hash className="h-3.5 w-3.5" />
                            <span className="text-xs">
                              {(project.total_tokens || 0).toLocaleString()}
                            </span>
                          </Tag>
                        </TooltipSimple>

                        <TooltipSimple content="Tasks">
                          <Tag variant="default" size="sm">
                            <Pin className="h-3.5 w-3.5" />
                            <span className="text-xs">
                              {project.task_count}
                            </span>
                          </Tag>
                        </TooltipSimple>
                      </div>

                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            size="icon"
                            onClick={(e) => e.stopPropagation()}
                            variant="ghost"
                            className="flex-shrink-0"
                          >
                            <Ellipsis size={16} className="text-text-primary" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="border-dropdown-border bg-dropdown-bg p-sm w-[98px] rounded-[12px] border border-solid">
                          <div className="space-y-1">
                            <PopoverClose asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-full"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleShare(project.project_id);
                                }}
                              >
                                <Share size={16} />
                                {t('layout.share')}
                              </Button>
                            </PopoverClose>

                            <PopoverClose asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-full"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDelete(project.project_id);
                                }}
                              >
                                <Trash2
                                  size={16}
                                  className="text-icon-primary group-hover:text-icon-cuation"
                                />
                                {t('layout.delete')}
                              </Button>
                            </PopoverClose>
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                  ))}

                {/* History Projects */}
                {historyTasks
                  .filter(
                    (project) =>
                      project.last_prompt
                        ?.toLowerCase()
                        .includes(searchValue.toLowerCase()) ||
                      project.project_name
                        ?.toLowerCase()
                        .includes(searchValue.toLowerCase())
                  )
                  .map((project) => (
                    <div
                      onClick={() => {
                        handleSetActive(
                          project.project_id,
                          project.last_prompt,
                          project.project_id
                        );
                      }}
                      key={project.project_id}
                      className="gap-sm rounded-xl border-border-disabled bg-project-surface-default px-4 py-3 shadow-history-item hover:bg-project-surface-hover relative flex w-full max-w-full cursor-pointer items-center justify-between border border-solid transition-all duration-300"
                    >
                      <Sparkle
                        size={20}
                        className="text-icon-secondary flex-shrink-0"
                      />

                      <div className="min-w-0 flex-1">
                        <TooltipSimple
                          align="start"
                          className="bg-surface-tertiary p-2 text-label-xs shadow-perfect pointer-events-auto w-[300px] text-wrap break-words select-text"
                          content={
                            <div>
                              {project.last_prompt ||
                                project.project_name ||
                                t('layout.new-project')}
                            </div>
                          }
                        >
                          <span className="text-body-sm font-semibold text-text-heading block overflow-hidden text-ellipsis whitespace-nowrap">
                            {project.last_prompt ||
                              project.project_name ||
                              t('layout.new-project')}
                          </span>
                        </TooltipSimple>
                      </div>

                      <div className="gap-2 flex flex-shrink-0 items-center">
                        <TooltipSimple content={t('chat.token')}>
                          <Tag variant="info" size="sm">
                            <Hash className="h-3.5 w-3.5" />
                            <span className="text-xs">
                              {(project.total_tokens || 0).toLocaleString()}
                            </span>
                          </Tag>
                        </TooltipSimple>

                        <TooltipSimple content="Tasks">
                          <Tag variant="default" size="sm">
                            <Pin className="h-3.5 w-3.5" />
                            <span className="text-xs">
                              {project.task_count}
                            </span>
                          </Tag>
                        </TooltipSimple>
                      </div>

                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            size="icon"
                            onClick={(e) => e.stopPropagation()}
                            variant="ghost"
                            className="flex-shrink-0"
                          >
                            <Ellipsis size={16} className="text-text-primary" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="border-dropdown-border bg-dropdown-bg p-sm w-[98px] rounded-[12px] border border-solid">
                          <div className="space-y-1">
                            <PopoverClose asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-full"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleShare(project.project_id);
                                }}
                              >
                                <Share size={16} />
                                {t('layout.share')}
                              </Button>
                            </PopoverClose>

                            <PopoverClose asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-full"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDelete(project.project_id);
                                }}
                              >
                                <Trash2
                                  size={16}
                                  className="text-icon-primary group-hover:text-icon-cuation"
                                />
                                {t('layout.delete')}
                              </Button>
                            </PopoverClose>
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                  ))}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
