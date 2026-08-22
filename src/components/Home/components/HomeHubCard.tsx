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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  getCustomWorkSessionName,
  resolveWorkSessionDisplayName,
} from '@/lib/spaceLabel';
import { iconForTriggerType } from '@/lib/triggerIcon';
import { useSpaceStore } from '@/store/spaceStore';
import { TriggerStatus } from '@/types';
import {
  Folder,
  ListChecks,
  Loader2,
  MessageCircle,
  Pause,
  Pencil,
  Play,
  Power,
  Share2,
  Trash2,
} from 'lucide-react';
import { useCallback, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useHomeHub } from '../context';
import { useHomeHubNavigation } from '../hooks/useHomeHubNavigation';
import { formatCompactCount, formatHubCreatedTime } from '../utils';
import { getWorkSessionCardRuntimeStatus } from '../utils/boardStatus';
import {
  getSpaceKindLabel,
  HomeHubAutomationBoardCardBody,
  HomeHubAutomationCardBody,
  HomeHubItemBody,
  HomeHubItemShell,
  HomeHubSpaceBoardCardBody,
  HomeHubSpaceCardBody,
  HomeHubTaskBoardCardBody,
  HomeHubTaskCardBody,
  HomeHubWorkSessionBoardCardBody,
  HomeHubWorkSessionCardBody,
  resolveWorkSessionTokenCount,
  type HomeHubAutomationItemProps,
  type HomeHubItemKind,
  type HomeHubSpaceItemProps,
  type HomeHubTaskItemProps,
  type HomeHubWorkSessionItemProps,
} from './HomeHubItemShared';

export type HomeHubCardProps = (
  | ({ kind: 'space' } & Omit<HomeHubSpaceItemProps, 'layout'>)
  | ({ kind: 'project' } & Omit<HomeHubWorkSessionItemProps, 'layout'>)
  | ({ kind: 'task' } & Omit<HomeHubTaskItemProps, 'layout'>)
  | ({ kind: 'automation' } & Omit<HomeHubAutomationItemProps, 'layout'>)
) & { kind: HomeHubItemKind };

function SpaceItemContent({
  space,
  subtitle: _subtitle,
  isLegacy,
  projectCount,
  taskCount,
  automationCount,
  layout,
}: HomeHubSpaceItemProps) {
  const { t } = useTranslation();
  const { openSpace, openWorkspace } = useHomeHubNavigation();
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

  const handleOpenWorkspace = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      openWorkspace(space.id);
    },
    [openWorkspace, space.id]
  );

  const openWorkspaceButton =
    layout === 'board' ? null : (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={
          layout === 'list'
            ? 'h-7 cursor-pointer justify-self-end rounded-lg font-medium'
            : 'h-7 cursor-pointer rounded-lg font-medium'
        }
        data-home-space-open-workspace
        data-layout={layout}
        onClick={handleOpenWorkspace}
      >
        Open Workspace
      </Button>
    );

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
            'Are you sure you want to delete this Space and all its Sessions? This action cannot be undone.',
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
          <>
            <HomeHubItemBody
              title={title}
              nameIcon={<Folder className="h-4 w-4" />}
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
                  id: 'automations',
                  content: formatCompactCount(automationCount),
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
            {openWorkspaceButton}
          </>
        ) : layout === 'board' ? (
          <HomeHubSpaceBoardCardBody
            title={title}
            spaceKindLabel={spaceKindLabel}
            projectCount={projectCount}
            taskCount={taskCount}
            automationCount={automationCount}
            status={space.status}
            menuItems={menuItems}
          />
        ) : (
          <>
            <HomeHubSpaceCardBody
              title={title}
              spaceKindLabel={spaceKindLabel}
              projectCount={projectCount}
              taskCount={taskCount}
              automationCount={automationCount}
              status={space.status}
              updatedAt={space.updatedAt}
              menuItems={menuItems}
              footerAction={openWorkspaceButton}
            />
          </>
        )}
      </HomeHubItemShell>
    </>
  );
}

