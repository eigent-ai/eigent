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
// Licensed under the Apache License, Version 2.0 (the "License");

import {
  NavTab,
  SidebarBackHeader,
  SidebarNavGroup,
  SidebarScrollArea,
  SidebarSection,
  SidebarShell,
} from '@/components/Layout/AppSidebar';
import AlertDialog from '@/components/ui/alertDialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { isLegacySpace } from '@/lib/spaceLabel';
import {
  isUnconfiguredPlaceholderSpace,
  useSpaceStore,
  type Space,
} from '@/store/spaceStore';
import { Folder, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import NewSpaceDialog from './NewSpaceDialog';
import { useNewSpaceCreation } from './hooks/useNewSpaceCreation';

interface SpaceDetailSidebarProps {
  selectedSpaceId: string;
  onBack: () => void;
  onSelectSpace: (spaceId: string) => void;
}

function SpaceRowMenu({
  space,
  onRename,
  onDelete,
}: {
  space: Space;
  onRename: (space: Space) => void;
  onDelete: (space: Space) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const moreLabel = t('layout.more-actions');

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          buttonRadius="full"
          buttonContent="icon-only"
          className="no-drag shrink-0 data-[state=open]:bg-ds-neutral-subtle-selected data-[state=open]:hover:bg-ds-neutral-subtle-selected"
          aria-label={`${moreLabel}: ${space.name}`}
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal
            className="size-ds-icon-md text-ds-ink-muted-default"
            aria-hidden
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        onClick={(event) => event.stopPropagation()}
      >
        <DropdownMenuItem className="gap-2" onSelect={() => onRename(space)}>
          <Pencil className="h-4 w-4" aria-hidden />
          {t('layout.spaces-rename-space')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="gap-2 text-ds-text-error-default-default focus:text-ds-text-error-strong-default data-[highlighted]:text-ds-text-error-default-default [&>svg]:text-ds-icon-error-default-default focus:[&>svg]:text-ds-icon-error-default-default data-[highlighted]:[&>svg]:text-ds-icon-error-default-default"
          onSelect={() => onDelete(space)}
        >
          <Trash2
            className="h-4 w-4 text-ds-icon-error-default-default"
            aria-hidden
          />
          {t('layout.delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Detail-mode rail: a single way back plus the selectable Space list. */
export default function SpaceDetailSidebar({
  selectedSpaceId,
  onBack,
  onSelectSpace,
}: SpaceDetailSidebarProps) {
  const { t } = useTranslation();
  const spacesById = useSpaceStore((state) => state.spaces);
  const projectsBySpaceId = useSpaceStore((state) => state.projectsBySpaceId);
  const renameSpaceOnServer = useSpaceStore(
    (state) => state.renameSpaceOnServer
  );
  const deleteSpaceOnServer = useSpaceStore(
    (state) => state.deleteSpaceOnServer
  );
  const [renameTarget, setRenameTarget] = useState<Space | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Space | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [newSpaceDialogOpen, setNewSpaceDialogOpen] = useState(false);
  const { createBlankSpace, createSpaceFromFolder } = useNewSpaceCreation(
    'space_detail_sidebar'
  );
  const spaces = useMemo(
    () =>
      Object.values(spacesById)
        .filter(
          (space) =>
            space.status !== 'archived' &&
            !isUnconfiguredPlaceholderSpace(space, projectsBySpaceId)
        )
        .sort((left, right) => right.updatedAt - left.updatedAt),
    [projectsBySpaceId, spacesById]
  );

  const openRenameDialog = useCallback((space: Space) => {
    setRenameValue(space.name?.trim() || '');
    setRenameTarget(space);
  }, []);

  const handleRename = useCallback(async () => {
    const nextName = renameValue.trim();
    if (!renameTarget || !nextName || renaming) return;
    setRenaming(true);
    try {
      await renameSpaceOnServer(renameTarget.id, nextName);
      toast.success(t('layout.spaces-rename-success'));
      setRenameTarget(null);
    } catch (error) {
      console.warn('[SpaceDetailSidebar] Failed to rename Space:', error);
      toast.error(t('layout.spaces-rename-failed'));
    } finally {
      setRenaming(false);
    }
  }, [renameSpaceOnServer, renameTarget, renameValue, renaming, t]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget || deleting) return;
    const deletedSpaceId = deleteTarget.id;
    setDeleting(true);
    try {
      await deleteSpaceOnServer(deletedSpaceId);
      setDeleteTarget(null);
      if (selectedSpaceId === deletedSpaceId) {
        const state = useSpaceStore.getState();
        const activeCandidate = state.activeSpaceId
          ? state.getSpaceById(state.activeSpaceId)
          : null;
        const nextSpace =
          (activeCandidate &&
          !isUnconfiguredPlaceholderSpace(
            activeCandidate,
            state.projectsBySpaceId
          )
            ? activeCandidate
            : null) ??
          Object.values(state.spaces)
            .filter(
              (space) =>
                space.status !== 'archived' &&
                !isUnconfiguredPlaceholderSpace(space, state.projectsBySpaceId)
            )
            .sort((left, right) => right.updatedAt - left.updatedAt)[0];
        if (nextSpace) {
          onSelectSpace(nextSpace.id);
        } else {
          onBack();
        }
      }
    } catch (error) {
      console.warn('[SpaceDetailSidebar] Failed to delete Space:', error);
      toast.error(
        t('layout.spaces-delete-failed', {
          defaultValue: 'Failed to delete Space',
        })
      );
    } finally {
      setDeleting(false);
    }
  }, [
    deleteSpaceOnServer,
    deleteTarget,
    deleting,
    onBack,
    onSelectSpace,
    selectedSpaceId,
    t,
  ]);

  return (
    <>
      <AlertDialog
        isOpen={Boolean(renameTarget)}
        onClose={() => setRenameTarget(null)}
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
        isOpen={Boolean(deleteTarget)}
        onClose={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        onConfirm={() => void handleDelete()}
        title={t('layout.delete')}
        message={t('layout.delete-space-confirmation', {
          defaultValue:
            'Are you sure you want to delete this space and all its sessions? This action cannot be undone.',
        })}
        confirmText={t('layout.delete')}
        cancelText={t('layout.cancel')}
        confirmDisabled={deleting}
      />

      <SidebarShell
        ariaLabel={t('layout.spaces', { defaultValue: 'Spaces' })}
        className="pt-0"
      >
        <SidebarBackHeader onBack={onBack} />
        <SidebarSection grow="fill">
          <SidebarScrollArea
            role="navigation"
            ariaLabel={t('layout.select-space', {
              defaultValue: 'Select a Space',
            })}
            className="gap-4 pt-1"
          >
            <SidebarNavGroup>
              <NavTab
                active={false}
                onClick={() => setNewSpaceDialogOpen(true)}
                leading={<Plus className="h-4 w-4 shrink-0" aria-hidden />}
                label={t('layout.new-space', { defaultValue: 'New Space' })}
                tooltip={t('layout.new-space', { defaultValue: 'New Space' })}
                tooltipEnabledWhenCollapsed
                ariaLabel={t('layout.new-space', {
                  defaultValue: 'New Space',
                })}
              />
            </SidebarNavGroup>
            <SidebarNavGroup
              label={t('layout.spaces', { defaultValue: 'Spaces' })}
            >
              {spaces.map((space) => {
                const selected = space.id === selectedSpaceId;
                const canManage = !isLegacySpace(space);
                return (
                  <NavTab
                    key={space.id}
                    active={selected}
                    onClick={() => onSelectSpace(space.id)}
                    leading={
                      <Folder className="h-4 w-4 shrink-0" aria-hidden />
                    }
                    label={space.name?.trim() || 'Untitled Space'}
                    layout={canManage ? 'split' : 'simple'}
                    endAction={
                      canManage ? (
                        <SpaceRowMenu
                          space={space}
                          onRename={openRenameDialog}
                          onDelete={setDeleteTarget}
                        />
                      ) : undefined
                    }
                    tooltip={space.name?.trim() || 'Untitled Space'}
                    tooltipEnabledWhenCollapsed
                    ariaLabel={space.name?.trim() || 'Untitled Space'}
                    ariaCurrentPage={selected}
                  />
                );
              })}
            </SidebarNavGroup>
          </SidebarScrollArea>
        </SidebarSection>
      </SidebarShell>

      <NewSpaceDialog
        open={newSpaceDialogOpen}
        onOpenChange={setNewSpaceDialogOpen}
        onStartFromScratch={createBlankSpace}
        onUseLocalFolder={createSpaceFromFolder}
      />
    </>
  );
}
