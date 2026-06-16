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

import AlertDialog from '@/components/ui/alertDialog';
import { Input } from '@/components/ui/input';
import { useSpaceStore } from '@/store/spaceStore';
import { TriggerStatus } from '@/types';
import {
  Folder,
  FolderKanban,
  ListChecks,
  Loader2,
  Pencil,
  Power,
  Share2,
  Trash2,
  Zap,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useHomeHub } from '../context';
import { useHomeHubNavigation } from '../hooks/useHomeHubNavigation';
import { formatCompactCount, formatHubCreatedTime } from '../utils';
import { getProjectCardRuntimeStatus } from '../utils/boardStatus';
import {
  getSpaceKindLabel,
  HomeHubItemBody,
  HomeHubItemShell,
  HomeHubProjectBoardCardBody,
  HomeHubProjectCardBody,
  HomeHubSpaceBoardCardBody,
  HomeHubSpaceCardBody,
  HomeHubTaskBoardCardBody,
  HomeHubTaskCardBody,
  HomeHubTriggerBoardCardBody,
  HomeHubTriggerCardBody,
  resolveProjectTokenCount,
  type HomeHubItemKind,
  type HomeHubProjectItemProps,
  type HomeHubSpaceItemProps,
  type HomeHubTaskItemProps,
  type HomeHubTriggerItemProps,
} from './HomeHubItemShared';

export type HomeHubCardProps = (
  | ({ kind: 'space' } & Omit<HomeHubSpaceItemProps, 'layout'>)
  | ({ kind: 'project' } & Omit<HomeHubProjectItemProps, 'layout'>)
  | ({ kind: 'task' } & Omit<HomeHubTaskItemProps, 'layout'>)
  | ({ kind: 'trigger' } & Omit<HomeHubTriggerItemProps, 'layout'>)
) & { kind: HomeHubItemKind };

function SpaceItemContent({
  space,
  subtitle: _subtitle,
  isLegacy,
  projectCount,
  taskCount,
  triggerCount,
  layout,
}: HomeHubSpaceItemProps) {
  const { t } = useTranslation();
  const { openSpace } = useHomeHubNavigation();
  const renameSpaceOnServer = useSpaceStore((s) => s.renameSpaceOnServer);
  const deleteSpaceOnServer = useSpaceStore((s) => s.deleteSpaceOnServer);

  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const canManage = space.status === 'active' && !isLegacy;
  const title = space.name?.trim() || t('layout.spaces-untitled');
  const spaceKindLabel = getSpaceKindLabel(space, t);

  const handleRename = useCallback(async () => {
    const nextName = renameValue.trim();
    if (!nextName || renaming || !canManage) return;
    setRenaming(true);
    try {
      await renameSpaceOnServer(space.id, nextName);
      toast.success(t('layout.spaces-rename-success'));
      setRenameDialogOpen(false);
    } catch (error) {
      console.warn('[HomeHubCard] Failed to rename Space:', error);
      toast.error(t('layout.spaces-rename-failed'));
    } finally {
      setRenaming(false);
    }
  }, [canManage, renameSpaceOnServer, renameValue, renaming, space.id, t]);

  const handleDelete = useCallback(async () => {
    if (deleting || !canManage) return;
    setDeleting(true);
    try {
      await deleteSpaceOnServer(space.id);
      setDeleteDialogOpen(false);
    } catch (error) {
      console.warn('[HomeHubCard] Failed to delete Space:', error);
      toast.error(
        t('layout.spaces-delete-failed', {
          defaultValue: 'Failed to delete Space',
        })
      );
    } finally {
      setDeleting(false);
    }
  }, [canManage, deleteSpaceOnServer, deleting, space.id, t]);

  const menuItems = [
    {
      label: t('layout.spaces-rename-space'),
      icon: <Pencil className="h-4 w-4" aria-hidden />,
      onSelect: () => {
        setRenameValue(space.name?.trim() || '');
        setRenameDialogOpen(true);
      },
      disabled: !canManage,
    },
    {
      label: t('layout.delete'),
      icon: <Trash2 className="h-4 w-4 text-ds-icon-error-default-default" />,
      onSelect: () => setDeleteDialogOpen(true),
      disabled: !canManage,
      destructive: true,
    },
  ];

  return (
    <>
      <AlertDialog
        isOpen={renameDialogOpen}
        onClose={() => setRenameDialogOpen(false)}
        onConfirm={() => void handleRename()}
        title={t('layout.spaces-rename-title')}
        confirmText={t('layout.save')}
        cancelText={t('layout.cancel')}
        confirmVariant="primary"
        confirmDisabled={!renameValue.trim() || renaming}
      >
        <Input
          autoFocus
          value={renameValue}
          placeholder={t('layout.spaces-rename-placeholder')}
          onChange={(event) => setRenameValue(event.target.value)}
          onEnter={() => {
            if (renameValue.trim() && !renaming) void handleRename();
          }}
        />
      </AlertDialog>

      <AlertDialog
        isOpen={deleteDialogOpen}
        onClose={() => {
          if (deleting) return;
          setDeleteDialogOpen(false);
        }}
        onConfirm={() => void handleDelete()}
        title={t('layout.delete')}
        message={t('layout.delete-space-confirmation', {
          defaultValue:
            'Are you sure you want to delete this Space and all its Projects? This action cannot be undone.',
        })}
        confirmText={t('layout.delete')}
        cancelText={t('layout.cancel')}
        confirmDisabled={deleting}
      />

      <HomeHubItemShell
        onClick={() => openSpace(space.id)}
        layout={layout}
        kind="space"
        menuItems={menuItems}
      >
        {layout === 'list' ? (
          <HomeHubItemBody
            title={title}
            nameIcon={<FolderKanban className="h-4 w-4" />}
            listCells={[
              { id: 'type', content: spaceKindLabel },
              {
                id: 'projects',
                content: String(projectCount),
                align: 'right',
              },
              {
                id: 'tasks',
                content: formatCompactCount(taskCount),
                align: 'right',
              },
              {
                id: 'triggers',
                content: formatCompactCount(triggerCount),
                align: 'right',
              },
              {
                id: 'created',
                content: formatHubCreatedTime(space.createdAt) || '—',
                align: 'right',
                textSize: 'xs',
              },
            ]}
          />
        ) : layout === 'board' ? (
          <HomeHubSpaceBoardCardBody
            title={title}
            spaceKindLabel={spaceKindLabel}
            projectCount={projectCount}
            taskCount={taskCount}
            triggerCount={triggerCount}
            status={space.status}
            menuItems={menuItems}
          />
        ) : (
          <HomeHubSpaceCardBody
            title={title}
            spaceKindLabel={spaceKindLabel}
            projectCount={projectCount}
            taskCount={taskCount}
            triggerCount={triggerCount}
            status={space.status}
            updatedAt={space.updatedAt}
            menuItems={menuItems}
          />
        )}
      </HomeHubItemShell>
    </>
  );
}