function WorkSessionItemContent({
  project,
  spaceLabel,
  onWorkSessionDelete,
  onWorkSessionRename,
  layout,
}: HomeHubWorkSessionItemProps) {
  const { t } = useTranslation();
  const { chatTasks } = useHomeHub();
  const { openWorkSession, loadingWorkSessionProjectId } =
    useHomeHubNavigation();
  const loading = loadingWorkSessionProjectId === project.project_id;
  const runtimeStatus = getWorkSessionCardRuntimeStatus(project, chatTasks);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);

  const title = resolveWorkSessionDisplayName(
    project.project_name,
    project.project_id,
    t('layout.new-project')
  );
  const tokenCount = resolveWorkSessionTokenCount(project);

  const handleRename = useCallback(async () => {
    const nextName = renameValue.trim();
    if (!nextName || renaming || !onWorkSessionRename) return;
    setRenaming(true);
    try {
      await onWorkSessionRename(project.project_id, nextName);
      setRenameDialogOpen(false);
    } finally {
      setRenaming(false);
    }
  }, [onWorkSessionRename, project.project_id, renameValue, renaming]);

  const menuItems = [
    {
      label: t('layout.rename-project', {
        defaultValue: 'Rename Session',
      }),
      icon: <Pencil className="h-4 w-4" aria-hidden />,
      onSelect: () => {
        setRenameValue(
          getCustomWorkSessionName(project.project_name, project.project_id) ??
            ''
        );
        setRenameDialogOpen(true);
      },
      disabled: !onWorkSessionRename,
    },
    {
      label: t('layout.delete'),
      icon: <Trash2 className="h-4 w-4 text-ds-icon-error-default-default" />,
      onSelect: () => onWorkSessionDelete?.(project.project_id),
      disabled: !onWorkSessionDelete,
      destructive: true,
    },
  ];

  return (
    <>
      <AlertDialog
        isOpen={renameDialogOpen}
        onClose={() => setRenameDialogOpen(false)}
        onConfirm={() => void handleRename()}
        title={t('layout.rename-project', { defaultValue: 'Rename Session' })}
        confirmText={t('layout.save')}
        cancelText={t('layout.cancel')}
        confirmVariant="primary"
        confirmDisabled={!renameValue.trim() || renaming}
      >
        <Input
          autoFocus
          value={renameValue}
          placeholder={t('layout.project-name', {
            defaultValue: 'Session name',
          })}
          onChange={(event) => setRenameValue(event.target.value)}
          onEnter={() => {
            if (renameValue.trim() && !renaming) void handleRename();
          }}
        />
      </AlertDialog>

      <HomeHubItemShell
        onClick={() => void openWorkSession(project)}
        layout={layout}
        kind="project"
        menuItems={menuItems}
        className="relative"
      >
        {loading ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-ds-icon-neutral-default-default" />
          </div>
        ) : null}
        {layout === 'list' ? (
          <HomeHubItemBody
            title={title}
            nameIcon={<MessageCircle className="h-4 w-4" />}
            listCells={[
              { id: 'space', content: spaceLabel || '—' },
              {
                id: 'tasks',
                content: formatCompactCount(project.task_count),
                align: 'right',
              },
              {
                id: 'automations',
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
          <HomeHubWorkSessionBoardCardBody
            title={title}
            taskCount={project.task_count || 0}
            automationCount={project.total_triggers || 0}
            tokenCount={tokenCount}
            spaceLabel={spaceLabel}
            runtimeStatus={runtimeStatus}
            menuItems={menuItems}
          />
        ) : (
          <HomeHubWorkSessionCardBody
            title={title}
            taskCount={project.task_count || 0}
            automationCount={project.total_triggers || 0}
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
  controlAction,
  controlPending,
  onControl,
  layout,
}: HomeHubTaskItemProps) {
  const { t } = useTranslation();
  const { openTask, loadingWorkSessionProjectId } = useHomeHubNavigation();
  const loading = loadingWorkSessionProjectId === task.project_id;
  const title =
    task.question?.trim() ||
    t('layout.sessions-untitled', { defaultValue: 'Untitled run' });
  const workSessionName = resolveWorkSessionDisplayName(
    project?.project_name || task.project_name,
    task.project_id,
    t('layout.new-project')
  );
  const menuItems = [
    ...(controlAction && onControl
      ? [
          {
            label:
              controlAction === 'pause'
                ? t('layout.pause', { defaultValue: 'Pause' })
                : t('layout.resume', { defaultValue: 'Resume' }),
            icon:
              controlAction === 'pause' ? (
                <Pause className="h-4 w-4" aria-hidden />
              ) : (
                <Play className="h-4 w-4" aria-hidden />
              ),
            onSelect: onControl,
            disabled: controlPending,
          },
        ]
      : []),
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
        <div className="absolute inset-0 z-10 flex items-center justify-center">
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
          workSessionName={workSessionName}
          spaceLabel={spaceLabel}
          menuItems={menuItems}
        />
      ) : (
        <HomeHubTaskCardBody
          title={title}
          tokenCount={task.tokens || 0}
          workSessionName={workSessionName}
          spaceLabel={spaceLabel}
          updatedAt={task.created_at || task.updated_at}
          menuItems={menuItems}
        />
      )}
    </HomeHubItemShell>
  );
}

function AutomationItemContent({
  automation,
  spaceLabel,
  automationTypeLabel,
  onEdit,
  onDelete,
  onToggleActive,
  layout,
}: HomeHubAutomationItemProps) {
  const { t } = useTranslation();
  const { openAutomation } = useHomeHubNavigation();
  const isActive = automation.status === TriggerStatus.Active;
  const statusLabel = isActive
    ? t('triggers.status.active')
    : t('triggers.status.inactive');
  const menuItems = [
    {
      label: t('triggers.edit'),
      icon: <Pencil className="h-4 w-4" aria-hidden />,
      onSelect: () => onEdit(automation),
    },
    {
      label: isActive
        ? t('triggers.deactivate', { defaultValue: 'Deactivate' })
        : t('triggers.activate', { defaultValue: 'Activate' }),
      icon: <Power className="h-4 w-4" aria-hidden />,
      onSelect: () => onToggleActive(automation),
    },
    {
      label: t('triggers.delete'),
      icon: <Trash2 className="h-4 w-4 text-ds-icon-error-default-default" />,
      onSelect: () => onDelete(automation),
      destructive: true,
    },
  ];

  const AutomationIcon = iconForTriggerType(automation.trigger_type);

  return (
    <HomeHubItemShell
      onClick={() => void openAutomation(automation)}
      layout={layout}
      kind="automation"
      menuItems={menuItems}
    >
      {layout === 'list' ? (
        <HomeHubItemBody
          title={automation.name}
          nameIcon={<AutomationIcon className="h-4 w-4" />}
          listCells={[
            { id: 'space', content: spaceLabel || '—' },
            { id: 'type', content: automationTypeLabel },
            { id: 'status', content: statusLabel },
            {
              id: 'created',
              content:
                formatHubCreatedTime(
                  automation.created_at || automation.last_executed_at
                ) || '—',
              align: 'right',
              textSize: 'xs',
            },
          ]}
        />
      ) : layout === 'board' ? (
        <HomeHubAutomationBoardCardBody
          title={automation.name}
          automationType={automation.trigger_type}
          automationTypeLabel={automationTypeLabel}
          automationRunCount={automation.execution_count ?? 0}
          spaceLabel={spaceLabel}
          isActive={isActive}
          activeLabel={t('triggers.status.active')}
          inactiveLabel={t('triggers.status.inactive')}
          menuItems={menuItems}
        />
      ) : (
        <HomeHubAutomationCardBody
          title={automation.name}
          automationType={automation.trigger_type}
          automationTypeLabel={automationTypeLabel}
          automationRunCount={automation.execution_count ?? 0}
          spaceLabel={spaceLabel}
          isActive={isActive}
          activeLabel={t('triggers.status.active')}
          inactiveLabel={t('triggers.status.inactive')}
          updatedAt={automation.updated_at || automation.last_executed_at}
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
      return <WorkSessionItemContent {...props} layout="board" />;
    case 'task':
      return <TaskItemContent {...props} layout="board" />;
    case 'automation':
      return <AutomationItemContent {...props} layout="board" />;
    default:
      return null;
  }
}

export default function HomeHubCard(props: HomeHubCardProps) {
  switch (props.kind) {
    case 'space':
      return <SpaceItemContent {...props} layout="card" />;
    case 'project':
      return <WorkSessionItemContent {...props} layout="card" />;
    case 'task':
      return <TaskItemContent {...props} layout="card" />;
    case 'automation':
      return <AutomationItemContent {...props} layout="card" />;
    default:
      return null;
  }
}

export function HomeHubListItem(
  props:
    | ({ kind: 'space' } & Omit<HomeHubSpaceItemProps, 'layout'>)
    | ({ kind: 'project' } & Omit<HomeHubWorkSessionItemProps, 'layout'>)
    | ({ kind: 'task' } & Omit<HomeHubTaskItemProps, 'layout'>)
    | ({ kind: 'automation' } & Omit<HomeHubAutomationItemProps, 'layout'>)
) {
  switch (props.kind) {
    case 'space':
      return <SpaceItemContent {...props} layout="list" />;
    case 'project':
      return <WorkSessionItemContent {...props} layout="list" />;
    case 'task':
      return <TaskItemContent {...props} layout="list" />;
    case 'automation':
      return <AutomationItemContent {...props} layout="list" />;
    default:
      return null;
  }
}
