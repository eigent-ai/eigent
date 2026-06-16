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

import tokenDarkIcon from '@/assets/custom/token-dark.svg';
import tokenLightIcon from '@/assets/custom/token-light.svg';
import { formatTokenCount } from '@/components/ChatBox/MessageItem/TokenUtils';
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
import {
  buildTaskQuestionsById,
  computeProjectFreshnessAnchor,
  loadProjectFromHistory,
} from '@/lib/replay';
import { useAuthStore } from '@/store/authStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { ChatTaskStatus } from '@/types/constants';
import { ProjectGroup as ProjectGroupType } from '@/types/history';
import { motion } from 'framer-motion';
import {
  FolderCheck,
  FolderClock,
  ListChecks,
  Loader2,
  MoreHorizontal,
  Trash2,
  Zap,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import ProjectDialog from './ProjectDialog';

const compactCountFormatter = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const formatCompactCount = (value?: number) =>
  compactCountFormatter.format(value || 0).replace('.0', '');

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

const resolveProjectTokenCount = (project: ProjectGroupType): number => {
  const direct = toFiniteNumber(project.total_tokens as unknown);
  if (direct !== null) {
    return direct;
  }

  // Fallback for inconsistent payloads where project-level total is missing/invalid.
  return (project.tasks || []).reduce(
    (sum, task) =>
      sum + (toFiniteNumber((task as { tokens?: unknown }).tokens) ?? 0),
    0
  );
};

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
  onProjectEdit: _onProjectEdit,
  onProjectDelete,
  onProjectRename,
  viewMode = 'grid',
}: ProjectGroupProps) {
  const { t } = useTranslation();
  const { appearance } = useAuthStore();
  const navigate = useNavigate();
  const projectStore = useProjectRuntimeStore();
  const { chatStore } = useChatStoreAdapter();
  const tokenIcon = appearance === 'dark' ? tokenDarkIcon : tokenLightIcon;
  const totalTokenCount = resolveProjectTokenCount(project);
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
        const question = firstTask.question || project.last_prompt || '';
        const historyId = firstTask.id?.toString() || '';
        const taskIdsList = project.tasks
          ?.map((t) => t.task_id)
          .filter(Boolean) || [project.project_id];

        setIsLoadingProject(true);
        try {
          await loadProjectFromHistory(
            projectStore,
            navigate,
            project.project_id,
            question,
            historyId,
            taskIdsList,
            project.project_name,
            project.space_id,
            buildTaskQuestionsById(project.tasks),
            computeProjectFreshnessAnchor(project)
          );
        } catch (error) {
          console.error('Failed to load project:', error);
        } finally {
          setIsLoadingProject(false);
        }
      } else {
        // No tasks to replay - project has triggers but no tasks
        // Create an empty project with this ID and navigate to it
        projectStore.createProject(
          project.project_name || 'Project',
          'Project with triggers',
          project.project_id
        );
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
  // const _triggerCount = 0;

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
        className={`relative h-full overflow-hidden rounded-xl border border-solid border-transparent bg-ds-bg-neutral-default-default backdrop-blur-sm transition-colors duration-200 ease-in-out hover:border-ds-border-neutral-subtle-default hover:bg-ds-bg-neutral-default-hover ${isLoadingProject ? 'pointer-events-none cursor-wait opacity-70' : 'cursor-pointer'}`}
      >
        {isLoadingProject && (
          <div className="bg-white/50 absolute inset-0 z-10 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-ds-icon-neutral-default-default" />
          </div>
        )}
        {/* Project Card */}
        <div className="flex h-full flex-col">
          {/* Header with menu */}
          <div className="flex min-h-32 items-start justify-between px-6 py-4">
            <div className="flex w-full flex-col gap-2 pr-4">
              <div className="flex w-full flex-row items-center justify-start gap-2">
                {isOngoing ? (
                  <FolderClock className="h-6 w-6 flex-shrink-0 text-ds-icon-status-running-default-default" />
                ) : (
                  <FolderCheck className="h-6 w-6 flex-shrink-0 text-ds-icon-neutral-subtle-default" />
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
                      <Tag variant="primary" tone="information" size="xs">
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
                      <Tag variant="primary" tone="warning" size="xs">
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
                className="pointer-events-auto select-text text-wrap break-words bg-ds-bg-neutral-strong-default px-2 text-label-xs shadow-perfect"
              >
                <span className="line-clamp-2 text-body-md font-semibold leading-relaxed text-ds-text-neutral-default-default">
                  {project.project_name}
                </span>
              </TooltipSimple>
            </div>

            {/* Menu button */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="xs"
                  buttonContent="icon-only"
                  className="relative z-10 flex-shrink-0 rounded-md"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-4 w-4 text-ds-icon-neutral-default-default" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="z-50 border-ds-border-neutral-default-default bg-ds-bg-neutral-strong-default"
              >
                {onProjectDelete && (
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      onProjectDelete(project.project_id);
                    }}
                    className="cursor-pointer bg-ds-bg-neutral-subtle-default text-ds-text-error-default-default hover:bg-ds-bg-neutral-subtle-hover hover:text-ds-text-error-default-default focus:text-ds-text-error-default-default data-[highlighted]:text-ds-text-error-default-default [&>svg]:text-ds-icon-error-default-default hover:[&>svg]:text-ds-icon-error-default-default focus:[&>svg]:text-ds-icon-error-default-default data-[highlighted]:[&>svg]:text-ds-icon-error-default-default"
                  >
                    <Trash2 className="mr-2 h-4 w-4 text-ds-icon-error-default-default" />
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
            className="flex items-center justify-between border-x-0 border-b-0 border-solid border-ds-border-neutral-muted-disabled px-6 py-4"
          >
            <div className="flex w-full flex-row items-center justify-end gap-4">
              <TooltipSimple content={t('chat.token')}>
                <Tag
                  variant="primary"
                  tone="information"
                  emphasis="default"
                  size="xs"
                  className="gap-1.5"
                >
                  <img src={tokenIcon} alt="" className="h-4 w-4" />
                  <span className="text-label-xs">
                    {formatTokenCount(totalTokenCount)}
                  </span>
                </Tag>
              </TooltipSimple>
              <TooltipSimple content={t('layout.tasks')}>
                <Tag
                  variant="primary"
                  tone="success"
                  emphasis="default"
                  size="xs"
                  className="min-w-10 gap-1.5"
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
                  className="min-w-10 gap-1.5"
                >
                  <Zap className="h-3 w-3" />
                  <span className="text-label-xs">
                    {formatCompactCount(project.total_triggers)}
                  </span>
                </Tag>
              </TooltipSimple>
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
      className={`hover:perfect-shadow relative overflow-hidden rounded-xl border border-solid border-transparent bg-ds-bg-neutral-default-default backdrop-blur-sm transition-colors duration-200 ease-in-out hover:border-ds-border-neutral-subtle-default hover:bg-ds-bg-neutral-default-hover ${isLoadingProject ? 'pointer-events-none cursor-wait opacity-70' : 'cursor-pointer'}`}
    >
      {isLoadingProject && (
        <div className="bg-white/50 absolute inset-0 z-10 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-ds-icon-neutral-default-default" />
        </div>
      )}
      {/* Project */}
      <div className="flex w-full items-center justify-between px-6 py-4">
        {/* Start: Folder icon and project name - Fixed width */}
        <div className="flex w-48 flex-shrink-0 items-center gap-3">
          {isOngoing ? (
            <FolderClock className="h-5 w-5 flex-shrink-0 text-ds-icon-status-running-default-default" />
          ) : (
            <FolderCheck className="h-5 w-5 flex-shrink-0 text-ds-icon-neutral-subtle-default" />
          )}
          <TooltipSimple
            content={
              <p className="max-w-xs break-words">{project.project_name}</p>
            }
            className="pointer-events-auto select-text text-wrap break-words bg-ds-bg-neutral-strong-default px-2 text-label-xs shadow-perfect"
          >
            <span className="block truncate text-left text-body-md font-semibold text-ds-text-neutral-default-default">
              {project.project_name}
            </span>
          </TooltipSimple>
        </div>

        {/* Middle: Project, Trigger, Agent tags - Aligned to right */}
        <div className="flex w-fit flex-1 items-center justify-end gap-2">
          <Tag
            variant="primary"
            tone="information"
            emphasis="default"
            size="xs"
            className="gap-1.5"
          >
            <img src={tokenIcon} alt="" className="h-4 w-4" />
            <span className="text-label-xs">
              {formatTokenCount(totalTokenCount)}
            </span>
          </Tag>

          <TooltipSimple content={t('layout.tasks')}>
            <Tag
              variant="primary"
              tone="success"
              emphasis="default"
              size="xs"
              className="min-w-10 gap-1.5"
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
              className="min-w-10 gap-1.5"
            >
              <Zap className="h-3 w-3" />
              <span className="text-label-xs">
                {formatCompactCount(project.total_triggers)}
              </span>
            </Tag>
          </TooltipSimple>
        </div>

        {/* End: Status and menu */}
        <div className="ml-4 flex w-fit min-w-32 items-center justify-end gap-2 border border-y-0 border-r-0 border-solid border-ds-border-neutral-muted-disabled pl-4">
          {/* Status tag */}
          {/* {isOngoing && (
            <Tag variant="primary" tone="information" size="sm">
              <Activity />
              {t("layout.ongoing")}
            </Tag>
          )} */}

          {/* {!isOngoing && hasIssue && (
            <Tag variant="primary" tone="warning" size="sm">
              {t("layout.issue") || "Issue"}
            </Tag>
          )} */}

          {/* Menu button */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="xs"
                buttonContent="icon-only"
                className="relative z-10 rounded-md"
              >
                <MoreHorizontal className="h-4 w-4 text-ds-icon-neutral-default-default" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="z-50 border-ds-border-neutral-default-default bg-ds-bg-neutral-strong-default"
            >
              {onProjectDelete && (
                <DropdownMenuItem
                  onClick={() => onProjectDelete(project.project_id)}
                  className="cursor-pointer bg-ds-bg-neutral-subtle-default text-ds-text-error-default-default hover:bg-ds-bg-neutral-subtle-hover hover:text-ds-text-error-default-default focus:text-ds-text-error-default-default data-[highlighted]:text-ds-text-error-default-default [&>svg]:text-ds-icon-error-default-default hover:[&>svg]:text-ds-icon-error-default-default focus:[&>svg]:text-ds-icon-error-default-default data-[highlighted]:[&>svg]:text-ds-icon-error-default-default"
                >
                  <Trash2 className="h-4 w-4 text-ds-icon-error-default-default" />
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