function ProjectItemContent({
  project,
  spaceLabel,
  onProjectDelete,
  onProjectRename,
  layout,
}: HomeHubProjectItemProps) {
  const { t } = useTranslation();
  const { chatTasks } = useHomeHub();
  const { openProject, loadingProjectId } = useHomeHubNavigation();
  const loading = loadingProjectId === project.project_id;
  const runtimeStatus = getProjectCardRuntimeStatus(project, chatTasks);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);

  const title = project.project_name?.trim() || t('layout.new-project');
  const tokenCount = resolveProjectTokenCount(project);

  const handleRename = useCallback(async () => {
    const nextName = renameValue.trim();
    if (!nextName || renaming || !onProjectRename) return;
    setRenaming(true);
    try {
      await onProjectRename(project.project_id, nextName);
      setRenameDialogOpen(false);
    } finally {
      setRenaming(false);
    }
  }, [onProjectRename, project.project_id, renameValue, renaming]);

  const menuItems = [
    {
      label: t('layout.rename-project', {
        defaultValue: 'Rename Project',
      }),
      icon: <Pencil className="h-4 w-4" aria-hidden />,
      onSelect: () => {
        setRenameValue(project.project_name?.trim() || '');
        setRenameDialogOpen(true);
      },
      disabled: !onProjectRename,
    },
    {
      label: t('layout.delete'),
      icon: <Trash2 className="h-4 w-4 text-ds-icon-error-default-default" />,
      onSelect: () => onProjectDelete?.(project.project_id),
      disabled: !onProjectDelete,
      destructive: true,
    },
  ];

  return (
    <>
      <AlertDialog
        isOpen={renameDialogOpen}
        onClose={() => setRenameDialogOpen(false)}
        onConfirm={() => void handleRename()}
        title={t('layout.rename-project', { defaultValue: 'Rename Project' })}
        confirmText={t('layout.save')}
        cancelText={t('layout.cancel')}
        confirmVariant="primary"
        confirmDisabled={!renameValue.trim() || renaming}
      >
        <Input
          autoFocus
          value={renameValue}
          placeholder={t('layout.project-name', {
            defaultValue: 'Project name',
          })}
          onChange={(event) => setRenameValue(event.target.value)}
          onEnter={() => {
            if (renameValue.trim() && !renaming) void handleRename();
          }}
        />
      </AlertDialog>

      <HomeHubItemShell
        onClick={() => void openProject(project)}
        layout={layout}
        kind="project"
        menuItems={menuItems}
        className="relative"
      >
        {loading ? (
          <div className="inset-0 absolute z-10 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-ds-icon-neutral-default-default" />
          </div>
        ) : null}
        {layout === 'list' ? (
          <HomeHubItemBody
            title={title}
            nameIcon={<Folder className="h-4 w-4" />}
            listCells={[
              { id: 'space', content: spaceLabel || '—' },
              {
                id: 'tasks',
                content: formatCompactCount(project.task_count),
                align: 'right',
              },
              {
                id: 'triggers',
                content: formatCompactCount(project.total_triggers),
                align: 'right',
              },
              {
                id: 'updated',
                content: formatHubCreatedTime(project.latest_task_date) || '—',
                align: 'right',
                textSize: 'xs',
              },
            ]}
          />
        ) : layout === 'board' ? (
          <HomeHubProjectBoardCardBody
            title={title}
            taskCount={project.task_count || 0}
            triggerCount={project.total_triggers || 0}
            tokenCount={tokenCount}
            spaceLabel={spaceLabel}
            runtimeStatus={runtimeStatus}
            menuItems={menuItems}
          />
        ) : (
          <HomeHubProjectCardBody
            title={title}
            taskCount={project.task_count || 0}
            triggerCount={project.total_triggers || 0}
            tokenCount={tokenCount}
            spaceLabel={spaceLabel}
            runtimeStatus={runtimeStatus}
            updatedAt={project.latest_task_date}
            menuItems={menuItems}
          />
        )}
      </HomeHubItemShell>
    </>
  );
}

