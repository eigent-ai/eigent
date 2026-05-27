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

import { proxyFetchGet } from '@/api/http';
import { GlobalSearchDialog } from '@/components/GlobalSearch';
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
import { useHost } from '@/host';
import type { SessionNavLeadPresentation } from '@/lib/sessionNavLead';
import { getSessionNavLeadPresentation } from '@/lib/sessionNavLead';
import {
  createSyncedProjectInSpace,
  resolveServerBackedSpaceId,
} from '@/lib/spaceProject';
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
  Check,
  ChevronDown,
  FolderKanban,
  Inbox,
  LayoutGrid,
  Loader2,
  MessageCircle,
  Pencil,
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

function normalizeFolderPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function folderPathBasename(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/$/, '');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

const PROJECT_NAV_IDLE_LEAD: SessionNavLeadPresentation = {
  kind: 'idle',
  Icon: MessageCircle,
  iconClassName: '!text-ds-icon-neutral-default-default',
};

export interface ProjectPageSidebarProps {
  chatStore: ChatStore | null;
  className?: string;
}

export default function ProjectPageSidebar({
  chatStore,
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
  const customFolderPath = usePageTabStore((s) =>
    activeProjectId
      ? s.customAgentFolderPathByProjectId[activeProjectId]
      : undefined
  );
  const { t } = useTranslation();
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [switchingSpaceId, setSwitchingSpaceId] = useState<string | null>(null);
  const [renameSpaceDialogOpen, setRenameSpaceDialogOpen] = useState(false);
  const [renameSpaceValue, setRenameSpaceValue] = useState('');
  const [renamingSpace, setRenamingSpace] = useState(false);

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
  const host = useHost();
  const electronAPI = host?.electronAPI;

  const [resolvedDefaultFolderPath, setResolvedDefaultFolderPath] = useState<
    string | null
  >(null);

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

  useEffect(() => {
    let cancelled = false;
    if (!email || !activeProjectId) {
      setResolvedDefaultFolderPath(null);
      return;
    }
    if (typeof electronAPI?.getProjectFolderPath !== 'function') {
      setResolvedDefaultFolderPath(null);
      return;
    }
    void electronAPI
      .getProjectFolderPath(email, activeProjectId)
      .then((p: string) => {
        if (!cancelled) setResolvedDefaultFolderPath(p || null);
      })
      .catch(() => {
        if (!cancelled) setResolvedDefaultFolderPath(null);
      });
    return () => {
      cancelled = true;
    };
  }, [email, activeProjectId, electronAPI]);

  const folderSettingTagLabel = useMemo(() => {
    const custom = customFolderPath?.trim();
    if (!custom) return t('layout.default');
    const def = resolvedDefaultFolderPath?.trim();
    if (def && normalizeFolderPath(custom) === normalizeFolderPath(def)) {
      return t('layout.default');
    }
    return folderPathBasename(custom);
  }, [customFolderPath, resolvedDefaultFolderPath, t]);

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
  const rawActiveSpaceName = activeSpace?.name?.trim();
  const activeSpaceLabel =
    rawActiveSpaceName === t('layout.new-project') ||
    rawActiveSpaceName === 'New Project'
      ? t('layout.spaces-new-space')
      : rawActiveSpaceName || t('layout.spaces-select-space');
  const canRenameActiveSpace = Boolean(
    activeSpace &&
    activeSpace.status === 'active' &&
    activeSpace.sourceType !== 'legacy' &&
    activeSpace.metadata?.legacy !== true
  );

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

  const selectProject = useCallback(
    async (projectId: string) => {
      projectStore.setActiveProject(projectId);
      setActiveWorkspaceTab('project');

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
          setActiveWorkspaceTab('new-project');
          return;
        }

        const firstTask = historyProject.tasks[0];
        await projectStore.loadProjectFromHistory(
          taskIdsList,
          firstTask?.question || historyProject.last_prompt || '',
          projectId,
          firstTask?.id != null ? String(firstTask.id) : undefined,
          historyProject.project_name
        );
        setActiveWorkspaceTab('project');
      } catch (error) {
        console.error(
          `Failed to load Project ${projectId} from history:`,
          error
        );
        if (!projectStore.peekActiveChatStore(projectId)) {
          projectStore.appendInitChatStore(projectId);
        }
        setActiveWorkspaceTab(
          projectHasStarted(projectId) ? 'project' : 'new-project'
        );
      }
    },
    [projectHasStarted, projectStore, setActiveWorkspaceTab]
  );

  const navProjects = useMemo(
    () =>
      projectMetasForActiveSpace.map((project) => {
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
          sessionLead: activeTask
            ? getSessionNavLeadPresentation(activeTask)
            : PROJECT_NAV_IDLE_LEAD,
          source: activeTask?.source,
        };
      }),
    [projectMetasForActiveSpace, projectStore, t]
  );

  const handleNewProject = useCallback(async () => {
    if (!activeSpaceId) {
      return;
    }
    const space = useSpaceStore.getState().getSpaceById(activeSpaceId);
    try {
      const result = await createSyncedProjectInSpace({
        projectStore,
        spaceId: activeSpaceId,
        workdirMode: space?.sourceType === 'folder' ? 'copy' : 'artifact-only',
        metadata: {
          createdFrom: 'project_sidebar',
        },
      });
      setActiveSpace(result.spaceId);
      setActiveWorkspaceTab('new-project');
      requestWorkspaceChatFocus();
    } catch (error) {
      console.error('Failed to create Project:', error);
      toast.error(t('layout.spaces-create-failed'), {
        closeButton: true,
      });
    }
  }, [
    activeSpaceId,
    projectStore,
    requestWorkspaceChatFocus,
    setActiveSpace,
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
        if (projectsInSpace.length > 0) {
          setActiveSpace(resolvedSpaceId);
          await selectProject(projectsInSpace[0].id);
          return;
        }
        setActiveSpace(resolvedSpaceId);
        projectStore.setActiveProject(null);
        setActiveWorkspaceTab('new-project');
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
      projectStore,
      requestWorkspaceChatFocus,
      selectProject,
      setActiveSpace,
      setActiveWorkspaceTab,
      t,
    ]
  );

  const handleNewSpace = useCallback(async () => {
    try {
      const spaceId = await createSpaceOnServer({
        name: t('layout.spaces-new-space'),
        sourceType: 'blank',
        setActive: false,
        metadata: {
          createdFrom: 'project_sidebar_space_selector',
          autoCreatedPlaceholder: true,
        },
      });
      setActiveSpace(spaceId);
      projectStore.setActiveProject(null);
      setActiveWorkspaceTab('new-project');
      requestWorkspaceChatFocus();
    } catch (error) {
      console.error('Failed to create Space:', error);
      toast.error(t('layout.spaces-create-failed'), {
        closeButton: true,
      });
    }
  }, [
    createSpaceOnServer,
    projectStore,
    requestWorkspaceChatFocus,
    setActiveSpace,
    setActiveWorkspaceTab,
    t,
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

      <aside
        className={cn(
          'box-border flex h-full min-h-0 w-full min-w-0 shrink-0 flex-col items-start overflow-hidden py-1.5',
          className
        )}
      >
        <div className="flex h-full min-h-0 w-full min-w-0 max-w-full flex-col overflow-x-hidden">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex w-full shrink-0 flex-col gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(workspaceTabButtonClass(false), 'mb-1')}
                    aria-label={t('layout.spaces-switch-space')}
                    title={projectSidebarFolded ? activeSpaceLabel : undefined}
                  >
                    <FolderKanban
                      className="h-4 w-4 shrink-0 text-ds-icon-neutral-muted-default"
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
                    <ChevronDown
                      className={cn(
                        'ml-auto h-3.5 w-3.5 shrink-0 text-ds-icon-neutral-subtle-default',
                        projectSidebarFolded && 'hidden'
                      )}
                      aria-hidden
                    />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-56">
                  <DropdownMenuItem
                    className="cursor-pointer"
                    onClick={() => void handleNewSpace()}
                  >
                    <Plus className="h-4 w-4" aria-hidden />
                    <span>{t('layout.spaces-new-space')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="cursor-pointer"
                    disabled={!canRenameActiveSpace}
                    onClick={openRenameSpaceDialog}
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                    <span>{t('layout.spaces-rename-space')}</span>
                  </DropdownMenuItem>
                  {activeSpaces.length > 0 ? <DropdownMenuSeparator /> : null}
                  {activeSpaces.map((space) => (
                    <DropdownMenuItem
                      key={space.id}
                      className="cursor-pointer"
                      disabled={switchingSpaceId !== null}
                      onClick={() => void handleSpaceSelect(space.id)}
                    >
                      {switchingSpaceId === space.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <Check
                          className={cn(
                            'h-4 w-4',
                            activeSpaceId === space.id
                              ? 'opacity-100'
                              : 'opacity-0'
                          )}
                          aria-hidden
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate">
                        {space.name?.trim() || t('layout.spaces-untitled')}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="flex w-full min-w-0 flex-col gap-2">
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
                  onClick={() => {
                    if (chatStore?.activeTaskId) {
                      chatStore.setNuwFileNum(chatStore.activeTaskId, 0);
                    }
                    setActiveWorkspaceTab('inbox', {
                      clearInboxForProjectId: activeProjectId,
                    });
                  }}
                  leading={
                    <span className="relative inline-flex h-4 w-4 shrink-0">
                      <Inbox className="h-4 w-4 shrink-0" aria-hidden />
                      {folderTabHasUnviewedFiles ? (
                        <span
                          className="absolute -right-1 -top-1 h-2 w-2 shrink-0 rounded-full bg-ds-text-error-default-default ease-in-out"
                          aria-hidden
                        />
                      ) : null}
                    </span>
                  }
                  label={t('layout.context-tab')}
                  trailing={
                    <span
                      className="max-w-[5.5rem] shrink-0 truncate rounded-md bg-ds-bg-neutral-default-default px-1.5 py-0.5 text-body-xs font-medium leading-tight text-ds-text-neutral-subtle-default"
                      title={
                        customFolderPath &&
                        folderSettingTagLabel !== t('layout.default')
                          ? customFolderPath
                          : (resolvedDefaultFolderPath ?? undefined)
                      }
                    >
                      {folderSettingTagLabel}
                    </span>
                  }
                  tooltip={t('layout.context-tab')}
                  tooltipEnabledWhenCollapsed={!projectSidebarFolded}
                  folded={projectSidebarFolded}
                  ariaLabel={`${t('layout.context-tab')}, ${folderSettingTagLabel}`}
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
                          'no-drag mr-1 shrink-0 rounded-xl hover:bg-ds-bg-neutral-strong-default',
                          'focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-border-neutral-default-default'
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

            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <ProjectNavList
                className="mt-6 flex min-h-0 flex-1 flex-col"
                projects={navProjects}
                activeProjectId={activeProjectId}
                onProjectClick={selectProject}
                onNewProject={() => void handleNewProject()}
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
