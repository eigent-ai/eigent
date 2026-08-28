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
import { BASE_WORKFLOW_AGENTS } from '@/components/WorkFlow/baseWorkers';
import { isBaseWorkflowAgent } from '@/components/Workspace/FoldedAgentCard';
import { SingleAgentList } from '@/components/Workspace/SingleAgentList';
import { SpaceWorkspacePanel } from '@/components/Workspace/SpaceWorkspacePanel';
import { WorkforceAgentList } from '@/components/Workspace/WorkforceAgentList';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useModelConfigCheck } from '@/hooks/useModelConfigCheck';
import { useHost } from '@/host';
import {
  hasUserBoundLocalFolder,
  isLegacySpace,
  isLocalWorkspaceSpace,
} from '@/lib/spaceLabel';
import { createSyncedProjectInSpace } from '@/lib/spaceProject';
import { useAuthStore, useWorkerList } from '@/store/authStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { openSettings } from '@/store/settingsStore';
import { useSpaceStore } from '@/store/spaceStore';
import { SessionMode, type SessionModeType } from '@/types/constants';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

const EMPTY_TASK_ASSIGNING: Agent[] = [];
/**
 * Viewport width at which the Space rail appears — kept in step with the `lg`
 * breakpoint that used to hide it in CSS alone. Mounting is gated on this
 * rather than `hidden lg:contents` because `display: none` still runs the
 * rail's grouped-history, trigger-paging, and `/files` requests.
 */
const SPACE_RAIL_MIN_VIEWPORT_WIDTH = 1024;