function TaskItemContent({
  task,
  spaceLabel,
  project,
  onDelete,
  onShare,
  layout,
}: HomeHubTaskItemProps) {
  const { t } = useTranslation();
  const { openTask, loadingProjectId } = useHomeHubNavigation();
  const loading = loadingProjectId === task.project_id;
  const title = task.question?.trim() || t('layout.new-project');
  const projectName =
    project?.project_name?.trim() || task.project_name?.trim() || '';
  const menuItems = [
    {
      label: t('layout.share', { defaultValue: 'Share' }),
      icon: <Share2 className="h-4 w-4" aria-hidden />,
      onSelect: onShare,
    },
    {
      label: t('layout.delete'),
      icon: <Trash2 className="h-4 w-4 text-ds-icon-error-default-default" />,
      onSelect: onDelete,
      destructive: true,
    },
  ];

  return (
    <HomeHubItemShell
      onClick={() => void openTask(task, project)}
      layout={layout}
      kind="task"
      menuItems={menuItems}
      className={loading ? 'relative' : undefined}
    >
      {loading ? (
        <div className="inset-0 absolute z-10 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-ds-icon-neutral-default-default" />
        </div>
      ) : null}
      {layout === 'list' ? (
        <HomeHubItemBody
          title={title}
          nameIcon={<ListChecks className="h-4 w-4" />}
          listCells={[
            { id: 'space', content: spaceLabel || '—' },
            {
              id: 'created',
              content:
                formatHubCreatedTime(task.created_at || task.updated_at) || '—',
              align: 'right',
              textSize: 'xs',
            },
          ]}
        />
      ) : layout === 'board' ? (
        <HomeHubTaskBoardCardBody
          title={title}
          tokenCount={task.tokens || 0}
          projectName={projectName}
          spaceLabel={spaceLabel}
          menuItems={menuItems}
        />
      ) : (
        <HomeHubTaskCardBody
          title={title}
          tokenCount={task.tokens || 0}
          projectName={projectName}
          spaceLabel={spaceLabel}
          updatedAt={task.created_at || task.updated_at}
          menuItems={menuItems}
        />
      )}
    </HomeHubItemShell>
  );
}

