import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronRight, Folder, FolderClosed, FolderOpen, Calendar, Target, Clock, Activity, Zap, Bot, MoreVertical, Edit, Trash2, MoreHorizontal, Pin, Hash, Sparkles, Sparkle } from "lucide-react";
import { ProjectGroup as ProjectGroupType, HistoryTask } from "@/types/history";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { TooltipSimple } from "@/components/ui/tooltip";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useProjectStore } from "@/store/projectStore";
import TaskItem from "./TaskItem";
import ProjectDialog from "./ProjectDialog";
import { replayProject } from "@/lib/replay";
import useChatStoreAdapter from "@/hooks/useChatStoreAdapter";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

interface ProjectGroupProps {
  project: ProjectGroupType;
  onTaskSelect: (projectId: string, question: string, historyId: string) => void;
  onTaskDelete: (taskId: string) => void;
  onTaskShare: (taskId: string) => void;
  activeTaskId?: string;
  searchValue?: string;
  isOngoing?: boolean;
  onOngoingTaskPause?: (taskId: string) => void;
  onOngoingTaskResume?: (taskId: string) => void;
  onProjectEdit?: (projectId: string) => void;
  onProjectDelete?: (projectId: string) => void;
  onProjectRename?: (projectId: string, newName: string) => void;
  viewMode?: "grid" | "list";
}

