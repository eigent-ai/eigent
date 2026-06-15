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

import {
  fetchDelete,
  fetchPut,
  proxyFetchDelete,
  proxyFetchGet,
} from '@/api/http';
import { GlobalSearchDialog } from '@/components/GlobalSearch';
import AlertDialog from '@/components/ui/alertDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TooltipSimple } from '@/components/ui/tooltip';
import { useHost } from '@/host';
import {
  createSpaceFromFolderPicker,
  getFolderSpaceErrorMessage,
} from '@/lib/createSpaceFromFolder';
import {
  isProjectAchieved,
  setProjectAchievedState,
} from '@/lib/projectAchievement';
import {
  buildTaskQuestionsById,
  computeProjectFreshnessAnchor,
} from '@/lib/replay';
import { ensureScratchSpaceWorkspaceBinding } from '@/lib/scratchSpaceWorkspace';
import {
  getSessionNavLeadFromHistoryProject,
  resolveProjectNavLeadPresentation,
} from '@/lib/sessionNavLead';
import {
  getActiveSpaceTriggerLabel,
  getContextTabBindingLabel,
  getDefaultNewSpaceName,
  isUnboundUntitledSpace,
} from '@/lib/spaceLabel';
import { resolveServerBackedSpaceId } from '@/lib/spaceProject';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import type { ChatStore } from '@/store/chatStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import {
  getVisibleProjectMetasForSpace,
  isDisposableBlankSpace,
  useSpaceStore,
} from '@/store/spaceStore';
import { useTriggerStore } from '@/store/triggerStore';
import { ChatTaskStatus } from '@/types/constants';
import {
  Cast,
  ChevronsUpDown,
  FolderIcon,
  Inbox,
  LayoutGrid,
  Plus,
  Zap,
  ZapOff,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  NavTab,
  NavTabReconnectSuffix,
  WORKSPACE_TAB_LABEL_CLASS,
  triggerListenerLeadIconClass,
  workspaceTabButtonClass,
} from './NavTab';
import { ProjectNavList } from './ProjectNavList';
import { SpaceSwitchDropdown } from './SpaceSwitchDropdown';

export interface ProjectPageSidebarProps {
  chatStore: ChatStore | null;
  className?: string;
}

