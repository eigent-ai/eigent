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
import tokenDarkIcon from '@/assets/token-dark.svg';
import tokenLightIcon from '@/assets/token-light.svg';
import { formatTokenCount } from '@/components/ChatBox/MessageItem/TokenUtils';
import { Button } from '@/components/ui/button';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useHost } from '@/host';
import { loadProjectFromHistory } from '@/lib';
import { share } from '@/lib/share';
import { fetchGroupedHistoryTasks } from '@/service/historyApi';
import { getAuthStore, useAuthStore } from '@/store/authStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { ChatTaskStatus } from '@/types/constants';
import { HistoryTask, ProjectGroup } from '@/types/history';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Ellipsis,
  FolderCheck,
  FolderClock,
  ListChecks,
  Plus,
  Share,
  Trash2,
  Zap,
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

const compactCountFormatter = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
});

const formatCompactCount = (value?: number) =>
  compactCountFormatter.format(value || 0);

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const resolveProjectTokenCount = (
  project: Pick<ProjectGroup, 'total_tokens' | 'tasks'>
): number => {
  const direct = toFiniteNumber(project.total_tokens as unknown);
  if (direct !== null) {
    return direct;
  }

  return (project.tasks || []).reduce(
    (sum, task) =>
      sum + (toFiniteNumber((task as { tokens?: unknown }).tokens) ?? 0),
    0
  );
};

