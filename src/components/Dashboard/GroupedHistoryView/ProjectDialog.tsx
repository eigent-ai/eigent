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
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useProjectStore } from '@/store/projectStore';
import { ProjectGroup } from '@/types/history';
import {
  CheckCircle,
  Clock,
  Hash,
  Loader2,
  LoaderCircle,
  Pin,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TaskItem from './TaskItem';

interface ProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: ProjectGroup;
  onProjectRename: (projectId: string, newName: string) => void;
  onTaskSelect: (
    projectId: string,
    question: string,
    historyId: string,
    project?: ProjectGroup
  ) => void;
  onTaskDelete: (taskId: string) => void;
  onTaskShare: (taskId: string) => void;
  activeTaskId?: string;
}

export default function ProjectDialog({
  open,
  onOpenChange,
  project,
  onProjectRename,
  onTaskSelect,
  onTaskDelete,
  onTaskShare,
  activeTaskId,
}: ProjectDialogProps) {
  const { t } = useTranslation();
  const projectStore = useProjectStore();
  const [projectName, setProjectName] = useState(
    project.project_name || t('layout.new-project')
  );
  const [isSaving, setIsSaving] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedNameRef = useRef<string>(
    project.project_name || t('layout.new-project')
  );

  // Update state when project changes
  useEffect(() => {
    const name = project.project_name || t('layout.new-project');
    // Use setTimeout to defer state update and avoid cascading renders
    setTimeout(() => {
      setProjectName(name);
    }, 0);
    lastSavedNameRef.current = name;
  }, [project.project_name, project.project_id, t]);

  // Auto-save with debouncing
  useEffect(() => {
    // Clear any existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    const trimmedName = projectName.trim();

    // Only save if the name has actually changed and is not empty
    if (trimmedName && trimmedName !== lastSavedNameRef.current) {
      // Use setTimeout to defer state update and avoid cascading renders
      setTimeout(() => {
        setIsSaving(true);
      }, 0);

      // Debounce: wait 800ms after user stops typing
      saveTimeoutRef.current = setTimeout(() => {
        // Update via callback (for history API)
        onProjectRename(project.project_id, trimmedName);

        // Also update in projectStore if the project exists there
        const storeProject = projectStore.getProjectById(project.project_id);
        if (storeProject) {
          projectStore.updateProject(project.project_id, { name: trimmedName });
        }

        lastSavedNameRef.current = trimmedName;
        setIsSaving(false);
      }, 800);
    } else if (!trimmedName) {
      // If empty, don't show saving state
      // Use setTimeout to defer state update and avoid cascading renders
      setTimeout(() => {
        setIsSaving(false);
      }, 0);
    }

    // Cleanup timeout on unmount or when projectName changes
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [projectName, project.project_id, onProjectRename, projectStore]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="md"
        className="flex h-full max-h-[80vh] flex-col"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <DialogHeader
          title={t('layout.project-settings')}
          subtitle={t('layout.manage-project-details')}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />

        <DialogContentSection
          className="scrollbar flex flex-col overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Project Name Section - Inline Edit with Auto-Save */}
          <div
            className="mb-lg gap-sm flex flex-col"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <label className="text-label-sm font-bold text-ds-text-neutral-muted-default">
              {t('layout.project-name')}
            </label>
            <div
              className="gap-sm flex items-center"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <Input
                disabled={true}
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onFocus={(e) => e.stopPropagation()}
                placeholder={t('layout.enter-project-name')}
              />
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin text-ds-icon-brand-default-default flex-shrink-0" />
              ) : (
                <></>
              )}
            </div>
          </div>

          {/* Project Stats */}
          <div className="gap-lg border-ds-border-neutral-muted-disabled pb-md grid grid-cols-4 border-x-0 border-t-0 border-solid">
            <div className="gap-xs flex flex-col">
              <span className="text-label-sm font-normal text-ds-text-neutral-muted-default">
                {t('layout.total-tokens')}
              </span>
              <div className="gap-sm flex flex-row items-center">
                <Hash className="h-4 w-4 text-ds-icon-neutral-default-default" />
                <span className="text-body-lg font-bold text-ds-text-neutral-default-default">
                  {project.total_tokens.toLocaleString()}
                </span>
              </div>
            </div>

            <div className="gap-xs flex flex-col">
              <span className="text-label-sm font-normal text-ds-text-neutral-muted-default">
                {t('layout.total-tasks')}
              </span>
              <div className="gap-sm flex flex-row items-center">
                <Pin className="h-4 w-4 text-ds-icon-neutral-default-default" />
                <span className="text-body-lg font-bold text-ds-text-neutral-default-default">
                  {project.task_count}
                </span>
              </div>
            </div>

            <div className="gap-xs flex flex-col">
              <span className="text-label-sm font-normal text-ds-text-neutral-muted-default">
                {t('layout.completed')}
              </span>
              <div className="gap-sm flex flex-row items-center">
                <CheckCircle className="h-4 w-4 text-ds-icon-status-completed-default-default" />
                <span className="text-body-lg font-bold text-ds-text-neutral-default-default">
                  {project.total_completed_tasks}
                </span>
              </div>
            </div>

            <div className="gap-xs flex flex-col">
              <span className="text-label-sm font-normal text-ds-text-neutral-muted-default">
                {t('layout.ongoing')}
              </span>
              <div className="gap-sm flex flex-row items-center">
                <LoaderCircle className="h-4 w-4 text-ds-icon-status-splitting-default-default" />
                <span className="text-body-lg font-bold text-ds-text-neutral-default-default">
                  {project.total_ongoing_tasks}
                </span>
              </div>
            </div>
          </div>

          {/* Tasks List */}
          <div className="scrollbar mt-4 gap-sm flex h-full flex-col overflow-y-auto">
            <div className="scrollbar gap-sm flex h-full flex-col overflow-y-auto">
              {project.tasks.length > 0 ? (
                project.tasks.map((task, index) => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    isActive={activeTaskId === task.id.toString()}
                    onSelect={() =>
                      onTaskSelect(
                        project.project_id,
                        task.question,
                        task.id.toString(),
                        project
                      )
                    }
                    onDelete={() => onTaskDelete(task.id.toString())}
                    onShare={() => onTaskShare(task.id.toString())}
                    isLast={index === project.tasks.length - 1}
                    showActions={false}
                  />
                ))
              ) : (
                <div className="py-lg text-sm text-ds-text-neutral-muted-default text-center">
                  <Clock className="mb-sm h-8 w-8 text-ds-icon-neutral-muted-default mx-auto opacity-50" />
                  {t('layout.no-tasks-in-project')}
                </div>
              )}
            </div>
          </div>
        </DialogContentSection>

        <DialogFooter
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onOpenChange(false);
            }}
          >
            {t('layout.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
