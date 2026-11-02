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

import { fetchPut } from '@/api/http';
import {
  DeleteSessionDialog,
  type DeleteSessionFailure,
  type DeleteSessionPhase,
} from '@/components/Session/DeleteSessionDialog';
import AlertDialog from '@/components/ui/alertDialog';
import { Input } from '@/components/ui/input';
import { useHost } from '@/host';
import { setProjectAchievedState } from '@/lib/projectAchievement';
import { ensureProjectRuntimeLoaded } from '@/lib/projectRuntimeHydration';
import {
  assertSessionCleanupIdentity,
  deleteSessionTaskData,
} from '@/lib/sessionFileCleanup';
import { renameSession } from '@/lib/sessionRename';
import { SessionStopError, stopSessionForDeletion } from '@/lib/sessionStop';
import { useAuthStore } from '@/store/authStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSessionControlsStore } from '@/store/sessionControlsStore';
import { useSpaceStore } from '@/store/spaceStore';
import { ChatTaskStatus } from '@/types/constants';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { create } from 'zustand';

/**
 * Mounted owners, newest last. The Workspace subtree can stay mounted (and
 * hidden) under the Home page, so two sidebars may hold the dialogs at once;
 * only the newest one answers a request.
 */
const useSessionControlOwners = create<{ owners: symbol[] }>(() => ({
  owners: [],
}));

function useIsSessionControlOwner(): boolean {
  const [token] = useState(() => Symbol('session-controls'));
  useEffect(() => {
    useSessionControlOwners.setState((state) => ({
      owners: [...state.owners, token],
    }));
    return () =>
      useSessionControlOwners.setState((state) => ({
        owners: state.owners.filter((owner) => owner !== token),
      }));
  }, [token]);
  return useSessionControlOwners((state) => state.owners.at(-1) === token);
}

/**
 * Rename, End and Delete confirmations for a Session. Rows and the Session
 * header ask through `useSessionControlsStore.requestAction`; whichever
 * sidebar is showing (the Space sidebar or Home's) mounts this owner.
 */
