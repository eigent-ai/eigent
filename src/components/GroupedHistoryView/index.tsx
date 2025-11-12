import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ProjectGroup as ProjectGroupType } from "@/types/history";
import { fetchGroupedHistoryTasks } from "@/service/historyApi";
import ProjectGroup from "./ProjectGroup";
import { useTranslation } from "react-i18next";
import { Loader2, FolderOpen } from "lucide-react";
import { update } from "electron/main/update";

interface GroupedHistoryViewProps {
  searchValue?: string;
  onTaskSelect: (projectId: string, question: string, historyId: string) => void;
  onTaskDelete: (historyId: string, callback: () => void) => void;
  onTaskShare: (taskId: string) => void;
  activeTaskId?: string;
  refreshTrigger?: number; // For triggering refresh from parent
}

export default function GroupedHistoryView({
  searchValue = "",
  onTaskSelect,
  onTaskDelete,
  onTaskShare,
  activeTaskId,
  refreshTrigger
}: GroupedHistoryViewProps) {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<ProjectGroupType[]>([]);
  const [loading, setLoading] = useState(true);

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

  const onDelete = (historyId: string ) => {
    try {
      onTaskDelete(historyId, () => {
        setProjects(prevProjects => {
          return prevProjects.map(project => {
            project.tasks = project.tasks.filter(task => String(task.id) !== historyId);
            return project;
          }).filter(project => project.tasks.length > 0);
        });
      });
    } catch (error) {
      console.error("Failed to delete task:", error);
    }
  }

  useEffect(() => {
    loadProjects();
  }, [refreshTrigger]);

  // Filter projects based on search value
  const filteredProjects = projects.filter(project => {
    if (!searchValue) return true;
    
    // Check if project name matches
    if (project.project_name?.toLowerCase().includes(searchValue.toLowerCase())) {
      return true;
    }
    
    // Check if any task in the project matches
    return project.tasks.some(task =>
      task.question?.toLowerCase().includes(searchValue.toLowerCase())
    );
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-icon-secondary" />
        <span className="ml-2 text-text-secondary">{t("layout.loading")}</span>
      </div>
    );
  }

  if (filteredProjects.length === 0) {
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
    <div className="space-y-4">
      <AnimatePresence mode="popLayout">
        {filteredProjects.map((project) => (
          <motion.div
            key={project.project_id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.2 }}
            layout
          >
            <ProjectGroup
              project={project}
              onTaskSelect={onTaskSelect}
              onTaskDelete={onDelete}
              onTaskShare={onTaskShare}
              activeTaskId={activeTaskId}
              searchValue={searchValue}
            />
          </motion.div>
        ))}
      </AnimatePresence>
      
      {/* Summary footer */}
      <div className="flex justify-center pt-4 border-t border-border-disabled">
        <div className="text-xs text-text-tertiary">
          {filteredProjects.length} {t("layout.projects")} • {" "}
          {filteredProjects.reduce((total, project) => total + project.task_count, 0)} {t("layout.total-tasks")} • {" "}
          {filteredProjects.reduce((total, project) => total + project.total_tokens, 0).toLocaleString()} {t("layout.total-tokens")}
        </div>
      </div>
    </div>
  );
}