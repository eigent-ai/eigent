import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ProjectGroup as ProjectGroupType } from "@/types/history";
import { fetchGroupedHistoryTasks } from "@/service/historyApi";
import ProjectGroup from "./ProjectGroup";
import { useTranslation } from "react-i18next";
import { Loader2, FolderOpen, Pin, Hash, LayoutGrid, List, Sparkles, Sparkle } from "lucide-react";
import { Tag } from "@/components/ui/tag";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGlobalStore } from "@/store/globalStore";
import { proxyFetchDelete, proxyFetchPut } from "@/api/http";
import { getAuthStore } from "@/store/authStore";
import { useProjectStore } from "@/store/projectStore";

// Task status constants
const TASK_STATUS = {
  ONGOING: 1,
  COMPLETED: 2,
} as const;

interface GroupedHistoryViewProps {
  searchValue?: string;
  onTaskSelect: (projectId: string, question: string, historyId: string) => void;
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
  searchValue = "",
  onTaskSelect,
  onTaskDelete,
  onTaskShare,
  activeTaskId,
  refreshTrigger,
  ongoingTasks = {},
  onOngoingTaskClick,
  onOngoingTaskPause,
  onOngoingTaskResume,
  onOngoingTaskDelete,
  onProjectEdit,
  onProjectDelete
}: GroupedHistoryViewProps) {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<ProjectGroupType[]>([]);
  const [loading, setLoading] = useState(true);
  const { history_type, setHistoryType } = useGlobalStore();
  const projectStore = useProjectStore();
  
  // Default to list view if not set
  const viewType = history_type || "list";

  const loadProjects = async () => {
    setLoading(true);
    try {
      await fetchGroupedHistoryTasks(setProjects);
    } catch (error) {
      console.error("Failed to load grouped projects:", error);
    } finally {
      setLoading(false);
    }
  };

  const onDelete = (historyId: string) => {
    // Optimistically update UI
    setProjects(prevProjects => {
      return prevProjects.map(project => {
        const filteredTasks = project.tasks.filter(task => String(task.id) !== historyId);

        // Recalculate all statistics in a single pass
        let total_completed = 0;
        let total_ongoing = 0;
        let total_tokens = 0;

        filteredTasks.forEach(task => {
          if (task.status === TASK_STATUS.COMPLETED) total_completed++;
          if (task.status === TASK_STATUS.ONGOING) total_ongoing++;
          total_tokens += task.tokens || 0;
        });

        return {
          ...project,
          tasks: filteredTasks,
          task_count: filteredTasks.length,
          total_tokens,
          total_completed_tasks: total_completed,
          total_ongoing_tasks: total_ongoing
        };
      }).filter(project => project.tasks.length > 0);
    });

    // Call delete with error handling
    onTaskDelete(historyId, () => {
      // Success callback - deletion confirmed
    });
  }

  const handleProjectEdit = (projectId: string) => {
    if (onProjectEdit) {
      onProjectEdit(projectId);
    }
  }

  const handleProjectDelete = (projectId: string) => {
    // Create the deletion callback that will be executed after confirmation
    const deleteCallback = async () => {
      const targetProject = projects.find(project => project.project_id === projectId);

      if (!targetProject || !targetProject.tasks) {
        console.warn(`Project ${projectId} not found or has no tasks`);
        return;
      }

      const deletedTaskIds: string[] = [];
      const failedTaskIds: string[] = [];

      try {
        // Delete each task one by one and track results
        for (const history of targetProject.tasks) {
          try {
            await proxyFetchDelete(`/api/chat/history/${history.id}`);
            deletedTaskIds.push(history.task_id);

            // Also delete local files for this task if available (via Electron IPC)
            const {email} = getAuthStore();
            if (history.task_id && (window as any).ipcRenderer) {
              try {
                await (window as any).ipcRenderer.invoke('delete-task-files', email, history.task_id, history.project_id ?? undefined);
              } catch (error) {
                console.warn(`Local file cleanup failed for task ${history.task_id}:`, error);
              }
            }
          } catch (error) {
            console.error(`Failed to delete task ${history.task_id}:`, error);
            failedTaskIds.push(history.task_id);
          }
        }

        // Only remove from store and state if all tasks were deleted successfully
        if (failedTaskIds.length === 0) {
          projectStore.removeProject(projectId);
          setProjects(prevProjects => prevProjects.filter(project => project.project_id !== projectId));
        } else {
          // Partial failure - update state to remove only successfully deleted tasks
          setProjects(prevProjects => prevProjects.map(project => {
            if (project.project_id !== projectId) return project;

            const remainingTasks = project.tasks.filter(task =>
              !deletedTaskIds.includes(task.task_id)
            );

            // Recalculate statistics
            let total_completed = 0;
            let total_ongoing = 0;
            let total_tokens = 0;

            remainingTasks.forEach(task => {
              if (task.status === TASK_STATUS.COMPLETED) total_completed++;
              if (task.status === TASK_STATUS.ONGOING) total_ongoing++;
              total_tokens += task.tokens || 0;
            });

            return {
              ...project,
              tasks: remainingTasks,
              task_count: remainingTasks.length,
              total_tokens,
              total_completed_tasks: total_completed,
              total_ongoing_tasks: total_ongoing
            };
          }).filter(project => project.tasks.length > 0));

          throw new Error(`Failed to delete ${failedTaskIds.length} task(s)`);
        }
      } catch (error) {
        console.error("Failed to delete project:", error);
        throw error;
      }
    };

    // Call parent callback with the deletion callback (for confirmation dialog)
    if (onProjectDelete) {
      onProjectDelete(projectId, deleteCallback);
    } else {
      // If no parent callback, execute deletion directly
      deleteCallback();
    }
  }

  const handleProjectRename = async (projectId: string, newName: string) => {
    // Store the original name for potential rollback
    const originalProject = projects.find(p => p.project_id === projectId);
    const originalName = originalProject?.project_name;

    // Optimistically update UI
    setProjects(prevProjects => {
      return prevProjects.map(project => {
        if (project.project_id === projectId) {
          return {
            ...project,
            project_name: newName
          };
        }
        return project;
      });
    });

    // Call API to update project name
    try {
      const response = await proxyFetchPut(`/api/chat/project/${projectId}/name?new_name=${encodeURIComponent(newName)}`);

      // Response with status 204 returns { code: 0, text: '' }
      if (!response || response.code !== 0) {
        console.error(`Failed to update project name: unexpected response`, response);
        // Revert the local change if API call fails
        if (originalName) {
          setProjects(prevProjects => {
            return prevProjects.map(project => {
              if (project.project_id === projectId) {
                return {
                  ...project,
                  project_name: originalName
                };
              }
              return project;
            });
          });
        }
      }
    } catch (error) {
      console.error(`Error updating project name:`, error);
      // Revert the local change if API call fails
      if (originalName) {
        setProjects(prevProjects => {
          return prevProjects.map(project => {
            if (project.project_id === projectId) {
              return {
                ...project,
                project_name: originalName
              };
            }
            return project;
          });
        });
      }
    }
  }

  useEffect(() => {
    loadProjects();
  }, [refreshTrigger]);

  // Memoize search value toLowerCase to avoid repeated calculations
  const searchValueLower = useMemo(() => searchValue.toLowerCase(), [searchValue]);

  // Filter projects based on search value
  const filteredProjects = useMemo(() => {
    return projects.filter(project => {
      if (!searchValue) return true;

      // Check if project name matches
      if (project.project_name?.toLowerCase().includes(searchValueLower)) {
        return true;
      }

      // Check if any task in the project matches
      return project.tasks.some(task =>
        task.question?.toLowerCase().includes(searchValueLower)
      );
    });
  }, [projects, searchValue, searchValueLower]);

  // Get empty projects from projectStore and convert to ProjectGroup format
  const emptyProjectGroups = useMemo(() => {
    const allProjectsFromStore = projectStore.getAllProjects();
    const emptyProjects = allProjectsFromStore.filter(project => projectStore.isEmptyProject(project));

    return emptyProjects.map(project => ({
      project_id: project.id,
      project_name: project.name,
      total_tokens: 0,
      task_count: 0,
      latest_task_date: new Date(project.updatedAt).toISOString(),
      last_prompt: "",
      tasks: [],
      total_completed_tasks: 0,
      total_ongoing_tasks: 0,
      average_tokens_per_task: 0
    }));
  }, [projectStore]);

  // Combine filtered projects with empty projects from store and deduplicate
  const allProjects = useMemo(() => {
    const projectMap = new Map<string, ProjectGroupType>();

    // Add filtered projects first (these have priority as they come from server)
    filteredProjects.forEach(project => {
      projectMap.set(project.project_id, project);
    });

    // Add empty projects only if they don't already exist
    emptyProjectGroups.forEach(project => {
      if (!projectMap.has(project.project_id)) {
        projectMap.set(project.project_id, project);
      }
    });

    return Array.from(projectMap.values());
  }, [filteredProjects, emptyProjectGroups]);

  // Calculate which projects are actually ongoing based on ongoingTasks prop
  const projectOngoingStatus = useMemo(() => {
    const statusMap = new Map<string, boolean>();

    allProjects.forEach(project => {
      // Check if any task in this project is in the ongoingTasks
      const hasOngoingTask = project.tasks.some(task =>
        ongoingTasks && ongoingTasks[task.task_id]
      );

      statusMap.set(project.project_id, hasOngoingTask || project.total_ongoing_tasks > 0);
    });

    return statusMap;
  }, [allProjects, ongoingTasks]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-icon-secondary" />
        <span className="ml-2 text-text-secondary">{t("layout.loading")}</span>
      </div>
    );
  }

  if (allProjects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <FolderOpen className="w-12 h-12 text-icon-tertiary mb-4" />
        <div className="text-text-secondary text-sm">
          {searchValue
            ? t("dashboard.no-projects-match-search")
            : t("dashboard.no-projects-found")
          }
        </div>
        {searchValue && (
          <div className="text-text-tertiary text-xs mt-1">
            {t("dashboard.try-different-search")}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 w-full pb-40">
      {/* Summary */}
      <div className="flex justify-between items-center pb-4">
        <div className="flex items-center gap-2">
          <Tag variant="default" size="sm" className="gap-2">
            <Sparkle />
            <span className="text-body-sm"> {t("layout.projects")}</span>
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-tag-fill-default-foreground text-text-body text-label-xs font-bold">
              {allProjects.length}
            </span>
          </Tag>
          
          <Tag variant="default" size="sm" className="gap-2">
            <Pin />
            <span className="text-body-sm"> {t("layout.total-tasks")}</span>
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-tag-fill-default-foreground text-text-body text-label-xs font-bold">
              {allProjects.reduce((total, project) => total + project.task_count, 0)}
            </span>
          </Tag>
        </div>
        <div className="flex items-center gap-md">
          <Tabs
            value={viewType}
            onValueChange={(value) =>
              setHistoryType(value as "grid" | "list")
            }
          >
            <TabsList>
              <TabsTrigger value="grid">
                <div className="flex items-center gap-1">
                  <LayoutGrid size={16} />
                  <span>{t("dashboard.grid")}</span>
                </div>
              </TabsTrigger>
              <TabsTrigger value="list">
                <div className="flex items-center gap-1">
                  <List size={16} />
                  <span>{t("dashboard.list")}</span>
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
          {viewType === "grid" ? (
            // Grid layout for project cards
            <motion.div 
              className="grid grid-cols-1 md:grid-cols-2 gap-4 auto-rows-fr"
              initial="hidden"
              animate="visible"
              variants={{
                hidden: { opacity: 0 },
                visible: {
                  opacity: 1,
                  transition: {
                    staggerChildren: 0.05
                  }
                }
              }}
            >
              <AnimatePresence mode="popLayout">
                {allProjects.map((project, index) => (
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
                          ease: "easeOut"
                        }
                      }
                    }}
                    exit={{
                      opacity: 0,
                      scale: 0.9,
                      transition: {
                        duration: 0.2
                      }
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
                      isOngoing={projectOngoingStatus.get(project.project_id) || false}
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
                    staggerChildren: 0.03
                  }
                }
              }}
            >
              <AnimatePresence mode="popLayout">
                {allProjects.map((project, index) => (
                  <motion.div
                    key={project.project_id}
                    variants={{
                      hidden: { opacity: 0, x: -20 },
                      visible: {
                        opacity: 1,
                        x: 0,
                        transition: {
                          duration: 0.3,
                          ease: "easeOut"
                        }
                      }
                    }}
                    exit={{
                      opacity: 0,
                      x: -20,
                      transition: {
                        duration: 0.2
                      }
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
                      isOngoing={projectOngoingStatus.get(project.project_id) || false}
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