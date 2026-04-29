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

import { proxyFetchDelete, proxyFetchPut } from '@/api/http';
import { useHost } from '@/host';
import { getAuthStore } from '@/store/authStore';
import { useProjectStore } from '@/store/projectStore';
import { ProjectGroup as ProjectGroupType } from '@/types/history';
import { AnimatePresence, motion } from 'framer-motion';
import { FolderOpen } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { DashboardViewMode } from '../useDashboardData';
import ProjectGroup from './ProjectGroup';

interface GroupedHistoryViewProps {
  projects: ProjectGroupType[];
  isLoading?: boolean;
  updateProjects: (
    updater: (prev: ProjectGroupType[]) => ProjectGroupType[]
  ) => void;
  invalidate: () => void;
  viewMode: DashboardViewMode;
  searchValue?: string;
  onTaskSelect: (
    projectId: string,
    question: string,
    historyId: string,
    project?: ProjectGroupType
  ) => void;
  onTaskDelete: (historyId: string, callback: () => void) => void;
  onTaskShare: (taskId: string) => void;
  activeTaskId?: string;
  refreshTrigger?: number; // For triggering refresh from parent
  ongoingTasks?: { [taskId: string]: any }; // Add ongoing tasks from chatStore
  onOngoingTaskClick?: (taskId: string) => void; // Callback for clicking ongoing tasks
  onOngoingTaskPause?: (taskId: string) => void; // Callback for pausing ongoing tasks
  onOngoingTaskResume?: (taskId: string) => void; // Callback for resuming ongoing tasks
  onOngoingTaskDelete?: (taskId: string) => void; // Callback for deleting ongoing tasks
  onProjectEdit?: (projectId: string) => void; // Callback for editing a project
  onProjectDelete?: (projectId: string, callback: () => Promise<void>) => void; // Callback for deleting a project with async callback
}

