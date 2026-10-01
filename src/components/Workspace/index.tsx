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

import { fetchGet } from '@/api/http';
import { AddWorker } from '@/components/AddWorker';
import BottomBox, { type FileAttachment } from '@/components/ChatBox/BottomBox';
import { Checkbox } from '@/components/ui/checkbox';
import { DsText } from '@/components/ui/ds-text';
import { BASE_WORKFLOW_AGENTS } from '@/components/WorkFlow/baseWorkers';
import { isBaseWorkflowAgent } from '@/components/Workspace/FoldedAgentCard';
import { SingleAgentList } from '@/components/Workspace/SingleAgentList';
import { WorkforceAgentList } from '@/components/Workspace/WorkforceAgentList';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useModelConfigCheck } from '@/hooks/useModelConfigCheck';
import { useNewSessionModelQuota } from '@/hooks/useNewSessionModelQuota';
import { useUsageIncidentBanner } from '@/hooks/useUsageIncidentBanner';
import { useHost } from '@/host';
import { getAccountEnvironmentKey } from '@/lib/authEnvironment';
import { notifyError } from '@/lib/notifyError';
import { isLegacySpace, isLocalWorkspaceSpace } from '@/lib/spaceLabel';
import { createSyncedProjectInSpace } from '@/lib/spaceProject';
import {
  createWorkspaceSessionDraft,
  reviseWorkspaceSessionDraft,
  submitWorkspaceSessionDraft,
  type WorkspaceSessionDraft,
} from '@/service/sessionMessage';
import { getAuthStore, useAuthStore, useWorkerList } from '@/store/authStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { openSettings } from '@/store/settingsStore';
import { useSpaceStore } from '@/store/spaceStore';
import { SessionMode, type SessionModeType } from '@/types/constants';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

