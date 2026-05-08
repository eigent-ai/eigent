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
import { WorkspaceWidgetPreview } from '@/components/Widget/WorkspaceWidgetPreview';
import { BASE_WORKFLOW_AGENTS } from '@/components/WorkFlow/baseWorkers';
import { isBaseWorkflowAgent } from '@/components/Workspace/FoldedAgentCard';
import { SingleAgentList } from '@/components/Workspace/SingleAgentList';
import { WorkforceAgentList } from '@/components/Workspace/WorkforceAgentList';
import { WorkspaceAllSessions } from '@/components/Workspace/WorkspaceAllSessions';
import { WorkspaceCoworkPanel } from '@/components/Workspace/WorkspaceCoworkPanel';
import { WorkspaceDispatch } from '@/components/Workspace/WorkspaceDispatch';
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
import { useProjectStore } from '@/store/projectStore';
import { useWidgetStore } from '@/store/widgetStore';
import { SessionMode } from '@/types/constants';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  Cast,
  MonitorSmartphone,
  PencilRuler,
  ScrollText,
} from 'lucide-react';
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
  const activeWorkspaceTab = usePageTabStore((s) => s.activeWorkspaceTab);
  const workspaceChatFocusRequestId = usePageTabStore(
    (s) => s.workspaceChatFocusRequestId
  );
  const sessionSidePanelMode = usePageTabStore(
    (s) => s.sessionSidePanelMode ?? SessionMode.WORKFORCE
  );
  const setSessionSidePanelMode = usePageTabStore(
    (s) => s.setSessionSidePanelMode
  );
  const workerList = useWorkerList();
  const { modelType, setWorkerList } = useAuthStore();
  const email = useAuthStore((s) => s.email);
  const widget = useWidgetStore((s) =>
    activeProjectId ? s.widgetsByProjectId[activeProjectId] : null
  );
  const widgetLoading = useWidgetStore((s) =>
    activeProjectId ? Boolean(s.loadingByProjectId[activeProjectId]) : false
  );
  const loadProjectWidget = useWidgetStore((s) => s.loadProjectWidget);

  const [message, setMessage] = useState('');
  const { hasModel } = useModelConfigCheck();
  const [useCloudModelInDev, setUseCloudModelInDev] = useState(false);
  const [addWorkerDialogOpen, setAddWorkerDialogOpen] = useState(false);
  const [editingWorkerAgent, setEditingWorkerAgent] = useState<Agent | null>(
    null
  );
  const [leftPanelTab, setLeftPanelTab] = useState<
    'instructions' | 'workWith' | null
  >(null);
  const [isWidgetPanelOpen, setIsWidgetPanelOpen] = useState(true);
  type WorkspaceSubPage = 'all-sessions' | 'instruction-md' | 'dispatch' | null;
  const [workspaceSubPage, setWorkspaceSubPage] =
    useState<WorkspaceSubPage>(null);
  const SUB_PAGE_TITLES: Record<NonNullable<WorkspaceSubPage>, string> = {
    'all-sessions': t('layout.sessions-full-title', {
      defaultValue: 'All sessions',
    }),
    'instruction-md': t('layout.instructions-rules-tone', {
      defaultValue: 'Rules & Tone',
    }),
    dispatch: t('layout.workspace-work-with-title', {
      defaultValue: 'Dispatch',
    }),
  };
  const [memoryOn, setMemoryOn] = useState(readMemoryInitial);
  const textareaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.localStorage.setItem(MEMORY_STORAGE_KEY, String(memoryOn));
  }, [memoryOn]);

  useEffect(() => {
    if (workspaceChatFocusRequestId === 0) return;
    if (activeWorkspaceTab !== 'workforce') return;
    const focusTimer = window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 180);
    return () => window.clearTimeout(focusTimer);
  }, [workspaceChatFocusRequestId, activeWorkspaceTab]);

  useEffect(() => {
    if (!activeProjectId || !email) return;
    void loadProjectWidget(activeProjectId, email, { quietMissing: true });
  }, [activeProjectId, email, loadProjectWidget]);

  useEffect(() => {
    setIsWidgetPanelOpen(true);
  }, [activeProjectId]);

  useEffect(() => {
    if (!leftPanelTab) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLeftPanelTab(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [leftPanelTab]);

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

  const handleLoadWidget = useCallback(async () => {
    if (!activeProjectId || !email) return;
    try {
      const loaded = await loadProjectWidget(activeProjectId, email);
      if (!loaded.exists) {
        toast.error('No widget folder found for this project.');
      } else {
        setIsWidgetPanelOpen(true);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to load widget.'
      );
    }
  }, [activeProjectId, email, loadProjectWidget]);

  const hasWidget = widget?.exists === true;

  const handleWidgetButtonClick = useCallback(() => {
    if (hasWidget) {
      setIsWidgetPanelOpen((open) => !open);
      return;
    }
    void handleLoadWidget();
  }, [handleLoadWidget, hasWidget]);

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

  const instructionsLabel = t('layout.instructions', {
    defaultValue: 'Instructions',
  });
  const workWithLabel = t('layout.workspace-work-with-title', {
    defaultValue: 'Work with',
  });

  return (
    <div className="min-h-0 flex h-full w-full flex-col">
      {/* Header toolbar */}
      <div className="px-3 gap-1 relative flex h-[44px] w-full shrink-0 flex-row items-center justify-start">
        {workspaceSubPage !== null && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              buttonContent="text"
              onClick={() => setWorkspaceSubPage(null)}
              className="no-drag shrink-0"
              aria-label={t('layout.back-to-workspace-tooltip', {
                defaultValue: 'Back to workspace',
              })}
            >
              <ArrowLeft aria-hidden />
              Back
            </Button>
          </>
        )}
        {workspaceSubPage !== null && (
          <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
            <span className="!text-label-sm font-semibold text-ds-text-neutral-default-default block max-w-[60vw] truncate text-center">
              {SUB_PAGE_TITLES[workspaceSubPage]}
            </span>
          </div>
        )}
        {workspaceSubPage === null && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            buttonContent="text"
            onClick={handleWidgetButtonClick}
            disabled={!hasWidget && widgetLoading}
            aria-expanded={hasWidget ? isWidgetPanelOpen : undefined}
            className="no-drag !text-label-sm gap-2 shrink-0"
          >
            <PencilRuler
              className={`h-4 w-4 text-ds-icon-neutral-default-default ${widgetLoading ? 'animate-pulse' : ''}`}
              aria-hidden
            />
            Widget
          </Button>
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
        {workspaceSubPage === null && (
          <>
            <TooltipSimple content={instructionsLabel} delayDuration={300}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                buttonContent="icon-only"
                onClick={() =>
                  setLeftPanelTab((prev) =>
                    prev === 'instructions' ? null : 'instructions'
                  )
                }
                aria-expanded={leftPanelTab === 'instructions'}
                aria-controls="workspace-right-panel"
                className={cn(
                  'no-drag shrink-0',
                  leftPanelTab === 'instructions'
                    ? 'bg-ds-bg-neutral-strong-default'
                    : 'hover:bg-ds-bg-neutral-strong-default'
                )}
                aria-label={instructionsLabel}
              >
                <ScrollText aria-hidden />
              </Button>
            </TooltipSimple>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              buttonContent="text"
              tone="default"
              textWeight="medium"
              onClick={() =>
                setLeftPanelTab((prev) =>
                  prev === 'workWith' ? null : 'workWith'
                )
              }
              aria-expanded={leftPanelTab === 'workWith'}
              aria-controls="workspace-right-panel"
              className={cn(
                'no-drag !text-label-sm gap-2 shrink-0',
                leftPanelTab === 'workWith'
                  ? 'bg-ds-bg-neutral-subtle-default'
                  : 'hover:bg-ds-bg-neutral-subtle-hover'
              )}
              aria-label="Dispatch"
            >
              <Cast aria-hidden />
              Dispatch
            </Button>
          </>
        )}
      </div>

      {/* Body: main content + right panel */}
      <div className="min-h-0 flex flex-1 flex-row overflow-hidden">
        {/* Sub-pages */}
        {workspaceSubPage === 'all-sessions' && (
          <WorkspaceAllSessions
            tasks={chatStore.tasks}
            activeTaskId={chatStore.activeTaskId}
            onSelectSession={(id) => {
              chatStore.setActiveTaskId(id);
              setActiveWorkspaceTab('session');
              setWorkspaceSubPage(null);
            }}
            onDeleteSession={(id) => {
              if (!window.confirm(t('layout.delete-task-confirmation'))) return;
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
        {workspaceSubPage === 'dispatch' && <WorkspaceDispatch />}

        {/* Main content + right panel (hidden when sub-page is active) */}
        {workspaceSubPage === null && (
          <>
            <AnimatePresence initial={false}>
              {hasWidget && isWidgetPanelOpen && widget && (
                <motion.div
                  key="workspace-widget-panel"
                  initial={{ width: 0, x: -16, opacity: 0 }}
                  animate={{ width: 280, x: 0, opacity: 1 }}
                  exit={{ width: 0, x: -16, opacity: 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="min-h-0 shrink-0 overflow-hidden"
                >
                  <WorkspaceWidgetPreview
                    widget={widget}
                    onOpen={() => setActiveWorkspaceTab('widget')}
                  />
                </motion.div>
              )}
            </AnimatePresence>
            <div className="min-h-0 min-w-0 relative z-0 flex flex-1 flex-col items-stretch overflow-hidden">
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
                      onOpenAllSessions={() =>
                        setWorkspaceSubPage('all-sessions')
                      }
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Right slide-in panel */}
            <AnimatePresence initial={false}>
              {leftPanelTab !== null && (
                <motion.div
                  key="workspace-right-panel"
                  id="workspace-right-panel"
                  initial={{ width: 0 }}
                  animate={{ width: 288 }}
                  exit={{ width: 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="pr-1 z-0 shrink-0 overflow-hidden"
                >
                  <div className="flex h-full w-[280px] flex-col overflow-hidden">
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.div
                        key={leftPanelTab}
                        initial={{ x: 12, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: -12, opacity: 0 }}
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                        className="flex h-full flex-col"
                      >
                        {leftPanelTab === 'instructions' ? (
                          <WorkspaceCoworkPanel
                            memoryOn={memoryOn}
                            onMemoryToggle={() => setMemoryOn((v) => !v)}
                            onEditInstructions={() => {
                              setLeftPanelTab(null);
                              setWorkspaceSubPage('instruction-md');
                            }}
                            onWorkforceSetting={() =>
                              setActiveWorkspaceTab('workforce')
                            }
                          />
                        ) : (
                          <>
                            <div className="px-2 py-1 rounded-2xl bg-ds-bg-neutral-default-default flex shrink-0 flex-col">
                              <span className="px-2 py-1.5 text-body-sm font-semibold text-ds-text-neutral-default-default">
                                {workWithLabel}
                              </span>
                              <div className="gap-2 py-1.5 flex flex-col">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  tone="default"
                                  emphasis="default"
                                  size="sm"
                                  buttonContent="text"
                                  className="no-drag gap-2 justify-start"
                                  onClick={() => {
                                    setLeftPanelTab(null);
                                    setWorkspaceSubPage('dispatch');
                                  }}
                                >
                                  <MonitorSmartphone
                                    className="h-4 w-4 text-ds-text-neutral-muted-default shrink-0"
                                    aria-hidden
                                  />
                                  {t(
                                    'layout.workspace-work-with-remote-control',
                                    {
                                      defaultValue: 'Remote control',
                                    }
                                  )}
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  tone="default"
                                  emphasis="default"
                                  size="sm"
                                  buttonContent="text"
                                  className="no-drag gap-2 justify-start"
                                  aria-label={t('layout.channels-telegram', {
                                    defaultValue: 'Telegram',
                                  })}
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
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  tone="default"
                                  emphasis="default"
                                  size="sm"
                                  buttonContent="text"
                                  className="no-drag gap-2 justify-start"
                                  aria-label={t('layout.channels-lark', {
                                    defaultValue: 'Lark',
                                  })}
                                >
                                  <img
                                    src={larkIcon}
                                    alt=""
                                    className="h-4 w-4 rounded-lg shrink-0 object-contain"
                                    aria-hidden
                                  />
                                  {t('layout.channels-lark', {
                                    defaultValue: 'Lark',
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
                                  aria-label={t('layout.channels-whatsapp', {
                                    defaultValue: 'WhatsApp',
                                  })}
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
                                </Button>
                              </div>
                            </div>
                          </>
                        )}
                      </motion.div>
                    </AnimatePresence>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </div>
  );
}