function TriggerItemContent({
  trigger,
  spaceLabel,
  triggerTypeLabel,
  onEdit,
  onDelete,
  onToggleActive,
  layout,
}: HomeHubTriggerItemProps) {
  const { t } = useTranslation();
  const { openTrigger } = useHomeHubNavigation();
  const isActive = trigger.status === TriggerStatus.Active;
  const statusLabel = isActive
    ? t('triggers.status.active')
    : t('triggers.status.inactive');
  const menuItems = [
    {
      label: t('triggers.edit'),
      icon: <Pencil className="h-4 w-4" aria-hidden />,
      onSelect: () => onEdit(trigger),
    },
    {
      label: isActive
        ? t('triggers.deactivate', { defaultValue: 'Deactivate' })
        : t('triggers.activate', { defaultValue: 'Activate' }),
      icon: <Power className="h-4 w-4" aria-hidden />,
      onSelect: () => onToggleActive(trigger),
    },
    {
      label: t('triggers.delete'),
      icon: <Trash2 className="h-4 w-4 text-ds-icon-error-default-default" />,
      onSelect: () => onDelete(trigger),
      destructive: true,
    },
  ];

  return (
    <HomeHubItemShell
      onClick={() => void openTrigger(trigger)}
      layout={layout}
      kind="trigger"
      menuItems={menuItems}
    >
      {layout === 'list' ? (
        <HomeHubItemBody
          title={trigger.name}
          nameIcon={<Zap className="h-4 w-4" />}
          listCells={[
            { id: 'space', content: spaceLabel || '—' },
            { id: 'type', content: triggerTypeLabel },
            { id: 'status', content: statusLabel },
            {
              id: 'created',
              content:
                formatHubCreatedTime(
                  trigger.created_at || trigger.last_executed_at
                ) || '—',
              align: 'right',
              textSize: 'xs',
            },
          ]}
        />
      ) : layout === 'board' ? (
        <HomeHubTriggerBoardCardBody
          title={trigger.name}
          triggerTypeLabel={triggerTypeLabel}
          executionCount={trigger.execution_count ?? 0}
          spaceLabel={spaceLabel}
          isActive={isActive}
          activeLabel={t('triggers.status.active')}
          inactiveLabel={t('triggers.status.inactive')}
          menuItems={menuItems}
        />
      ) : (
        <HomeHubTriggerCardBody
          title={trigger.name}
          triggerTypeLabel={triggerTypeLabel}
          executionCount={trigger.execution_count ?? 0}
          spaceLabel={spaceLabel}
          isActive={isActive}
          activeLabel={t('triggers.status.active')}
          inactiveLabel={t('triggers.status.inactive')}
          updatedAt={trigger.updated_at || trigger.last_executed_at}
          menuItems={menuItems}
        />
      )}
    </HomeHubItemShell>
  );
}

export function HomeHubBoardCard(props: HomeHubCardProps) {
  switch (props.kind) {
    case 'space':
      return <SpaceItemContent {...props} layout="board" />;
    case 'project':
      return <ProjectItemContent {...props} layout="board" />;
    case 'task':
      return <TaskItemContent {...props} layout="board" />;
    case 'trigger':
      return <TriggerItemContent {...props} layout="board" />;
    default:
      return null;
  }
}

export default function HomeHubCard(props: HomeHubCardProps) {
  switch (props.kind) {
    case 'space':
      return <SpaceItemContent {...props} layout="card" />;
    case 'project':
      return <ProjectItemContent {...props} layout="card" />;
    case 'task':
      return <TaskItemContent {...props} layout="card" />;
    case 'trigger':
      return <TriggerItemContent {...props} layout="card" />;
    default:
      return null;
  }
}

export function HomeHubListItem(
  props:
    | ({ kind: 'space' } & Omit<HomeHubSpaceItemProps, 'layout'>)
    | ({ kind: 'project' } & Omit<HomeHubProjectItemProps, 'layout'>)
    | ({ kind: 'task' } & Omit<HomeHubTaskItemProps, 'layout'>)
    | ({ kind: 'trigger' } & Omit<HomeHubTriggerItemProps, 'layout'>)
) {
  switch (props.kind) {
    case 'space':
      return <SpaceItemContent {...props} layout="list" />;
    case 'project':
      return <ProjectItemContent {...props} layout="list" />;
    case 'task':
      return <TaskItemContent {...props} layout="list" />;
    case 'trigger':
      return <TriggerItemContent {...props} layout="list" />;
    default:
      return null;
  }
}