const EMPTY_TASK_ASSIGNING: Agent[] = [];
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
  const { modelType, token, user_id, setWorkerList } = useAuthStore();
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
  const messageRevision = useRef(0);
  const activeProjectId = useProjectRuntimeStore((s) => s.activeProjectId);
  const [draftFiles, setDraftFiles] = useState<FileAttachment[]>([]);
  const accountKey = useAuthStore(getAccountEnvironmentKey);
  const [managedAvailable, setManagedAvailable] = useState(false);
  const [managedSelected, setManagedSelected] = useState(false);
  const managedDraftRef = useRef<WorkspaceSessionDraft | null>(null);
  const managedLifetime = useRef(new AbortController());
  useEffect(() => {
    setManagedAvailable(false);
    setManagedSelected(false);
    managedDraftRef.current = null;
    const controller = new AbortController();
    managedLifetime.current = controller;
    void fetchGet('/executions/capabilities', undefined, undefined, {
      expectedAccountKey: accountKey,
      signal: controller.signal,
    })
      .then((capabilities) => {
        if (!controller.signal.aborted)
          setManagedAvailable(capabilities?.local_single_session === true);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [accountKey, activeSpaceId]);
  const directProjectStartRef = useRef(false);
  const activeSubmission = useRef<symbol | null>(null);
  const composerGeneration = useRef(0);
  const mountedRef = useRef(false);
  const [isStartingDirectProject, setIsStartingDirectProject] = useState(false);
  useEffect(() => {
    composerGeneration.current += 1;
    if (managedSelected) {
      // A newer selection owns a new composer. The older accepted execution
      // may finish in the background, but cannot clear or navigate this view.
      managedDraftRef.current = null;
      activeSubmission.current = null;
      directProjectStartRef.current = false;
      setIsStartingDirectProject(false);
    }
  }, [
    activeProjectId,
    workspaceChatFocusRequestId,
    accountKey,
    activeSpaceId,
    managedSelected,
  ]);
  const { hasModel } = useModelConfigCheck();
  // A fresh Session resolves its materialized Space model at launch. The
  // unrelated global preference cannot establish whether that model is usable.
  const canResolveSpaceModelAtLaunch = Boolean(
    !managedSelected &&
    token &&
    activeSpace &&
    activeSpace.id === activeSpaceId &&
    !isLegacyActiveSpace &&
    !activeSpace.id.startsWith('legacy_') &&
    (!activeSpace.userId || activeSpace.userId === String(user_id))
  );
  const canStartWithModel = hasModel || canResolveSpaceModelAtLaunch;
  const modelQuota = useNewSessionModelQuota(
    canResolveSpaceModelAtLaunch ? activeSpaceId : null,
    modelType
  );
  const incidentBanner = useUsageIncidentBanner(
    modelQuota.isCurrentAccount ? (modelQuota.effectiveModelType ?? '') : ''
  );
  const usageLimitBanner = modelQuota.error
    ? {
        message: modelQuota.error.message,
        actionLabel: t('chat.notice-refresh'),
        severity: 'danger' as const,
        onAction: modelQuota.refresh,
      }
    : incidentBanner
      ? {
          ...incidentBanner,
          onAction: () => {
            incidentBanner.onAction();
            modelQuota.refresh();
          },
          onRefresh: incidentBanner.onRefresh
            ? () => {
                incidentBanner.onRefresh?.();
                modelQuota.refresh();
              }
            : undefined,
        }
      : null;
  const [useCloudModelInDev, setUseCloudModelInDev] = useState(false);
  const [addWorkerDialogOpen, setAddWorkerDialogOpen] = useState(false);
  const [editingWorkerAgent, setEditingWorkerAgent] = useState<Agent | null>(
    null
  );

  const textareaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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

    // Resolve the actual Space category before creating a quota-blocked Session.
    if (modelQuota.blocked) return;

    if (!canStartWithModel) {
      toast.error(t('layout.please-select-model-first'));
      openSettings('models');
      return;
    }

    if (directProjectStartRef.current) {
      return;
    }
    directProjectStartRef.current = true;
    const submission = Symbol('workspace-send');
    activeSubmission.current = submission;
    const owner = {
      projectId: useProjectRuntimeStore.getState().activeProjectId,
      focusRequest: usePageTabStore.getState().workspaceChatFocusRequestId,
      generation: composerGeneration.current,
      messageRevision: messageRevision.current,
    };
    const ownsComposer = () =>
      mountedRef.current &&
      activeSubmission.current === submission &&
      composerGeneration.current === owner.generation &&
      messageRevision.current === owner.messageRevision &&
      useProjectRuntimeStore.getState().activeProjectId === owner.projectId &&
      usePageTabStore.getState().workspaceChatFocusRequestId ===
        owner.focusRequest &&
      getAccountEnvironmentKey(getAuthStore()) === accountKey &&
      useSpaceStore.getState().activeSpaceId === activeSpaceId &&
      usePageTabStore.getState().activeWorkspaceTab === activeWorkspaceTab;
    setIsStartingDirectProject(true);
    const startingAuth = getAuthStore();
    const startingAccount =
      startingAuth.token && startingAuth.user_id != null
        ? String(startingAuth.user_id)
        : null;

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

      const assertStartingContext = await modelQuota.beforeCreate();
      if (!mountedRef.current) return;
      const projectStore = useProjectRuntimeStore.getState();
      const composerThinkingEffort = projectStore.getComposerThinkingEffort();
      if (managedSelected) {
        if (
          effectiveSessionMode !== SessionMode.SINGLE_AGENT ||
          draftFiles.length ||
          !isLocalWorkspaceSpace(activeSpace) ||
          !['custom', 'local'].includes(modelType)
        ) {
          toast.error(t('chat.parallel-unsupported'));
          return;
        }
        let draft = managedDraftRef.current;
        if (!draft) {
          draft = createWorkspaceSessionDraft(
            activeSpaceId,
            trimmedMessage,
            composerThinkingEffort ?? null,
            managedLifetime.current.signal
          );
          managedDraftRef.current = draft;
        } else {
          reviseWorkspaceSessionDraft(
            draft,
            trimmedMessage,
            composerThinkingEffort ?? null
          );
        }
        const projectId = await submitWorkspaceSessionDraft(draft);
        if (ownsComposer()) {
          useProjectRuntimeStore.getState().setActiveProject(projectId);
          setMessage('');
          managedDraftRef.current = null;
          setActiveWorkspaceTab('project');
        }
        return;
      }
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
      assertStartingContext();
      if (!mountedRef.current) return;
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

      // Keep the draft mounted until the server accepts startup. Key/usage and
      // admission failures must not navigate away from the user's composer.
      await targetChatStore.startTask(
        taskId,
        undefined,
        undefined,
        undefined,
        trimmedMessage,
        attachesToSend,
        undefined,
        targetProjectId,
        effectiveSessionMode,
        { awaitAdmission: true }
      );
      targetChatStore.setHasWaitComfirm(taskId, true);
      targetChatStore.setAttaches(taskId, []);
      // A newer New session command can clear selection without unmounting
      // this composer or changing its Space/tab. It owns the draft and view.
      if (
        mountedRef.current &&
        useProjectRuntimeStore.getState().activeProjectId === targetProjectId &&
        useSpaceStore.getState().activeSpaceId === activeSpaceId &&
        usePageTabStore.getState().activeWorkspaceTab === activeWorkspaceTab
      ) {
        setDraftFiles([]);
        setMessage('');
        setActiveWorkspaceTab('project');
      }
    } catch (err: unknown) {
      console.error('Failed to start task:', err);
      // Auth changes before useUsageNotices synchronizes its account. Never
      // re-report a departed account's rejection as the current user's limit.
      const currentAuth = getAuthStore();
      const currentAccount =
        currentAuth.token && currentAuth.user_id != null
          ? String(currentAuth.user_id)
          : null;
      if (
        currentAccount === startingAccount &&
        (!managedSelected || ownsComposer())
      ) {
        notifyError(
          managedSelected
            ? t('chat.parallel-request-failed')
            : err instanceof Error
              ? err.message
              : t('layout.failed-to-start-task')
        );
      }
    } finally {
      if (activeSubmission.current === submission) {
        activeSubmission.current = null;
        directProjectStartRef.current = false;
        setIsStartingDirectProject(false);
      }
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
    onChange: (value: string) => {
      messageRevision.current += 1;
      setMessage(value);
    },
    onSend: handleSend,
    files: draftFiles,
    onFilesChange: setDraftFiles,
    onAddFile: handleFileSelect,
    disabled:
      !canStartWithModel ||
      modelQuota.blocked ||
      isStartingDirectProject ||
      isLegacyActiveSpace,
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
          <span className="sr-only">
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
      {(managedAvailable || managedSelected) && (
        <label className="mb-3 flex items-center gap-2 text-ds-ink-default-default">
          <Checkbox
            checked={managedSelected}
            onCheckedChange={(checked) => setManagedSelected(checked === true)}
            disabled={
              isStartingDirectProject || Boolean(managedDraftRef.current)
            }
          />
          <DsText as="span" role="base">
            {t('chat.parallel-opt-in')}
          </DsText>
        </label>
      )}
      <div data-workspace-bottom-box className="w-full">
        <BottomBox
          resourcePickersEnabled={!managedSelected}
          state="input"
          queuedMessages={[]}
          onRemoveQueuedMessage={() => {}}
          noModelOverlay={!canStartWithModel && !modelQuota.blocked}
          usageLimitBanner={usageLimitBanner}
          onSelectModel={() => openSettings('models')}
          inputProps={{
            ...composerInputProps,
            attachmentsEnabled: !managedSelected,
            onUnsupportedAttachment: () =>
              toast.error(t('chat.parallel-unsupported')),
          }}
          sessionMode={effectiveSessionMode}
          onSessionModeChange={setActiveProjectMode}
          sessionModeSelectInteractive
          modelSelectDisabled={isStartingDirectProject || isLegacyActiveSpace}
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
            <div className="flex w-full max-w-[600px] min-w-0 flex-col pb-[58px]">
              {workspaceComposerTop}
              {composerInput}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
