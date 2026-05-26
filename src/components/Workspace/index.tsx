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
import BottomBox from '@/components/ChatBox/BottomBox';
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
import { cn } from '@/lib/utils';
import { useAuthStore, useWorkerList } from '@/store/authStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSpaceStore } from '@/store/spaceStore';
import { ChatTaskStatus, SessionMode } from '@/types/constants';
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
   * `'new-project'`: only the centered composer, for the New Project page.
   */
  variant?: 'workspace' | 'new-project';
}

/**
 * Workspace tab: project landing with a centered task input.
 * After the user starts a task, it switches to the Project chat tab.
 */
export default function Workspace({ variant = 'workspace' }: WorkspaceProps) {
  const { t } = useTranslation();
  const isNewProjectVariant = variant === 'new-project';
  const navigate = useNavigate();
  const host = useHost();
  const { chatStore } = useChatStoreAdapter();
  const activeProjectId = useProjectRuntimeStore((s) => s.activeProjectId);
  const activeProject = useProjectRuntimeStore((s) =>
    s.activeProjectId ? s.projects[s.activeProjectId] : null
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
  // Workspace is the pre-Run Project landing. Project.mode is the source of
  // truth; the old sessionSidePanelMode global is retained only as a migration
  // shim in pageTabStore.
  const effectiveSessionMode =
    activeProjectMeta?.mode ?? activeProject?.mode ?? SessionMode.SINGLE_AGENT;

  const setActiveProjectMode = useCallback(
    (mode: typeof effectiveSessionMode) => {
      if (!activeProjectId) return;
      updateProjectMeta(activeProjectId, { mode });
    },
    [activeProjectId, updateProjectMeta]
  );

  const [message, setMessage] = useState('');
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
    if (!message.trim() || !chatStore?.activeTaskId || !activeProjectId) {
      return;
    }

    if (!hasModel) {
      toast.error(t('layout.please-select-model-first'));
      navigate('/history?tab=agents');
      return;
    }

    const taskId = chatStore.activeTaskId;
    if (activeProjectId && !(activeProjectMeta?.mode ?? activeProject?.mode)) {
      updateProjectMeta(activeProjectId, {
        mode: effectiveSessionMode,
      });
    }
    chatStore.setHasMessages(taskId, true);
    const attachesToSend =
      JSON.parse(JSON.stringify(chatStore.tasks[taskId]?.attaches)) || [];

    // Enter the live Project immediately; task startup continues in the background.
    setActiveWorkspaceTab('project');

    try {
      await chatStore.startTask(
        taskId,
        undefined,
        undefined,
        undefined,
        message.trim(),
        attachesToSend,
        undefined,
        undefined,
        effectiveSessionMode
      );
      chatStore.setHasWaitComfirm(taskId, true);
      chatStore.setAttaches(taskId, []);
      setMessage('');
    } catch (err: unknown) {
      setActiveWorkspaceTab('workforce');
      console.error('Failed to start task:', err);
      toast.error(
        err instanceof Error ? err.message : t('layout.failed-to-start-task')
      );
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

  if (!chatStore?.activeTaskId) {
    return null;
  }

  const activeAgentId = chatStore.tasks[chatStore.activeTaskId]?.activeAgent;

  const projectPicker =
    isNewProjectVariant && !isFreshProject ? (
      <WorkspaceProjectPicker readOnly />
    ) : (
      <WorkspaceProjectPicker />
    );

  const composer = (
    <div className="mx-auto my-auto flex w-full max-w-[600px] shrink-0 flex-col">
      <div className="flex min-h-[50vh] w-full min-w-0 flex-col justify-end">
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
        <div className="w-full">
          <BottomBox
            state="input"
            queuedMessages={[]}
            onRemoveQueuedMessage={() => {}}
            noModelOverlay={!hasModel}
            onSelectModel={() => navigate('/history?tab=agents')}
            inputProps={{
              value: message,
              onChange: setMessage,
              onSend: handleSend,
              files:
                chatStore.tasks[chatStore.activeTaskId]?.attaches?.map((f) => ({
                  fileName: f.fileName,
                  filePath: f.filePath,
                })) || [],
              onFilesChange: (files) =>
                chatStore.setAttaches(
                  chatStore.activeTaskId as string,
                  files as any
                ),
              onAddFile: handleFileSelect,
              disabled: !hasModel,
              textareaRef,
              allowDragDrop: true,
              useCloudModelInDev,
              placeholder: t('layout.project-task-placeholder'),
              sessionMode: effectiveSessionMode,
              onSessionModeChange: setActiveProjectMode,
              sessionModeSelectInteractive: true,
            }}
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
      </div>
    </div>
  );

  if (isNewProjectVariant) {
    return (
      <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
        {/* Empty header toolbar — matches the workspace page vertical structure */}
        <div className="relative flex h-[44px] w-full shrink-0 flex-row items-center justify-start gap-1" />
        <div className="relative z-0 flex min-h-0 min-w-0 flex-1 flex-col items-stretch overflow-hidden">
          <div className="flex min-h-0 w-full flex-1 flex-col">
            {composer}
            <div
              className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto pt-6"
              id="workspace-bottom-group"
            >
              <WorkspaceExamplePrompts
                onSelectPrompt={setMessage}
                disabled={!hasModel}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-row overflow-hidden">
      {/* Center section: header + content */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* Header toolbar */}
        <div className="relative flex h-[44px] w-full shrink-0 flex-row items-center justify-start gap-1 px-3">
          {workspaceSubPage !== null && (
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
          {workspaceSubPage !== null && (
            <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <span className="block max-w-[60vw] truncate text-center !text-label-sm font-semibold text-ds-text-neutral-default-default">
                {SUB_PAGE_TITLES[workspaceSubPage]}
              </span>
            </div>
          )}
          <div className="flex-1" />
          {workspaceSubPage === 'instruction-md' && activeProjectId && (
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
          {workspaceSubPage === 'all-sessions' && (
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
          {workspaceSubPage === 'instruction-md' && activeProjectId && (
            <WorkspaceInstructionMd
              key={activeProjectId}
              projectId={activeProjectId}
            />
          )}

          {/* Main content (hidden when a sub-page is active) */}
          {workspaceSubPage === null && (
            <div className="relative z-0 flex min-h-0 min-w-0 flex-1 flex-col items-stretch overflow-hidden">
              <div className="flex min-h-0 w-full flex-1 flex-col px-3">
                {composer}

                <div
                  className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto pt-6"
                  id="workspace-bottom-group"
                >
                  {showWorkspaceExamplePrompts ? (
                    <WorkspaceExamplePrompts
                      onSelectPrompt={setMessage}
                      disabled={!hasModel}
                    />
                  ) : (
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
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right section: instructions + onboarding panel */}
      {workspaceSubPage === null && (
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
      )}
    </div>
  );
}
