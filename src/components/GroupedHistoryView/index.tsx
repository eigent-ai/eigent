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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tag } from '@/components/ui/tag';
import { fetchGroupedHistoryTasks } from '@/service/historyApi';
import { getAuthStore } from '@/store/authStore';
import { useGlobalStore } from '@/store/globalStore';
import { useProjectStore } from '@/store/projectStore';
import { ProjectGroup as ProjectGroupType } from '@/types/history';
import { AnimatePresence, motion } from 'framer-motion';
import { FolderOpen, LayoutGrid, List, Pin, Sparkle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ProjectGroup from './ProjectGroup';

interface GroupedHistoryViewProps {
  searchValue?: string;
  onTaskSelect: (
    projectId: string,
    question: string,
    historyId: string
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
  const [projects, setProjects] = useState<ProjectGroupType[]>([]);
  const [loading, setLoading] = useState(true);
  const { history_type, setHistoryType } = useGlobalStore();
  const projectStore = useProjectStore();

  // Default to list view if not set
  const viewType = history_type || 'list';

  const loadProjects = async () => {
    setLoading(true);
    try {
      await fetchGroupedHistoryTasks(setProjects);
    } catch (error) {
      console.error('Failed to load grouped projects:', error);
    } finally {
      setLoading(false);
    }
  };

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
              await proxyFetchDelete(`/api/chat/history/${history.id}`);
              console.log(`Successfully deleted task ${history.task_id}`);

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
        `/api/chat/project/${projectId}/name?new_name=${encodeURIComponent(newName)}`
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
    loadProjects();
  }, [refreshTrigger]);

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

  // Get all projects from projectStore and find empty ones
  const allProjectsFromStore = projectStore.getAllProjects();
  const emptyProjects = allProjectsFromStore.filter((project) =>
    projectStore.isEmptyProject(project)
  );

  // Convert empty projects from projectStore format to ProjectGroup format
  const emptyProjectGroups: ProjectGroupType[] = emptyProjects.map(
    (project) => ({
      project_id: project.id,
      project_name: project.name,
      total_tokens: 0,
      task_count: 0,
      latest_task_date: new Date(project.updatedAt).toISOString(),
      last_prompt: '',
      tasks: [],
      total_completed_tasks: 0,
      total_triggers: 0,
      total_ongoing_tasks: 0,
      average_tokens_per_task: 0,
    })
  );

  // Combine filtered projects with empty projects from store
  const allProjects = [...emptyProjectGroups, ...filteredProjects];

  // Shimmer animation styles
  // Shimmer animation styles
  const shimmerStyle = {
    background:
      'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%)',
    backgroundSize: '200% 100%',
    animation: 'shimmer 1.5s infinite',
  };

  // Skeleton component for list card loading state
  const ListCardSkeleton = () => (
    <div className="overflow-hidden rounded-xl bg-surface-secondary">
      <div className="flex w-full items-center justify-between px-6 py-4">
        {/* Start: Folder icon and project name skeleton */}
        <div className="flex w-48 flex-shrink-0 items-center gap-3">
          <div className="relative h-5 w-5 flex-shrink-0 overflow-hidden rounded bg-surface-primary">
            <div className="absolute inset-0" style={shimmerStyle} />
          </div>
          <div className="relative h-5 w-32 overflow-hidden rounded bg-surface-primary">
            <div className="absolute inset-0" style={shimmerStyle} />
          </div>
        </div>

        {/* Middle: Tags skeleton */}
        <div className="flex flex-1 items-center justify-end gap-4">
          <div className="relative h-6 w-16 overflow-hidden rounded-full bg-surface-primary">
            <div className="absolute inset-0" style={shimmerStyle} />
          </div>
          <div className="relative h-6 w-12 overflow-hidden rounded-full bg-surface-primary">
            <div className="absolute inset-0" style={shimmerStyle} />
          </div>
          <div className="relative h-6 w-12 overflow-hidden rounded-full bg-surface-primary">
            <div className="absolute inset-0" style={shimmerStyle} />
          </div>
        </div>

        {/* End: Menu skeleton */}
        <div className="ml-4 flex min-w-32 items-center justify-end gap-2 pl-4">
          <div className="relative h-8 w-8 overflow-hidden rounded-md bg-surface-primary">
            <div className="absolute inset-0" style={shimmerStyle} />
          </div>
        </div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="flex w-full flex-col gap-4 pb-40">
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
        <div className="flex items-center justify-between pb-4">
          <div className="flex items-center gap-2">
            <div className="relative h-7 w-28 overflow-hidden rounded-full bg-surface-tertiary">
              <div className="absolute inset-0" style={shimmerStyle} />
            </div>
            <div className="relative h-7 w-32 overflow-hidden rounded-full bg-surface-tertiary">
              <div className="absolute inset-0" style={shimmerStyle} />
            </div>
          </div>
          <div className="flex items-center gap-md">
            <div className="relative h-9 w-40 overflow-hidden rounded-lg bg-surface-tertiary">
              <div className="absolute inset-0" style={shimmerStyle} />
            </div>
          </div>
        </div>

        {/* List skeleton cards */}
        <div className="flex flex-col gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <ListCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (filteredProjects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <FolderOpen className="text-icon-tertiary mb-4 h-12 w-12" />
        <div className="text-sm text-text-secondary">
          {searchValue
            ? t('dashboard.no-projects-match-search')
            : t('dashboard.no-projects-found')}
        </div>
        {searchValue && (
          <div className="mt-1 text-xs text-text-tertiary">
            {t('dashboard.try-different-search')}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4 pb-40">
      {/* Summary */}
      <div className="flex items-center justify-between pb-4">
        <div className="flex items-center gap-2">
          <Tag variant="default" size="sm" className="gap-2">
            <Sparkle />
            <span className="text-body-sm"> {t('layout.projects')}</span>
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-tag-fill-default-foreground text-label-xs font-bold text-text-body">
              {allProjects.length}
            </span>
          </Tag>

          <Tag variant="default" size="sm" className="gap-2">
            <Pin />
            <span className="text-body-sm"> {t('layout.total-tasks')}</span>
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-tag-fill-default-foreground text-label-xs font-bold text-text-body">
              {allProjects.reduce(
                (total, project) => total + project.task_count,
                0
              )}
            </span>
          </Tag>
        </div>
        <div className="flex items-center gap-md">
          <Tabs
            value={viewType}
            onValueChange={(value) => setHistoryType(value as 'grid' | 'list')}
          >
            <TabsList>
              <TabsTrigger value="grid">
                <div className="flex items-center gap-1">
                  <LayoutGrid size={16} />
                  <span>{t('dashboard.grid')}</span>
                </div>
              </TabsTrigger>
              <TabsTrigger value="list">
                <div className="flex items-center gap-1">
                  <List size={16} />
                  <span>{t('dashboard.list')}</span>
                </div>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={viewType}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {viewType === 'grid' ? (
            // Grid layout for project cards
            <motion.div
              className="grid auto-rows-fr grid-cols-1 gap-4 md:grid-cols-2"
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
              className="flex flex-col gap-3"
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
