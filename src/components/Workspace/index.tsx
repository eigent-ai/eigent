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

import larkIcon from '@/assets/icon/lark.png';
import telegramIcon from '@/assets/icon/telegram.svg';
import whatsappIcon from '@/assets/icon/whatsapp.svg';
import { isDesktop } from '@/client/platform';
import { AddWorker } from '@/components/AddWorker';
import BottomBox, { type FileAttachment } from '@/components/ChatBox/BottomBox';
import { SESSION_SIDE_PANEL_CONTENT_WIDTH_CLASS } from '@/components/Session/sessionSidePanelLayout';
import { Button } from '@/components/ui/button';
import { TooltipSimple } from '@/components/ui/tooltip';
import { BASE_WORKFLOW_AGENTS } from '@/components/WorkFlow/baseWorkers';
import { isBaseWorkflowAgent } from '@/components/Workspace/FoldedAgentCard';
import { SingleAgentList } from '@/components/Workspace/SingleAgentList';
import { WorkforceAgentList } from '@/components/Workspace/WorkforceAgentList';
import { WorkspaceAllSessions } from '@/components/Workspace/WorkspaceAllSessions';
import { WorkspaceCoworkPanel } from '@/components/Workspace/WorkspaceCoworkPanel';
import { WorkspaceExamplePrompts } from '@/components/Workspace/WorkspaceExamplePrompts';
import { WorkspaceInstructionMd } from '@/components/Workspace/WorkspaceInstructionMd';
import { WorkspaceProjectPicker } from '@/components/Workspace/WorkspaceProjectPicker';
import { WorkspaceRecentSessions } from '@/components/Workspace/WorkspaceRecentSessions';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useModelConfigCheck } from '@/hooks/useModelConfigCheck';
import { useHost } from '@/host';
import {
  createRemoteControlSession,
  getRemoteControlDesktopInstanceId,
  waitForRemoteControlBridgeConnected,
} from '@/lib/remoteControl';
import { createSyncedProjectInSpace } from '@/lib/spaceProject';
import { cn } from '@/lib/utils';
import { useAuthStore, useWorkerList } from '@/store/authStore';
import { getConnectionConfig } from '@/store/connectionStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSpaceStore } from '@/store/spaceStore';
import {
  ChatTaskStatus,
  SessionMode,
  type SessionModeType,
} from '@/types/constants';
import { ArrowLeft, Cast, Loader2, MonitorSmartphone } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

const EMPTY_TASK_ASSIGNING: Agent[] = [];
const REMOTE_CONTROL_TITLE_MAX_LENGTH = 80;

function truncateRemoteControlTitle(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= REMOTE_CONTROL_TITLE_MAX_LENGTH) {
    return text;
  }
  return `${text.slice(0, REMOTE_CONTROL_TITLE_MAX_LENGTH - 3).trimEnd()}...`;
}

function buildRemoteControlTitle(task?: {
  summaryTask?: string;
  messages?: { role: string; content?: string }[];
}): string {
  const summaryTitle = task?.summaryTask?.split('|')[0]?.trim();
  const firstUserMessage = task?.messages
    ?.find((item) => item.role === 'user')
    ?.content?.split(/[.!?\n。！？]/)[0]
    ?.trim();
  return truncateRemoteControlTitle(
    summaryTitle || firstUserMessage || 'Remote control'
  );
}

const MEMORY_STORAGE_KEY = 'eigent-sidebar-instructions-memory-on';

function readMemoryInitial(): boolean {
  if (typeof window === 'undefined') return true;
  const v = window.localStorage.getItem(MEMORY_STORAGE_KEY);
  if (v === null) return true;
  return v === 'true';
}

interface WorkspaceProps {
  /**
   * `'workspace'` (default): full landing — header, composer, recent runs,
   * and the docked instructions panel.
   * `'new-project'`: composer-first layout; use with `embedded` inside Session.
   */
  variant?: 'workspace' | 'new-project';
  /** When true, render only the centered composer block (for Session shell). */
  embedded?: boolean;
  /** Controlled session mode when embedded in the new-project Session shell. */
  sessionMode?: SessionModeType;
  onSessionModeChange?: (mode: SessionModeType) => void;
}

