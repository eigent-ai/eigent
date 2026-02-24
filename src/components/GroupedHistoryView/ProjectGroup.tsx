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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tag } from '@/components/ui/tag';
import { TooltipSimple } from '@/components/ui/tooltip';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { loadProjectFromHistory } from '@/lib/replay';
import { useProjectStore } from '@/store/projectStore';
import { ChatTaskStatus } from '@/types/constants';
import { ProjectGroup as ProjectGroupType } from '@/types/history';
import { motion } from 'framer-motion';
import {
  Edit,
  Hash,
  Loader2,
  MoreHorizontal,
  Pin,
  Sparkle,
  Sparkles,
  Trash2,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import ProjectDialog from './ProjectDialog';

interface ProjectGroupProps {
  project: ProjectGroupType;
  onTaskSelect: (
    projectId: string,
    question: string,
    historyId: string,
    project?: ProjectGroupType
  ) => void;
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
  viewMode?: 'grid' | 'list';
}

export default function ProjectGroup({
  project,
  onTaskSelect,
  onTaskDelete,
  onTaskShare,
  activeTaskId,
  searchValue = '',
  isOngoing = false,
  onOngoingTaskPause: _onOngoingTaskPause,
  onOngoingTaskResume: _onOngoingTaskResume,
  onProjectEdit,
  onProjectDelete,
  onProjectRename,
  viewMode = 'grid',
}: ProjectGroupProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const projectStore = useProjectStore();
  const { chatStore } = useChatStoreAdapter();
  const [_isExpanded, _setIsExpanded] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLoadingProject, setIsLoadingProject] = useState(false);

  // Filter tasks based on search value
  const filteredTasks = project.tasks.filter((task) =>
    task.question?.toLowerCase().includes(searchValue.toLowerCase())
  );

  // Calculate if project has issues (requiring human in the loop)
  // Find tasks in chatStore where task_id matches any task in the project
  const hasHumanInLoop = useMemo(() => {
    if (!chatStore?.tasks || !project.tasks?.length) return false;

    // Get all task_ids from the project, filtering out undefined/null values
    const projectTaskIds = project.tasks
      .map((task) => task.task_id)
      .filter((id): id is string => !!id);

    // Check if any task in chatStore with matching task_id has pending status
    return Object.entries(chatStore.tasks).some(
      ([taskId, task]) =>
        projectTaskIds.includes(taskId) &&
        task.status === ChatTaskStatus.PENDING
    );
  }, [chatStore?.tasks, project.tasks]);
  const _hasIssue = hasHumanInLoop;

  // Handler to navigate to project
  const handleProjectClick = async (e: React.MouseEvent) => {
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
      // Project doesn't exist, load final state (no replay animation)
      const firstTask = project.tasks?.[0];
      if (firstTask) {
        const historyId = firstTask.id?.toString() || '';
        const taskPairs = (project.tasks || [])
          .filter((t) => t.task_id)
          .map((t) => ({ taskId: t.task_id!, question: t.question || '' }));
        const taskIdsList = taskPairs.length
          ? taskPairs.map((p) => p.taskId)
          : [project.project_id];
        const questions = taskPairs.length
          ? taskPairs.map((p) => p.question)
          : [project.last_prompt || ''];

        setIsLoadingProject(true);
        try {
          await loadProjectFromHistory(
            projectStore,
            navigate,
            project.project_id,
            questions,
            historyId,
            taskIdsList,
            project.project_name
          );
        } catch (error) {
          console.error('Failed to load project:', error);
        } finally {
          setIsLoadingProject(false);
        }
      } else {
        console.warn('No tasks found in project, cannot load');
        projectStore.setActiveProject(project.project_id);
        navigate('/');
      }
    }
  };

  // Don't render if no tasks match the search
  if (searchValue && filteredTasks.length === 0) {
    return null;
  }

  const _formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInDays = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (diffInDays === 0) return t('layout.today');
    if (diffInDays === 1) return t('layout.yesterday');
    if (diffInDays < 7) return `${diffInDays} ${t('layout.days-ago')}`;

    return date.toLocaleDateString();
  };

  // Calculate agent count (placeholder - count unique agents from tasks if available)
  const _agentCount =
    project.tasks?.length > 0
      ? new Set(project.tasks.map((t) => t.model_type || 'default')).size
      : 0;

  // Trigger count is 0 for now (disabled)
  const _triggerCount = 0;

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
  if (viewMode === 'grid') {
    return (
      <motion.div
        transition={{ duration: 0.2, ease: 'easeOut' }}
        onClick={handleProjectClick}
        className={`relative h-full overflow-hidden rounded-xl border border-solid border-border-disabled bg-project-surface-default backdrop-blur-sm transition-colors hover:bg-project-surface-hover ${isLoadingProject ? 'pointer-events-none cursor-wait opacity-70' : 'cursor-pointer hover:bg-project-surface-hover'}`}
      >
        {isLoadingProject && (
          <div className="bg-white/50 absolute inset-0 z-10 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-icon-primary" />
          </div>
        )}
        {/* Project Card */}
        <div className="flex h-full flex-col">
          {/* Header with menu */}
          <div className="flex min-h-32 items-start justify-between px-6 py-4">
            <div className="flex w-full flex-col gap-2 pr-4">
              <div className="flex w-full flex-row items-center justify-start gap-2">
                {isOngoing ? (
                  <Sparkles className="h-6 w-6 flex-shrink-0 text-icon-information" />
                ) : (
                  <Sparkle className="h-6 w-6 flex-shrink-0 text-icon-secondary" />
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
                content={
                  <p className="max-w-xs break-words">{project.project_name}</p>
                }
                className="pointer-events-auto select-text text-wrap break-words bg-surface-tertiary px-2 text-label-xs shadow-perfect"
              >
                <span className="line-clamp-2 text-body-md font-semibold leading-relaxed text-text-heading">
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
                  className="relative z-10 flex-shrink-0 rounded-md"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-4 w-4 text-icon-primary" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="z-50 border-dropdown-border bg-dropdown-bg"
              >
                {onProjectEdit && (
                  <DropdownMenuItem
                    onClick={handleProjectEdit}
                    className="cursor-pointer bg-dropdown-item-bg-default hover:bg-dropdown-item-bg-hover"
                  >
                    <Edit className="mr-2 h-4 w-4" />
                    {t('layout.edit') || 'Edit'}
                  </DropdownMenuItem>
                )}
                {onProjectDelete && (
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      onProjectDelete(project.project_id);
                    }}
                    className="cursor-pointer bg-dropdown-item-bg-default text-text-cuation hover:bg-dropdown-item-bg-hover"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {t('layout.delete')}
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
            className="flex items-center justify-between border-x-0 border-b-0 border-solid border-border-disabled px-6 py-4"
          >
            <div className="flex w-full flex-row items-center justify-between gap-4">
              {/* Token count */}
              <TooltipSimple content={t('chat.token')}>
                <div className="flex items-center gap-1">
                  <Hash className="h-4 w-4 text-icon-information" />
                  <span className="text-body-sm font-semibold text-text-information">
                    {' '}
                    {t('chat.token')}
                  </span>
                  <span className="text-body-sm font-semibold text-text-information">
                    {project.total_tokens
                      ? project.total_tokens.toLocaleString()
                      : '0'}
                  </span>
                </div>
              </TooltipSimple>

              <div className="flex flex-row items-center justify-end gap-4">
                {/* Task count */}
                <TooltipSimple content="Tasks">
                  <div className="flex items-center gap-1">
                    <Pin className="h-4 w-4 text-icon-secondary" />
                    <span className="text-body-sm font-semibold text-text-body">
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
      className={`hover:perfect-shadow relative overflow-hidden rounded-xl border border-solid border-border-disabled bg-project-surface-default backdrop-blur-sm hover:bg-project-surface-hover ${isLoadingProject ? 'pointer-events-none cursor-wait opacity-70' : 'cursor-pointer'}`}
    >
      {isLoadingProject && (
        <div className="bg-white/50 absolute inset-0 z-10 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-icon-primary" />
        </div>
      )}
      {/* Project */}
      <div className="flex w-full items-center justify-between px-6 py-4">
        {/* Start: Folder icon and project name - Fixed width */}
        <div className="flex w-48 flex-shrink-0 items-center gap-3">
          {isOngoing ? (
            <Sparkles className="h-5 w-5 flex-shrink-0 text-icon-information" />
          ) : (
            <Sparkle className="h-5 w-5 flex-shrink-0 text-icon-secondary" />
          )}
          <TooltipSimple
            content={
              <p className="max-w-xs break-words">{project.project_name}</p>
            }
            className="pointer-events-auto select-text text-wrap break-words bg-surface-tertiary px-2 text-label-xs shadow-perfect"
          >
            <span className="block truncate text-left text-body-md font-semibold text-text-heading">
              {project.project_name}
            </span>
          </TooltipSimple>
        </div>

        {/* Middle: Project, Trigger, Agent tags - Aligned to right */}
        <div className="flex w-fit flex-1 items-center justify-end gap-4">
          <Tag variant="info" size="sm">
            <Hash />
            <span>
              {project.total_tokens
                ? project.total_tokens.toLocaleString()
                : '0'}
            </span>
          </Tag>

          <TooltipSimple content={t('layout.tasks')}>
            <Tag variant="default" size="sm" className="min-w-10">
              <Pin />
              <span>{project.task_count}</span>
            </Tag>
          </TooltipSimple>
        </div>

        {/* End: Status and menu */}
        <div className="ml-4 flex w-fit min-w-32 items-center justify-end gap-2 border border-y-0 border-r-0 border-solid border-border-disabled pl-4">
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
              <Button
                variant="ghost"
                size="icon"
                className="relative z-10 rounded-md"
              >
                <MoreHorizontal className="h-4 w-4 text-icon-primary" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="z-50 border-dropdown-border bg-dropdown-bg"
            >
              {onProjectEdit && (
                <DropdownMenuItem
                  onClick={handleProjectEdit}
                  className="cursor-pointer bg-dropdown-item-bg-default hover:bg-dropdown-item-bg-hover"
                >
                  <Edit className="mr-2 h-4 w-4" />
                  {t('layout.edit') || 'Edit'}
                </DropdownMenuItem>
              )}
              {onProjectDelete && (
                <DropdownMenuItem
                  onClick={() => onProjectDelete(project.project_id)}
                  className="cursor-pointer bg-dropdown-item-bg-default text-text-cuation hover:bg-dropdown-item-bg-hover"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t('layout.delete')}
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
