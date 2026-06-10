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

import { AddWorker } from '@/components/AddWorker';
import BottomBox, { type FileAttachment } from '@/components/ChatBox/BottomBox';
import { SESSION_SIDE_PANEL_CONTENT_WIDTH_CLASS } from '@/components/Session/sessionSidePanelLayout';
import { Button } from '@/components/ui/button';
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
import { resolveProjectNavLeadPresentation } from '@/lib/sessionNavLead';
import { isLegacySpace, isLocalWorkspaceSpace } from '@/lib/spaceLabel';
import { createSyncedProjectInSpace } from '@/lib/spaceProject';
import { cn } from '@/lib/utils';
import { useAuthStore, useWorkerList } from '@/store/authStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import {
  getVisibleProjectMetasForSpace,
  useSpaceStore,
} from '@/store/spaceStore';
import {
  ChatTaskStatus,
  SessionMode,
  type SessionModeType,
} from '@/types/constants';
import { ArrowLeft } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

const EMPTY_TASK_ASSIGNING: Agent[] = [];

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
  // Legacy Spaces are read-only — new Projects can't be started inside them.
  const isLegacyActiveSpace = activeSpace ? isLegacySpace(activeSpace) : false;
  const activeProjectMeta = useSpaceStore((s) =>
    activeProjectId ? s.getProjectMeta(activeProjectId) : null
  );
  const projectsBySpaceId = useSpaceStore((s) => s.projectsBySpaceId);
  const navLeadByProjectId = useProjectRuntimeStore(
    (s) => s.navLeadByProjectId
  );
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
  const navProjects = useMemo(() => {
    if (!activeSpaceId) return [];
    return getVisibleProjectMetasForSpace(projectsBySpaceId, activeSpaceId)
      .filter((project) => {
        if (project.metadata?.historyId) return true;
        const historyDisplayName =
          typeof project.metadata?.historyDisplayName === 'string'
            ? project.metadata.historyDisplayName.trim()
            : '';
        if (historyDisplayName) return true;
        const normalizedName = (project.name ?? '').trim().toLowerCase();
        return (
          Boolean(normalizedName) &&
          normalizedName !== 'new project' &&
          normalizedName !== 'new space'
        );
      })
      .map((project) => ({
        id: project.id,
        title:
          project.name && project.name !== 'new project'
            ? project.name
            : t('layout.new-project'),
        sessionLead: resolveProjectNavLeadPresentation({
          cachedLead: navLeadByProjectId[project.id],
          isHistoryLoading: false,
        }),
      }));
  }, [activeSpaceId, navLeadByProjectId, projectsBySpaceId, t]);

  const handleSelectProject = useCallback((projectId: string) => {
    useProjectRuntimeStore.getState().setActiveProject(projectId);
    usePageTabStore.getState().setActiveWorkspaceTab('project');
  }, []);

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
  const effectiveSessionMode = controlledSessionMode ?? draftSessionMode;

  const setActiveProjectMode = useCallback(
    (mode: SessionModeType) => {
      if (onSessionModeChange) {
        onSessionModeChange(mode);
        return;
      }
      setDraftSessionMode(mode);
    },
    [onSessionModeChange]
  );

  const [message, setMessage] = useState('');
  const [draftFiles, setDraftFiles] = useState<FileAttachment[]>([]);
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
    'all-sessions': t('layout.projects'),
    'instruction-md': t('layout.instructions-rules-tone'),
  };
  const [memoryOn, setMemoryOn] = useState(readMemoryInitial);
  const textareaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.localStorage.setItem(MEMORY_STORAGE_KEY, String(memoryOn));
  }, [memoryOn]);

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

    if (directProjectStartRef.current) {
      return;
    }
    directProjectStartRef.current = true;
    setIsStartingDirectProject(true);

    try {
      if (!activeSpaceId) {
        toast.error(t('layout.spaces-create-failed'));
        return;
      }

      if (isLegacyActiveSpace) {
        toast.error(
          t('layout.spaces-legacy-readonly-hint', {
            defaultValue:
              'Legacy Spaces are read-only. Create a new Space to start a Project.',
          })
        );
        return;
      }

      const projectStore = useProjectRuntimeStore.getState();
      const syncedProject = await createSyncedProjectInSpace({
        projectStore,
        spaceId: activeSpaceId,
        name: trimmedMessage.slice(0, 120),
        mode: effectiveSessionMode,
        workdirMode: isLocalWorkspaceSpace(activeSpace)
          ? 'direct-write'
          : 'artifact-only',
        metadata: {
          createdFrom: 'workspace_direct_chat',
        },
      });
      useSpaceStore.getState().setActiveSpace(syncedProject.spaceId);
      const targetProjectId = syncedProject.projectId;
      const targetChatStore =
        useProjectRuntimeStore
          .getState()
          .getActiveChatStore(targetProjectId)
          ?.getState() ?? null;

      if (!targetProjectId || !targetChatStore?.activeTaskId) {
        throw new Error('No active Project chat available');
      }

      const taskId = targetChatStore.activeTaskId;
      targetChatStore.setHasMessages(taskId, true);
      const attachesToSend = JSON.parse(JSON.stringify(draftFiles)) || [];
      targetChatStore.setAttaches(taskId, attachesToSend);

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
      setDraftFiles([]);
      setMessage('');
    } catch (err: unknown) {
      setActiveWorkspaceTab('workforce');
      console.error('Failed to start task:', err);
      toast.error(
        err instanceof Error ? err.message : t('layout.failed-to-start-task')
      );
    } finally {
      directProjectStartRef.current = false;
      setIsStartingDirectProject(false);
    }
  };

  const handleFileSelect = useCallback(async () => {
    try {
      const result = await host?.electronAPI?.selectFile({
        title: t('chat.select-file'),
        filters: [{ name: t('chat.all-files'), extensions: ['*'] }],
      });

      if (result?.success && result.files && result.files.length > 0) {
        setDraftFiles((existingFiles) => [
          ...existingFiles,
          ...result.files.filter(
            (r: File) => !existingFiles.some((f) => f.filePath === r.filePath)
          ),
        ]);
      }
    } catch (error) {
      console.error('Select File Error:', error);
    }
  }, [host, t]);

  const buildComposerInputProps = () => ({
    value: message,
    onChange: setMessage,
    onSend: handleSend,
    files: draftFiles,
    onFilesChange: setDraftFiles,
    onAddFile: handleFileSelect,
    disabled: !hasModel || isStartingDirectProject || isLegacyActiveSpace,
    textareaRef,
    allowDragDrop: true,
    useCloudModelInDev,
    placeholder: isLegacyActiveSpace
      ? t('layout.spaces-legacy-readonly-hint', {
          defaultValue:
            'Legacy Spaces are read-only. Create a new Space to start a Project.',
        })
      : t('layout.project-task-placeholder'),
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
          inputProps={buildComposerInputProps()}
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
          />
        </div>
      </div>
    ) : null;

  return (
    <div className="relative z-[1] flex h-full min-h-0 w-full min-w-0 flex-row overflow-hidden">
      {/* Center section: header + content */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* Header toolbar */}
        <div
          className={cn(
            'relative flex h-[44px] w-full shrink-0 flex-row items-center justify-start gap-1',
            !isNewProjectVariant && 'px-3'
          )}
        >
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
          {!isNewProjectVariant && workspaceSubPage === 'all-sessions' && (
            <WorkspaceAllSessions
              projects={navProjects}
              activeProjectId={activeProjectId}
              onProjectClick={(id) => {
                handleSelectProject(id);
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
                  ) : navProjects.length > 0 ? (
                    <WorkspaceRecentSessions
                      projects={navProjects}
                      activeProjectId={activeProjectId}
                      onProjectClick={handleSelectProject}
                      onOpenAllProjects={() =>
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