/**
 * Workspace tab: project landing with a centered task input.
 * After the user starts a task, it switches to the Project chat tab.
 */
export default function Workspace({
  variant = 'workspace',
  embedded = false,
  sessionMode: controlledSessionMode,
  onSessionModeChange,
}: WorkspaceProps) {
  const { t } = useTranslation();
  const isNewProjectVariant = variant === 'new-project';
  const navigate = useNavigate();
  const host = useHost();
  const { chatStore } = useChatStoreAdapter();
  const activeProjectId = useProjectRuntimeStore((s) => s.activeProjectId);
  const activeProject = useProjectRuntimeStore((s) =>
    s.activeProjectId ? s.projects[s.activeProjectId] : null
  );
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId);
  const activeSpace = useSpaceStore((s) =>
    s.activeSpaceId ? s.spaces[s.activeSpaceId] : null
  );
  const activeProjectMeta = useSpaceStore((s) =>
    activeProjectId ? s.getProjectMeta(activeProjectId) : null
  );
  const updateProjectMeta = useSpaceStore((s) => s.updateProjectMeta);
  const activeProjectMetadata =
    activeProjectMeta?.metadata ?? activeProject?.metadata;
  const isEmptyProject = useProjectRuntimeStore((s) => s.isEmptyProject);
  const customAgentFolderPath = usePageTabStore((s) =>
    activeProjectId
      ? s.customAgentFolderPathByProjectId[activeProjectId]
      : undefined
  );
  const showWorkspaceExamplePrompts = useMemo(() => {
    if (!activeProject) return false;
    if (customAgentFolderPath) return false;
    if (!isEmptyProject(activeProject)) return false;
    if (activeProjectMetadata?.historyId) return false;
    if (activeProjectMetadata?.tags?.includes('replay')) return false;
    return true;
  }, [
    activeProject,
    activeProjectMetadata,
    customAgentFolderPath,
    isEmptyProject,
  ]);
  /**
   * True when the home workspace has no explicitly selected project (default
   * "new project" shell). New Project keeps the interactive project picker in
   * that case; once a project is selected (history, folder, or started work)
   * the picker is display-only.
   */
  const isFreshProject = useMemo(() => {
    if (!activeProject) return true;
    if (activeProjectMetadata?.historyId) return false;
    if (customAgentFolderPath) return false;
    const hasStartedWork = Object.values(chatStore?.tasks ?? {}).some(
      (task) =>
        (task.messages?.length || 0) > 0 ||
        task.hasMessages ||
        task.status !== ChatTaskStatus.PENDING
    );
    if (hasStartedWork) return false;
    return true;
  }, [
    activeProject,
    activeProjectMetadata,
    chatStore?.tasks,
    customAgentFolderPath,
  ]);
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);
  const activeWorkspaceTab = usePageTabStore((s) => s.activeWorkspaceTab);
  const workspaceChatFocusRequestId = usePageTabStore(
    (s) => s.workspaceChatFocusRequestId
  );
  const workerList = useWorkerList();
  const { modelType, setWorkerList } = useAuthStore();
  const [draftSessionMode, setDraftSessionMode] = useState<SessionModeType>(
    SessionMode.SINGLE_AGENT
  );
  // Workspace is the pre-Run Project landing. Project.mode is the source of
  // truth; the old sessionSidePanelMode global is retained only as a migration
  // shim in pageTabStore.
  const effectiveSessionMode =
    controlledSessionMode ??
    activeProjectMeta?.mode ??
    activeProject?.mode ??
    draftSessionMode;

  const setActiveProjectMode = useCallback(
    (mode: SessionModeType) => {
      if (onSessionModeChange) {
        onSessionModeChange(mode);
        return;
      }
      if (!activeProjectId) {
        setDraftSessionMode(mode);
        return;
      }
      updateProjectMeta(activeProjectId, { mode });
    },
    [activeProjectId, onSessionModeChange, updateProjectMeta]
  );

  const [message, setMessage] = useState('');
  const directProjectStartRef = useRef(false);
  const [isStartingDirectProject, setIsStartingDirectProject] = useState(false);
  const { hasModel } = useModelConfigCheck();
  const [useCloudModelInDev, setUseCloudModelInDev] = useState(false);
  const [addWorkerDialogOpen, setAddWorkerDialogOpen] = useState(false);
  const [editingWorkerAgent, setEditingWorkerAgent] = useState<Agent | null>(
    null
  );
  type WorkspaceSubPage = 'all-sessions' | 'instruction-md' | null;
  const [workspaceSubPage, setWorkspaceSubPage] =
    useState<WorkspaceSubPage>(null);
  const SUB_PAGE_TITLES: Record<NonNullable<WorkspaceSubPage>, string> = {
    'all-sessions': t('layout.sessions-full-title'),
    'instruction-md': t('layout.instructions-rules-tone'),
  };
  const [memoryOn, setMemoryOn] = useState(readMemoryInitial);
  const [workspaceWorkWithPanelOpen, setWorkspaceWorkWithPanelOpen] =
    useState(false);
  const [remoteControlLoading, setRemoteControlLoading] = useState(false);
  const textareaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.localStorage.setItem(MEMORY_STORAGE_KEY, String(memoryOn));
  }, [memoryOn]);

  useEffect(() => {
    if (!workspaceWorkWithPanelOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWorkspaceWorkWithPanelOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [workspaceWorkWithPanelOpen]);

  useEffect(() => {
    if (workspaceChatFocusRequestId === 0) return;
    if (
      activeWorkspaceTab !== 'workforce' &&
      activeWorkspaceTab !== 'new-project'
    )
      return;
    const focusTimer = window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 180);
    return () => window.clearTimeout(focusTimer);
  }, [workspaceChatFocusRequestId, activeWorkspaceTab]);

  useEffect(() => {
    if (
      import.meta.env.VITE_USE_LOCAL_PROXY === 'true' &&
      modelType === 'cloud'
    ) {
      setUseCloudModelInDev(true);
    } else {
      setUseCloudModelInDev(false);
    }
  }, [modelType]);

  const handleSend = async () => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      return;
    }

    if (!hasModel) {
      toast.error(t('layout.please-select-model-first'));
      navigate('/history?tab=agents');
      return;
    }

    const needsProjectBootstrap = !activeProjectId || !chatStore?.activeTaskId;
    if (needsProjectBootstrap) {
      if (directProjectStartRef.current) {
        return;
      }
      directProjectStartRef.current = true;
      setIsStartingDirectProject(true);
    }

    try {
      let targetProjectId = activeProjectId;
      let targetChatStore: typeof chatStore | null = chatStore;

      if (!targetProjectId || !targetChatStore?.activeTaskId) {
        if (!activeSpaceId) {
          toast.error(t('layout.spaces-create-failed'));
          return;
        }

        const projectStore = useProjectRuntimeStore.getState();
        const syncedProject = await createSyncedProjectInSpace({
          projectStore,
          spaceId: activeSpaceId,
          name: trimmedMessage.slice(0, 120),
          mode: effectiveSessionMode,
          workdirMode:
            activeSpace?.sourceType === 'folder'
              ? 'direct-write'
              : 'artifact-only',
          metadata: {
            createdFrom: 'workspace_direct_chat',
          },
        });
        useSpaceStore.getState().setActiveSpace(syncedProject.spaceId);
        targetProjectId = syncedProject.projectId;
        targetChatStore =
          useProjectRuntimeStore
            .getState()
            .getActiveChatStore(targetProjectId)
            ?.getState() ?? null;
      }

      if (!targetProjectId || !targetChatStore?.activeTaskId) {
        throw new Error('No active Project chat available');
      }

      const taskId = targetChatStore.activeTaskId;
      const targetProjectMeta = useSpaceStore
        .getState()
        .getProjectMeta(targetProjectId);
      const targetProject =
        useProjectRuntimeStore.getState().projects[targetProjectId];
      if (!(targetProjectMeta?.mode ?? targetProject?.mode)) {
        updateProjectMeta(targetProjectId, {
          mode: effectiveSessionMode,
        });
      }
      targetChatStore.setHasMessages(taskId, true);
      const attachesToSend =
        JSON.parse(JSON.stringify(targetChatStore.tasks[taskId]?.attaches)) ||
        [];

      // Enter the live Project immediately; task startup continues in the background.
      setActiveWorkspaceTab('project');

      await targetChatStore.startTask(
        taskId,
        undefined,
        undefined,
        undefined,
        trimmedMessage,
        attachesToSend,
        undefined,
        targetProjectId,
        effectiveSessionMode
      );
      targetChatStore.setHasWaitComfirm(taskId, true);
      targetChatStore.setAttaches(taskId, []);
      setMessage('');
    } catch (err: unknown) {
      setActiveWorkspaceTab('workforce');
      console.error('Failed to start task:', err);
      toast.error(
        err instanceof Error ? err.message : t('layout.failed-to-start-task')
      );
    } finally {
      if (needsProjectBootstrap) {
        directProjectStartRef.current = false;
        setIsStartingDirectProject(false);
      }
    }
  };

  const handleFileSelect = useCallback(async () => {
    if (!chatStore?.activeTaskId) return;
    try {
      const result = await host?.electronAPI?.selectFile({
        title: t('chat.select-file'),
        filters: [{ name: t('chat.all-files'), extensions: ['*'] }],
      });

      if (result.success && result.files && result.files.length > 0) {
        const taskId = chatStore.activeTaskId as string;
        const files = [
          ...(chatStore.tasks[taskId].attaches || []),
          ...result.files.filter(
            (r: File) =>
              !chatStore.tasks[taskId].attaches?.some(
                (f: File) => f.filePath === r.filePath
              )
          ),
        ];
        chatStore.setAttaches(taskId, files);
      }
    } catch (error) {
      console.error('Select File Error:', error);
    }
  }, [chatStore, host, t]);

  const handleCreateRemoteControl = useCallback(async () => {
    const activeTaskId = chatStore?.activeTaskId;
    const brainSessionId = getConnectionConfig().sessionId;
    if (!isDesktop()) {
      toast.error('Remote control must be started from the desktop app.');
      return;
    }
    if (!activeSpaceId) {
      toast.error('Open a Space before starting remote control.');
      return;
    }

    setRemoteControlLoading(true);
    try {
      const bridgeReady = await waitForRemoteControlBridgeConnected();
      if (!bridgeReady) {
        toast.error('Remote control is still connecting.', {
          description:
            'Keep Eigent Desktop open and try again in a few seconds.',
        });
        return;
      }
      const task = activeTaskId ? chatStore?.tasks[activeTaskId] : null;
      const title = task
        ? buildRemoteControlTitle(task)
        : activeSpace?.name || 'Eigent Remote Control';
      const res = await createRemoteControlSession({
        desktop_instance_id: getRemoteControlDesktopInstanceId(),
        space_id: activeSpaceId,
        ...(activeProjectId ? { project_id: activeProjectId } : {}),
        ...(activeTaskId ? { active_task_id: activeTaskId } : {}),
        ...(activeProjectId && brainSessionId
          ? { brain_session_id: brainSessionId }
          : {}),
        title,
      });
      setWorkspaceWorkWithPanelOpen(false);
      try {
        await navigator.clipboard.writeText(res.url);
        toast.success('Remote control link copied', {
          description: res.url,
          duration: 10000,
        });
      } catch {
        toast.success('Remote control link created', {
          description: res.url,
          duration: 10000,
        });
      }
    } catch (err: any) {
      const code =
        err?.response?.data?.detail?.code ||
        err?.response?.data?.code ||
        err?.code;
      if (code === 'BRIDGE_OFFLINE') {
        toast.error('Remote control bridge is offline.', {
          description:
            'Keep Eigent Desktop open and wait for the bridge to reconnect, then try again.',
        });
      } else {
        toast.error(err?.message || 'Failed to create remote control link.');
      }
    } finally {
      setRemoteControlLoading(false);
    }
  }, [activeProjectId, activeSpace?.name, activeSpaceId, chatStore]);

  const buildComposerInputProps = (
    targetChatStore: typeof chatStore | null = chatStore
  ) => ({
    value: message,
    onChange: setMessage,
    onSend: handleSend,
    files:
      targetChatStore?.activeTaskId &&
      targetChatStore.tasks[targetChatStore.activeTaskId]
        ? targetChatStore.tasks[targetChatStore.activeTaskId]?.attaches?.map(
            (f) => ({
              fileName: f.fileName,
              filePath: f.filePath,
            })
          ) || []
        : [],
    onFilesChange: (files: FileAttachment[]) => {
      if (!targetChatStore?.activeTaskId) return;
      targetChatStore.setAttaches(
        targetChatStore.activeTaskId as string,
        files as any
      );
    },
    onAddFile: handleFileSelect,
    disabled: !hasModel || isStartingDirectProject,
    textareaRef,
    allowDragDrop: true,
    useCloudModelInDev,
    placeholder: t('layout.project-task-placeholder'),
    sessionMode: effectiveSessionMode,
    onSessionModeChange: setActiveProjectMode,
    sessionModeSelectInteractive: true,
  });

  const taskAssigning =
    chatStore?.activeTaskId != null
      ? (chatStore.tasks[chatStore.activeTaskId]?.taskAssigning ??
        EMPTY_TASK_ASSIGNING)
      : EMPTY_TASK_ASSIGNING;

  const sortedAgents = useMemo(() => {
    const base = [...BASE_WORKFLOW_AGENTS, ...workerList].filter(
      (worker) => !taskAssigning.find((a) => a.type === worker.type)
    );
    const allAgents = [...taskAssigning, ...base];
    return [...allAgents].sort((a, b) => {
      const aHas = a.tasks && a.tasks.length > 0;
      const bHas = b.tasks && b.tasks.length > 0;
      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;
      return 0;
    });
  }, [taskAssigning, workerList]);

  const onSelectAgent = useCallback(
    (agentId: string) => {
      if (!chatStore?.activeTaskId) return;
      chatStore.setActiveWorkspace(chatStore.activeTaskId, agentId);
      chatStore.setActiveAgent(chatStore.activeTaskId, agentId);
      host?.electronAPI?.hideAllWebview?.();
    },
    [chatStore, host]
  );

  const onEditWorkerFromMenu = useCallback((agent: Agent) => {
    setEditingWorkerAgent(agent);
  }, []);

  const onDuplicateUserAgent = useCallback(
    (agent: Agent) => {
      if (isBaseWorkflowAgent(agent)) return;
      const baseName = agent.workerInfo?.name ?? agent.name;
      const taken = new Set<string>();
      workerList.forEach((w) => {
        taken.add(w.agent_id);
        taken.add(w.name);
      });
      let newName = `${baseName} copy`;
      let n = 2;
      while (taken.has(newName)) {
        newName = `${baseName} copy ${n++}`;
      }
      const raw = JSON.parse(JSON.stringify(agent)) as Agent;
      const duplicate: Agent = {
        ...raw,
        agent_id: newName,
        name: newName,
        type: newName as AgentNameType,
        tasks: [],
        log: [],
        activeWebviewIds: [],
        workerInfo: raw.workerInfo
          ? { ...raw.workerInfo, name: newName }
          : undefined,
      };
      setWorkerList([...workerList, duplicate]);
    },
    [workerList, setWorkerList]
  );

  const onDeleteUserAgent = useCallback(
    (agentId: string) => {
      setWorkerList(workerList.filter((w) => w.agent_id !== agentId));
    },
    [workerList, setWorkerList]
  );

  const projectPicker =
    isNewProjectVariant && (embedded || !isFreshProject) ? (
      <WorkspaceProjectPicker readOnly />
    ) : (
      <WorkspaceProjectPicker />
    );

  const activeAgentId = chatStore?.activeTaskId
    ? chatStore.tasks[chatStore.activeTaskId]?.activeAgent
    : undefined;

  const composerTop = (
    <>
      <div className="mb-8 flex w-full justify-center">{projectPicker}</div>
      <span className="mb-8 w-full text-center text-heading-lg font-bold text-ds-text-neutral-default-default">
        {effectiveSessionMode === SessionMode.SINGLE_AGENT
          ? t('layout.workspace-cowork-single-agent')
          : t('layout.workspace-cowork-workforce')}
      </span>
      <div className="mb-8 flex w-full justify-center px-5">
        {effectiveSessionMode === SessionMode.SINGLE_AGENT ? (
          <SingleAgentList />
        ) : (
          <WorkforceAgentList
            sortedAgents={sortedAgents}
            activeAgentId={activeAgentId}
            onSelectAgent={onSelectAgent}
            onEditWorkerFromMenu={onEditWorkerFromMenu}
            onDuplicateUserAgent={onDuplicateUserAgent}
            onDeleteUserAgent={onDeleteUserAgent}
            onAddWorker={() => setAddWorkerDialogOpen(true)}
          />
        )}
      </div>
    </>
  );

  const composerInput = (
    <>
      <div className="w-full">
        <BottomBox
          state="input"
          queuedMessages={[]}
          onRemoveQueuedMessage={() => {}}
          noModelOverlay={!hasModel}
          onSelectModel={() => navigate('/history?tab=agents')}
          inputProps={buildComposerInputProps(chatStore ?? undefined)}
        />
      </div>
      <AddWorker
        isOpen={addWorkerDialogOpen}
        onOpenChange={setAddWorkerDialogOpen}
      />
      {editingWorkerAgent && (
        <AddWorker
          edit
          workerInfo={editingWorkerAgent}
          isOpen={true}
          onOpenChange={(open) => {
            if (!open) setEditingWorkerAgent(null);
          }}
        />
      )}
    </>
  );

  const composer = (
    <div className="mx-auto my-auto flex w-full max-w-[600px] shrink-0 flex-col">
      <div className="flex min-h-[50vh] w-full min-w-0 flex-col justify-end">
        {composerTop}
        {composerInput}
      </div>
    </div>
  );

  const showBottomExamplePrompts =
    !embedded &&
    (isNewProjectVariant ||
      !chatStore?.activeTaskId ||
      showWorkspaceExamplePrompts);

  if (embedded && isNewProjectVariant) {
    return (
      <div className="relative z-[1] flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-3">
        {composer}
        <div
          className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto pt-6"
          id="workspace-bottom-group"
          aria-hidden
        />
      </div>
    );
  }

  const sidePanel =
    workspaceSubPage === null ? (
      <div className="shrink-0 overflow-hidden">
        <div
          className={cn(
            'flex h-full flex-col overflow-hidden',
            SESSION_SIDE_PANEL_CONTENT_WIDTH_CLASS
          )}
        >
          <WorkspaceCoworkPanel
            memoryOn={memoryOn}
            onMemoryToggle={() => setMemoryOn((v) => !v)}
            onEditInstructions={() => setWorkspaceSubPage('instruction-md')}
            onWorkforceSetting={() => setActiveWorkspaceTab('workforce')}
          />
        </div>
      </div>
    ) : null;

  const workWithPanelToggleLabel = workspaceWorkWithPanelOpen
    ? t('layout.workspace-work-with-panel-hide', {
        defaultValue: 'Hide Work with panel',
      })
    : t('layout.workspace-work-with-panel-show', {
        defaultValue: 'Show Work with panel',
      });
  const comingSoonLabel = t('layout.dispatch-coming-soon', {
    defaultValue: 'Coming soon',
  });

  return (
    <div className="relative z-[1] flex h-full min-h-0 w-full min-w-0 flex-row overflow-hidden">
      {workspaceWorkWithPanelOpen ? (
        <>
          <button
            type="button"
            className="absolute inset-0 z-40 cursor-default bg-transparent backdrop-blur-[1px]"
            aria-label={t('layout.workspace-work-with-dismiss-overlay', {
              defaultValue: 'Dismiss',
            })}
            onClick={() => setWorkspaceWorkWithPanelOpen(false)}
          />
          <div
            id="workspace-work-with-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="workspace-work-with-heading"
            className="absolute left-0 top-8 z-50 flex max-h-[calc(100%-2.75rem)] w-[300px] flex-col overflow-y-auto duration-200 ease-out animate-in fade-in-0 slide-in-from-left-2"
          >
            <div className="flex flex-col gap-3 p-3">
              <div className="flex min-w-0 flex-col rounded-xl border border-solid border-ds-border-neutral-subtle-default bg-ds-bg-neutral-subtle-default p-3">
                <span
                  id="workspace-work-with-heading"
                  className="text-body-sm font-semibold text-ds-text-neutral-default-default"
                >
                  {t('layout.workspace-work-with-title', {
                    defaultValue: 'Work with',
                  })}
                </span>
                <div className="mt-3 flex flex-col gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    tone="default"
                    emphasis="default"
                    size="sm"
                    buttonContent="text"
                    className="no-drag justify-start gap-2"
                    disabled={remoteControlLoading}
                    onClick={handleCreateRemoteControl}
                  >
                    {remoteControlLoading ? (
                      <Loader2
                        className="h-4 w-4 shrink-0 animate-spin text-ds-text-neutral-muted-default"
                        aria-hidden
                      />
                    ) : (
                      <MonitorSmartphone
                        className="h-4 w-4 shrink-0 text-ds-text-neutral-muted-default"
                        aria-hidden
                      />
                    )}
                    {t('layout.workspace-work-with-remote-control', {
                      defaultValue: 'Remote control',
                    })}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    tone="default"
                    emphasis="default"
                    size="sm"
                    buttonContent="text"
                    className="no-drag w-full justify-start gap-2"
                    aria-label={t('layout.channels-telegram', {
                      defaultValue: 'Telegram',
                    })}
                    disabled
                  >
                    <img
                      src={telegramIcon}
                      alt=""
                      className="h-4 w-4 shrink-0 object-contain"
                      aria-hidden
                    />
                    {t('layout.channels-telegram', {
                      defaultValue: 'Telegram',
                    })}
                    <span className="ml-auto rounded-full bg-ds-bg-neutral-muted-default px-2 py-0.5 text-label-xs text-ds-text-neutral-muted-default">
                      {comingSoonLabel}
                    </span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    tone="default"
                    emphasis="default"
                    size="sm"
                    buttonContent="text"
                    className="no-drag w-full justify-start gap-2"
                    aria-label={t('layout.channels-lark', {
                      defaultValue: 'Lark',
                    })}
                    disabled
                  >
                    <img
                      src={larkIcon}
                      alt=""
                      className="h-4 w-4 shrink-0 rounded-lg object-contain"
                      aria-hidden
                    />
                    {t('layout.channels-lark', { defaultValue: 'Lark' })}
                    <span className="ml-auto rounded-full bg-ds-bg-neutral-muted-default px-2 py-0.5 text-label-xs text-ds-text-neutral-muted-default">
                      {comingSoonLabel}
                    </span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    tone="default"
                    emphasis="default"
                    size="sm"
                    buttonContent="text"
                    className="no-drag w-full justify-start gap-2"
                    aria-label={t('layout.channels-whatsapp', {
                      defaultValue: 'WhatsApp',
                    })}
                    disabled
                  >
                    <img
                      src={whatsappIcon}
                      alt=""
                      className="h-4 w-4 shrink-0 object-contain"
                      aria-hidden
                    />
                    {t('layout.channels-whatsapp', {
                      defaultValue: 'WhatsApp',
                    })}
                    <span className="ml-auto rounded-full bg-ds-bg-neutral-muted-default px-2 py-0.5 text-label-xs text-ds-text-neutral-muted-default">
                      {comingSoonLabel}
                    </span>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {/* Center section: header + content */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* Header toolbar */}
        <div
          className={cn(
            'relative flex h-[44px] w-full shrink-0 flex-row items-center justify-start gap-1',
            !isNewProjectVariant && 'px-3'
          )}
        >
          {!isNewProjectVariant && workspaceSubPage === null && (
            <TooltipSimple
              content={workWithPanelToggleLabel}
              delayDuration={300}
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                buttonContent="icon-only"
                onClick={() => setWorkspaceWorkWithPanelOpen((open) => !open)}
                aria-expanded={workspaceWorkWithPanelOpen}
                aria-controls="workspace-work-with-panel"
                className="no-drag shrink-0 text-ds-text-neutral-muted-default hover:bg-ds-bg-neutral-strong-default"
                aria-label={workWithPanelToggleLabel}
              >
                <Cast className="h-4 w-4" aria-hidden />
              </Button>
            </TooltipSimple>
          )}
          {!isNewProjectVariant && workspaceSubPage !== null && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              buttonContent="text"
              onClick={() => setWorkspaceSubPage(null)}
              className="no-drag shrink-0"
              aria-label={t('layout.back-to-workspace-tooltip')}
            >
              <ArrowLeft aria-hidden />
              {t('layout.back')}
            </Button>
          )}
          {!isNewProjectVariant && workspaceSubPage !== null && (
            <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <span className="block max-w-[60vw] truncate text-center !text-label-sm font-semibold text-ds-text-neutral-default-default">
                {SUB_PAGE_TITLES[workspaceSubPage]}
              </span>
            </div>
          )}
          <div className="flex-1" />
          {!isNewProjectVariant &&
            workspaceSubPage === 'instruction-md' &&
            activeProjectId && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                buttonContent="text"
                className="no-drag shrink-0"
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent('workspace-instruction-md-save', {
                      detail: { projectId: activeProjectId },
                    })
                  );
                }}
              >
                Save
              </Button>
            )}
        </div>

        {/* Content */}
        <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
          {/* Sub-pages */}
          {!isNewProjectVariant &&
            workspaceSubPage === 'all-sessions' &&
            chatStore && (
              <WorkspaceAllSessions
                tasks={chatStore.tasks}
                activeTaskId={chatStore.activeTaskId}
                onSelectSession={(id) => {
                  chatStore.setActiveTaskId(id);
                  setActiveWorkspaceTab('project');
                  setWorkspaceSubPage(null);
                }}
                onDeleteSession={(id) => {
                  if (!window.confirm(t('layout.delete-task-confirmation')))
                    return;
                  const wasActive = chatStore.activeTaskId === id;
                  chatStore.removeTask(id);
                  if (wasActive) setActiveWorkspaceTab('workforce');
                  setWorkspaceSubPage(null);
                }}
              />
            )}
          {!isNewProjectVariant &&
            workspaceSubPage === 'instruction-md' &&
            activeProjectId && (
              <WorkspaceInstructionMd
                key={activeProjectId}
                projectId={activeProjectId}
              />
            )}

          {/* Main content (hidden when a sub-page is active) */}
          {workspaceSubPage === null && (
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col items-stretch overflow-hidden">
              <div
                className={cn(
                  'flex min-h-0 w-full flex-1 flex-col',
                  !isNewProjectVariant && 'px-3'
                )}
              >
                {composer}

                <div
                  className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto pt-6"
                  id="workspace-bottom-group"
                >
                  {showBottomExamplePrompts ? (
                    <WorkspaceExamplePrompts
                      onSelectPrompt={setMessage}
                      disabled={!hasModel}
                    />
                  ) : chatStore ? (
                    <WorkspaceRecentSessions
                      tasks={chatStore.tasks}
                      activeTaskId={chatStore.activeTaskId}
                      onSelectSession={(id) => {
                        chatStore.setActiveTaskId(id);
                        setActiveWorkspaceTab('project');
                      }}
                      onOpenAllSessions={() =>
                        setWorkspaceSubPage('all-sessions')
                      }
                    />
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {sidePanel}
    </div>
  );
}