function useHasSpaceRailRoom() {
  const [hasRoom, setHasRoom] = useState(
    () =>
      typeof window === 'undefined' ||
      window.innerWidth >= SPACE_RAIL_MIN_VIEWPORT_WIDTH
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () =>
      setHasRoom(window.innerWidth >= SPACE_RAIL_MIN_VIEWPORT_WIDTH);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return hasRoom;
}

const WORKSPACE_COWORK_TEXT_CLASS =
  'inline-flex shrink-0 items-center font-display text-ds-text-display font-semibold text-ds-ink-default-default';

interface WorkspaceProps {
  /**
   * `'workspace'` (default): Cowork composer on the Workspace tab.
   * `'new-project'`: same composer inside the Session new-project shell.
   */
  variant?: 'workspace' | 'new-project';
  /** When true, fill the Session content column instead of the page shell. */
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
  const host = useHost();
  const { chatStore } = useChatStoreAdapter();
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId);
  const activeSpace = useSpaceStore((s) =>
    s.activeSpaceId ? s.spaces[s.activeSpaceId] : null
  );
  // Legacy Spaces are read-only — new Projects can't be started inside them.
  const isLegacyActiveSpace = activeSpace ? isLegacySpace(activeSpace) : false;
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

  const textareaRef = useRef<HTMLDivElement>(null);
  const hasSpaceRailRoom = useHasSpaceRailRoom();

  const handleUsePrompt = useCallback(
    (prompt: string) => {
      const replacedDraft = message;
      setMessage(prompt);
      window.requestAnimationFrame(() => textareaRef.current?.focus());
      if (!replacedDraft.trim()) return;
      // The guide tiles sit beside the composer, so a draft can already be in
      // flight when one is clicked. Honour the click, but back it with the
      // same Undo affordance the guide dismissal uses.
      const toastId = toast(
        t('layout.workspace-onboarding-prompt-replaced', {
          defaultValue: 'Draft replaced',
        }),
        {
          action: {
            label: t('layout.workspace-onboarding-dismiss-undo', {
              defaultValue: 'Undo',
            }),
            onClick: () => {
              setMessage(replacedDraft);
              toast.dismiss(toastId);
            },
          },
        }
      );
    },
    [message, t]
  );

  const handleExploreUseCases = useCallback(() => {
    const url = 'https://www.eigent.ai/use-cases';
    const openExternal = host?.electronAPI?.openExternal;
    if (openExternal) {
      void openExternal(url)
        .then((result: { success: boolean; error?: string }) => {
          if (result?.success === false) {
            toast.error(
              result.error ||
                t('layout.browser-unable-to-open-url', {
                  defaultValue: 'Unable to open this URL',
                })
            );
          }
        })
        .catch((error: unknown) => {
          console.error('Failed to open external URL:', error);
          toast.error(
            t('layout.browser-unable-to-open-url', {
              defaultValue: 'Unable to open this URL',
            })
          );
        });
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }, [host, t]);

  const handleOpenSpaceFolder = useCallback(async () => {
    if (!activeSpace?.rootPath || !host?.ipcRenderer) return;
    try {
      const result = await host.ipcRenderer.invoke(
        'reveal-in-folder',
        activeSpace.rootPath
      );
      if (!result?.success) {
        toast.error(result?.error || t('chat.failed-to-open-folder'));
      }
    } catch (error) {
      console.error('Failed to open Space folder:', error);
      toast.error(t('chat.failed-to-open-folder'));
    }
  }, [activeSpace?.rootPath, host, t]);

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
      openSettings('models');
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
              'Legacy Spaces are read-only. Create a new Space to start a session.',
          })
        );
        return;
      }

      const projectStore = useProjectRuntimeStore.getState();
      const composerThinkingEffort = projectStore.getComposerThinkingEffort();
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
          ...(composerThinkingEffort !== undefined
            ? { thinkingEffort: composerThinkingEffort }
            : {}),
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

  const composerInputProps = {
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
            'Legacy Spaces are read-only. Create a new Space to start a session.',
        })
      : t('layout.project-task-placeholder'),
  };

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

  const onEditWorkerFromMenu = (agent: Agent) => {
    setEditingWorkerAgent(agent);
  };

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

  const activeAgentId = chatStore?.activeTaskId
    ? chatStore.tasks[chatStore.activeTaskId]?.activeAgent
    : undefined;

  const renderAgentList = () =>
    effectiveSessionMode === SessionMode.SINGLE_AGENT ? (
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
        alignment="start"
      />
    );

  const workspaceComposerTop = (
    <div
      data-workspace-cowork-row
      className="mb-3 flex min-h-[46px] w-full min-w-0 items-center justify-start gap-3"
    >
      <span className={WORKSPACE_COWORK_TEXT_CLASS}>
        {t('layout.cowork-with', { defaultValue: 'Cowork with' })}
      </span>
      <div
        data-workspace-agent-list
        className="flex h-[46px] min-h-[46px] min-w-0 flex-1 items-center justify-start gap-3 overflow-visible"
      >
        {renderAgentList()}
        {effectiveSessionMode === SessionMode.SINGLE_AGENT ? (
          <span
            data-workspace-single-agent-label
            className={`${WORKSPACE_COWORK_TEXT_CLASS} @max-[599px]/workspace-composer:hidden`}
          >
            {t('layout.workspace-session-single-agent', {
              defaultValue: 'Single Agent',
            })}
          </span>
        ) : null}
      </div>
    </div>
  );

  const composerInput = (
    <>
      <div data-workspace-bottom-box className="w-full">
        <BottomBox
          state="input"
          queuedMessages={[]}
          onRemoveQueuedMessage={() => {}}
          noModelOverlay={!hasModel}
          onSelectModel={() => openSettings('models')}
          inputProps={composerInputProps}
          sessionMode={effectiveSessionMode}
          onSessionModeChange={setActiveProjectMode}
          sessionModeSelectInteractive
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

  return (
    <div
      data-workspace-variant={variant}
      className={
        embedded
          ? 'relative z-[1] flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'
          : 'relative z-[1] flex h-full min-h-0 w-full min-w-0 flex-row overflow-hidden'
      }
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <section
          aria-label={t('layout.workspace-header', {
            defaultValue: 'Workspace header',
          })}
          className="flex min-h-0 w-full flex-1 items-center gap-0"
        >
          <div
            data-workspace-input-section
            className="flex min-w-0 flex-1 items-center justify-center p-4"
          >
            <div
              data-workspace-composer
              className="@container/workspace-composer flex w-full max-w-[600px] min-w-0 flex-col pb-[58px]"
            >
              {workspaceComposerTop}
              {composerInput}
            </div>
          </div>
        </section>
      </div>
      {!embedded &&
      variant === 'workspace' &&
      activeSpace &&
      hasSpaceRailRoom ? (
        <div data-space-workspace-panel-container className="contents">
          <SpaceWorkspacePanel
            key={activeSpace.id}
            space={activeSpace}
            canUsePrompt={!isLegacyActiveSpace}
            onUsePrompt={handleUsePrompt}
            onConnectApp={() => openSettings('connectors')}
            onExploreUseCases={handleExploreUseCases}
            onOpenFiles={() => setActiveWorkspaceTab('files')}
            canOpenFolder={Boolean(
              activeSpace.rootPath &&
              host?.ipcRenderer &&
              // The rail already refuses to treat a generated scratch
              // workspace as a user folder; revealing one in Finder would
              // contradict that.
              hasUserBoundLocalFolder(activeSpace)
            )}
            onOpenFolder={() => void handleOpenSpaceFolder()}
          />
        </div>
      ) : null}
    </div>
  );
}
