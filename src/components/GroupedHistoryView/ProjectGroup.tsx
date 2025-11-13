import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronRight, Folder, Calendar, Target, Clock } from "lucide-react";
import { ProjectGroup as ProjectGroupType, HistoryTask } from "@/types/history";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { TooltipSimple } from "@/components/ui/tooltip";
import { useTranslation } from "react-i18next";
import TaskItem from "./TaskItem";

interface ProjectGroupProps {
  project: ProjectGroupType;
  onTaskSelect: (projectId: string, question: string, historyId: string) => void;
  onTaskDelete: (taskId: string) => void;
  onTaskShare: (taskId: string) => void;
  activeTaskId?: string;
  searchValue?: string;
}

export default function ProjectGroup({
  project,
  onTaskSelect,
  onTaskDelete,
  onTaskShare,
  activeTaskId,
  searchValue = ""
}: ProjectGroupProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(true);

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

  const getStatusColor = (completedTasks: number, totalTasks: number) => {
    const ratio = totalTasks > 0 ? completedTasks / totalTasks : 0;
    if (ratio >= 0.8) return "text-green-600";
    if (ratio >= 0.5) return "text-yellow-600";
    return "text-red-600";
  };

  return (
    <div className="border border-solid border-border-disabled rounded-xl bg-white-30% overflow-hidden">
      {/* Project Header */}
      <Button
        variant="ghost"
        className="w-full p-4 h-auto justify-start hover:bg-white-50% transition-all duration-200"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              {isExpanded ? (
                <ChevronDown className="w-4 h-4 text-icon-secondary" />
              ) : (
                <ChevronRight className="w-4 h-4 text-icon-secondary" />
              )}
              <Folder className="w-5 h-5 text-icon-primary" />
            </div>
            
            <div className="flex flex-col items-start gap-1">
              <TooltipSimple
                content={<p className="max-w-xs break-words">{project.project_name}</p>}
                className="bg-surface-tertiary p-2 text-wrap break-words text-label-xs select-text pointer-events-auto shadow-perfect"
              >
                <span className="text-text-primary font-semibold text-left truncate max-w-[200px]">
                  {project.project_name}
                </span>
              </TooltipSimple>
              
              <div className="flex items-center gap-2 text-xs text-text-secondary">
                <div className="flex items-center gap-1">
                  <Target className="w-3 h-3" />
                  <span>{project.task_count} {t("layout.tasks")}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  <span>{formatDate(project.latest_task_date)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Tag
              variant="primary"
              className="text-xs"
            >
              {t("layout.token")} {project.total_tokens.toLocaleString()}
            </Tag>
            
            <Tag
              variant="primary"
              className={`text-xs ${getStatusColor(project.total_completed_tasks, project.task_count)}`}
            >
              {project.total_completed_tasks}/{project.task_count} {t("layout.completed")}
            </Tag>
          </div>
        </div>
      </Button>

      {/* Tasks List */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-2">
              {(searchValue ? filteredTasks : project.tasks).map((task, index) => (
                <TaskItem
                  key={task.id}
                  task={task}
                  isActive={activeTaskId === task.task_id}
                  onSelect={() => onTaskSelect(task.project_id, task.question, task.id.toString())}
                  onDelete={() => onTaskDelete(task.id.toString())}
                  onShare={() => onTaskShare(task.task_id)}
                  isLast={index === (searchValue ? filteredTasks : project.tasks).length - 1}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}