export default function GroupedHistoryView({
  projects,
  isLoading = false,
  updateProjects: setProjects,
  invalidate,
  viewMode,
  searchValue = '',
  onTaskSelect,
  onTaskDelete,
  onTaskShare,
  activeTaskId,
  refreshTrigger,
  ongoingTasks: _ongoingTasks = {},
  onOngoingTaskClick: _onOngoingTaskClick,
  onOngoingTaskPause,
  onOngoingTaskResume,
  onOngoingTaskDelete: _onOngoingTaskDelete,
  onProjectEdit,
  onProjectDelete,
}: GroupedHistoryViewProps) {
  const { t } = useTranslation();
  const host = useHost();
  const ipcRenderer = host?.ipcRenderer;
  const projectStore = useProjectStore();
  const projectViewType = viewMode === 'board' ? 'grid' : 'list';

  const onDelete = (historyId: string) => {
    try {
      onTaskDelete(historyId, () => {
        setProjects((prevProjects) => {
          // Create new project objects instead of mutating existing ones
          return prevProjects
            .map((project) => {
              const filteredTasks = project.tasks.filter(
                (task) => String(task.id) !== historyId
              );
              return {
                ...project,
                tasks: filteredTasks,
                task_count: filteredTasks.length,
                total_tokens: filteredTasks.reduce(
                  (sum, task) => sum + (task.tokens || 0),
                  0
                ),
              };
            })
            .filter((project) => project.tasks.length > 0);
        });
      });
    } catch (error) {
      console.error('Failed to delete task:', error);
    }
  };

  const handleProjectEdit = (projectId: string) => {
    if (onProjectEdit) {
      onProjectEdit(projectId);
    } else {
      console.log('Edit project:', projectId);
      // TODO: Implement project edit functionality
    }
  };

  const handleProjectDelete = (projectId: string) => {
    // Create the deletion callback that will be executed after confirmation
    const deleteCallback = async () => {
      try {
        // Find the project in our existing data
        const targetProject = projects.find(
          (project) => project.project_id === projectId
        );

        if (
          targetProject &&
          targetProject.tasks &&
          targetProject.tasks.length > 0
        ) {
          console.log(
            `Deleting project ${projectId} with ${targetProject.tasks.length} tasks`
          );

          // Delete each task one by one
          for (const history of targetProject.tasks) {
            try {
              await proxyFetchDelete(`/api/v1/chat/history/${history.id}`);
              console.log(`Successfully deleted task ${history.task_id}`);

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

          // Remove from projectStore
          projectStore.removeProject(projectId);

          // Update local state to remove the project
          setProjects((prevProjects) =>
            prevProjects.filter((project) => project.project_id !== projectId)
          );

          console.log(`Completed deletion of project ${projectId}`);
        } else if (targetProject) {
          // Project exists but has no tasks, just remove from store
          console.log(
            `Project ${projectId} has no tasks, removing from store only`
          );
          projectStore.removeProject(projectId);
          setProjects((prevProjects) =>
            prevProjects.filter((project) => project.project_id !== projectId)
          );
        } else {
          console.warn(`Project ${projectId} not found`);
        }
      } catch (error) {
        console.error('Failed to delete project:', error);
        throw error; // Re-throw to let parent handle errors
      }
    };

    // Call parent callback with the deletion callback (for confirmation dialog)
    if (onProjectDelete) {
      onProjectDelete(projectId, deleteCallback);
    } else {
      // If no parent callback, execute deletion directly
      deleteCallback();
    }
  };

  const handleProjectRename = async (projectId: string, newName: string) => {
    setProjects((prevProjects) => {
      return prevProjects.map((project) => {
        if (project.project_id === projectId) {
          return {
            ...project,
            project_name: newName,
          };
        }
        return project;
      });
    });

    // Call API to update project name
    try {
      const response = await proxyFetchPut(
        `/api/v1/chat/project/${projectId}/name?new_name=${encodeURIComponent(newName)}`
      );

      if (response && response.code !== undefined && response.code !== 0) {
        console.error(`Failed to update project name: ${response.code}`);
        // Optionally: revert the local change if API call fails
      } else {
        console.log(
          `Successfully updated project ${projectId} name to ${newName}`
        );
      }
    } catch (error) {
      console.error(`Error updating project name:`, error);
      // Optionally: revert the local change if API call fails
    }
  };

  useEffect(() => {
    if (refreshTrigger !== undefined) invalidate();
  }, [invalidate, refreshTrigger]);

  // Filter projects based on search value
  const filteredProjects = projects.filter((project) => {
    if (!searchValue) return true;

    // Check if project name matches
    if (
      project.project_name?.toLowerCase().includes(searchValue.toLowerCase())
    ) {
      return true;
    }

    // Check if any task in the project matches
    return project.tasks.some((task) =>
      task.question?.toLowerCase().includes(searchValue.toLowerCase())
    );
  });

  const allProjects = filteredProjects;

  // Shimmer animation styles
  // Shimmer animation styles
  const shimmerStyle = {
    background:
      'linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--ds-text-neutral-subtle-default) 40%, transparent) 50%, transparent 100%)',
    backgroundSize: '200% 100%',
    animation: 'shimmer 1.5s infinite',
  };

  // Skeleton component for list card loading state
  const ListCardSkeleton = () => (
    <div className="rounded-xl bg-ds-bg-neutral-default-default overflow-hidden">
      <div className="px-6 py-4 flex w-full items-center justify-between">
        {/* Start: Folder icon and project name skeleton */}
        <div className="w-48 gap-3 flex flex-shrink-0 items-center">
          <div className="h-5 w-5 rounded bg-ds-bg-neutral-subtle-default relative flex-shrink-0 overflow-hidden">
            <div className="inset-0 absolute" style={shimmerStyle} />
          </div>
          <div className="h-5 w-32 rounded bg-ds-bg-neutral-subtle-default relative overflow-hidden">
            <div className="inset-0 absolute" style={shimmerStyle} />
          </div>
        </div>

        {/* Middle: Tags skeleton */}
        <div className="gap-4 flex flex-1 items-center justify-end">
          <div className="h-6 w-16 bg-ds-bg-neutral-subtle-default relative overflow-hidden rounded-full">
            <div className="inset-0 absolute" style={shimmerStyle} />
          </div>
          <div className="h-6 w-12 bg-ds-bg-neutral-subtle-default relative overflow-hidden rounded-full">
            <div className="inset-0 absolute" style={shimmerStyle} />
          </div>
          <div className="h-6 w-12 bg-ds-bg-neutral-subtle-default relative overflow-hidden rounded-full">
            <div className="inset-0 absolute" style={shimmerStyle} />
          </div>
        </div>

        {/* End: Menu skeleton */}
        <div className="ml-4 min-w-32 gap-2 pl-4 flex items-center justify-end">
          <div className="h-8 w-8 rounded-md bg-ds-bg-neutral-subtle-default relative overflow-hidden">
            <div className="inset-0 absolute" style={shimmerStyle} />
          </div>
        </div>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className="gap-4 pb-40 flex w-full flex-col">
        {/* Keyframe animation for shimmer effect */}
        <style>
          {`
            @keyframes shimmer {
              0% { background-position: 200% 0; }
              100% { background-position: -200% 0; }
            }
          `}
        </style>

        {/* Summary skeleton */}
        <div className="pb-4 flex items-center justify-between">
          <div className="gap-2 flex items-center">
            <div className="h-7 w-28 bg-ds-bg-neutral-strong-default relative overflow-hidden rounded-full">
              <div className="inset-0 absolute" style={shimmerStyle} />
            </div>
            <div className="h-7 w-32 bg-ds-bg-neutral-strong-default relative overflow-hidden rounded-full">
              <div className="inset-0 absolute" style={shimmerStyle} />
            </div>
          </div>
          <div className="gap-md flex items-center">
            <div className="h-9 w-40 rounded-lg bg-ds-bg-neutral-strong-default relative overflow-hidden">
              <div className="inset-0 absolute" style={shimmerStyle} />
            </div>
          </div>
        </div>

        {/* List skeleton cards */}
        <div className="gap-3 flex flex-col">
          {[1, 2, 3, 4, 5].map((i) => (
            <ListCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (filteredProjects.length === 0) {
    return (
      <div className="p-8 flex flex-col items-center justify-center text-center">
        <FolderOpen className="mb-4 h-12 w-12 text-ds-icon-neutral-muted-default" />
        <div className="text-sm text-ds-text-neutral-muted-default">
          {searchValue
            ? t('dashboard.no-projects-match-search')
            : t('dashboard.no-projects-found')}
        </div>
        {searchValue && (
          <div className="mt-1 text-xs text-ds-text-neutral-muted-default">
            {t('dashboard.try-different-search')}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="gap-4 pb-40 flex w-full flex-col">
      <AnimatePresence mode="wait">
        <motion.div
          key={projectViewType}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {projectViewType === 'grid' ? (
            // Grid layout for project cards — equal-width columns; cards fill the cell (w-full)
            <motion.div
              className="gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 grid auto-rows-fr grid-cols-1"
              initial="hidden"
              animate="visible"
              variants={{
                hidden: { opacity: 0 },
                visible: {
                  opacity: 1,
                  transition: {
                    staggerChildren: 0.05,
                  },
                },
              }}
            >
              <AnimatePresence mode="popLayout">
                {allProjects.map((project, _index) => (
                  <motion.div
                    key={project.project_id}
                    className="min-w-0 w-full"
                    variants={{
                      hidden: { opacity: 0, y: 20, scale: 0.95 },
                      visible: {
                        opacity: 1,
                        y: 0,
                        scale: 1,
                        transition: {
                          duration: 0.3,
                          ease: 'easeOut',
                        },
                      },
                    }}
                    exit={{
                      opacity: 0,
                      scale: 0.9,
                      transition: {
                        duration: 0.2,
                      },
                    }}
                    layout
                  >
                    <ProjectGroup
                      project={project}
                      onTaskSelect={onTaskSelect}
                      onTaskDelete={onDelete}
                      onTaskShare={onTaskShare}
                      activeTaskId={activeTaskId}
                      searchValue={searchValue}
                      isOngoing={project.total_ongoing_tasks > 0}
                      onOngoingTaskPause={onOngoingTaskPause}
                      onOngoingTaskResume={onOngoingTaskResume}
                      onProjectEdit={handleProjectEdit}
                      onProjectDelete={handleProjectDelete}
                      onProjectRename={handleProjectRename}
                      viewMode="grid"
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
          ) : (
            // List layout for projects
            <motion.div
              className="gap-3 flex flex-col"
              initial="hidden"
              animate="visible"
              variants={{
                hidden: { opacity: 0 },
                visible: {
                  opacity: 1,
                  transition: {
                    staggerChildren: 0.03,
                  },
                },
              }}
            >
              <AnimatePresence mode="popLayout">
                {allProjects.map((project, _index) => (
                  <motion.div
                    key={project.project_id}
                    variants={{
                      hidden: { opacity: 0, x: -20 },
                      visible: {
                        opacity: 1,
                        x: 0,
                        transition: {
                          duration: 0.3,
                          ease: 'easeOut',
                        },
                      },
                    }}
                    exit={{
                      opacity: 0,
                      x: -20,
                      transition: {
                        duration: 0.2,
                      },
                    }}
                    layout
                  >
                    <ProjectGroup
                      project={project}
                      onTaskSelect={onTaskSelect}
                      onTaskDelete={onDelete}
                      onTaskShare={onTaskShare}
                      activeTaskId={activeTaskId}
                      searchValue={searchValue}
                      isOngoing={project.total_ongoing_tasks > 0}
                      onOngoingTaskPause={onOngoingTaskPause}
                      onOngoingTaskResume={onOngoingTaskResume}
                      onProjectEdit={handleProjectEdit}
                      onProjectDelete={handleProjectDelete}
                      onProjectRename={handleProjectRename}
                      viewMode="list"
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
