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

import tokenDarkIcon from '@/assets/token-dark.svg';
import tokenLightIcon from '@/assets/token-light.svg';
import { formatTokenCount } from '@/components/ChatBox/MessageItem/TokenUtils';
import AlertDialog from '@/components/ui/alertDialog';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '@/store/authStore';
import { useSpaceStore } from '@/store/spaceStore';
import { TriggerStatus } from '@/types';
import {
  Folder,
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
import { useHomeHubNavigation } from '../hooks/useHomeHubNavigation';
import { formatCompactCount } from '../utils';
import {
  getSpaceKindLabel,
  HomeHubItemBody,
  HomeHubItemShell,
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
  subtitle,
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

      <HomeHubItemShell onClick={() => openSpace(space.id)} layout={layout}>
        <HomeHubItemBody
          layout={layout}
          headerTag={getSpaceKindLabel(space, t)}
          title={title}
          subtitle={subtitle}
          createdAt={space.createdAt}
          stats={[
            {
              icon: <Folder className="h-3 w-3" />,
              label: String(projectCount),
            },
            {
              icon: <ListChecks className="h-3 w-3" />,
              label: formatCompactCount(taskCount),
            },
            {
              icon: <Zap className="h-3 w-3" />,
              label: formatCompactCount(triggerCount),
            },
          ]}
          menuItems={[
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
              icon: (
                <Trash2 className="h-4 w-4 text-ds-icon-error-default-default" />
              ),
              onSelect: () => setDeleteDialogOpen(true),
              disabled: !canManage,
              destructive: true,
            },
          ]}
        />
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
  const { appearance } = useAuthStore();
  const tokenIcon = appearance === 'dark' ? tokenDarkIcon : tokenLightIcon;
  const { openProject, loadingProjectId } = useHomeHubNavigation();
  const loading = loadingProjectId === project.project_id;
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);

  const title = project.project_name?.trim() || t('layout.new-project');
  const subtitle =
    project.last_prompt?.trim() ||
    t('layout.no-description', { defaultValue: 'No description yet.' });
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
        className="relative"
      >
        {loading ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-ds-icon-neutral-default-default" />
          </div>
        ) : null}
        <HomeHubItemBody
          layout={layout}
          headerTag={spaceLabel}
          title={title}
          subtitle={subtitle}
          createdAt={project.latest_task_date}
          stats={[
            {
              icon: <ListChecks className="h-3 w-3" />,
              label: formatCompactCount(project.task_count),
            },
            {
              icon: <Zap className="h-3 w-3" />,
              label: formatCompactCount(project.total_triggers),
            },
            {
              icon: <img src={tokenIcon} alt="" className="h-3 w-3" />,
              label: formatTokenCount(tokenCount),
            },
          ]}
          menuItems={[
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
              icon: (
                <Trash2 className="h-4 w-4 text-ds-icon-error-default-default" />
              ),
              onSelect: () => onProjectDelete?.(project.project_id),
              disabled: !onProjectDelete,
              destructive: true,
            },
          ]}
        />
      </HomeHubItemShell>
    </>
  );
}

function TaskItemContent({
  task,
  spaceLabel,
  subtitle,
  project,
  onDelete,
  onShare,
  layout,
}: HomeHubTaskItemProps) {
  const { t } = useTranslation();
  const { appearance } = useAuthStore();
  const tokenIcon = appearance === 'dark' ? tokenDarkIcon : tokenLightIcon;
  const { openTask, loadingProjectId } = useHomeHubNavigation();
  const loading = loadingProjectId === task.project_id;
  const title = task.question?.trim() || t('layout.new-project');

  return (
    <HomeHubItemShell
      onClick={() => void openTask(task, project)}
      layout={layout}
      className={loading ? 'relative' : undefined}
    >
      {loading ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-ds-icon-neutral-default-default" />
        </div>
      ) : null}
      <HomeHubItemBody
        layout={layout}
        headerTag={spaceLabel}
        title={title}
        subtitle={subtitle}
        createdAt={task.created_at || task.updated_at}
        stats={[
          {
            icon: <img src={tokenIcon} alt="" className="h-3 w-3" />,
            label: formatTokenCount(task.tokens || 0),
          },
        ]}
        menuItems={[
          {
            label: t('layout.share', { defaultValue: 'Share' }),
            icon: <Share2 className="h-4 w-4" aria-hidden />,
            onSelect: onShare,
          },
          {
            label: t('layout.delete'),
            icon: (
              <Trash2 className="h-4 w-4 text-ds-icon-error-default-default" />
            ),
            onSelect: onDelete,
            destructive: true,
          },
        ]}
      />
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
  const subtitle =
    trigger.task_prompt?.trim() ||
    trigger.description?.trim() ||
    t('triggers.no-task-prompt');

  return (
    <HomeHubItemShell onClick={() => void openTrigger(trigger)} layout={layout}>
      <HomeHubItemBody
        layout={layout}
        headerTag={spaceLabel}
        title={trigger.name}
        subtitle={subtitle}
        createdAt={trigger.created_at || trigger.last_executed_at}
        stats={[{ label: triggerTypeLabel }]}
        menuItems={[
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
            icon: (
              <Trash2 className="h-4 w-4 text-ds-icon-error-default-default" />
            ),
            onSelect: () => onDelete(trigger),
            destructive: true,
          },
        ]}
      />
    </HomeHubItemShell>
  );
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