export function SessionControlDialogs() {
  const { t } = useTranslation();
  const ipcRenderer = useHost()?.ipcRenderer;
  const projectStore = useProjectRuntimeStore();
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId);
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);
  const requestWorkspaceChatFocus = usePageTabStore(
    (s) => s.requestWorkspaceChatFocus
  );
  const isOwner = useIsSessionControlOwner();
  const [deleteProjectId, setDeleteProjectId] = useState<string | null>(null);
  const [deleteProjectPhase, setDeleteProjectPhase] =
    useState<DeleteSessionPhase>('idle');
  const [deleteProjectFailure, setDeleteProjectFailure] =
    useState<DeleteSessionFailure>(null);
  const [deleteProjectWorkdir, setDeleteProjectWorkdir] = useState(false);
  const deleteProjectIdentity = useRef<{
    email: string | null;
    userId: number | null;
  } | null>(null);
  const [achieveProjectId, setAchieveProjectId] = useState<string | null>(null);
  const [achieveProjectLoading, setAchieveProjectLoading] = useState(false);
  const [achieveDialogOpen, setAchieveDialogOpen] = useState(false);
  const sessionControlRequest = useSessionControlsStore((s) => s.request);
  const handledSessionControlRequest = useRef(
    sessionControlRequest?.sequence ?? 0
  );
  const [renameProjectId, setRenameProjectId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameProjectLoading, setRenameProjectLoading] = useState(false);

  const ensureProjectLoaded = useCallback(
    (projectId: string) =>
      ensureProjectRuntimeLoaded(projectStore, projectId, {
        requireActiveSelection: true,
      }),
    [projectStore]
  );

  const requestDeleteSession = useCallback((projectId: string) => {
    const auth = useAuthStore.getState();
    deleteProjectIdentity.current = { email: auth.email, userId: auth.user_id };
    setDeleteProjectFailure(null);
    setDeleteProjectWorkdir(false);
    setDeleteProjectId(projectId);
  }, []);

  const requestEndSession = useCallback((projectId: string) => {
    setAchieveProjectId(projectId);
    setAchieveDialogOpen(true);
  }, []);

  const requestRenameSession = useCallback((projectId: string) => {
    const name = useSpaceStore.getState().getProjectMeta(projectId)?.name;
    setRenameValue(name ?? '');
    setRenameProjectId(projectId);
  }, []);

  useEffect(() => {
    if (
      !sessionControlRequest ||
      sessionControlRequest.sequence <= handledSessionControlRequest.current
    ) {
      return;
    }
    handledSessionControlRequest.current = sessionControlRequest.sequence;
    // Every mounted owner tracks the sequence, so a request is never
    // replayed when another owner takes over later.
    if (!isOwner) return;
    const { action, projectId } = sessionControlRequest;
    if (action === 'rename') requestRenameSession(projectId);
    if (action === 'end') requestEndSession(projectId);
    if (action === 'delete') requestDeleteSession(projectId);
  }, [
    isOwner,
    requestDeleteSession,
    requestEndSession,
    requestRenameSession,
    sessionControlRequest,
  ]);

  const confirmRenameSession = useCallback(async () => {
    const projectId = renameProjectId;
    const name = renameValue.trim();
    if (!projectId || !name || renameProjectLoading) return;
    setRenameProjectLoading(true);
    try {
      await renameSession(
        projectId,
        name,
        projectStore,
        useSpaceStore.getState()
      );
      setRenameProjectId(null);
    } catch (error) {
      console.error('[SessionControlDialogs] Failed to rename session:', error);
      toast.error(t('layout.failed-to-rename-session'));
    } finally {
      setRenameProjectLoading(false);
    }
  }, [projectStore, renameProjectId, renameProjectLoading, renameValue, t]);

  const confirmDeleteSession = useCallback(async () => {
    const projectId = deleteProjectId;
    if (!projectId || deleteProjectPhase !== 'idle') return;

    setDeleteProjectPhase('stopping');
    try {
      const identity = deleteProjectIdentity.current;
      if (!identity) throw new Error('Missing Session cleanup identity');
      assertSessionCleanupIdentity(identity);
      const projectMeta = useSpaceStore.getState().getProjectMeta(projectId);
      const spaceId = projectMeta?.spaceId ?? activeSpaceId ?? undefined;
      const wasActive = projectStore.activeProjectId === projectId;

      const deferLocalCleanup = await stopSessionForDeletion(projectId);
      setDeleteProjectPhase('deleting');
      const chatState = projectStore.peekActiveChatStore(projectId)?.getState();
      await deleteSessionTaskData({
        projectId,
        spaceId,
        ...identity,
        knownTasks: Object.keys(chatState?.tasks ?? {}).map((taskId) => ({
          task_id: taskId,
          project_id: projectId,
        })),
        deleteWorkdir: deleteProjectWorkdir,
        deferLocalCleanup,
        ipcRenderer,
      });

      assertSessionCleanupIdentity(identity);
      if (spaceId) {
        try {
          const { proxyUpdateSpaceProject } =
            await import('@/service/spaceApi');
          assertSessionCleanupIdentity(identity);
          await proxyUpdateSpaceProject(spaceId, projectId, {
            status: 'archived',
          });
        } catch (error) {
          console.warn(
            `[SessionControlDialogs] Failed to archive server project ${projectId}:`,
            error
          );
        }
      }

      assertSessionCleanupIdentity(identity);
      projectStore.removeProject(projectId);
      setDeleteProjectId(null);

      if (wasActive) {
        setActiveWorkspaceTab('workforce');
        requestWorkspaceChatFocus();
      }

      toast.success(t('layout.delete-project'));
    } catch (error) {
      console.error('[SessionControlDialogs] Failed to delete project:', error);
      const failure = error instanceof SessionStopError ? 'stop' : 'cleanup';
      setDeleteProjectFailure(failure);
      toast.error(
        t(
          failure === 'stop'
            ? 'layout.delete-project-stop-failed'
            : 'layout.delete-project-failed'
        )
      );
    } finally {
      setDeleteProjectPhase('idle');
    }
  }, [
    activeSpaceId,
    deleteProjectId,
    deleteProjectPhase,
    deleteProjectWorkdir,
    ipcRenderer,
    projectStore,
    requestWorkspaceChatFocus,
    setActiveWorkspaceTab,
    t,
  ]);

  const confirmEndSession = useCallback(async () => {
    const projectId = achieveProjectId;
    if (!projectId) return;

    setAchieveProjectLoading(true);
    try {
      const wasActive = projectStore.activeProjectId === projectId;
      await ensureProjectLoaded(projectId);
      const projectChatStore = projectStore.peekActiveChatStore(projectId);
      const projectChatState = projectChatStore?.getState();
      const taskId = projectChatState?.activeTaskId;
      const task = taskId ? projectChatState?.tasks[taskId] : undefined;

      const hasActiveRun =
        task &&
        (task.status === ChatTaskStatus.RUNNING ||
          task.status === ChatTaskStatus.PAUSE ||
          task.isPending);
      if (taskId && hasActiveRun) {
        await fetchPut(`/task/${taskId}/take-control`, { action: 'stop' });
        projectChatStore?.getState().stopTask(taskId);
        projectChatStore?.getState().setIsPending(taskId, false);
      }

      await setProjectAchievedState({
        projectStore,
        projectId,
        achieved: true,
      });
      if (wasActive) {
        setActiveWorkspaceTab('workforce');
        requestWorkspaceChatFocus();
      }
      toast.success(t('layout.project-ended-successfully'), {
        closeButton: true,
      });
    } catch (error) {
      console.error(
        '[SessionControlDialogs] Failed to achieve project:',
        error
      );
      toast.error(t('layout.failed-to-end-project'), {
        closeButton: true,
      });
    } finally {
      setAchieveProjectLoading(false);
      setAchieveProjectId(null);
      setAchieveDialogOpen(false);
    }
  }, [
    achieveProjectId,
    ensureProjectLoaded,
    projectStore,
    requestWorkspaceChatFocus,
    setActiveWorkspaceTab,
    t,
  ]);

  return (
    <>
      <AlertDialog
        isOpen={renameProjectId != null}
        onClose={() => {
          if (!renameProjectLoading) setRenameProjectId(null);
        }}
        onConfirm={() => void confirmRenameSession()}
        closeOnConfirm={false}
        title={t('layout.rename-project')}
        confirmText={t('layout.save')}
        cancelText={t('layout.cancel')}
        confirmVariant="primary"
        confirmDisabled={!renameValue.trim() || renameProjectLoading}
      >
        <Input
          autoFocus
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          placeholder={t('layout.project-name')}
          aria-label={t('layout.project-name')}
        />
      </AlertDialog>
      <DeleteSessionDialog
        projectId={deleteProjectId}
        phase={deleteProjectPhase}
        failure={deleteProjectFailure}
        deleteWorkdir={deleteProjectWorkdir}
        onDeleteWorkdirChange={setDeleteProjectWorkdir}
        onClose={() => setDeleteProjectId(null)}
        onConfirm={() => void confirmDeleteSession()}
      />

      <AlertDialog
        isOpen={achieveDialogOpen}
        onClose={() => {
          if (achieveProjectLoading) return;
          setAchieveDialogOpen(false);
          setAchieveProjectId(null);
        }}
        onConfirm={() => void confirmEndSession()}
        title={t('layout.achieve-project')}
        message={t('layout.ending-this-project-will-stop')}
        confirmText={t('layout.yes-end-project')}
        cancelText={t('layout.cancel')}
        confirmVariant="primary"
        confirmTone="error"
        confirmDisabled={achieveProjectLoading}
      />
    </>
  );
}
