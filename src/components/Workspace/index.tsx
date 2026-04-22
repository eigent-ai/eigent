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
import { AddWorker } from '@/components/AddWorker';
import BottomBox from '@/components/ChatBox/BottomBox';
import { Button } from '@/components/ui/button';
import { TooltipSimple } from '@/components/ui/tooltip';
import { BASE_WORKFLOW_AGENTS } from '@/components/WorkFlow/baseWorkers';
import { isBaseWorkflowAgent } from '@/components/Workspace/FoldedAgentCard';
import { SingleAgentList } from '@/components/Workspace/SingleAgentList';
import { WorkforceAgentList } from '@/components/Workspace/WorkforceAgentList';
import { WorkspaceExamplePrompts } from '@/components/Workspace/WorkspaceExamplePrompts';
import { WorkspaceProjectPicker } from '@/components/Workspace/WorkspaceProjectPicker';
import { WorkspaceRecentSessions } from '@/components/Workspace/WorkspaceRecentSessions';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useAuthStore, useWorkerList } from '@/store/authStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectStore } from '@/store/projectStore';
import { SessionMode } from '@/types/constants';
import { Cast, MonitorSmartphone, Puzzle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

const EMPTY_TASK_ASSIGNING: Agent[] = [];

/**
 * Workspace tab: project landing with a centered task input.
 * After the user starts a task, it switches to the session tab.
 */
export default function Workspace() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { chatStore, projectStore } = useChatStoreAdapter();
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const activeProject = useProjectStore((s) =>
    s.activeProjectId ? s.projects[s.activeProjectId] : null
  );
  const isEmptyProject = useProjectStore((s) => s.isEmptyProject);
  const customAgentFolderPath = usePageTabStore((s) =>
    activeProjectId
      ? s.customAgentFolderPathByProjectId[activeProjectId]
      : undefined
  );
  const showWorkspaceExamplePrompts = useMemo(() => {
    if (!activeProject) return false;
    if (customAgentFolderPath) return false;
    if (!isEmptyProject(activeProject)) return false;
    if (activeProject.metadata?.historyId) return false;
    if (activeProject.metadata?.tags?.includes('replay')) return false;
    return true;
  }, [activeProject, customAgentFolderPath, isEmptyProject]);
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);
  const sessionSidePanelMode = usePageTabStore(
    (s) => s.sessionSidePanelMode ?? SessionMode.WORKFORCE
  );
  const setSessionSidePanelMode = usePageTabStore(
    (s) => s.setSessionSidePanelMode
  );
  const workerList = useWorkerList();
  const { modelType, setWorkerList } = useAuthStore();

  const [message, setMessage] = useState('');
  const [hasModel, setHasModel] = useState(false);
  const [useCloudModelInDev, setUseCloudModelInDev] = useState(false);
  const [addWorkerDialogOpen, setAddWorkerDialogOpen] = useState(false);
  const [workspaceWorkWithPanelOpen, setWorkspaceWorkWithPanelOpen] =
    useState(false);
  const textareaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!workspaceWorkWithPanelOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWorkspaceWorkWithPanelOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [workspaceWorkWithPanelOpen]);

  const checkModelConfig = useCallback(async () => {
    try {
      if (modelType === 'cloud') {
        const res = await proxyFetchGet('/api/v1/user/key');
        setHasModel(!!res.value);
      } else if (modelType === 'local' || modelType === 'custom') {
        const res = await proxyFetchGet('/api/v1/providers', { prefer: true });
        const providerList = res.items || [];
        setHasModel(providerList.length > 0);
      } else {
        setHasModel(false);
      }
    } catch (err) {
      console.error('Failed to check model config:', err);
      setHasModel(false);
    }
  }, [modelType]);

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

  useEffect(() => {
    checkModelConfig();
  }, [modelType, checkModelConfig]);

  useEffect(() => {
    if (location.pathname === '/') {
      checkModelConfig();
    }
  }, [location.pathname, checkModelConfig]);

  const handleSend = async () => {
    if (
      !message.trim() ||
      !chatStore?.activeTaskId ||
      !projectStore.activeProjectId
    ) {
      return;
    }

    if (!hasModel) {
      toast.error('Please select a model first.');
      navigate('/history?tab=agents');
      return;
    }

    const taskId = chatStore.activeTaskId;
    chatStore.setHasMessages(taskId, true);
    const attachesToSend =
      JSON.parse(JSON.stringify(chatStore.tasks[taskId]?.attaches)) || [];

    // Enter the live session immediately; task startup continues in the background.
    setActiveWorkspaceTab('session');

    try {
      await chatStore.startTask(
        taskId,
        undefined,
        undefined,
        undefined,
        message.trim(),
        attachesToSend,
        undefined
      );
      chatStore.setHasWaitComfirm(taskId, true);
      chatStore.setAttaches(taskId, []);
      setMessage('');
    } catch (err: unknown) {
      setActiveWorkspaceTab('workforce');
      console.error('Failed to start task:', err);
      toast.error(
        err instanceof Error
          ? err.message
          : t('layout.failed-to-start-task', {
              defaultValue:
                'Failed to start task. Please check your model configuration.',
            })
      );
    }
  };

  const handleFileSelect = useCallback(async () => {
    if (!chatStore?.activeTaskId) return;
    try {
      const result = await window.electronAPI.selectFile({
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
  }, [chatStore, t]);

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
      window.electronAPI?.hideAllWebview?.();
    },
    [chatStore]
  );

  const onAgentDetailFromMenu = useCallback(
    (agentId: string) => {
      onSelectAgent(agentId);
      setActiveWorkspaceTab('session');
    },
    [onSelectAgent, setActiveWorkspaceTab]
  );

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

  const workWithPanelToggleLabel = workspaceWorkWithPanelOpen
    ? t('layout.workspace-work-with-panel-hide', {
        defaultValue: 'Hide Work with panel',
      })
    : t('layout.workspace-work-with-panel-show', {
        defaultValue: 'Show Work with panel',
      });

  return (
    <div className="min-h-0 relative flex h-full w-full flex-col">
      <div className="px-3 relative z-50 flex h-[44px] w-full shrink-0 flex-row items-center justify-start">
        <TooltipSimple content={workWithPanelToggleLabel} delayDuration={300}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
            onClick={() => setWorkspaceWorkWithPanelOpen((open) => !open)}
            aria-expanded={workspaceWorkWithPanelOpen}
            aria-controls="workspace-work-with-panel"
            className="no-drag text-ds-text-neutral-muted-default hover:bg-ds-bg-neutral-strong-default shrink-0"
            aria-label={workWithPanelToggleLabel}
          >
            <Cast className="h-4 w-4" aria-hidden />
          </Button>
        </TooltipSimple>
      </div>
      <div className="min-h-0 relative z-0 flex w-full flex-1 flex-col items-stretch overflow-hidden">
        <div className="min-h-0 px-3 flex w-full flex-1 flex-col">
          <div className="mx-auto flex w-full max-w-[600px] shrink-0 flex-col">
            <div className="min-w-0 flex min-h-[50vh] w-full flex-col justify-end">
              <div className="mb-6 flex w-full justify-center">
                <WorkspaceProjectPicker />
              </div>
              <span className="mb-6 text-ds-text-neutral-default-default text-heading-lg font-bold w-full text-center">
                {sessionSidePanelMode === SessionMode.SINGLE_AGENT
                  ? t('layout.workspace-cowork-single-agent', {
                      defaultValue: 'Cowork with Single Agent',
                    })
                  : t('layout.workspace-cowork-workforce', {
                      defaultValue: 'Cowork with Workforce',
                    })}
              </span>
              <div className="px-5 mb-6 flex w-full justify-center">
                {sessionSidePanelMode === SessionMode.SINGLE_AGENT ? (
                  <SingleAgentList />
                ) : (
                  <WorkforceAgentList
                    sortedAgents={sortedAgents}
                    activeAgentId={activeAgentId}
                    onSelectAgent={onSelectAgent}
                    onAgentDetailFromMenu={onAgentDetailFromMenu}
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
                      chatStore.tasks[chatStore.activeTaskId]?.attaches?.map(
                        (f) => ({
                          fileName: f.fileName,
                          filePath: f.filePath,
                        })
                      ) || [],
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
                    placeholder: t('layout.project-task-placeholder', {
                      defaultValue: 'Describe what you want to accomplish...',
                    }),
                    sessionMode: sessionSidePanelMode,
                    onSessionModeChange: setSessionSidePanelMode,
                    sessionModeSelectInteractive: true,
                  }}
                />
              </div>
              <AddWorker
                isOpen={addWorkerDialogOpen}
                onOpenChange={setAddWorkerDialogOpen}
              />
            </div>
          </div>

          <div
            className="min-h-0 pt-6 flex w-full flex-1 flex-col overflow-y-auto"
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
                  setActiveWorkspaceTab('session');
                }}
              />
            )}
          </div>
        </div>
      </div>

      {workspaceWorkWithPanelOpen ? (
        <>
          <button
            type="button"
            className="inset-0 absolute z-40 cursor-default bg-transparent backdrop-blur-[1px]"
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
            className="left-0 top-8 ease-out animate-in fade-in-0 slide-in-from-left-2 absolute z-50 flex max-h-[calc(100%-2.75rem)] w-[300px] flex-col overflow-y-auto duration-200"
          >
            <div className="gap-3 p-3 flex flex-col">
              <div className="rounded-xl border-ds-border-neutral-subtle-default bg-ds-bg-neutral-subtle-default min-w-0 p-3 flex flex-col border border-solid">
                <span
                  id="workspace-work-with-heading"
                  className="text-ds-text-neutral-default-default text-body-sm font-semibold"
                >
                  {t('layout.workspace-work-with-title', {
                    defaultValue: 'Work with',
                  })}
                </span>
                <div className="mt-3 gap-1 flex flex-col">
                  <Button
                    type="button"
                    variant="ghost"
                    tone="default"
                    emphasis="default"
                    size="sm"
                    buttonContent="text"
                    className="no-drag gap-2 justify-start"
                  >
                    <MonitorSmartphone
                      className="text-ds-text-neutral-muted-default h-4 w-4 shrink-0"
                      aria-hidden
                    />
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
                    className="no-drag gap-2 justify-start"
                  >
                    <Puzzle
                      className="text-ds-text-neutral-muted-default h-4 w-4 shrink-0"
                      aria-hidden
                    />
                    {t('layout.workspace-work-with-browser-extension', {
                      defaultValue: 'Browser extension',
                    })}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