export default function ProjectGroup({
  project,
  onTaskSelect,
  onTaskDelete,
  onTaskShare,
  activeTaskId,
  searchValue = "",
  isOngoing = false,
  onOngoingTaskPause,
  onOngoingTaskResume,
  onProjectEdit,
  onProjectDelete,
  onProjectRename,
  viewMode = "grid"
}: ProjectGroupProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const projectStore = useProjectStore();
  const { chatStore } = useChatStoreAdapter();
  const [isExpanded, setIsExpanded] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Handler to navigate to project
  const handleProjectClick = (e: React.MouseEvent) => {
    // Don't trigger if clicking on interactive elements (buttons, dropdowns)
    if ((e.target as HTMLElement).closest('button, [role="menuitem"]')) {
      return;
    }
    
    // Check if project exists in store
    const existingProject = projectStore.getProjectById(project.project_id);
    
    if (existingProject) {
      // Project exists, just activate it and navigate
      projectStore.setActiveProject(project.project_id);
      navigate('/');
    } else {
      // Project doesn't exist, trigger replay to recreate it
      // Get the first task's question and use the first task's ID as history ID
      const firstTask = project.tasks?.[0];
      if (firstTask) {
        const question = firstTask.question || project.last_prompt || "";
        const historyId = firstTask.id?.toString() || "";
        const taskIdsList = [project.project_id];
        
        replayProject(projectStore, navigate, project.project_id, question, historyId, taskIdsList);
      } else {
        console.warn("No tasks found in project, cannot replay");
        // Fallback: try to set as active anyway (may create a new project)
        projectStore.setActiveProject(project.project_id);
        navigate('/');
      }
    }
  };

  // Filter tasks based on search value
  const filteredTasks = project.tasks.filter(task =>
    task.question?.toLowerCase().includes(searchValue.toLowerCase())
  );

  // Don't render if no tasks match the search
  if (searchValue && filteredTasks.length === 0) {
    return null;
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffInDays === 0) return t("layout.today");
    if (diffInDays === 1) return t("layout.yesterday");
    if (diffInDays < 7) return `${diffInDays} ${t("layout.days-ago")}`;
    
    return date.toLocaleDateString();
  };

  // Calculate if project has issues (requiring human in the loop)
  // Find tasks in chatStore where task_id matches any task in the project
  const hasHumanInLoop = useMemo(() => {
    if (!chatStore?.tasks || !project.tasks?.length) return false;

    // Get all task_ids from the project, filtering out undefined/null values
    const projectTaskIds = project.tasks
      .map(task => task.task_id)
      .filter((id): id is string => !!id);

    // Check if any task in chatStore with matching task_id has pending status
    return Object.entries(chatStore.tasks).some(([taskId, task]) =>
      projectTaskIds.includes(taskId) && task.status === 'pending'
    );
  }, [chatStore?.tasks, project.tasks]);
  const hasIssue = hasHumanInLoop;
  
  // Calculate agent count (placeholder - count unique agents from tasks if available)
  const agentCount = project.tasks?.length > 0 
    ? new Set(project.tasks.map(t => t.model_type || 'default')).size 
    : 0;
  
  // Trigger count is 0 for now (disabled)
  const triggerCount = 0;

  // Handle project edit - open dialog
  const handleProjectEdit = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    setIsDialogOpen(true);
    // Also call the parent callback if provided
    if (onProjectEdit) {
      onProjectEdit(project.project_id);
    }
  };

  // Handle project rename
  const handleProjectRename = (projectId: string, newName: string) => {
    if (onProjectRename) {
      onProjectRename(projectId, newName);
    }
  };

  // Grid view - Card-based design
  if (viewMode === "grid") {
    return (
      <motion.div
        transition={{ duration: 0.2, ease: "easeOut" }}
        onClick={handleProjectClick}
        className="border border-solid border-border-disabled rounded-xl bg-project-surface-default overflow-hidden transition-colors hover:bg-project-surface-hover h-full backdrop-blur-sm cursor-pointer"
      >
        {/* Project Card */}
        <div className="flex flex-col h-full">
          {/* Header with menu */}
          <div className="flex items-start justify-between px-6 py-4 min-h-32">
            <div className="flex flex-col w-full pr-4 gap-2">
              <div className="flex flex-row w-full justify-start items-center gap-2">
                {isOngoing ? (
                  <Sparkles className="w-6 h-6 text-icon-information flex-shrink-0" />
                ) : (
                  <Sparkle className="w-6 h-6 text-icon-secondary flex-shrink-0" />
                )}
                
                {/* Status badges */}
                <div className="flex items-center gap-2">
                  {/* TODO: Add ongoing badge after finish state management is implemented */}
                  {/* {isOngoing && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.2 }}
                    >
                      <Tag variant="info" size="xs">
                        <Activity className="w-3.5 h-3.5" />
                        {t("layout.ongoing")}
                      </Tag>
                    </motion.div>
                  )} */}
                  
                  {/* {!isOngoing && hasIssue && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.2 }}
                    >
                      <Tag variant="warning" size="xs">
                        {t("layout.issue") || "Issue"}
                      </Tag>
                    </motion.div>
                  )} */}
                  </div>
              </div>
              <TooltipSimple
                content={<p className="max-w-xs break-words">{project.project_name}</p>}
                className="bg-surface-tertiary px-2 text-wrap break-words text-label-xs select-text pointer-events-auto shadow-perfect"
              >
                <span className="text-text-heading font-semibold text-body-md leading-relaxed line-clamp-2">
                  {project.project_name}
                </span>
              </TooltipSimple>
            </div>

            {/* Menu button */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="rounded-md flex-shrink-0 relative z-10"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="w-4 h-4 text-icon-primary" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-dropdown-bg border-dropdown-border z-50">
                {onProjectEdit && (
                  <DropdownMenuItem
                    onClick={handleProjectEdit}
                    className="bg-dropdown-item-bg-default hover:bg-dropdown-item-bg-hover cursor-pointer"
                  >
                    <Edit className="w-4 h-4 mr-2" />
                    {t("layout.edit") || "Edit"}
                  </DropdownMenuItem>
                )}
                {onProjectDelete && (
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      onProjectDelete(project.project_id);
                    }}
                    className="bg-dropdown-item-bg-default hover:bg-dropdown-item-bg-hover text-text-cuation cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    {t("layout.delete")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Project Dialog */}
          <ProjectDialog
            open={isDialogOpen}
            onOpenChange={setIsDialogOpen}
            project={project}
            onProjectRename={handleProjectRename}
            onTaskSelect={onTaskSelect}
            onTaskDelete={onTaskDelete}
            onTaskShare={onTaskShare}
            activeTaskId={activeTaskId}
          />

          {/* Footer with stats */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.3 }}
            className="flex items-center justify-between px-6 py-4 border-solid border-b-0 border-x-0 border-border-disabled"
          >
            <div className="flex flex-row w-full items-center justify-between gap-4">
              {/* Token count */}
              <TooltipSimple content={t("chat.token")}>
                <div className="flex items-center gap-1">
                  <Hash className="w-4 h-4 text-icon-information" />
                  <span className="text-body-sm text-text-information font-semibold"> {t("chat.token")}</span>
                  <span className="text-text-information font-semibold text-body-sm">
                    {project.total_tokens ? project.total_tokens.toLocaleString() : "0"}
                  </span>
                </div>
              </TooltipSimple>
              
              <div className="flex flex-row items-center justify-end gap-4">

              {/* Task count */}
              <TooltipSimple content="Tasks">
                <div className="flex items-center gap-1">
                  <Pin className="w-4 h-4 text-icon-secondary" />
                  <span className="text-body-sm text-text-body font-semibold">
                    {project.task_count}
                  </span>
                </div>
              </TooltipSimple>
              </div>
            </div>
          </motion.div>
        </div>
      </motion.div>
    );
  }

  // List view - Original horizontal layout
  return (
    <div 
      onClick={handleProjectClick}
      className="border border-solid border-border-disabled rounded-xl bg-project-surface-default hover:bg-project-surface-hover overflow-hidden backdrop-blur-sm hover:perfect-shadow cursor-pointer"
    >
      {/* Project */}
      <div className="flex items-center justify-between w-full px-6 py-4">
        {/* Start: Folder icon and project name - Fixed width */}
        <div className="flex items-center gap-3 w-48 flex-shrink-0">
          {isOngoing ? (
            <Sparkles className="w-5 h-5 text-icon-information flex-shrink-0" />
          ) : (
            <Sparkle className="w-5 h-5 text-icon-secondary flex-shrink-0" />
          )}
          <TooltipSimple
            content={<p className="max-w-xs break-words">{project.project_name}</p>}
            className="bg-surface-tertiary px-2 text-wrap break-words text-label-xs select-text pointer-events-auto shadow-perfect"
          >
            <span className="text-text-heading font-semibold text-body-md text-left truncate block">
              {project.project_name}
            </span>
          </TooltipSimple>
        </div>

        {/* Middle: Project, Trigger, Agent tags - Aligned to right */}
        <div className="flex items-center gap-4 flex-1 justify-end w-fit">
          <Tag variant="info" size="sm">
            <Hash />
            <span>{project.total_tokens ? project.total_tokens.toLocaleString() : "0"}</span>
          </Tag>

          <TooltipSimple content={t("layout.tasks")}>
            <Tag variant="default" size="sm" className="min-w-10">
              <Pin />
              <span>{project.task_count}</span>
            </Tag>
          </TooltipSimple>
        </div>

        {/* End: Status and menu */}
        <div className="flex items-center gap-2 min-w-32 w-fit justify-end ml-4 border border-solid border-border-disabled border-r-0 border-y-0 pl-4">
          {/* Status tag */}
          {/* {isOngoing && (
            <Tag variant="info" size="sm">
              <Activity />
              {t("layout.ongoing")}
            </Tag>
          )} */}
          
          {/* {!isOngoing && hasIssue && (
            <Tag variant="warning" size="sm">
              {t("layout.issue") || "Issue"}
            </Tag>
          )} */}

          {/* Menu button */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-md relative z-10">
                <MoreHorizontal className="w-4 h-4 text-icon-primary" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-dropdown-bg border-dropdown-border z-50">
              {onProjectEdit && (
                <DropdownMenuItem
                  onClick={handleProjectEdit}
                  className="bg-dropdown-item-bg-default hover:bg-dropdown-item-bg-hover cursor-pointer"
                >
                  <Edit className="w-4 h-4 mr-2" />
                  {t("layout.edit") || "Edit"}
                </DropdownMenuItem>
              )}
              {onProjectDelete && (
                <DropdownMenuItem
                  onClick={() => onProjectDelete(project.project_id)}
                  className="bg-dropdown-item-bg-default hover:bg-dropdown-item-bg-hover text-text-cuation cursor-pointer"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  {t("layout.delete")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Project Dialog */}
      <ProjectDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        project={project}
        onProjectRename={handleProjectRename}
        onTaskSelect={onTaskSelect}
        onTaskDelete={onTaskDelete}
        onTaskShare={onTaskShare}
        activeTaskId={activeTaskId}
      />
    </div>
  );
}