export default function ProjectPageSidebar({
  chatStore: _chatStore,
  className,
}: ProjectPageSidebarProps) {
  const activeWorkspaceTab = usePageTabStore((s) => s.activeWorkspaceTab);
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);
  const requestWorkspaceChatFocus = usePageTabStore(
    (s) => s.requestWorkspaceChatFocus
  );
  const requestOpenTriggerAddDialog = usePageTabStore(
    (s) => s.requestOpenTriggerAddDialog
  );
  const projectSidebarFolded = usePageTabStore((s) => s.projectSidebarFolded);
  const unviewedTabs = usePageTabStore((s) => s.unviewedTabs);
  const inboxUnviewedForProjects = usePageTabStore(
    (s) => s.inboxUnviewedForProjects
  );
  const wsConnectionStatus = useTriggerStore((s) => s.wsConnectionStatus);
  const triggerReconnect = useTriggerStore((s) => s.triggerReconnect);
  const triggersListenerConnected = wsConnectionStatus === 'connected';
  const projectStore = useProjectRuntimeStore();
  const navLeadByProjectId = useProjectRuntimeStore(
    (s) => s.navLeadByProjectId
  );
  const historyLoadingProjectIds = useProjectRuntimeStore(
    (s) => s.historyLoadingProjectIds
  );
  const activeProjectId = projectStore.activeProjectId;
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId);
  const spacesById = useSpaceStore((s) => s.spaces);
  const projectsBySpaceId = useSpaceStore((s) => s.projectsBySpaceId);
  const setActiveSpace = useSpaceStore((s) => s.setActiveSpace);
  const createSpaceOnServer = useSpaceStore((s) => s.createSpaceOnServer);
  const renameSpaceOnServer = useSpaceStore((s) => s.renameSpaceOnServer);
  const projectMetasForActiveSpace = useMemo(() => {
    if (!activeSpaceId) return [];
    return getVisibleProjectMetasForSpace(projectsBySpaceId, activeSpaceId);
  }, [activeSpaceId, projectsBySpaceId]);
  const folderTabHasUnviewedFiles =
    !!activeProjectId && inboxUnviewedForProjects.has(activeProjectId);
  const { t } = useTranslation();
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [switchingSpaceId, setSwitchingSpaceId] = useState<string | null>(null);
  const [renameSpaceDialogOpen, setRenameSpaceDialogOpen] = useState(false);
  const [renameSpaceValue, setRenameSpaceValue] = useState('');
  const [renamingSpace, setRenamingSpace] = useState(false);
  const [deleteProjectId, setDeleteProjectId] = useState<string | null>(null);
  const [deleteProjectLoading, setDeleteProjectLoading] = useState(false);
  const [achieveProjectId, setAchieveProjectId] = useState<string | null>(null);
  const [achieveProjectLoading, setAchieveProjectLoading] = useState(false);
  const [achieveDialogOpen, setAchieveDialogOpen] = useState(false);
  const [pinnedProjectIds, setPinnedProjectIds] = useState<Set<string>>(() => {
    try {
      return new Set(
        JSON.parse(
          localStorage.getItem('eigent-pinned-projects') ?? '[]'
        ) as string[]
      );
    } catch {
      return new Set();
    }
  });

  const scheduledTabLabel = t('layout.scheduled-tab');
  const triggersTabTooltip = scheduledTabLabel;

  const triggersTabAriaLabel = useMemo(() => {
    const base = scheduledTabLabel;
    if (triggersListenerConnected) return base;
    if (wsConnectionStatus === 'connecting') {
      return `${base}, ${t('layout.triggers-connecting')}`;
    }
    return `${base}, ${t('layout.triggers-disconnected')}`;
  }, [scheduledTabLabel, t, triggersListenerConnected, wsConnectionStatus]);

  const email = useAuthStore((s) => s.email);
  const userId = useAuthStore((s) => s.user_id);
  const host = useHost();
  const ipcRenderer = host?.ipcRenderer;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setGlobalSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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

  const activeSpace = activeSpaceId ? spacesById[activeSpaceId] : null;
  const activeSpaceLabel = getActiveSpaceTriggerLabel(activeSpace?.name, t, {
    emptyLabelKey: activeSpaceId
      ? 'layout.spaces-untitled'
      : 'layout.spaces-select-space',
  });
  const canRenameActiveSpace = Boolean(
    activeSpace &&
    activeSpace.status === 'active' &&
    activeSpace.sourceType !== 'legacy' &&
    activeSpace.metadata?.legacy !== true
  );
  const isActiveSpaceUnbound = isUnboundUntitledSpace(activeSpace, t);
  const contextTabBinding = useMemo(
    () => getContextTabBindingLabel(activeSpace, t),
    [activeSpace, t]
  );

  useEffect(() => {
    if (
      !activeSpace ||
      activeSpace.sourceType !== 'blank' ||
      activeSpace.rootPath
    ) {
      return;
    }
    void ensureScratchSpaceWorkspaceBinding({
      email,
      userId,
      space: activeSpace,
    });
  }, [
    activeSpace,
    activeSpace?.id,
    activeSpace?.rootPath,
    activeSpace?.sourceType,
    email,
    userId,
  ]);

  const projectHasStarted = useCallback(
    (projectId: string) => {
      const projectChatStore = projectStore.peekActiveChatStore(projectId);
      const projectChatState = projectChatStore?.getState();
      const projectTask = projectChatState?.activeTaskId
        ? projectChatState.tasks[projectChatState.activeTaskId]
        : undefined;
      return Boolean(
        projectTask &&
        ((projectTask.messages?.length || 0) > 0 ||
          projectTask.hasMessages ||
          projectTask.status !== ChatTaskStatus.PENDING)
      );
    },
    [projectStore]
  );

  const shouldShowProjectInNavList = useCallback(
    (project: (typeof projectMetasForActiveSpace)[number]) => {
      if (project.metadata?.historyId) return true;
      const historyDisplayName =
        typeof project.metadata?.historyDisplayName === 'string'
          ? project.metadata.historyDisplayName.trim()
          : '';
      if (historyDisplayName) return true;

      const normalizedName = (project.name ?? '').trim().toLowerCase();
      if (
        normalizedName &&
        normalizedName !== 'new project' &&
        normalizedName !== 'new space'
      ) {
        return true;
      }

      return projectHasStarted(project.id);
    },
    [projectHasStarted]
  );

  const isProjectNavSelectionActive =
    activeWorkspaceTab === 'project' || activeWorkspaceTab === 'new-project';

  const ensureProjectLoaded = useCallback(
    async (projectId: string) => {
      if (projectStore.peekActiveChatStore(projectId)) {
        return;
      }

      try {
        const historyProject = await proxyFetchGet(
          `/api/v1/chat/histories/grouped/${projectId}`,
          { include_tasks: true }
        );
        const taskIdsList = (historyProject?.tasks ?? [])
          .map((task: { task_id?: string | null }) => task.task_id)
          .filter((taskId: string | null | undefined): taskId is string =>
            Boolean(taskId)
          );

        if (taskIdsList.length === 0) {
          projectStore.appendInitChatStore(projectId);
          return;
        }

        projectStore.setProjectNavLead(
          projectId,
          getSessionNavLeadFromHistoryProject(historyProject)
        );

        const firstTask = historyProject.tasks[0];
        const taskQuestionsById = buildTaskQuestionsById(historyProject?.tasks);
        await projectStore.loadProjectFromHistory(
          taskIdsList,
          firstTask?.question || historyProject.last_prompt || '',
          projectId,
          firstTask?.id != null ? String(firstTask.id) : undefined,
          historyProject.project_name,
          undefined,
          taskQuestionsById,
          computeProjectFreshnessAnchor(historyProject)
        );
      } catch (error) {
        console.error(
          `Failed to load Project ${projectId} from history:`,
          error
        );
        if (!projectStore.peekActiveChatStore(projectId)) {
          projectStore.appendInitChatStore(projectId);
        }
      }
    },
    [projectStore]
  );

  const selectProject = useCallback(
    async (projectId: string) => {
      projectStore.setActiveProject(projectId);

      // Already loaded — flip to the live Project shell immediately.
      if (projectStore.peekActiveChatStore(projectId)) {
        setActiveWorkspaceTab('project');
        return;
      }

      // Load history first, then choose the right shell. Avoids briefly
      // showing 'project' while empty (which the Session redirect bounces
      // to 'workforce', producing a flicker on slow loads).
      await ensureProjectLoaded(projectId);

      // History-loaded projects are known to have content. Trust the project
      // type tag (set by createProject(REPLAY)) over `projectHasStarted`,
      // which can read a transiently-empty chatStore during the brief
      // window between loadProjectFromHistory's remove+create rebuild.
      const meta = useSpaceStore.getState().getProjectMeta(projectId);
      const projectInStore = projectStore.getProjectById(projectId);
      const isReplayProject = Boolean(
        meta?.metadata?.tags?.includes('replay') ||
        projectInStore?.metadata?.tags?.includes('replay')
      );
      setActiveWorkspaceTab(
        isReplayProject || projectHasStarted(projectId)
          ? 'project'
          : 'new-project'
      );
    },
    [
      ensureProjectLoaded,
      projectHasStarted,
      projectStore,
      setActiveWorkspaceTab,
    ]
  );

  const navProjects = useMemo(
    () =>
      projectMetasForActiveSpace
        .filter((project) => shouldShowProjectInNavList(project))
        .map((project) => {
          // `navLeadByProjectId` is kept live by `projectStore`'s chat-store
          // subscription registry — no need to peek into chat-store internals
          // here (those reads aren't tracked by React).
          const projectChatStore = projectStore.peekActiveChatStore(project.id);
          const projectChatState = projectChatStore?.getState();
          const activeTask = projectChatState?.activeTaskId
            ? projectChatState.tasks[projectChatState.activeTaskId]
            : undefined;
          return {
            id: project.id,
            title:
              project.name && project.name !== 'new project'
                ? project.name
                : t('layout.new-project'),
            sessionLead: resolveProjectNavLeadPresentation({
              cachedLead: navLeadByProjectId[project.id],
              isHistoryLoading: Boolean(historyLoadingProjectIds[project.id]),
              isAchieved: isProjectAchieved(project.metadata),
            }),
            achieved: isProjectAchieved(project.metadata),
            pinned: pinnedProjectIds.has(project.id),
            source: activeTask?.source,
          };
        }),
    [
      historyLoadingProjectIds,
      navLeadByProjectId,
      pinnedProjectIds,
      projectMetasForActiveSpace,
      projectStore,
      shouldShowProjectInNavList,
      t,
    ]
  );

  const handleNewProject = useCallback(() => {
    projectStore.setActiveProject(null);
    setActiveWorkspaceTab('new-project');
    requestWorkspaceChatFocus();
  }, [projectStore, requestWorkspaceChatFocus, setActiveWorkspaceTab]);

  const openInboxTab = useCallback(() => {
    let projectId = activeProjectId;

    if (!projectId && activeSpaceId) {
      const spaceStore = useSpaceStore.getState();
      const projectsInSpace = spaceStore.getProjectsForSpace(activeSpaceId);
      if (projectsInSpace.length > 0) {
        const lastVisitedProjectId =
          spaceStore.lastVisitedProjectBySpace[activeSpaceId];
        const targetProject =
          projectsInSpace.find(
            (project) => project.id === lastVisitedProjectId
          ) ?? projectsInSpace[0];
        projectId = targetProject.id;
        projectStore.setActiveProject(projectId);
      }
    }

    if (!projectId) {
      toast.error(t('layout.workspace-select-project'));
      return;
    }

    const projectChatStore = projectStore.peekActiveChatStore(projectId);
    const taskId = projectChatStore?.getState().activeTaskId;
    if (taskId) {
      projectChatStore?.getState().setNuwFileNum(taskId, 0);
    }

    setActiveWorkspaceTab('inbox', {
      clearInboxForProjectId: projectId,
    });

    if (!projectStore.peekActiveChatStore(projectId)) {
      void ensureProjectLoaded(projectId);
    }
  }, [
    activeProjectId,
    activeSpaceId,
    ensureProjectLoaded,
    projectStore,
    setActiveWorkspaceTab,
    t,
  ]);

  const handlePinProject = useCallback((projectId: string) => {
    setPinnedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      try {
        localStorage.setItem(
          'eigent-pinned-projects',
          JSON.stringify([...next])
        );
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }, []);

  const requestDeleteProject = useCallback((projectId: string) => {
    setDeleteProjectId(projectId);
  }, []);

  const requestAchieveProject = useCallback((projectId: string) => {
    setAchieveProjectId(projectId);
    setAchieveDialogOpen(true);
  }, []);

  const confirmDeleteProject = useCallback(async () => {
    const projectId = deleteProjectId;
    if (!projectId) return;

    setDeleteProjectLoading(true);
    try {
      const projectMeta = useSpaceStore.getState().getProjectMeta(projectId);
      const spaceId = projectMeta?.spaceId ?? activeSpaceId ?? undefined;
      const wasActive = projectStore.activeProjectId === projectId;

      let historyProject: {
        tasks?: Array<{
          id?: number;
          task_id?: string;
          project_id?: string;
        }>;
      } | null = null;

      try {
        historyProject = await proxyFetchGet(
          `/api/v1/chat/histories/grouped/${projectId}`,
          { include_tasks: true }
        );
      } catch (error) {
        console.warn(
          `[ProjectPageSidebar] No grouped history for project ${projectId}:`,
          error
        );
      }

      // Fan out per-task cleanup in parallel: with many tasks the previous
      // sequential loop kept the confirm dialog spinning for several seconds
      // even though every call is independent and best-effort.
      const cleanupPromises = (historyProject?.tasks ?? [])
        .filter((task) => task?.id != null)
        .flatMap((task) => {
          const work: Promise<unknown>[] = [
            proxyFetchDelete(`/api/v1/chat/history/${task.id}`).catch(
              (error) => {
                console.warn(
                  `[ProjectPageSidebar] Failed to delete history task ${task.task_id}:`,
                  error
                );
              }
            ),
          ];
          if (task.task_id && email && ipcRenderer) {
            work.push(
              ipcRenderer
                .invoke(
                  'delete-task-files',
                  email,
                  task.task_id,
                  task.project_id ?? projectId
                )
                .catch((error: unknown) => {
                  console.warn(
                    `[ProjectPageSidebar] Local file cleanup failed for task ${task.task_id}:`,
                    error
                  );
                })
            );
          }
          return work;
        });
      await Promise.allSettled(cleanupPromises);

      try {
        await fetchDelete(`/chat/${projectId}`);
      } catch {
        /* Backend may already have removed the chat */
      }

      if (spaceId) {
        try {
          const { proxyUpdateSpaceProject } =
            await import('@/service/spaceApi');
          await proxyUpdateSpaceProject(spaceId, projectId, {
            status: 'archived',
          });
        } catch (error) {
          console.warn(
            `[ProjectPageSidebar] Failed to archive server project ${projectId}:`,
            error
          );
        }
      }

      projectStore.removeProject(projectId);

      if (wasActive) {
        setActiveWorkspaceTab('workforce');
        requestWorkspaceChatFocus();
      }

      toast.success(t('layout.delete-project'));
    } catch (error) {
      console.error('[ProjectPageSidebar] Failed to delete project:', error);
      toast.error(t('layout.delete-project'));
    } finally {
      setDeleteProjectLoading(false);
      setDeleteProjectId(null);
    }
  }, [
    activeSpaceId,
    deleteProjectId,
    email,
    ipcRenderer,
    projectStore,
    requestWorkspaceChatFocus,
    setActiveWorkspaceTab,
    t,
  ]);

  const confirmAchieveProject = useCallback(async () => {
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
      console.error('[ProjectPageSidebar] Failed to achieve project:', error);
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

  const handleSpaceSelect = useCallback(
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
        setActiveSpace(resolvedSpaceId);
        if (projectsInSpace.length > 0) {
          const lastVisitedProjectId =
            spaceStore.lastVisitedProjectBySpace[resolvedSpaceId];
          const targetProject =
            projectsInSpace.find(
              (project) => project.id === lastVisitedProjectId
            ) ?? projectsInSpace[0];
          projectStore.setActiveProject(targetProject.id);
          await ensureProjectLoaded(targetProject.id);
        } else {
          projectStore.setActiveProject(null);
        }
        setActiveWorkspaceTab('workforce');
        requestWorkspaceChatFocus();
      } catch (error) {
        console.error('Failed to create Project for Space:', error);
        toast.error(t('layout.spaces-create-failed'), {
          closeButton: true,
        });
      } finally {
        setSwitchingSpaceId(null);
      }
    },
    [
      ensureProjectLoaded,
      projectStore,
      requestWorkspaceChatFocus,
      setActiveSpace,
      setActiveWorkspaceTab,
      t,
    ]
  );

  const handleNewSpace = useCallback(async () => {
    try {
      const spaceId = await createSpaceOnServer({
        name: getDefaultNewSpaceName(t),
        sourceType: 'blank',
        setActive: false,
        metadata: {
          createdFrom: 'project_sidebar_space_selector',
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
      setActiveWorkspaceTab('workforce');
      requestWorkspaceChatFocus();
    } catch (error) {
      console.error('Failed to create Space:', error);
      toast.error(t('layout.spaces-create-failed'), {
        closeButton: true,
      });
    }
  }, [
    createSpaceOnServer,
    email,
    projectStore,
    requestWorkspaceChatFocus,
    setActiveSpace,
    setActiveWorkspaceTab,
    t,
    userId,
  ]);

  const handleCreateSpaceFromFolder = useCallback(async () => {
    try {
      const spaceId = await createSpaceFromFolderPicker({
        host,
        email,
        userId,
        activeSpaceId,
        projectStore,
        createdFrom: 'project_sidebar_space_selector',
      });
      if (!spaceId) return;
      setActiveWorkspaceTab('workforce');
      requestWorkspaceChatFocus();
    } catch (error) {
      console.warn(
        '[ProjectPageSidebar] Failed to create folder Space:',
        error
      );
      toast.error(getFolderSpaceErrorMessage(error, t), {
        closeButton: true,
      });
    }
  }, [
    activeSpaceId,
    email,
    host,
    projectStore,
    requestWorkspaceChatFocus,
    setActiveWorkspaceTab,
    t,
    userId,
  ]);

  const openRenameSpaceDialog = useCallback(() => {
    if (!canRenameActiveSpace || !activeSpace) return;
    setRenameSpaceValue(activeSpace.name?.trim() || '');
    setRenameSpaceDialogOpen(true);
  }, [activeSpace, canRenameActiveSpace]);

  const handleRenameSpace = useCallback(async () => {
    const nextName = renameSpaceValue.trim();
    if (!activeSpaceId || !nextName || renamingSpace) return;
    setRenamingSpace(true);
    try {
      await renameSpaceOnServer(activeSpaceId, nextName);
      toast.success(t('layout.spaces-rename-success'));
      setRenameSpaceDialogOpen(false);
    } catch (error) {
      console.warn('[ProjectPageSidebar] Failed to rename Space:', error);
      toast.error(t('layout.spaces-rename-failed'));
    } finally {
      setRenamingSpace(false);
    }
  }, [activeSpaceId, renameSpaceOnServer, renameSpaceValue, renamingSpace, t]);

  return (
    <>
      <GlobalSearchDialog
        open={globalSearchOpen}
        onOpenChange={setGlobalSearchOpen}
      />
      <AlertDialog
        isOpen={renameSpaceDialogOpen}
        onClose={() => setRenameSpaceDialogOpen(false)}
        onConfirm={() => void handleRenameSpace()}
        title={t('layout.spaces-rename-title')}
        confirmText={t('layout.save')}
        cancelText={t('layout.cancel')}
        confirmVariant="primary"
        confirmDisabled={!renameSpaceValue.trim() || renamingSpace}
      >
        <Input
          autoFocus
          value={renameSpaceValue}
          placeholder={t('layout.spaces-rename-placeholder')}
          onChange={(event) => setRenameSpaceValue(event.target.value)}
          onEnter={() => {
            if (renameSpaceValue.trim() && !renamingSpace) {
              void handleRenameSpace();
            }
          }}
        />
      </AlertDialog>

      <AlertDialog
        isOpen={deleteProjectId != null}
        onClose={() => {
          if (deleteProjectLoading) return;
          setDeleteProjectId(null);
        }}
        onConfirm={() => void confirmDeleteProject()}
        title={t('layout.delete-project')}
        message={t('layout.delete-project-confirmation')}
        confirmText={t('layout.delete')}
        cancelText={t('layout.cancel')}
        confirmDisabled={deleteProjectLoading}
      />

      <AlertDialog
        isOpen={achieveDialogOpen}
        onClose={() => {
          if (achieveProjectLoading) return;
          setAchieveDialogOpen(false);
          setAchieveProjectId(null);
        }}
        onConfirm={() => void confirmAchieveProject()}
        title={t('layout.end-project')}
        message={t('layout.ending-this-project-will-stop')}
        confirmText={t('layout.yes-end-project')}
        cancelText={t('layout.cancel')}
        confirmVariant="caution"
        confirmDisabled={achieveProjectLoading}
      />

      <aside
        className={cn(
          'min-h-0 min-w-0 p-1 bg-ds-bg-neutral-default-default rounded-2xl box-border flex h-full w-full shrink-0 flex-col items-start overflow-hidden',
          className
        )}
      >
        <div className="min-h-0 min-w-0 flex h-full w-full max-w-full flex-col overflow-x-hidden">
          <div className="min-h-0 min-w-0 flex flex-1 flex-col overflow-hidden">
            <div className="gap-1 flex w-full shrink-0 flex-col">
              <SpaceSwitchDropdown
                triggerTooltip="Spaces"
                triggerTooltipEnabled={projectSidebarFolded}
                trigger={
                  <button
                    type="button"
                    className={cn(workspaceTabButtonClass(false))}
                    aria-label={t('layout.spaces-switch-space')}
                  >
                    <FolderIcon
                      className="h-4 w-4 text-ds-icon-neutral-muted-default shrink-0"
                      aria-hidden
                    />
                    <span
                      className={cn(
                        WORKSPACE_TAB_LABEL_CLASS,
                        projectSidebarFolded && 'hidden'
                      )}
                    >
                      {activeSpaceLabel}
                    </span>
                    <ChevronsUpDown
                      className={cn(
                        'h-4 w-4 text-ds-icon-neutral-subtle-default ml-auto shrink-0',
                        projectSidebarFolded && 'hidden'
                      )}
                      aria-hidden
                    />
                  </button>
                }
                spaces={activeSpaces}
                activeSpaceId={activeSpaceId}
                switchingSpaceId={switchingSpaceId}
                canRenameActiveSpace={canRenameActiveSpace}
                createSpaceMenu={{
                  onStartFromScratch: handleNewSpace,
                  onSelectFolder: handleCreateSpaceFromFolder,
                }}
                onRenameSpace={openRenameSpaceDialog}
                onSpaceSelect={handleSpaceSelect}
              />

              <div className="min-w-0 gap-1 flex w-full flex-col">
                <NavTab
                  active={activeWorkspaceTab === 'workforce'}
                  onClick={() => setActiveWorkspaceTab('workforce')}
                  leading={
                    <LayoutGrid className="h-4 w-4 shrink-0" aria-hidden />
                  }
                  label={t('layout.workspace-tab')}
                  tooltip={t('layout.workspace-tab')}
                  tooltipEnabledWhenCollapsed={!projectSidebarFolded}
                  folded={projectSidebarFolded}
                  ariaLabel={t('layout.workspace-tab')}
                  ariaCurrentPage={activeWorkspaceTab === 'workforce'}
                />
                <NavTab
                  active={activeWorkspaceTab === 'inbox'}
                  onClick={openInboxTab}
                  disabled={isActiveSpaceUnbound}
                  leading={
                    <span className="h-4 w-4 relative inline-flex shrink-0">
                      <Inbox className="h-4 w-4 shrink-0" aria-hidden />
                      {folderTabHasUnviewedFiles && !isActiveSpaceUnbound ? (
                        <span
                          className="-right-1 -top-1 h-2 w-2 bg-ds-text-error-default-default ease-in-out absolute shrink-0 rounded-full"
                          aria-hidden
                        />
                      ) : null}
                    </span>
                  }
                  label={t('layout.context-tab')}
                  trailing={
                    contextTabBinding ? (
                      <div
                        className={cn(
                          'rounded-xl bg-ds-bg-neutral-muted-default px-1.5 flex shrink-0 flex-col items-center',
                          contextTabBinding.tooltip && 'pointer-events-auto'
                        )}
                        onClick={
                          contextTabBinding.tooltip
                            ? (e) => e.stopPropagation()
                            : undefined
                        }
                      >
                        {contextTabBinding.tooltip ? (
                          <TooltipSimple
                            content={contextTabBinding.tooltip}
                            side="top"
                            sideOffset={8}
                            delayDuration={300}
                          >
                            <span className="text-label-xs font-medium text-ds-text-neutral-muted-default">
                              {contextTabBinding.label}
                            </span>
                          </TooltipSimple>
                        ) : (
                          <span className="text-label-xs font-medium text-ds-text-neutral-muted-default">
                            {contextTabBinding.label}
                          </span>
                        )}
                      </div>
                    ) : undefined
                  }
                  tooltip={
                    isActiveSpaceUnbound
                      ? t('layout.context-tab-unbound-tooltip')
                      : (contextTabBinding?.tooltip ?? t('layout.context-tab'))
                  }
                  // Render the tooltip even when disabled so users get a hint
                  // instead of relying on the toast that only fires on click.
                  tooltipEnabledWhenCollapsed={!projectSidebarFolded}
                  folded={projectSidebarFolded}
                  ariaLabel={t('layout.context-tab')}
                  ariaCurrentPage={activeWorkspaceTab === 'inbox'}
                />
                <NavTab
                  layout="split"
                  active={activeWorkspaceTab === 'triggers'}
                  onClick={() => setActiveWorkspaceTab('triggers')}
                  leading={
                    triggersListenerConnected ? (
                      <Zap
                        className={cn(
                          'h-4 w-4 shrink-0',
                          triggerListenerLeadIconClass(wsConnectionStatus)
                        )}
                        aria-hidden
                      />
                    ) : (
                      <ZapOff
                        className={cn(
                          'h-4 w-4 shrink-0',
                          triggerListenerLeadIconClass(wsConnectionStatus)
                        )}
                        aria-hidden
                      />
                    )
                  }
                  label={scheduledTabLabel}
                  showNotificationDot={unviewedTabs.has('triggers')}
                  notificationDotTone="attention"
                  notificationDotClassName="h-2 w-2"
                  endAction={
                    triggersListenerConnected ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        buttonContent="icon-only"
                        className={cn(
                          'no-drag mr-1 rounded-xl hover:bg-ds-bg-neutral-strong-default shrink-0',
                          'focus-visible:ring-ds-border-neutral-default-default focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none'
                        )}
                        aria-label={t('triggers.add-trigger')}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          requestOpenTriggerAddDialog();
                        }}
                      >
                        <Plus
                          className="h-4 w-4 text-ds-icon-neutral-muted-default"
                          aria-hidden
                        />
                      </Button>
                    ) : (
                      <NavTabReconnectSuffix
                        wsConnectionStatus={wsConnectionStatus}
                        onReconnect={triggerReconnect}
                      />
                    )
                  }
                  tooltip={triggersTabTooltip}
                  tooltipEnabledWhenCollapsed={!projectSidebarFolded}
                  folded={projectSidebarFolded}
                  ariaLabel={triggersTabAriaLabel}
                  ariaCurrentPage={activeWorkspaceTab === 'triggers'}
                />
                <NavTab
                  active={activeWorkspaceTab === 'dispatch'}
                  onClick={() => setActiveWorkspaceTab('dispatch')}
                  leading={<Cast className="h-4 w-4 shrink-0" aria-hidden />}
                  label={t('layout.dispatch-tab')}
                  tooltip={t('layout.dispatch-tab')}
                  tooltipEnabledWhenCollapsed={!projectSidebarFolded}
                  folded={projectSidebarFolded}
                  ariaLabel={t('layout.dispatch-tab')}
                  ariaCurrentPage={activeWorkspaceTab === 'dispatch'}
                />
              </div>
            </div>

            <div className="px-3 my-2">
              <div className="bg-ds-border-neutral-default-default h-px w-full" />
            </div>

            <div className="min-h-0 min-w-0 flex flex-1 flex-col overflow-hidden">
              <ProjectNavList
                className="min-h-0 flex flex-1 flex-col"
                projects={navProjects}
                activeProjectId={
                  isProjectNavSelectionActive ? activeProjectId : null
                }
                onProjectClick={selectProject}
                onDeleteProject={requestDeleteProject}
                onAchieveProject={requestAchieveProject}
                onPinProject={handlePinProject}
                onNewProject={handleNewProject}
                newProjectActive={activeWorkspaceTab === 'new-project'}
                folded={projectSidebarFolded}
              />
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
