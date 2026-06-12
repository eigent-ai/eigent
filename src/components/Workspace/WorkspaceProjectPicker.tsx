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

import { SpaceSwitchDropdown } from '@/components/ProjectPageSidebar/SpaceSwitchDropdown';
import AlertDialog from '@/components/ui/alertDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useHost } from '@/host';
import {
  createSpaceFromFolderPicker,
  getFolderSpaceErrorMessage,
} from '@/lib/createSpaceFromFolder';
import { ensureScratchSpaceWorkspaceBinding } from '@/lib/scratchSpaceWorkspace';
import {
  getActiveSpaceTriggerLabel,
  getDefaultNewSpaceName,
  isLocalWorkspaceSpace,
} from '@/lib/spaceLabel';
import { resolveServerBackedSpaceId } from '@/lib/spaceProject';
import { cn } from '@/lib/utils';
import {
  proxyApplySpaceProjectRun,
  proxyDiscardSpaceProjectOverlays,
  proxyFetchSpaceProjectOverlays,
  type SpaceOverlay,
} from '@/service/spaceApi';
import { useAuthStore } from '@/store/authStore';
import { usePageTabStore } from '@/store/pageTabStore';
import {
  getVisibleProjectMetasForSpace,
  isDisposableBlankSpace,
  useSpaceStore,
} from '@/store/spaceStore';
import { ChatTaskStatus } from '@/types/constants';
import { ChevronsUpDown, FolderIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

/** Shared chrome so read-only and dropdown trigger stay the same height (Button md = 32px). */
const PROJECT_PICKER_SHELL_CLASS =
  'bg-ds-bg-neutral-subtle-default shadow-workspace-project-picker box-border inline-flex h-8 min-h-8 w-fit min-w-[180px] max-w-[300px] items-center gap-2 rounded-full px-3 py-0 font-semibold';

export interface WorkspaceProjectPickerProps {
  /** Display-only: render the current project name without the dropdown. */
  readOnly?: boolean;
}

/**
 * Space switcher for the workspace landing. Project switching lives in the
 * left sidebar; this control only creates/switches Spaces and exposes current
 * Project workdir actions.
 */
export function WorkspaceProjectPicker({
  readOnly = false,
}: WorkspaceProjectPickerProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const host = useHost();
  const email = useAuthStore((s) => s.email);
  const userId = useAuthStore((s) => s.user_id);
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId);
  const spacesById = useSpaceStore((s) => s.spaces);
  const projectsBySpaceId = useSpaceStore((s) => s.projectsBySpaceId);
  const setActiveSpace = useSpaceStore((s) => s.setActiveSpace);
  const createSpaceOnServer = useSpaceStore((s) => s.createSpaceOnServer);
  const renameSpaceOnServer = useSpaceStore((s) => s.renameSpaceOnServer);
  const refreshProjectOnServer = useSpaceStore((s) => s.refreshProjectOnServer);
  const { projectStore } = useChatStoreAdapter();
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);

  const [menuOpen, setMenuOpen] = useState(false);
  const [switchingSpaceId, setSwitchingSpaceId] = useState<string | null>(null);
  const [pendingOverlays, setPendingOverlays] = useState<SpaceOverlay[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingLoadFailed, setPendingLoadFailed] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    'apply' | 'discard' | 'refresh' | null
  >(null);
  const [applyProgress, setApplyProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [applyIssueDialog, setApplyIssueDialog] = useState<{
    title: string;
    message: string;
  } | null>(null);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renamingSpace, setRenamingSpace] = useState(false);

  const activeProjectId = projectStore.activeProjectId;
  const activeProject = activeProjectId
    ? projectStore.getProjectById(activeProjectId)
    : null;
  const activeProjectChatStore = activeProjectId
    ? projectStore.peekActiveChatStore(activeProjectId)
    : null;
  const activeProjectChatState = activeProjectChatStore?.getState();
  const activeProjectTask =
    activeProjectChatState?.activeTaskId &&
    activeProjectChatState.tasks[activeProjectChatState.activeTaskId]
      ? activeProjectChatState.tasks[activeProjectChatState.activeTaskId]
      : null;
  const activeProjectRunActive = Boolean(
    activeProjectTask &&
    (activeProjectTask.status === ChatTaskStatus.RUNNING ||
      activeProjectTask.isPending)
  );
  const activeProjectMeta = useSpaceStore((s) =>
    activeProjectId ? s.getProjectMeta(activeProjectId) : null
  );
  const activeProjectSpaceId =
    activeProjectMeta?.spaceId ||
    activeProject?.spaceId ||
    activeSpaceId ||
    null;
  const activeProjectSpace = activeProjectSpaceId
    ? spacesById[activeProjectSpaceId]
    : null;
  const activeProjectWorkdirMode =
    activeProjectMeta?.workdirMode || activeProject?.workdirMode || null;
  const activeProjectDirectWrite =
    activeProjectWorkdirMode === 'direct-write' ||
    (!activeProjectWorkdirMode && isLocalWorkspaceSpace(activeProjectSpace));
  const activeProjectServerBacked = Boolean(
    activeProjectMeta?.metadata?.serverSynced ||
    activeProjectMeta?.metadata?.historyId ||
    activeProject?.metadata?.serverSynced ||
    activeProject?.metadata?.historyId
  );
  const activeSpace = activeSpaceId ? spacesById[activeSpaceId] : null;
  const canRenameActiveSpace = Boolean(
    activeSpace &&
    activeSpace.status === 'active' &&
    activeSpace.sourceType !== 'legacy' &&
    activeSpace.metadata?.legacy !== true
  );
  const activeSpaces = useMemo(
    () =>
      Object.values(spacesById)
        .filter(
          (space) =>
            space.status !== 'archived' &&
            !(
              space.id === 'legacy_local' &&
              activeSpaceId !== 'legacy_local' &&
              getVisibleProjectMetasForSpace(projectsBySpaceId, space.id)
                .length === 0
            ) &&
            (space.id === activeSpaceId ||
              !isDisposableBlankSpace(space, projectsBySpaceId))
        )
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [activeSpaceId, projectsBySpaceId, spacesById]
  );

  const loadPendingOverlays = useCallback(async () => {
    if (
      !activeProjectSpaceId ||
      !activeProjectId ||
      !activeProjectServerBacked ||
      activeProjectSpaceId.startsWith('legacy_') ||
      !activeProjectSpace ||
      activeProjectDirectWrite
    ) {
      setPendingOverlays([]);
      setPendingLoadFailed(false);
      setPendingLoading(false);
      return;
    }
    setPendingLoading(true);
    try {
      const response = await proxyFetchSpaceProjectOverlays(
        activeProjectSpaceId,
        activeProjectId
      );
      setPendingOverlays(response.overlays);
      setPendingLoadFailed(false);
    } catch (error) {
      console.warn(
        '[WorkspaceProjectPicker] Failed to load pending changes:',
        error
      );
      setPendingLoadFailed(true);
    } finally {
      setPendingLoading(false);
    }
  }, [
    activeProjectDirectWrite,
    activeProjectId,
    activeProjectServerBacked,
    activeProjectSpace,
    activeProjectSpaceId,
  ]);

  useEffect(() => {
    void loadPendingOverlays();
  }, [loadPendingOverlays]);

  useEffect(() => {
    if (menuOpen) {
      void loadPendingOverlays();
    }
  }, [loadPendingOverlays, menuOpen]);

  const activeSpaceTitle = useMemo(
    () =>
      getActiveSpaceTriggerLabel(activeSpace?.name, t, {
        emptyLabelKey: activeSpaceId
          ? 'layout.spaces-untitled'
          : 'layout.spaces-select-space',
      }),
    [activeSpace, activeSpaceId, t]
  );

  const activateSpace = useCallback(
    async (spaceId: string) => {
      setSwitchingSpaceId(spaceId);
      try {
        const resolvedSpaceId = await resolveServerBackedSpaceId(
          projectStore,
          spaceId
        );
        const spaceStore = useSpaceStore.getState();
        if (
          resolvedSpaceId.startsWith('legacy_') ||
          spaceStore.shouldSyncProjects(resolvedSpaceId)
        ) {
          await spaceStore.syncProjectsFromServer(resolvedSpaceId);
        }
        const projectsInSpace = useSpaceStore
          .getState()
          .getProjectsForSpace(resolvedSpaceId);
        if (projectsInSpace.length > 0) {
          setActiveSpace(resolvedSpaceId);
          const nextProject = projectsInSpace[0];
          projectStore.setActiveProject(nextProject.id);
        } else {
          setActiveSpace(resolvedSpaceId);
          projectStore.setActiveProject(null);
        }
        navigate('/');
        setMenuOpen(false);
      } catch (error) {
        console.warn('[WorkspaceProjectPicker] Failed to switch Space:', error);
        toast.error(t('layout.spaces-create-failed'));
      } finally {
        setSwitchingSpaceId(null);
      }
    },
    [navigate, projectStore, setActiveSpace, t]
  );

  const handleNewSpace = useCallback(async () => {
    try {
      const spaceId = await createSpaceOnServer({
        name: getDefaultNewSpaceName(t),
        sourceType: 'blank',
        setActive: false,
        metadata: {
          createdFrom: 'workspace_space_picker',
          autoCreatedPlaceholder: true,
        },
      });
      await ensureScratchSpaceWorkspaceBinding({
        email,
        userId,
        space: useSpaceStore.getState().getSpaceById(spaceId),
      });
      setActiveSpace(spaceId);
      projectStore.setActiveProject(null);
      navigate('/');
      setMenuOpen(false);
    } catch (error) {
      console.error('Failed to create Space:', error);
      toast.error(t('layout.spaces-create-failed'));
    }
  }, [
    createSpaceOnServer,
    email,
    navigate,
    projectStore,
    setActiveSpace,
    t,
    userId,
  ]);

  const openRenameDialog = () => {
    if (!canRenameActiveSpace || !activeSpace) return;
    setRenameValue(activeSpace.name?.trim() || '');
    setMenuOpen(false);
    setRenameDialogOpen(true);
  };

  const handleRenameSpace = async () => {
    const nextName = renameValue.trim();
    if (!activeSpaceId || !nextName || renamingSpace) return;
    setRenamingSpace(true);
    try {
      await renameSpaceOnServer(activeSpaceId, nextName);
      toast.success(t('layout.spaces-rename-success'));
    } catch (error) {
      console.warn('[WorkspaceProjectPicker] Failed to rename Space:', error);
      toast.error(t('layout.spaces-rename-failed'));
    } finally {
      setRenamingSpace(false);
    }
  };

  const pendingRunIds = useMemo(
    () => Array.from(new Set(pendingOverlays.map((overlay) => overlay.run_id))),
    [pendingOverlays]
  );

  const pendingPathSummary = (paths: string[]) => {
    const maxVisiblePaths = 8;
    const visible = paths.slice(0, maxVisiblePaths).join(', ');
    const rest = paths.length - maxVisiblePaths;
    if (rest <= 0) return visible;
    return `${visible} ${t('layout.workspace-path-summary-more', {
      count: rest,
    })}`;
  };

  const handleApplyPending = async () => {
    if (
      !activeProjectSpaceId ||
      !activeProjectId ||
      pendingRunIds.length === 0
    ) {
      return;
    }
    setPendingAction('apply');
    setApplyProgress({ current: 0, total: pendingRunIds.length });
    try {
      const conflictPaths: string[] = [];
      const failedPaths: string[] = [];
      const failedRuns: string[] = [];
      let appliedCount = 0;

      for (const [index, runId] of pendingRunIds.entries()) {
        setApplyProgress({ current: index + 1, total: pendingRunIds.length });
        try {
          const response = await proxyApplySpaceProjectRun(
            activeProjectSpaceId,
            activeProjectId,
            {
              run_id: runId,
            }
          );
          appliedCount += response.applied.length;
          conflictPaths.push(
            ...response.conflicts.map(
              (conflict) => `${runId}: ${conflict.path}`
            )
          );
          failedPaths.push(
            ...response.failed.map((failure) => `${runId}: ${failure.path}`)
          );
          if (response.conflicts.length === 0 && response.failed.length === 0) {
            setPendingOverlays((current) =>
              current.filter((overlay) => overlay.run_id !== runId)
            );
          }
          if (response.conflicts.length > 0) {
            break;
          }
        } catch (error) {
          console.warn(
            `[WorkspaceProjectPicker] Failed to apply pending run ${runId}:`,
            error
          );
          failedRuns.push(runId);
        }
      }

      if (conflictPaths.length > 0) {
        setApplyIssueDialog({
          title: t('layout.workspace-apply-conflict-title'),
          message: t('layout.workspace-apply-conflict-message', {
            count: conflictPaths.length,
            paths: pendingPathSummary(conflictPaths),
          }),
        });
      } else if (failedPaths.length > 0 || failedRuns.length > 0) {
        const failedCount = failedPaths.length + failedRuns.length;
        setApplyIssueDialog({
          title: t('layout.workspace-apply-partial-title'),
          message: t('layout.workspace-apply-partial-message', {
            count: failedCount,
            paths: pendingPathSummary([...failedPaths, ...failedRuns]),
          }),
        });
      } else {
        toast.success(
          t('layout.workspace-pending-applied-with-count', {
            count: appliedCount,
          })
        );
      }
      await loadPendingOverlays();
    } finally {
      setApplyProgress(null);
      setPendingAction(null);
    }
  };

  const executeDiscardPending = async () => {
    if (!activeProjectSpaceId || !activeProjectId) return;
    setPendingAction('discard');
    try {
      const response = await proxyDiscardSpaceProjectOverlays(
        activeProjectSpaceId,
        activeProjectId,
        {
          // Empty payload intentionally means "discard all pending overlays".
        }
      );
      toast.success(
        t('layout.workspace-discarded-pending', {
          count: response.discarded,
        })
      );
      await loadPendingOverlays();
    } catch (error) {
      console.warn(
        '[WorkspaceProjectPicker] Failed to discard pending changes:',
        error
      );
      toast.error(t('layout.workspace-discard-failed'));
    } finally {
      setPendingAction(null);
    }
  };

  const handleDiscardPending = () => {
    if (
      !activeProjectSpaceId ||
      !activeProjectId ||
      pendingOverlays.length === 0
    ) {
      return;
    }
    setMenuOpen(false);
    setDiscardConfirmOpen(true);
  };

  const getErrorCode = (error: unknown) => {
    const err = error as {
      response?: { data?: { detail?: unknown } };
      detail?: unknown;
    };
    const detail = err.response?.data?.detail ?? err.detail;
    if (typeof detail === 'object' && detail !== null) {
      return String((detail as { code?: unknown }).code || '');
    }
    return '';
  };

  const handleRefreshWorkdir = async () => {
    if (!activeProjectSpaceId || !activeProjectId) return;
    if (activeProjectRunActive) {
      toast.error(t('layout.workspace-refresh-failed'));
      return;
    }
    setPendingAction('refresh');
    try {
      await refreshProjectOnServer(activeProjectSpaceId, activeProjectId);
      toast.success(t('layout.workspace-refresh-success'));
      await loadPendingOverlays();
    } catch (error) {
      console.warn(
        '[WorkspaceProjectPicker] Failed to refresh project workdir:',
        error
      );
      const code = getErrorCode(error);
      toast.error(
        code === 'pending_overlays'
          ? t('layout.workspace-refresh-before-refresh')
          : t('layout.workspace-refresh-failed')
      );
    } finally {
      setPendingAction(null);
    }
  };

  const handleCreateSpaceFromFolder = async () => {
    try {
      const spaceId = await createSpaceFromFolderPicker({
        host,
        email,
        userId,
        activeSpaceId,
        projectStore,
        createdFrom: 'workspace_folder_space_picker',
        onUnavailable: openAgentFolderTab,
      });
      if (!spaceId) return;
      navigate('/');
      setMenuOpen(false);
    } catch (error) {
      console.warn(
        '[WorkspaceProjectPicker] Failed to create folder Space:',
        error
      );
      toast.error(getFolderSpaceErrorMessage(error, t));
    }
  };

  const openAgentFolderTab = () => {
    const pid = projectStore.activeProjectId;
    setActiveWorkspaceTab('inbox', {
      clearInboxForProjectId: pid ?? undefined,
    });
    setMenuOpen(false);
  };

  if (readOnly) {
    return (
      <div
        className={cn(PROJECT_PICKER_SHELL_CLASS, 'justify-center')}
        aria-label={activeSpaceTitle}
      >
        <FolderIcon className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 truncate text-label-sm text-ds-text-neutral-default-default">
          {activeSpaceTitle}
        </span>
      </div>
    );
  }

  return (
    <>
      <AlertDialog
        isOpen={discardConfirmOpen}
        onClose={() => setDiscardConfirmOpen(false)}
        onConfirm={() => void executeDiscardPending()}
        title={t('layout.workspace-discard-confirm-title')}
        message={t('layout.workspace-discard-confirm-message', {
          count: pendingOverlays.length,
        })}
        confirmText={t('layout.workspace-discard-pending-changes')}
        cancelText={t('layout.cancel')}
      />
      <AlertDialog
        isOpen={applyIssueDialog !== null}
        onClose={() => setApplyIssueDialog(null)}
        onConfirm={() => setApplyIssueDialog(null)}
        title={applyIssueDialog?.title}
        message={applyIssueDialog?.message}
        confirmText={t('layout.close')}
        cancelText={t('layout.cancel')}
        confirmVariant="primary"
        hideCancel
      />
      <AlertDialog
        isOpen={renameDialogOpen}
        onClose={() => setRenameDialogOpen(false)}
        onConfirm={() => void handleRenameSpace()}
        title={t('layout.spaces-rename-title')}
        confirmText={t('layout.save')}
        cancelText={t('layout.cancel')}
        confirmVariant="primary"
        confirmDisabled={!renameValue.trim() || renamingSpace}
      >
        <Input
          autoFocus
          value={renameValue}
          placeholder={t('layout.spaces-rename-placeholder')}
          onChange={(event) => setRenameValue(event.target.value)}
          onEnter={() => {
            if (renameValue.trim() && !renamingSpace) {
              void handleRenameSpace();
              setRenameDialogOpen(false);
            }
          }}
        />
      </AlertDialog>
      <SpaceSwitchDropdown
        open={menuOpen}
        onOpenChange={setMenuOpen}
        contentAlign="center"
        contentSideOffset={6}
        triggerWrapperClassName="w-fit"
        trigger={
          <Button
            id="workspace-project-picker-trigger"
            type="button"
            variant="ghost"
            size="md"
            buttonContent="text"
            buttonRadius="full"
            className={cn(
              PROJECT_PICKER_SHELL_CLASS,
              'no-drag justify-between hover:bg-ds-bg-neutral-default-hover'
            )}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            <FolderIcon className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 truncate text-label-sm text-ds-text-neutral-default-default">
              {activeSpaceTitle}
            </span>
            <ChevronsUpDown
              className="size-4 shrink-0 opacity-80"
              aria-hidden
            />
          </Button>
        }
        spaces={activeSpaces}
        activeSpaceId={activeSpaceId}
        switchingSpaceId={switchingSpaceId}
        canRenameActiveSpace={canRenameActiveSpace}
        createSpaceMenu={{
          onStartFromScratch: handleNewSpace,
          onSelectFolder: handleCreateSpaceFromFolder,
        }}
        onRenameSpace={openRenameDialog}
        onSpaceSelect={activateSpace}
        pendingChangesMenu={
          activeProjectId && !activeProjectDirectWrite
            ? {
                loading: pendingLoading,
                loadFailed: pendingLoadFailed,
                overlayCount: pendingOverlays.length,
                action: pendingAction,
                applyProgress,
                applyDisabled:
                  pendingOverlays.length === 0 || pendingAction !== null,
                discardDisabled:
                  pendingOverlays.length === 0 || pendingAction !== null,
                refreshDisabled:
                  pendingOverlays.length > 0 ||
                  pendingAction !== null ||
                  activeProjectRunActive,
                onApply: handleApplyPending,
                onDiscard: handleDiscardPending,
                onRefresh: handleRefreshWorkdir,
              }
            : undefined
        }
      />
    </>
  );
}
