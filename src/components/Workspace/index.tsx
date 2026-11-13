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
import { BlockedWorkspaceOperationNotice } from '@/components/ChatBox/BlockedWorkspaceOperationCard';
import BottomBox, { type FileAttachment } from '@/components/ChatBox/BottomBox';
import { Checkbox } from '@/components/ui/checkbox';
import { DsText } from '@/components/ui/ds-text';
import { BASE_WORKFLOW_AGENTS } from '@/components/WorkFlow/baseWorkers';
import { useWorkspaceComposerRequests } from '@/components/Workspace/composerRequests';
import { EigentAppIcon } from '@/components/Workspace/EigentAppIcon';
import {
  clearWorkspaceSendRecovery,
  peekWorkspaceSendRecovery,
  setWorkspaceSendRecovery,
  type WorkspaceSendRecovery,
} from '@/components/Workspace/sendRecovery';
import {
  readStarterUseCasesOverride,
  USE_CASES_URL,
  UseCaseCards,
} from '@/components/Workspace/UseCaseCards';
import { pickWorkspaceWelcomeKey } from '@/components/Workspace/welcomeMessage';
import { WorkforceAgentsMenu } from '@/components/Workspace/WorkforceAgentsMenu';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useModelConfigCheck } from '@/hooks/useModelConfigCheck';
import { useNewSessionModelQuota } from '@/hooks/useNewSessionModelQuota';
import { useSessionPageTabStore } from '@/hooks/useSessionPageTabStore';
import { useSessionPane } from '@/hooks/useSessionPane';
import { useUsageIncidentBanner } from '@/hooks/useUsageIncidentBanner';
import { useHost } from '@/host';
import { getAccountEnvironmentKey } from '@/lib/authEnvironment';
import { notifyError } from '@/lib/notifyError';
import { isLegacySpace, isLocalWorkspaceSpace } from '@/lib/spaceLabel';
import {
  parseSpaceModelChoice,
  SPACE_MODEL_METADATA_KEY,
} from '@/lib/spaceModelChoice';
import { createSyncedProjectInSpace } from '@/lib/spaceProject';
import { cn } from '@/lib/utils';
import {
  createWorkspaceSessionDraft,
  reviseWorkspaceSessionDraft,
  submitWorkspaceSessionDraft,
  type WorkspaceSessionDraft,
} from '@/service/sessionMessage';
import { getAuthStore, useAuthStore, useWorkerList } from '@/store/authStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import {
  EMPTY_SESSION_DRAFT,
  sessionDraftKey,
  useSessionDraftStore,
} from '@/store/sessionDraftStore';
import { useSessionStartStore } from '@/store/sessionStartStore';
import { openSettings } from '@/store/settingsStore';
import { useSpaceStore } from '@/store/spaceStore';
import { SessionMode, type SessionModeType } from '@/types/constants';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

