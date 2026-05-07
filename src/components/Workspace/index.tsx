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
import { useModelConfigCheck } from '@/hooks/useModelConfigCheck';
import { useHost } from '@/host';
import { cn } from '@/lib/utils';
import { useAuthStore, useWorkerList } from '@/store/authStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectStore } from '@/store/projectStore';
import { SessionMode } from '@/types/constants';
import { Cast, MonitorSmartphone, PenLine, ScrollText } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

// ─── Cowork side panel ────────────────────────────────────────────────────────

type CoworkPanelContent = 'work-with' | 'instructions' | null;

const MEMORY_STORAGE_KEY = 'eigent-sidebar-instructions-memory-on';

function readMemoryInitial(): boolean {
  if (typeof window === 'undefined') return true;
  const v = window.localStorage.getItem(MEMORY_STORAGE_KEY);
  return v === null ? true : v === 'true';
}

function CoworkSidePanel({ content }: { content: CoworkPanelContent }) {
  const { t } = useTranslation();
  const requestWorkspaceChatFocus = usePageTabStore(
    (s) => s.requestWorkspaceChatFocus
  );
  const [memoryOn, setMemoryOn] = useState(readMemoryInitial);

  useEffect(() => {
    window.localStorage.setItem(MEMORY_STORAGE_KEY, String(memoryOn));
  }, [memoryOn]);

  const rowClass =
    'flex items-center justify-between gap-2 rounded-lg py-2 px-3 hover:bg-ds-bg-neutral-subtle-default transition-colors';
  const labelClass =
    'text-body-sm font-medium text-ds-text-neutral-muted-default min-w-0 flex-1';

  return (
    // Outer shell: width transitions 0 ↔ 280px; overflow-hidden clips inner content.
    <div
      aria-hidden={!content}
      className={cn(
        'ease-in-out relative z-20 shrink-0 overflow-hidden transition-[width] duration-300',
        content ? 'w-[280px]' : 'w-0'
      )}
    >
      {/* Inner card: fixed width, margin + border + rounded */}
      <div className="m-2 rounded-2xl border-ds-border-neutral-subtle-default bg-ds-bg-neutral-subtle-default flex h-[calc(100%-1rem)] w-[calc(280px-1rem)] flex-col overflow-y-auto border border-solid">
        {content === 'work-with' && (
          <div className="gap-1 p-2 flex flex-col">
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
                className="h-4 w-4 text-ds-text-neutral-muted-default shrink-0"
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
              <img
                src={telegramIcon}
                alt=""
                className="h-4 w-4 shrink-0 object-contain"
                aria-hidden
              />
              {t('layout.channels-telegram', { defaultValue: 'Telegram' })}
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
              <img
                src={larkIcon}
                alt=""
                className="h-4 w-4 rounded-lg shrink-0 object-contain"
                aria-hidden
              />
              {t('layout.channels-lark', { defaultValue: 'Lark' })}
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
              <img
                src={whatsappIcon}
                alt=""
                className="h-4 w-4 shrink-0 object-contain"
                aria-hidden
              />
              {t('layout.channels-whatsapp', { defaultValue: 'WhatsApp' })}
            </Button>
          </div>
        )}

        {content === 'instructions' && (
          <div className="gap-0.5 p-2 flex flex-col">
            <div className={rowClass}>
              <span className={labelClass}>
                {t('layout.instructions-rules-tone', {
                  defaultValue: 'Rules & Tone',
                })}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                buttonContent="icon-only"
                aria-label={t('layout.edit-instructions', {
                  defaultValue: 'Edit instructions',
                })}
                onClick={requestWorkspaceChatFocus}
              >
                <PenLine className="h-4 w-4 shrink-0" aria-hidden />
              </Button>
            </div>
            <div className={rowClass}>
              <span className={labelClass}>
                {t('layout.memory', { defaultValue: 'Memory' })}
              </span>
              <Button
                type="button"
                variant="secondary"
                size="xs"
                onClick={() => setMemoryOn((v) => !v)}
                aria-pressed={memoryOn}
              >
                {memoryOn
                  ? t('layout.memory-on', { defaultValue: 'On' })
                  : t('layout.memory-off', { defaultValue: 'Off' })}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const EMPTY_TASK_ASSIGNING: Agent[] = [];

/**
 * Workspace tab: project landing with a centered task input.
 * After the user starts a task, it switches to the session tab.
 */
export default function Workspace() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const host = useHost();
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
  const { hasModel } = useModelConfigCheck();
  const [useCloudModelInDev, setUseCloudModelInDev] = useState(false);
  const [addWorkerDialogOpen, setAddWorkerDialogOpen] = useState(false);
  const [editingWorkerAgent, setEditingWorkerAgent] = useState<Agent | null>(
    null
  );
  const [panelContent, setPanelContent] = useState<CoworkPanelContent>(null);
  const textareaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!panelContent) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanelContent(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [panelContent]);

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

  const togglePanel = (target: 'work-with' | 'instructions') => {
    setPanelContent((cur) => (cur === target ? null : target));
  };

  return (
    <div className="min-h-0 flex h-full w-full flex-col">
      {/* Header: panel toggle buttons */}
      <div className="border-ds-border-neutral-subtle-default px-3 gap-1 flex h-[44px] w-full shrink-0 flex-row items-center border-b">
        <TooltipSimple
          content={t('layout.workspace-work-with-title', {
            defaultValue: 'Work with',
          })}
          delayDuration={300}
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
            onClick={() => togglePanel('work-with')}
            aria-pressed={panelContent === 'work-with'}
            className={cn(
              'no-drag shrink-0',
              panelContent === 'work-with'
                ? 'bg-ds-bg-neutral-strong-default text-ds-text-neutral-default-default'
                : 'text-ds-text-neutral-muted-default hover:bg-ds-bg-neutral-strong-default'
            )}
            aria-label={t('layout.workspace-work-with-title', {
              defaultValue: 'Work with',
            })}
          >
            <Cast className="h-4 w-4" aria-hidden />
          </Button>
        </TooltipSimple>
        <TooltipSimple
          content={t('layout.instructions', { defaultValue: 'Instructions' })}
          delayDuration={300}
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
            onClick={() => togglePanel('instructions')}
            aria-pressed={panelContent === 'instructions'}
            className={cn(
              'no-drag shrink-0',
              panelContent === 'instructions'
                ? 'bg-ds-bg-neutral-strong-default text-ds-text-neutral-default-default'
                : 'text-ds-text-neutral-muted-default hover:bg-ds-bg-neutral-strong-default'
            )}
            aria-label={t('layout.instructions', {
              defaultValue: 'Instructions',
            })}
          >
            <ScrollText className="h-4 w-4" aria-hidden />
          </Button>
        </TooltipSimple>
      </div>

      {/* Body: left panel + main content side by side */}
      <div className="min-h-0 flex w-full flex-1 flex-row overflow-hidden">
        {/* Left side panel */}
        <CoworkSidePanel content={panelContent} />

        {/* Main content area */}
        <div className="min-h-0 min-w-0 flex flex-1 flex-col items-stretch overflow-hidden">
          <div className="min-h-0 relative z-0 flex w-full flex-1 flex-col items-stretch overflow-hidden">
            <div className="min-h-0 px-3 flex w-full flex-1 flex-col">
              <div className="mx-auto flex w-full max-w-[600px] shrink-0 flex-col">
                <div className="min-w-0 flex min-h-[50vh] w-full flex-col justify-end">
                  <div className="mb-8 flex w-full justify-center">
                    <WorkspaceProjectPicker />
                  </div>
                  <span className="mb-8 text-heading-lg font-bold text-ds-text-neutral-default-default w-full text-center">
                    {sessionSidePanelMode === SessionMode.SINGLE_AGENT
                      ? t('layout.workspace-cowork-single-agent', {
                          defaultValue: 'Cowork with Single Agent',
                        })
                      : t('layout.workspace-cowork-workforce', {
                          defaultValue: 'Cowork with Workforce',
                        })}
                  </span>
                  <div className="mb-8 px-5 flex w-full justify-center">
                    {sessionSidePanelMode === SessionMode.SINGLE_AGENT ? (
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
                          chatStore.tasks[
                            chatStore.activeTaskId
                          ]?.attaches?.map((f) => ({
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
                        placeholder: t('layout.project-task-placeholder', {
                          defaultValue:
                            'Describe what you want to accomplish...',
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
                    onOpenAllSessions={() => setActiveWorkspaceTab('sessions')}
                  />
                )}
              </div>
            </div>
          </div>
          {/* end relative z-0 */}
        </div>
        {/* end main content area */}
      </div>
      {/* end body flex-row */}
    </div>
  );
}