export default function HistorySidebar() {
  const { t } = useTranslation();
  const host = useHost();
  const ipcRenderer = host?.ipcRenderer;
  const { appearance } = useAuthStore();
  const tokenIcon = appearance === 'dark' ? tokenDarkIcon : tokenLightIcon;
  const { isOpen, close } = useSidebarStore();
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
  }, [chatStore, chatStore?.updateCount]);

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
          total_triggers:
            historyTasks.find((item) => item.project_id === project.id)
              ?.total_triggers || 0,
          last_prompt: lastPrompt,
          isOngoing: true,
        });
      }
    });

    return Array.from(projectMap.values());
  }, [projectStore, chatStore, historyTasks]);

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
      if (history?.task_id && ipcRenderer) {
        try {
          //TODO(file): rename endpoint to use project_id
          //TODO(history): make sure to sync to projectId when updating endpoint
          await ipcRenderer.invoke(
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
            if (history.task_id && ipcRenderer) {
              try {
                await ipcRenderer.invoke(
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
      if (sidebarTitleEl) {
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
  }, [isOpen]);

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
            className="fixed inset-0 z-40 bg-transparent"
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
            className="fixed z-50 flex max-h-[80vh] w-[360px] flex-col overflow-hidden rounded-xl bg-ds-bg-neutral-subtle-default p-2 shadow-perfect"
            style={{
              left: anchorStyle.left,
              top: anchorStyle.top,
            }}
          >
            <div className="flex items-center justify-between py-2 pl-2">
              {/* Search */}
              <SearchInput value={searchValue} onChange={handleSearch} />
              <Button variant="ghost" size="md" onClick={createChat}>
                <Plus className="h-8 w-8 text-ds-icon-neutral-muted-default transition-all duration-300 group-hover:text-ds-icon-neutral-default-default" />
              </Button>
            </div>
            <div className="scrollbar-hide mt-2 min-h-0 flex-1 overflow-y-auto">
              <div className="flex flex-col gap-3 px-sm">
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
                      className="relative flex w-full max-w-full cursor-pointer items-center justify-between gap-sm rounded-xl border border-solid border-ds-border-neutral-subtle-default bg-ds-bg-neutral-default-default px-4 py-3 shadow-history-item transition-all duration-300 hover:bg-ds-bg-neutral-default-hover"
                    >
                      <FolderClock className="h-5 w-5 flex-shrink-0 text-ds-icon-status-running-default-default" />

                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <TooltipSimple
                          align="start"
                          className="pointer-events-auto w-[300px] select-text text-wrap break-words bg-ds-bg-neutral-default-default p-2 text-label-xs shadow-perfect"
                          content={
                            <div>
                              {project.project_name || t('layout.new-project')}
                            </div>
                          }
                        >
                          <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-body-sm font-semibold text-ds-text-neutral-default-default">
                            {project.project_name || t('layout.new-project')}
                          </span>
                        </TooltipSimple>
                      </div>

                      <div className="flex flex-shrink-0 items-center gap-2">
                        <TooltipSimple content={t('chat.token')}>
                          <Tag
                            variant="primary"
                            tone="information"
                            emphasis="default"
                            size="xs"
                            className="gap-1.5"
                          >
                            <img src={tokenIcon} alt="" className="h-3 w-3" />
                            <span className="text-label-xs">
                              {formatTokenCount(
                                resolveProjectTokenCount(project)
                              )}
                            </span>
                          </Tag>
                        </TooltipSimple>

                        <TooltipSimple content={t('layout.tasks')}>
                          <Tag
                            variant="primary"
                            tone="default"
                            emphasis="default"
                            size="xs"
                            className="gap-1.5"
                          >
                            <ListChecks className="h-3 w-3" />
                            <span className="text-label-xs">
                              {formatCompactCount(project.task_count)}
                            </span>
                          </Tag>
                        </TooltipSimple>

                        <TooltipSimple content="Triggers">
                          <Tag
                            variant="primary"
                            tone="warning"
                            emphasis="default"
                            size="xs"
                            className="gap-1.5"
                          >
                            <Zap className="h-3 w-3" />
                            <span className="text-label-xs">
                              {formatCompactCount(project.total_triggers)}
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
                            <Ellipsis
                              size={16}
                              className="text-ds-text-neutral-default-default"
                            />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[98px] rounded-[12px] border border-solid border-ds-border-neutral-default-default bg-ds-bg-neutral-default-default p-sm">
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
                                  className="text-ds-icon-neutral-default-default group-hover:text-ds-icon-status-error-default-default"
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
                      className="relative flex w-full max-w-full cursor-pointer items-center justify-between gap-sm rounded-xl border border-solid border-ds-border-neutral-subtle-default bg-ds-bg-neutral-default-default px-4 py-3 shadow-history-item transition-all duration-300 hover:bg-ds-bg-neutral-default-hover"
                    >
                      <FolderCheck className="h-5 w-5 flex-shrink-0 text-ds-icon-neutral-subtle-default" />

                      <div className="min-w-0 flex-1">
                        <TooltipSimple
                          align="start"
                          className="pointer-events-auto w-[300px] select-text text-wrap break-words bg-ds-bg-neutral-default-default p-2 text-label-xs shadow-perfect"
                          content={
                            <div>
                              {project.last_prompt ||
                                project.project_name ||
                                t('layout.new-project')}
                            </div>
                          }
                        >
                          <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-body-sm font-semibold text-ds-text-neutral-default-default">
                            {project.last_prompt ||
                              project.project_name ||
                              t('layout.new-project')}
                          </span>
                        </TooltipSimple>
                      </div>

                      <div className="flex flex-shrink-0 items-center gap-2">
                        <TooltipSimple content={t('chat.token')}>
                          <Tag
                            variant="primary"
                            tone="information"
                            emphasis="default"
                            size="xs"
                            className="gap-1.5"
                          >
                            <img src={tokenIcon} alt="" className="h-3 w-3" />
                            <span className="text-label-xs">
                              {formatTokenCount(
                                resolveProjectTokenCount(project)
                              )}
                            </span>
                          </Tag>
                        </TooltipSimple>

                        <TooltipSimple content={t('layout.tasks')}>
                          <Tag
                            variant="primary"
                            tone="default"
                            emphasis="default"
                            size="xs"
                            className="gap-1.5"
                          >
                            <ListChecks className="h-3 w-3" />
                            <span className="text-label-xs">
                              {formatCompactCount(project.task_count)}
                            </span>
                          </Tag>
                        </TooltipSimple>

                        <TooltipSimple content="Triggers">
                          <Tag
                            variant="primary"
                            tone="warning"
                            emphasis="default"
                            size="xs"
                            className="gap-1.5"
                          >
                            <Zap className="h-3 w-3" />
                            <span className="text-label-xs">
                              {formatCompactCount(project.total_triggers)}
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
                            <Ellipsis
                              size={16}
                              className="text-ds-text-neutral-default-default"
                            />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[98px] rounded-[12px] border border-solid border-ds-border-neutral-default-default bg-ds-bg-neutral-default-default p-sm">
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
                                  className="text-ds-icon-neutral-default-default group-hover:text-ds-icon-status-error-default-default"
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
