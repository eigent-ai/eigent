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
import { useWorkforceChatInput } from '@/components/ChatBox/useWorkforceChatInput';
import { TooltipSimple } from '@/components/ui/tooltip';
import { BASE_WORKFLOW_AGENTS } from '@/components/WorkFlow/baseWorkers';
import { FoldedAgentCard } from '@/components/Workforce/FoldedPanel';
import { cn } from '@/lib/utils';
import { useAuthStore, useWorkerList } from '@/store/authStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { ChatTaskStatus } from '@/types/constants';
import {
  ArrowRight,
  ChevronDown,
  FileText,
  FolderClosed,
  FolderOpen,
  PinIcon,
  Plus,
  Store,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

/** Matches projectStore `isEmptyProject` task shape: brand-new task with no user/agent activity yet. */
function isEmptyPendingTask(task: {
  messages: unknown[];
  hasMessages?: boolean;
  summaryTask: string;
  progressValue: number;
  isPending: boolean;
  status: string;
  taskTime: number;
  tokens: number;
  elapsed: number;
  hasWaitComfirm: boolean;
  attaches?: unknown[];
  streamingDecomposeText?: string;
}): boolean {
  return (
    Array.isArray(task.messages) &&
    task.messages.length === 0 &&
    !task.hasMessages &&
    task.summaryTask === '' &&
    task.progressValue === 0 &&
    task.isPending === false &&
    task.status === ChatTaskStatus.PENDING &&
    task.taskTime === 0 &&
    task.tokens === 0 &&
    task.elapsed === 0 &&
    task.hasWaitComfirm === false &&
    (!task.attaches || task.attaches.length === 0) &&
    !task.streamingDecomposeText?.trim()
  );
}

type TaskLike = Parameters<typeof isEmptyPendingTask>[0];

function chatStoreHasRealTaskSession(cs: {
  getState: () => { tasks: Record<string, TaskLike> };
}) {
  const tasks = Object.values(cs.getState().tasks);
  if (tasks.length === 0) return false;
  return tasks.some((task) => !isEmptyPendingTask(task));
}

export default function WorkspaceProjectPage() {
  const { t } = useTranslation();
  const email = useAuthStore((s) => s.email);
  const workerList = useWorkerList();
  const [addWorkerOpen, setAddWorkerOpen] = useState(false);
  const setWorkforceShellView = usePageTabStore((s) => s.setWorkforceShellView);
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomBoxOverlayRef = useRef<HTMLDivElement>(null);

  const {
    chatStore,
    projectStore,
    message,
    setMessage,
    textareaRef,
    taskTime,
    loading,
    isPauseResumeLoading,
    useCloudModelInDev,
    queuedMessages,
    handleRemoveTaskQueue,
    getBottomBoxState,
    handleSend,
    handleConfirmTask,
    handleFileSelect,
    handlePauseResume,
    handleEditQuery,
    hasAnyMessages,
    isInputDisabled,
  } = useWorkforceChatInput({
    scrollContainerRef,
    bottomBoxOverlayRef,
    measureScrollBottomInset: false,
  });

  const activeProjectId = projectStore.activeProjectId;

  const toggleHistorySidebar = useSidebarStore((s) => s.toggle);
  const historySidebarOpen = useSidebarStore((s) => s.isOpen);

  const [projectFiles, setProjectFiles] = useState<
    Array<{
      name?: string;
      path?: string;
      fileName?: string;
      filePath?: string;
    }>
  >([]);

  const refreshProjectFiles = useCallback(async () => {
    if (!email || !activeProjectId) {
      setProjectFiles([]);
      return;
    }
    try {
      const res = await window.ipcRenderer?.invoke(
        'get-project-file-list',
        email,
        activeProjectId
      );
      setProjectFiles(Array.isArray(res) ? res : []);
    } catch {
      setProjectFiles([]);
    }
  }, [email, activeProjectId]);

  useEffect(() => {
    void refreshProjectFiles();
  }, [refreshProjectFiles, chatStore?.updateCount]);

  const sessionStores = useMemo(() => {
    if (!activeProjectId) return [];
    return projectStore
      .getAllChatStores(activeProjectId)
      .filter(({ chatStore: cs }) => chatStoreHasRealTaskSession(cs));
  }, [activeProjectId, projectStore]);

  const sortedAgents = useMemo(() => {
    const taskAssigning =
      chatStore?.activeTaskId && chatStore.tasks[chatStore.activeTaskId]
        ? (chatStore.tasks[chatStore.activeTaskId].taskAssigning ?? [])
        : [];
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
  }, [chatStore, workerList]);

  const summaryTask =
    chatStore?.activeTaskId != null
      ? chatStore.tasks[chatStore.activeTaskId]?.summaryTask
      : undefined;
  const activeTaskTitle = useMemo(() => {
    if (chatStore?.activeTaskId && summaryTask) {
      return summaryTask.split('|')[0];
    }
    return t('layout.new-project');
  }, [chatStore?.activeTaskId, summaryTask, t]);

  /** Open folder icon once the task has a real title; closed folder for brand-new project shell. */
  const hasProjectSelectedForFolderIcon = Boolean(
    chatStore?.activeTaskId &&
    (chatStore.tasks[chatStore.activeTaskId]?.summaryTask?.trim() ?? '')
  );

  const openSession = (chatId: string) => {
    if (!activeProjectId) return;
    projectStore.setActiveChatStore(activeProjectId, chatId);
    setWorkforceShellView('session');
  };

  const openOutputFileInFolderTab = useCallback(
    (label: string, filePath: string | undefined) => {
      if (!filePath || !chatStore?.activeTaskId) {
        toast.error(t('layout.workspace-output-open-failed'));
        return;
      }
      const name =
        label ||
        filePath.replace(/\\/g, '/').split('/').filter(Boolean).pop() ||
        filePath;
      const ext = name.includes('.')
        ? (name.split('.').pop()?.toLowerCase() ?? '')
        : '';
      const fileInfo: FileInfo = {
        name,
        type: ext || 'txt',
        path: filePath,
      };
      chatStore.setNuwFileNum(chatStore.activeTaskId, 0);
      setActiveWorkspaceTab('inbox', {
        clearInboxForProjectId: activeProjectId ?? null,
      });
      chatStore.setSelectedFile(chatStore.activeTaskId, fileInfo);
    },
    [chatStore, activeProjectId, setActiveWorkspaceTab, t]
  );

  if (!chatStore) {
    return <div className="text-text-body p-4">{t('triggers.loading')}</div>;
  }

  const activeAgentIdForFolded =
    chatStore.activeTaskId &&
    chatStore.tasks[chatStore.activeTaskId]?.activeAgent;

  const renderBottomInput = () => {
    if (!chatStore.activeTaskId) return null;

    if (hasAnyMessages) {
      return (
        <BottomBox
          state={getBottomBoxState()}
          queuedMessages={queuedMessages}
          onRemoveQueuedMessage={(id) => handleRemoveTaskQueue(id)}
          subtitle={
            getBottomBoxState() === 'confirm'
              ? (() => {
                  const messages =
                    chatStore.tasks[chatStore.activeTaskId!]?.messages || [];
                  const lastUserMessage = messages
                    .slice()
                    .reverse()
                    .find((msg) => msg.role === 'user');
                  return (
                    lastUserMessage?.content ||
                    chatStore.tasks[chatStore.activeTaskId!]?.summaryTask
                  );
                })()
              : chatStore.tasks[chatStore.activeTaskId!]?.summaryTask
          }
          onStartTask={() => handleConfirmTask()}
          onEdit={handleEditQuery}
          taskTime={taskTime}
          taskStatus={chatStore.tasks[chatStore.activeTaskId!]?.status}
          onPauseResume={handlePauseResume}
          pauseResumeLoading={isPauseResumeLoading}
          loading={loading}
          inputProps={{
            value: message,
            onChange: setMessage,
            onSend: handleSend,
            files:
              chatStore.tasks[chatStore.activeTaskId!]?.attaches?.map((f) => ({
                fileName: f.fileName,
                filePath: f.filePath,
              })) || [],
            onFilesChange: (files) =>
              chatStore.setAttaches(
                chatStore.activeTaskId as string,
                files as any
              ),
            onAddFile: handleFileSelect,
            placeholder: t('chat.follow-up-placeholder'),
            disabled: isInputDisabled,
            textareaRef: textareaRef,
            allowDragDrop: true,
            useCloudModelInDev: useCloudModelInDev,
            projectPageInputLayout: true,
          }}
        />
      );
    }

    return (
      <BottomBox
        state="input"
        queuedMessages={queuedMessages}
        onRemoveQueuedMessage={(id) => handleRemoveTaskQueue(id)}
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
          disabled: isInputDisabled,
          textareaRef: textareaRef,
          allowDragDrop: true,
          useCloudModelInDev: useCloudModelInDev,
          projectPageInputLayout: true,
        }}
      />
    );
  };

  const hasWorkspaceSessions = sessionStores.length > 0;

  return (
    <div className="rounded-2xl border-border-tertiary bg-surface-secondary min-h-0 relative flex h-full w-full flex-col overflow-hidden border-solid">
      <div
        className={cn(
          'min-h-0 px-4 py-3 mx-auto flex w-full max-w-[700px] flex-1 flex-col',
          !hasWorkspaceSessions && 'justify-center'
        )}
      >
        <div className="mb-4 flex w-full shrink-0 justify-start">
          <TooltipSimple
            content={t('layout.chat-history-title')}
            side="bottom"
            align="center"
          >
            <button
              id="workspace-project-title-btn"
              type="button"
              className={cn(
                'no-drag min-w-0 py-2 gap-2 rounded-xl inline-flex w-fit max-w-full cursor-pointer items-center bg-transparent text-left transition-colors',
                historySidebarOpen
                  ? 'bg-surface-tertiary hover:brightness-[0.98]'
                  : 'hover:bg-surface-tertiary',
                'focus-visible:ring-border-secondary focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none'
              )}
              onClick={() => toggleHistorySidebar()}
              aria-expanded={historySidebarOpen}
              aria-haspopup="dialog"
              aria-label={activeTaskTitle}
            >
              {hasProjectSelectedForFolderIcon ? (
                <FolderOpen className="text-icon-primary h-6 w-6 shrink-0" />
              ) : (
                <FolderClosed className="text-icon-primary h-6 w-6 shrink-0" />
              )}
              <span className="text-text-body text-heading-sm font-bold max-w-[min(100%,20rem)] truncate">
                {activeTaskTitle}
              </span>
              <ChevronDown className="text-icon-primary h-6 w-6 shrink-0" />
            </button>
          </TooltipSimple>
        </div>

        <div className="mb-4 shrink-0">
          <div className="gap-2 flex flex-row items-center justify-between">
            <div className="gap-2 min-w-0 flex flex-1 flex-wrap items-center">
              {sortedAgents.map((agent) => (
                <FoldedAgentCard
                  key={agent.agent_id}
                  agent={agent}
                  isActive={activeAgentIdForFolded === agent.agent_id}
                  dimmed={false}
                  compactMode
                  onSelect={() => {
                    if (!chatStore.activeTaskId) return;
                    chatStore.setActiveWorkspace(
                      chatStore.activeTaskId,
                      agent.agent_id
                    );
                    chatStore.setActiveAgent(
                      chatStore.activeTaskId,
                      agent.agent_id
                    );
                    window.electronAPI?.hideAllWebview?.();
                  }}
                />
              ))}
              <TooltipSimple
                content={t('triggers.add')}
                side="bottom"
                align="center"
              >
                <button
                  type="button"
                  onClick={() => setAddWorkerOpen(true)}
                  className={cn(
                    'rounded-xl bg-worker-surface-primary border-border-secondary border border-solid',
                    'hover:border-worker-border-default opacity-80',
                    'p-2 inline-flex shrink-0 items-center justify-center',
                    'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                    'ease-in-out transition-all duration-200'
                  )}
                  aria-label={t('triggers.add')}
                >
                  <span className="h-6 w-6 text-text-secondary relative inline-flex shrink-0 items-center justify-center">
                    <Plus className="h-6 w-6" strokeWidth={2} aria-hidden />
                  </span>
                </button>
              </TooltipSimple>
            </div>
            <div className="shrink-0">
              <TooltipSimple
                content={t('layout.workspace-browse-plugins', {
                  defaultValue: 'Browse plugins',
                })}
                side="bottom"
                align="end"
              >
                <button
                  type="button"
                  className={cn(
                    'rounded-xl bg-worker-surface-primary border-border-secondary border border-solid',
                    'hover:border-worker-border-default opacity-80',
                    'gap-1.5 px-2.5 py-2 inline-flex items-center justify-center',
                    'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                    'text-text-label text-body-sm font-medium ease-in-out transition-all duration-200'
                  )}
                  aria-label={t('layout.workspace-browse-plugins', {
                    defaultValue: 'Browse plugins',
                  })}
                >
                  <Store className="h-5 w-5 text-icon-primary shrink-0" />
                  <span className="hidden min-[420px]:inline">
                    {t('layout.browse', { defaultValue: 'Browse' })}
                  </span>
                </button>
              </TooltipSimple>
            </div>
            <AddWorker isOpen={addWorkerOpen} onOpenChange={setAddWorkerOpen} />
          </div>
        </div>

        <div className="min-w-0 w-full shrink-0">{renderBottomInput()}</div>

        <div className="mt-4 rounded-3xl border-border-tertiary bg-surface-tertiary p-4 shrink-0 border border-solid">
          <div className="text-text-body mb-2 text-body-md font-semibold tracking-wide">
            {t('layout.workspace-output')}
          </div>
          <div className="scrollbar-always-visible max-h-[120px] overflow-y-auto">
            {projectFiles.length === 0 ? (
              <p className="text-text-body px-1 py-2 text-sm text-center opacity-70">
                {t('layout.workspace-output-empty')}
              </p>
            ) : (
              <ul className="gap-1 flex flex-col">
                {projectFiles.map((f, i) => {
                  const label = f.name ?? f.fileName ?? String(f.path ?? i);
                  const path = f.path ?? f.filePath;
                  return (
                    <li key={`${label}-${i}`}>
                      <button
                        type="button"
                        className="hover:bg-surface-secondary gap-2 rounded-lg px-2 py-1.5 flex w-full cursor-pointer items-center text-left transition-colors"
                        onClick={() => openOutputFileInFolderTab(label, path)}
                      >
                        <FileText className="text-icon-secondary h-4 w-4 shrink-0" />
                        <span className="text-text-body text-sm truncate">
                          {label}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div
          className={cn(
            'mt-4 min-w-0 py-4 flex flex-col bg-transparent',
            hasWorkspaceSessions ? 'min-h-0 flex-1' : 'h-auto shrink-0'
          )}
        >
          <div
            className={cn(
              'scrollbar-always-visible gap-2 flex flex-col',
              hasWorkspaceSessions
                ? 'min-h-0 flex-1 overflow-y-auto'
                : 'h-auto shrink-0 overflow-visible'
            )}
          >
            {!hasWorkspaceSessions ? (
              <p className="text-text-body px-1 py-3 text-sm text-center opacity-70">
                {t('layout.workspace-sessions-empty')}
              </p>
            ) : null}
            {sessionStores.map(({ chatId, chatStore: cs }) => {
              const state = cs.getState();
              const tid = state.activeTaskId;
              const task = tid ? state.tasks[tid] : null;
              const title =
                (task?.summaryTask && task.summaryTask.slice(0, 80)) ||
                chatId.slice(0, 8);
              const status = task?.status ?? ChatTaskStatus.PENDING;
              const activeChatId =
                projectStore.getProjectById(activeProjectId ?? '')
                  ?.activeChatId ?? null;
              const isActive = chatId === activeChatId;

              return (
                <button
                  key={chatId}
                  type="button"
                  onClick={() => openSession(chatId)}
                  className={cn(
                    'rounded-2xl bg-surface-tertiary p-4 gap-4 flex shrink-0 flex-row items-center justify-between text-left transition-colors',
                    isActive && 'bg-surface-information'
                  )}
                >
                  <PinIcon className="text-icon-secondary h-4 w-4 shrink-0" />
                  <div className="text-text-heading text-sm font-medium line-clamp-2">
                    {title}
                  </div>
                  <div className="text-text-body text-xs capitalize opacity-80">
                    {String(status)}
                  </div>
                  <ArrowRight className="text-icon-secondary h-4 w-4 shrink-0" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