const EMPTY_TASK_ASSIGNING: Agent[] = [];

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
  /** First control in the composer toolbar, for example a Space chip. */
  composerFooterLeading?: ReactNode;
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
  composerFooterLeading,
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
  const authEmail = useAuthStore((s) => s.email);
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

  // A failed start that already opened its Session returns its draft here.
  const [recoveredDraft] = useState(() =>
    peekWorkspaceSendRecovery(activeSpaceId, activeWorkspaceTab)
  );
  useEffect(() => {
    if (recoveredDraft) clearWorkspaceSendRecovery(recoveredDraft);
  }, [recoveredDraft]);
  const [message, setMessage] = useState(recoveredDraft?.message ?? '');
  const messageRevision = useRef(0);
  const activeProjectId = useProjectRuntimeStore((s) => s.activeProjectId);
  const [draftFiles, setDraftFiles] = useState<FileAttachment[]>(
    recoveredDraft?.files ?? []
  );
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
  const spaceModelType = useSpaceStore((state) =>
    activeSpaceId
      ? parseSpaceModelChoice(
          state.spaces?.[activeSpaceId]?.metadata?.[SPACE_MODEL_METADATA_KEY]
        )?.modelType
      : undefined
  );
  const modelQuota = useNewSessionModelQuota(
    canResolveSpaceModelAtLaunch ? activeSpaceId : null,
    spaceModelType ?? modelType
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

  // Preview tabs and the Summary choice opened on the New session page follow
  // the user into the Session their first task creates.
  const handOffNewSessionDraft = (projectId: string) => {
    if (variant === 'new-project')
      usePageTabStore.getState().handOffNewSessionDraft(projectId);
  };

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
    // Creating the Session selects it, so the composer is owned when that new
    // Session is the selection rather than the one Send started from.
    const ownsComposerView = (createdProjectId: string) =>
      mountedRef.current &&
      activeSubmission.current === submission &&
      composerGeneration.current === owner.generation &&
      messageRevision.current === owner.messageRevision &&
      useProjectRuntimeStore.getState().activeProjectId === createdProjectId &&
      usePageTabStore.getState().workspaceChatFocusRequestId ===
        owner.focusRequest &&
      getAccountEnvironmentKey(getAuthStore()) === accountKey &&
      useSpaceStore.getState().activeSpaceId === activeSpaceId &&
      usePageTabStore.getState().activeWorkspaceTab === activeWorkspaceTab;
    const openedSession: { projectId: string | null } = { projectId: null };
    let sentDraft: WorkspaceSendRecovery | null = null;
    // A Session that failed to start stays open with its error, and the
    // message waits in its composer for a retry.
    const settleFailedSend = (
      projectId: string,
      draft: WorkspaceSendRecovery
    ) => {
      if (getAccountEnvironmentKey(getAuthStore()) !== accountKey) return;
      if (!useProjectRuntimeStore.getState().projects[projectId]) return;
      const key = sessionDraftKey(accountKey, projectId);
      const { drafts } = useSessionDraftStore.getState();
      if (!drafts[key]?.text) {
        useSessionDraftStore.setState({
          drafts: {
            ...drafts,
            [key]: {
              ...(drafts[key] ?? EMPTY_SESSION_DRAFT),
              text: draft.message,
            },
          },
        });
      }
    };
    // A Session the server rejected is removed, which clears the selection
    // and lets the page select another Session. While the rejected Session
    // is still selected, return the draft to the tab Send started from.
    const returnRejectedDraft = (
      projectId: string,
      draft: WorkspaceSendRecovery
    ) => {
      const stillViewingSession =
        getAccountEnvironmentKey(getAuthStore()) === accountKey &&
        usePageTabStore.getState().activeWorkspaceTab === 'project' &&
        useProjectRuntimeStore.getState().activeProjectId === projectId &&
        useSpaceStore.getState().activeSpaceId === draft.spaceId;
      if (!stillViewingSession) return;
      if (mountedRef.current) {
        setMessage(draft.message);
        setDraftFiles(draft.files);
      } else {
        setWorkspaceSendRecovery(draft);
      }
      setActiveWorkspaceTab(draft.tab);
    };
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
          handOffNewSessionDraft(projectId);
          setActiveWorkspaceTab('project');
        }
        return;
      }
      sentDraft = {
        spaceId: activeSpaceId,
        tab: activeWorkspaceTab,
        message,
        files: draftFiles,
      };
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
        // Open the Session on Send; creation and startup continue behind it.
        onLocalProjectCreated: ({ projectId }) => {
          if (!ownsComposerView(projectId)) return;
          // The Session page sends an unstarted Session back to this
          // composer and opens Activity for a started one, so mark the first
          // task started before opening it, as a completed start would.
          const openedChatStore = useProjectRuntimeStore
            .getState()
            .getActiveChatStore(projectId)
            ?.getState();
          if (!openedChatStore?.activeTaskId) return;
          openedChatStore.setHasMessages(openedChatStore.activeTaskId, true);
          usePageTabStore.getState().markSessionTaskStarted(projectId);
          openedSession.projectId = projectId;
          // The opened Session's composer waits until this start settles.
          useSessionStartStore.getState().markSessionStarting(projectId);
          setDraftFiles([]);
          setMessage('');
          handOffNewSessionDraft(projectId);
          setActiveWorkspaceTab('project');
        },
        onLocalProjectRejected: ({ projectId }) => {
          if (openedSession.projectId === projectId && sentDraft) {
            returnRejectedDraft(projectId, sentDraft);
          }
        },
      });
      assertStartingContext();
      if (!openedSession.projectId && !mountedRef.current) return;
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

      // Key/usage and admission failures keep the user in the new Session.
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
        !openedSession.projectId &&
        mountedRef.current &&
        useProjectRuntimeStore.getState().activeProjectId === targetProjectId &&
        useSpaceStore.getState().activeSpaceId === activeSpaceId &&
        usePageTabStore.getState().activeWorkspaceTab === activeWorkspaceTab
      ) {
        setDraftFiles([]);
        setMessage('');
        handOffNewSessionDraft(targetProjectId);
        setActiveWorkspaceTab('project');
      }
    } catch (err: unknown) {
      console.error('Failed to start task:', err);
      if (openedSession.projectId && sentDraft) {
        settleFailedSend(openedSession.projectId, sentDraft);
      }
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
              ? err
              : t('layout.failed-to-start-task')
        );
      }
    } finally {
      if (openedSession.projectId) {
        useSessionStartStore
          .getState()
          .clearSessionStarting(openedSession.projectId);
      }
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

  // The Space panel's Add files attaches through this composer's picker.
  const attachFilesRequestId = useWorkspaceComposerRequests(
    (s) => s.attachFilesRequestId
  );
  const handledAttachFilesRequest = useRef(attachFilesRequestId);
  useEffect(() => {
    if (attachFilesRequestId === handledAttachFilesRequest.current) return;
    handledAttachFilesRequest.current = attachFilesRequestId;
    if (variant === 'workspace') void handleFileSelect();
  }, [attachFilesRequestId, handleFileSelect, variant]);

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

  /** Puts a starter use case in the composer, ready to edit or send. */
  const applyUseCasePrompt = useCallback((prompt: string) => {
    setMessage(prompt);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
  }, []);

  // Starter use cases are onboarding: shown only while the user has at most
  // one Space (archived ones aside), i.e. before they have set up their work.
  const isNewUser = useSpaceStore(
    (state) =>
      Object.values(state.spaces).filter((space) => space.status !== 'archived')
        .length <= 1
  );
  // Read once per visit; see STARTER_USE_CASES_OVERRIDE_KEY for testing.
  const [useCasesOverride] = useState(readStarterUseCasesOverride);
  const showStarterUseCases =
    useCasesOverride === null ? isNewUser : useCasesOverride === 'show';

  // In a Session, "View more" opens the use cases in its Preview browser so
  // the user stays in the app; the standalone page has no Preview, so it
  // falls back to the system browser.
  const sessionPane = useSessionPane();
  const openBrowserPreview = useSessionPageTabStore(
    (s) => s.openBrowserPreview
  );
  const openUseCases = useCallback(() => {
    if (sessionPane) {
      openBrowserPreview(USE_CASES_URL);
      return;
    }
    window.open(USE_CASES_URL, '_blank', 'noopener,noreferrer');
  }, [openBrowserPreview, sessionPane]);

  // Chosen once per visit so the line does not change while the user types.
  const [welcomeKey] = useState(() => pickWorkspaceWelcomeKey());

  // Workforce lists its agents from a button beside the composer's "+".
  const workforceAgentsAction =
    effectiveSessionMode === SessionMode.WORKFORCE ? (
      <WorkforceAgentsMenu
        agents={sortedAgents}
        onAddAgent={() => setAddWorkerDialogOpen(true)}
        onEditAgent={setEditingWorkerAgent}
        onDeleteAgent={(agent) =>
          setWorkerList(
            workerList.filter((worker) => worker.agent_id !== agent.agent_id)
          )
        }
        disabled={isStartingDirectProject}
      />
    ) : undefined;

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
      {/* A new Session writes to the same checkout, so a blocked operation
          must be resolvable before its first message. */}
      <BlockedWorkspaceOperationNotice
        space={activeSpace}
        email={authEmail}
        userId={user_id}
      />
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
            leadingActions: workforceAgentsAction,
            attachmentsEnabled: !managedSelected,
            onUnsupportedAttachment: () =>
              toast.error(t('chat.parallel-unsupported')),
          }}
          sessionMode={effectiveSessionMode}
          onSessionModeChange={setActiveProjectMode}
          sessionModeSelectInteractive
          modelSelectDisabled={isStartingDirectProject || isLegacyActiveSpace}
          footerLeading={composerFooterLeading}
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
          isOpen
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
            {/* The Workspace page shares its width with the Space panel. */}
            <div
              className={cn(
                '@container flex w-full min-w-0 flex-col pb-[58px]',
                variant === 'new-project' ? 'max-w-[736px]' : 'max-w-[600px]'
              )}
            >
              {/* In a narrow composer column the line wraps, so the icon stacks
                  above it, centred; from 40rem it sits beside the line. */}
              <h1
                data-workspace-welcome
                className="m-0 mb-ds-24 flex flex-col items-center justify-center gap-ds-12 text-center text-ds-text-display font-semibold text-ds-ink-default-default @min-[40rem]:flex-row"
              >
                <EigentAppIcon className="size-11" />
                {/* The display face goes on the text itself: a global `*` rule gives
                    every element Inter, so it is not inherited from the h1. */}
                <span className="min-w-0 font-display text-balance">
                  {t(welcomeKey)}
                </span>
              </h1>
              {composerInput}
              {showStarterUseCases ? (
                <div className="mt-ds-32 w-full">
                  <UseCaseCards
                    onSelectPrompt={applyUseCasePrompt}
                    onViewMore={openUseCases}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
