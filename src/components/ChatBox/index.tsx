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

import {
  fetchDelete,
  fetchGet,
  fetchPost,
  proxyFetchDelete,
  proxyFetchGet,
  uploadFileToBrain,
} from '@/api/http';
import { isWeb } from '@/client/platform';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useInterruptedRunStatus } from '@/hooks/useInterruptedRunStatus';
import { useModelConfigCheck } from '@/hooks/useModelConfigCheck';
import { useProjectEventRuntime } from '@/hooks/useProjectEventRuntime';
import { useHost } from '@/host';
import { generateUniqueId, SITE_URL } from '@/lib';
import {
  isProjectAchieved,
  setProjectAchievedState,
} from '@/lib/projectAchievement';
import { runEventIngressRegistry } from '@/lib/runEvents/registry';
import { inferSessionModeFromTask } from '@/lib/sessionMode';
import { takeControlOfTask } from '@/lib/taskRuntimeControl';
import {
  cancelFollowUpRequest,
  createFollowUpRequest,
  listPendingFollowUpRequests,
  prioritizeFollowUpRequest,
  terminalContinuationAdmissionRejection,
} from '@/service/followUpQueueApi';
import { decideHumanInteraction } from '@/service/humanInteractionApi';
import { cancelProjectRun } from '@/service/projectRunsApi';
import { proxyUpdateTriggerExecution } from '@/service/triggerApi';
import { useAuthStore } from '@/store/authStore';
import { isChatEventTimelineEnabled } from '@/store/chatEventProjectionBridge';
import { buildProjectContinuationContext } from '@/store/chatStore';
import { usePageTabStore } from '@/store/pageTabStore';
import type { ProjectEventStoreSnapshot } from '@/store/projectEventStore';
import { openSettings } from '@/store/settingsStore';
import { useSpaceStore } from '@/store/spaceStore';
import { ExecutionStatus } from '@/types';
import { DEFAULT_CHAT_TIMELINE_DETAIL_LEVEL } from '@/types/chatTimeline';
import { AgentStep, ChatTaskStatus, SessionMode } from '@/types/constants';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import BottomBox from './BottomBox';
import { selectBottomBoxControl } from './BottomBox/controlArbitration';
import { createLegacyApprovalVariant } from './BottomBox/legacyHumanControl';
import type {
  BottomBoxApprovalScope,
  BottomBoxInputVariant,
  BottomBoxRunControlVariant,
} from './BottomBox/types';
import { useEventNativeHumanControl } from './BottomBox/useEventNativeHumanControl';
import { EventNativeProjectTimeline } from './EventNativeProjectTimeline';
import {
  InterruptedRunBanner,
  InterruptedRunBannerAction,
} from './InterruptedRunBanner';
import { FloatingAction } from './MessageItem/FloatingAction';
import { ProjectChatContainer } from './ProjectChatContainer';
import {
  canUseLegacyControlWithoutCanonicalOwner,
  isEventNativeRunActionable,
  selectActionableInterruptedRun,
  selectComposerTaskControlState,
  selectEventNativeActiveRunId,
} from './runControlArbitration';
import { PLAN_OVERLAY_SLOT_ID } from './TaskBox/PlanTaskBox';

/** Minimum scroll padding under messages (matches previous ~8rem floor). */
const CHAT_SCROLL_BOTTOM_MIN_PX = 128;
/** Small gap between last message and BottomBox top. */
const CHAT_SCROLL_BOTTOM_GAP_PX = 8;

const USAGE_WARNING_RATIO = 0.75;
const FREE_STARTING_CREDITS = 500;
const TERMINAL_QUEUED_RUN_STATUSES = new Set([
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);
const READ_ONLY_EVENT_NATIVE_RUN_STATUSES = new Set([
  'pending',
  'running',
  'waiting_for_user',
  'cancelling',
  'interrupted',
]);

type EventNativeProjectedRun =
  ProjectEventStoreSnapshot['view']['runs'][string];

function isEventNativeRunReadOnly(run: EventNativeProjectedRun): boolean {
  return (
    (run.origin !== null && run.origin !== 'local') ||
    Boolean(run.resumeBlockedReason)
  );
}

function compareProjectedRunsByRecency(
  left: EventNativeProjectedRun,
  right: EventNativeProjectedRun
): number {
  const timeDelta =
    (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0);
  if (timeDelta !== 0) return timeDelta;
  if (right.lastSequence !== left.lastSequence) {
    return right.lastSequence - left.lastSequence;
  }
  return right.runId.localeCompare(left.runId);
}

function selectLatestReadOnlyEventNativeRun(
  snapshot: ProjectEventStoreSnapshot | null
): EventNativeProjectedRun | null {
  if (!snapshot) return null;
  return (
    Object.values(snapshot.view.runs)
      .filter(
        (run) =>
          READ_ONLY_EVENT_NATIVE_RUN_STATUSES.has(run.status) &&
          isEventNativeRunReadOnly(run)
      )
      .sort(compareProjectedRunsByRecency)[0] ?? null
  );
}

interface SubscriptionLimitInfo {
  plan_key?: string | null;
  is_trialing?: boolean | null;
  monthly_credits?: number | null;
  trial_daily_credits_limit?: number | null;
  trial_daily_credits_used?: number | null;
  trial_daily_credits_remaining?: number | null;
  trial_total_credits_limit?: number | null;
  trial_total_credits_used?: number | null;
  trial_total_credits_remaining?: number | null;
}

interface UsageLimitBannerState {
  id: string;
  message: string;
  actionLabel: string;
  severity: 'warning' | 'danger';
}

function getCurrentTimestamp() {
  return Date.now();
}

const runActionRequestId = (action: 'resume' | 'cancel', runId: string) => {
  const key = `eigent:run:${runId}:${action}:request-id`;
  try {
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const requestId = `${action}:${runId}:${generateUniqueId()}`;
    window.sessionStorage.setItem(key, requestId);
    return requestId;
  } catch {
    return `${action}:${runId}:${generateUniqueId()}`;
  }
};

const clearRunActionRequestId = (
  action: 'resume' | 'cancel',
  runId: string
) => {
  try {
    window.sessionStorage.removeItem(
      `eigent:run:${runId}:${action}:request-id`
    );
  } catch {
    // sessionStorage can be unavailable in hardened browser contexts.
  }
};

const toFiniteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const usagePercent = (used: number, limit: number) =>
  Math.min(100, Math.max(0, Math.round((used / limit) * 100)));

const buildUsageLimitBannerState = (
  subscription: SubscriptionLimitInfo | null,
  currentCredits: number | null,
  t: (key: string, options?: Record<string, unknown>) => string
): UsageLimitBannerState | null => {
  const actionLabel = t('chat.usage-limit-action');

  if (subscription?.is_trialing) {
    const trialCandidates = [
      {
        id: 'trial-daily',
        warningKey: 'chat.usage-limit-trial-daily-warning',
        exhaustedKey: 'chat.usage-limit-trial-daily-exhausted',
        limit: toFiniteNumber(subscription.trial_daily_credits_limit),
        used: toFiniteNumber(subscription.trial_daily_credits_used),
        remaining: toFiniteNumber(subscription.trial_daily_credits_remaining),
      },
      {
        id: 'trial-total',
        warningKey: 'chat.usage-limit-trial-total-warning',
        exhaustedKey: 'chat.usage-limit-trial-total-exhausted',
        limit: toFiniteNumber(subscription.trial_total_credits_limit),
        used: toFiniteNumber(subscription.trial_total_credits_used),
        remaining: toFiniteNumber(subscription.trial_total_credits_remaining),
      },
    ]
      .map((candidate) => {
        if (!candidate.limit || candidate.limit <= 0 || candidate.used === null)
          return null;

        const remaining =
          candidate.remaining ?? Math.max(candidate.limit - candidate.used, 0);
        const ratio = candidate.used / candidate.limit;
        const exhausted = remaining <= 0 || candidate.used >= candidate.limit;

        if (!exhausted && ratio < USAGE_WARNING_RATIO) return null;

        const percent = usagePercent(candidate.used, candidate.limit);
        return {
          id: `${candidate.id}:${exhausted ? 'exhausted' : 'warning'}`,
          message: t(
            exhausted ? candidate.exhaustedKey : candidate.warningKey,
            {
              percent,
            }
          ),
          actionLabel,
          severity: exhausted ? ('danger' as const) : ('warning' as const),
          ratio,
          exhausted,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a!.exhausted !== b!.exhausted) {
          return a!.exhausted ? -1 : 1;
        }
        return b!.ratio - a!.ratio;
      });

    if (trialCandidates[0]) {
      const {
        ratio: _ratio,
        exhausted: _exhausted,
        ...banner
      } = trialCandidates[0];
      return banner;
    }
  }

  if (currentCredits === null) return null;

  if (currentCredits <= 0) {
    const planKey = subscription?.plan_key?.toLowerCase() || 'free';
    return {
      id: `credits-exhausted:${planKey}`,
      message: t(
        planKey === 'free'
          ? 'chat.usage-limit-free-exhausted'
          : 'chat.usage-limit-monthly-exhausted'
      ),
      actionLabel,
      severity: 'danger',
    };
  }

  const planKey = subscription?.plan_key?.toLowerCase() || 'free';
  const limit =
    planKey === 'free'
      ? FREE_STARTING_CREDITS
      : toFiniteNumber(subscription?.monthly_credits);

  if (!limit || limit <= 0) return null;

  const remainingRatio = currentCredits / limit;
  if (remainingRatio > 1 - USAGE_WARNING_RATIO) return null;

  const percent = usagePercent(limit - currentCredits, limit);
  return {
    id: `${planKey === 'free' ? 'free' : 'monthly'}-credits:warning`,
    message: t(
      planKey === 'free'
        ? 'chat.usage-limit-free-warning'
        : 'chat.usage-limit-monthly-warning',
      { percent }
    ),
    actionLabel,
    severity: 'warning',
  };
};
export default function ChatBox(): JSX.Element {
  const [message, setMessage] = useState<string>('');
  const [pendingReviewHandoffIds, setPendingReviewHandoffIds] = useState<
    string[]
  >([]);
  const host = useHost();

  //Get Chatstore for the active project's task
  const { chatStore, projectStore } = useChatStoreAdapter();

  const { t } = useTranslation();
  const textareaRef = useRef<HTMLDivElement>(null);
  const handledChatDraftRequestRef = useRef<number | null>(null);
  const workspaceChatFocusRequestId = usePageTabStore(
    (s) => s.workspaceChatFocusRequestId
  );
  const workspaceChatDraftRequest = usePageTabStore(
    (s) => s.workspaceChatDraftRequest
  );
  const consumeWorkspaceChatDraft = usePageTabStore(
    (s) => s.consumeWorkspaceChatDraft
  );
  const acknowledgeWorkspaceReviewHandoffs = usePageTabStore(
    (s) => s.acknowledgeWorkspaceReviewHandoffs
  );
  const discardWorkspaceReviewHandoffs = usePageTabStore(
    (s) => s.discardWorkspaceReviewHandoffs
  );
  const chatTimelineDetailLevel = usePageTabStore(
    (s) => s.chatTimelineDetailLevel ?? DEFAULT_CHAT_TIMELINE_DETAIL_LEVEL
  );
  const activeProjectId = projectStore.activeProjectId;
  const eventNativeTimelineEnabled = isChatEventTimelineEnabled();
  const {
    projectId: projectEventRuntimeProjectId,
    snapshot: sharedProjectEventSnapshot,
  } = useProjectEventRuntime();
  const eventNativeProjectSnapshot =
    eventNativeTimelineEnabled &&
    sharedProjectEventSnapshot?.view.projectId === activeProjectId
      ? sharedProjectEventSnapshot
      : null;
  useEffect(() => {
    if (!activeProjectId || !eventNativeProjectSnapshot) return;
    const admittedIds = eventNativeProjectSnapshot.chat.nodes.flatMap((node) =>
      node.kind === 'message' && node.role === 'user'
        ? (node.reviewHandoffIds ?? [])
        : []
    );
    acknowledgeWorkspaceReviewHandoffs(activeProjectId, admittedIds);
  }, [
    acknowledgeWorkspaceReviewHandoffs,
    activeProjectId,
    eventNativeProjectSnapshot,
  ]);
  const eventNativeReadOnlyRun = selectLatestReadOnlyEventNativeRun(
    eventNativeProjectSnapshot
  );
  const activeProjectMeta = useSpaceStore((s) =>
    activeProjectId ? s.getProjectMeta(activeProjectId) : null
  );
  const updateProjectMeta = useSpaceStore((s) => s.updateProjectMeta);
  const activeProject = activeProjectId
    ? projectStore.getProjectById(activeProjectId)
    : null;
  const activeTask = chatStore?.activeTaskId
    ? chatStore.tasks[chatStore.activeTaskId]
    : undefined;
  // Project mode in three forms: `inferred` is a legacy Run fallback;
  // `effective` always resolves to a concrete mode; `display` stays nullable
  // so a still-loading Project renders empty instead of the wrong mode.
  const inferredSessionMode = inferSessionModeFromTask(activeTask, null);
  const activeProjectMode = activeProjectMeta?.mode ?? activeProject?.mode;
  const effectiveSessionMode =
    activeProjectMode ?? inferredSessionMode ?? SessionMode.SINGLE_AGENT;
  const displaySessionMode =
    activeProjectMode ?? inferredSessionMode ?? undefined;
  const ensureActiveProjectMode = useCallback(() => {
    const projectId = projectStore.activeProjectId;
    if (!projectId || activeProjectMode) return;
    updateProjectMeta(projectId, { mode: effectiveSessionMode });
  }, [
    activeProjectMode,
    effectiveSessionMode,
    projectStore,
    updateProjectMeta,
  ]);
  const { hasModel, isConfigLoaded, cloudUsageLimitReached } =
    useModelConfigCheck();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomBoxOverlayRef = useRef<HTMLDivElement>(null);
  const [scrollBottomInsetPx, setScrollBottomInsetPx] = useState(
    CHAT_SCROLL_BOTTOM_MIN_PX
  );
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { modelType, token, user_id } = useAuthStore();
  const [subscriptionUsage, setSubscriptionUsage] =
    useState<SubscriptionLimitInfo | null>(null);
  const [currentCredits, setCurrentCredits] = useState<number | null>(null);
  const [dismissedUsageLimitBannerId, setDismissedUsageLimitBannerId] =
    useState<string | null>(null);
  const {
    run: interruptedRun,
    setRun: setInterruptedRun,
    refresh: refreshInterruptedRun,
  } = useInterruptedRunStatus(activeProjectId);
  const [durableRunAction, setDurableRunAction] =
    useState<InterruptedRunBannerAction>(null);
  const isCloudRestoredRun = interruptedRun?.origin === 'cloud_restore';

  const refreshUsageLimits = useCallback(async () => {
    if (modelType !== 'cloud' || !token) {
      setSubscriptionUsage(null);
      setCurrentCredits(null);
      return;
    }

    const [subscriptionResult, creditsResult] = await Promise.allSettled([
      proxyFetchGet('/api/v1/subscription'),
      proxyFetchGet('/api/v1/user/current_credits'),
    ]);

    if (subscriptionResult.status === 'fulfilled') {
      setSubscriptionUsage(subscriptionResult.value || null);
    }

    if (creditsResult.status === 'fulfilled') {
      setCurrentCredits(toFiniteNumber(creditsResult.value?.credits));
    }
  }, [modelType, token]);

  const scheduleUsageRefresh = useCallback(() => {
    window.setTimeout(refreshUsageLimits, 2000);
    window.setTimeout(refreshUsageLimits, 15000);
  }, [refreshUsageLimits]);

  const usageLimitBannerState = useMemo(
    () => buildUsageLimitBannerState(subscriptionUsage, currentCredits, t),
    [subscriptionUsage, currentCredits, t]
  );

  const cloudUsageLimitMessage = useMemo(() => {
    if (modelType !== 'cloud' || !cloudUsageLimitReached) return null;
    return [
      usageLimitBannerState?.message ||
        t('chat.usage-limit-trial-daily-exhausted'),
      t('chat.usage-limit-switch-model-hint'),
    ].join(' ');
  }, [modelType, cloudUsageLimitReached, usageLimitBannerState, t]);

  const effectiveUsageLimitBannerState = useMemo(() => {
    if (!cloudUsageLimitMessage) return usageLimitBannerState;

    return {
      id: 'cloud-usage-limit-blocked',
      message: cloudUsageLimitMessage,
      actionLabel:
        usageLimitBannerState?.actionLabel || t('chat.usage-limit-action'),
      severity: 'danger' as const,
    };
  }, [cloudUsageLimitMessage, usageLimitBannerState, t]);

  const usageLimitBanner = useMemo(() => {
    if (
      !effectiveUsageLimitBannerState ||
      effectiveUsageLimitBannerState.id === dismissedUsageLimitBannerId
    ) {
      return null;
    }

    return {
      ...effectiveUsageLimitBannerState,
      onAction: () => {
        window.location.href = `${SITE_URL}/pricing`;
      },
      onDismiss: () => {
        setDismissedUsageLimitBannerId(effectiveUsageLimitBannerState.id);
      },
    };
  }, [effectiveUsageLimitBannerState, dismissedUsageLimitBannerId]);

  useEffect(() => {
    refreshUsageLimits();

    if (modelType !== 'cloud' || !token) return;

    window.addEventListener('focus', refreshUsageLimits);

    return () => {
      window.removeEventListener('focus', refreshUsageLimits);
    };
  }, [modelType, token, refreshUsageLimits]);

  const [useCloudModelInDev, setUseCloudModelInDev] = useState(false);

  useEffect(() => {
    // Only show warning message, don't block functionality
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
    if (workspaceChatFocusRequestId === 0) return;
    const focusTimer = window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 180);
    return () => clearTimeout(focusTimer);
  }, [workspaceChatFocusRequestId]);

  useEffect(() => {
    setPendingReviewHandoffIds([]);
  }, [activeProjectId]);

  useEffect(() => {
    if (
      !workspaceChatDraftRequest ||
      workspaceChatDraftRequest.projectId !== activeProjectId ||
      handledChatDraftRequestRef.current === workspaceChatDraftRequest.requestId
    ) {
      return;
    }
    handledChatDraftRequestRef.current = workspaceChatDraftRequest.requestId;
    setMessage((current) => {
      const existing = current.trimEnd();
      return existing
        ? `${existing}\n\n${workspaceChatDraftRequest.content}`
        : workspaceChatDraftRequest.content;
    });
    setPendingReviewHandoffIds((current) => [
      ...new Set([
        ...current,
        ...(workspaceChatDraftRequest.reviewHandoffIds ?? []),
      ]),
    ]);
    consumeWorkspaceChatDraft(workspaceChatDraftRequest.requestId);
  }, [activeProjectId, consumeWorkspaceChatDraft, workspaceChatDraftRequest]);

  useEffect(() => {
    proxyFetchGet('/api/v1/configs').catch((err) =>
      console.error('Failed to fetch configs:', err)
    );
  }, []);
  const [searchParams, setSearchParams] = useSearchParams();
  const share_token = searchParams.get('share_token');
  const skill_prompt = searchParams.get('skill_prompt');

  const handleSendRef = useRef<
    | ((
        messageStr?: string,
        taskId?: string,
        executionId?: string,
        queuedAttaches?: File[],
        queuedRequestId?: string,
        queuedReviewHandoffIds?: string[]
      ) => Promise<void>)
    | null
  >(null);
  const queuedDispatchRef = useRef<string | null>(null);
  const [admittedQueuedRun, setAdmittedQueuedRun] = useState<{
    projectId: string;
    runId: string;
  } | null>(null);

  const handleSelectModel = useCallback(() => {
    openSettings('models');
  }, []);

  const [loading, setLoading] = useState(false);
  const [isPauseResumeLoading, setIsPauseResumeLoading] = useState(false);

  const activeTaskId = chatStore?.activeTaskId;
  const activeAskTask = chatStore?.tasks[activeTaskId as string];
  const legacyControlTaskId =
    activeTaskId &&
    activeAskTask &&
    activeAskTask.type !== 'replay' &&
    activeAskTask.type !== 'share' &&
    activeAskTask.status !== ChatTaskStatus.FINISHED
      ? activeTaskId
      : null;
  const projectedLegacyRun = activeTaskId
    ? eventNativeProjectSnapshot?.view.runs[activeTaskId]
    : undefined;
  const eligibleLegacyActiveRunId =
    activeTaskId &&
    activeAskTask &&
    activeAskTask.type !== 'replay' &&
    activeAskTask.type !== 'share' &&
    activeAskTask.status !== ChatTaskStatus.FINISHED &&
    projectedLegacyRun &&
    (projectedLegacyRun.status === 'running' ||
      projectedLegacyRun.status === 'cancelling') &&
    isEventNativeRunActionable(projectedLegacyRun)
      ? activeTaskId
      : null;
  const eventNativeActiveRunId = selectEventNativeActiveRunId(
    eventNativeProjectSnapshot,
    eligibleLegacyActiveRunId
  );
  const eventNativeActiveTask = eventNativeActiveRunId
    ? chatStore?.tasks[eventNativeActiveRunId]
    : undefined;
  const eventNativeActiveProjectedRun = eventNativeActiveRunId
    ? eventNativeProjectSnapshot?.view.runs[eventNativeActiveRunId]
    : undefined;
  const allowLegacyFallbackControl =
    eventNativeTimelineEnabled &&
    projectEventRuntimeProjectId === activeProjectId &&
    canUseLegacyControlWithoutCanonicalOwner(
      eventNativeProjectSnapshot,
      legacyControlTaskId
    );
  const eventNativeInterruptedRun = selectActionableInterruptedRun(
    eventNativeProjectSnapshot,
    interruptedRun?.run_id
  );
  const activeAsk = activeAskTask?.activeAsk;
  const activeAskMessage = activeAskTask?.messages.findLast(
    (item) => item.step === AgentStep.ASK
  );
  const activeInteraction = activeAskMessage?.interaction;
  const isInteractiveHumanReply =
    !!activeAskTask &&
    activeAskTask.type !== 'replay' &&
    activeAskTask.type !== 'share' &&
    activeAskTask.status !== ChatTaskStatus.FINISHED;
  const [legacyApprovalSubmitting, setLegacyApprovalSubmitting] =
    useState(false);

  useEffect(() => {
    setLegacyApprovalSubmitting(false);
  }, [activeInteraction?.interaction_id]);

  const handleLegacyApprovalDecision = async (
    decision: 'approved' | 'rejected',
    scope: BottomBoxApprovalScope
  ) => {
    const interaction = activeInteraction;
    const taskId = activeTaskId;
    if (
      !interaction ||
      interaction.interaction_type !== 'approval' ||
      !taskId ||
      legacyApprovalSubmitting
    ) {
      return;
    }

    setLegacyApprovalSubmitting(true);
    try {
      await decideHumanInteraction(interaction, {
        decisionRequestId: [
          'desktop-approval',
          encodeURIComponent(interaction.interaction_id),
          String(interaction.version ?? 0),
          decision,
          scope,
        ].join(':'),
        decision: { decision, scope },
        actorId: user_id,
      });

      const activeStore = projectStore.getActiveChatStore();
      if (!activeStore) return;
      const state = activeStore.getState();
      if (!state || state.activeTaskId !== taskId) return;

      state.markHumanInteractionResolved(taskId, interaction.interaction_id);
      const current = activeStore.getState().tasks[taskId];
      if (!current) return;
      const [nextAsk, ...remainingAsks] = current.askList;
      state.setActiveAskList(taskId, remainingAsks);
      state.setActiveAsk(taskId, nextAsk?.agent_name || '');
      state.setIsPending(taskId, false);
      state.setDurableRunStatus(
        taskId,
        nextAsk ? 'waiting_for_user' : 'running'
      );
      state.setStatus(taskId, ChatTaskStatus.RUNNING);
      if (nextAsk) state.addMessages(taskId, nextAsk);
    } catch (error: any) {
      const message =
        error?.response?.data?.detail?.message ||
        error?.response?.data?.detail ||
        error?.message ||
        t('chat.control-decision-failed');
      toast.error(
        typeof message === 'string' ? message : JSON.stringify(message)
      );
    } finally {
      setLegacyApprovalSubmitting(false);
    }
  };

  const updateLegacyHumanControlSubmission = useCallback(
    (
      projectId: string,
      interaction: { interactionId: string; runId: string },
      phase: 'submitting' | 'failed'
    ) => {
      const activeStore = projectStore.getActiveChatStore(projectId);
      if (!activeStore) return;
      const state = activeStore.getState();
      if (state.activeTaskId !== interaction.runId) return;
      const current = state.tasks[interaction.runId];
      if (!current) return;

      // Presentation-only migration bridge: the durable interaction remains
      // authoritative, but the sidebar must react at click time instead of
      // waiting for the decision POST plus event replay round trip.
      state.setIsPending(interaction.runId, phase === 'submitting');
      state.setDurableRunStatus(
        interaction.runId,
        phase === 'submitting' ? 'running' : 'waiting_for_user'
      );
      state.setStatus(interaction.runId, ChatTaskStatus.RUNNING);
    },
    [projectStore]
  );

  const handleDurableHumanControlResolved = useCallback(
    (projectId: string, resolved: { interactionId: string; runId: string }) => {
      const activeStore = projectStore.getActiveChatStore(projectId);
      if (!activeStore) return;
      const state = activeStore.getState();
      if (state.activeTaskId !== resolved.runId) return;
      const current = state.tasks[resolved.runId];
      if (!current) return;

      const activeAskInteractionId = current.messages.findLast(
        (message) => message.step === AgentStep.ASK
      )?.interaction?.interaction_id;
      if (
        activeAskInteractionId &&
        activeAskInteractionId !== resolved.interactionId
      ) {
        return;
      }

      // Migration-only compatibility: the durable terminal event is already
      // loaded at this point. Keep the legacy task queue coherent until all
      // send/disable and sidebar logic reads HumanControlProjection directly.
      state.markHumanInteractionResolved(
        resolved.runId,
        resolved.interactionId
      );
      const reconciled = activeStore.getState().tasks[resolved.runId];
      if (!reconciled) return;
      const [nextAsk, ...remainingAsks] = reconciled.askList;
      state.setActiveAskList(resolved.runId, remainingAsks);
      state.setActiveAsk(resolved.runId, nextAsk?.agent_name || '');
      state.setIsPending(resolved.runId, false);
      state.setDurableRunStatus(
        resolved.runId,
        nextAsk ? 'waiting_for_user' : 'running'
      );
      state.setStatus(resolved.runId, ChatTaskStatus.RUNNING);
      if (nextAsk) state.addMessages(resolved.runId, nextAsk);
    },
    [projectStore]
  );

  const eventNativeHumanControl = useEventNativeHumanControl({
    projectId: eventNativeTimelineEnabled ? activeProjectId : null,
    activeRunId: eventNativeActiveRunId,
    enabled:
      eventNativeTimelineEnabled &&
      Boolean(activeProjectId) &&
      eventNativeActiveTask?.type !== 'share' &&
      Boolean(
        eventNativeActiveProjectedRun &&
        isEventNativeRunActionable(eventNativeActiveProjectedRun)
      ) &&
      !share_token,
    onSubmissionStart: (interaction) => {
      if (!activeProjectId) return;
      updateLegacyHumanControlSubmission(
        activeProjectId,
        interaction,
        'submitting'
      );
    },
    onSubmissionFailure: (interaction) => {
      if (!activeProjectId) return;
      updateLegacyHumanControlSubmission(
        activeProjectId,
        interaction,
        'failed'
      );
    },
    onDurableResolution: (interaction) => {
      if (!activeProjectId) return;
      handleDurableHumanControlResolved(activeProjectId, interaction);
    },
  });

  const getAllChatStoresMemoized = useMemo(() => {
    if (!projectStore.activeProjectId) return [];
    return projectStore.getAllChatStores(projectStore.activeProjectId);
  }, [projectStore]);

  // Check if any chat store in the project has messages
  const hasAnyMessages = useMemo(() => {
    const hasMessages = (store: typeof chatStore) =>
      !!store &&
      Object.values(store.tasks).some(
        (task) => (task.messages?.length || 0) > 0 || task.hasMessages
      );

    if (hasMessages(chatStore)) return true;

    // Then check all other chat stores in the project
    return getAllChatStoresMemoized.some(({ chatStore: store }) => {
      const state = store.getState();
      return Object.values(state.tasks).some(
        (task) => (task.messages?.length || 0) > 0 || task.hasMessages
      );
    });
  }, [chatStore, getAllChatStoresMemoized]);

  // With the event-native read path enabled, typed-only durable events can be
  // the first visible records. Timeline presence must not depend on whether a
  // legacy ChatStore message happened to be created for the same event.
  const shouldRenderChatTimeline = eventNativeTimelineEnabled
    ? Boolean(activeProjectId)
    : hasAnyMessages;
  const hasEventNativeTimelineContent = Boolean(
    eventNativeProjectSnapshot?.chat.nodes.length
  );
  // Local durable events are the preferred read model, but cloud-restored and
  // legacy Sessions may have usable ChatStore history before `/runs` responds
  // (or no local RunJournal replica at all). Keep that history visible while
  // event hydration catches up instead of replacing the page with a skeleton.
  const shouldRenderEventNativeTimeline = Boolean(
    eventNativeTimelineEnabled &&
    activeProjectId &&
    (hasEventNativeTimelineContent || !hasAnyMessages)
  );
  const shouldRenderBottomBoxOverlay =
    shouldRenderChatTimeline &&
    Boolean(
      chatStore?.activeTaskId ||
      (eventNativeTimelineEnabled &&
        (interruptedRun ||
          eventNativeHumanControl.variant ||
          eventNativeActiveRunId ||
          eventNativeReadOnlyRun))
    );

  useLayoutEffect(() => {
    if (!shouldRenderBottomBoxOverlay) return;

    const el = bottomBoxOverlayRef.current;
    if (!el) return;

    const measure = () => {
      const raw = el.getBoundingClientRect().height;
      setScrollBottomInsetPx(
        Math.max(
          CHAT_SCROLL_BOTTOM_MIN_PX,
          Math.round(raw) + CHAT_SCROLL_BOTTOM_GAP_PX
        )
      );
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [shouldRenderBottomBoxOverlay]);

  const isTaskBusy = useMemo(() => {
    if (!chatStore?.activeTaskId || !chatStore.tasks[chatStore.activeTaskId])
      return false;
    const task = chatStore.tasks[chatStore.activeTaskId];

    return (
      // running or paused
      task.status === ChatTaskStatus.RUNNING ||
      task.status === ChatTaskStatus.PAUSE ||
      // splitting phase
      task.messages.some(
        (m) => m.step === AgentStep.TO_SUB_TASKS && !m.isConfirm
      ) ||
      // skeleton/computing phase
      ((task.status as string) !== ChatTaskStatus.FINISHED &&
        (task.status as string) !== ChatTaskStatus.RUNNING &&
        !task.messages.find((m) => m.step === AgentStep.TO_SUB_TASKS) &&
        !task.hasWaitComfirm &&
        task.messages.length > 0) ||
      task.isTakeControl
    );
  }, [chatStore?.activeTaskId, chatStore?.tasks]);

  const isCloudUsageLimited = modelType === 'cloud' && cloudUsageLimitReached;

  const isInputDisabled = useMemo(() => {
    if (!chatStore?.activeTaskId || !chatStore.tasks[chatStore.activeTaskId])
      return true;

    const task = chatStore.tasks[chatStore.activeTaskId];

    // If ask human is active, allow input
    if (task.activeAsk) return false;

    // Standard checks - check model
    if (isCloudUsageLimited) return true;
    if (!hasModel) return true;
    if (useCloudModelInDev) return true;
    if (task.isContextExceeded) return true;

    return false;
  }, [
    chatStore?.activeTaskId,
    chatStore?.tasks,
    isCloudUsageLimited,
    hasModel,
    useCloudModelInDev,
  ]);

  const handleSendShare = useCallback(
    async (token: string) => {
      if (!chatStore) return;
      if (!token) return;
      if (!projectStore.activeProjectId) {
        console.warn("Can't send share due to no active projectId");
        return;
      }

      // Check model configuration before starting task
      if (!hasModel) {
        if (isCloudUsageLimited) {
          toast.error(
            cloudUsageLimitMessage ||
              t('chat.usage-limit-trial-daily-exhausted')
          );
          return;
        }
        toast.error(
          t('chat.select-model-first', {
            defaultValue: 'Please select a model first.',
          })
        );
        openSettings('models');
        return;
      }

      let _token: string = token.split('__')[0];
      let taskId: string = token.split('__')[1];
      chatStore.create(taskId, 'share');
      chatStore.setHasMessages(taskId, true);
      const res = await proxyFetchGet(`/api/v1/chat/share/info/${_token}`);
      if (res?.question) {
        chatStore.addMessages(taskId, {
          id: generateUniqueId(),
          role: 'user',
          content: res.question.split('|')[0],
        });
        try {
          await chatStore.startTask(taskId, 'share', _token, 0.1);
          chatStore.setActiveTaskId(taskId);
          chatStore.handleConfirmTask(
            projectStore.activeProjectId,
            taskId,
            'share'
          );
        } catch (err: any) {
          console.error('Failed to start shared task:', err);
          toast.error(
            err?.message ||
              'Failed to start task. Please check your model configuration.'
          );
        }
      }
    },
    [
      chatStore,
      projectStore.activeProjectId,
      hasModel,
      isCloudUsageLimited,
      cloudUsageLimitMessage,
      t,
    ]
  );

  // Handle skill_prompt from URL - pre-fill message when navigating from Skills page
  useEffect(() => {
    if (skill_prompt) {
      setMessage(skill_prompt);
      // Clear the skill_prompt param from URL after setting the message
      const newSearchParams = new URLSearchParams(searchParams);
      newSearchParams.delete('skill_prompt');
      setSearchParams(newSearchParams, { replace: true });
    }
  }, [skill_prompt, searchParams, setSearchParams]);

  // Handle scrollbar visibility on scroll
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    const handleScroll = () => {
      // Add scrolling class
      scrollContainer.classList.add('scrolling');

      // Clear existing timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      // Remove scrolling class after 1 second of no scrolling
      scrollTimeoutRef.current = setTimeout(() => {
        scrollContainer.classList.remove('scrolling');
      }, 1000);
    };

    scrollContainer.addEventListener('scroll', handleScroll);

    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  const handleSend = async (
    messageStr?: string,
    taskId?: string,
    executionId?: string,
    queuedAttaches?: File[],
    queuedRequestId?: string,
    queuedReviewHandoffIds?: string[]
  ) => {
    const _taskId = taskId || chatStore.activeTaskId;
    const composerAttachments =
      queuedAttaches || (_taskId ? chatStore.tasks[_taskId]?.attaches : []);
    if (
      message.trim() === '' &&
      !messageStr &&
      (composerAttachments?.length || 0) === 0
    )
      return;

    if (!hasModel) {
      if (isCloudUsageLimited) {
        toast.error(
          cloudUsageLimitMessage || t('chat.usage-limit-trial-daily-exhausted')
        );
        return;
      }
      toast.error(
        t('chat.select-model-first', {
          defaultValue: 'Please select a model first.',
        })
      );
      openSettings('models');
      return;
    }

    const targetProjectId = projectStore.activeProjectId;
    if (!targetProjectId) {
      toast.error(
        t('chat.no-active-session', {
          defaultValue: 'No active session selected.',
        })
      );
      return;
    }

    const targetProjectMeta = useSpaceStore
      .getState()
      .getProjectMeta(targetProjectId);
    const shouldResumeProject = isProjectAchieved(targetProjectMeta?.metadata);

    const rawMessageContent = messageStr || message;
    let tempMessageContent = rawMessageContent;
    if (!tempMessageContent.trim() && (composerAttachments?.length || 0) > 0) {
      tempMessageContent = t('chat.attachment-only-message', {
        defaultValue: 'Please use the attached file(s).',
      });
    }
    const displayContent = tempMessageContent;
    const requestedReviewHandoffIds =
      queuedReviewHandoffIds ?? pendingReviewHandoffIds;
    const preserveComposer = queuedAttaches !== undefined;

    if (executionId && targetProjectId) {
      const project = projectStore.getProjectById(targetProjectId);
      const isInQueue = project?.queuedMessages?.some(
        (m) => m.executionId === executionId
      );
      if (isInQueue) {
        console.warn(
          `[handleSend] Skipping message with executionId ${executionId} - already in queue, will be processed by useBackgroundTaskProcessor`
        );
        return;
      }
    }
    chatStore.setHasMessages(_taskId as string, true);
    if (!_taskId) return;

    // Multi-turn support: Check if task is running or planning (splitting/confirm)
    const task = chatStore.tasks[_taskId];
    const requiresHumanReply = Boolean(task?.activeAsk);
    const reviewHandoffIds = queuedReviewHandoffIds
      ? requestedReviewHandoffIds
      : requestedReviewHandoffIds.filter((handoffId) => {
          const handoff = usePageTabStore
            .getState()
            .workspaceReviewHandoffs.find(
              (candidate) =>
                candidate.projectId === targetProjectId &&
                candidate.handoffId === handoffId
            );
          return Boolean(
            handoff && tempMessageContent.includes(handoff.content)
          );
        });
    const discardedReviewHandoffIds = queuedReviewHandoffIds
      ? []
      : requestedReviewHandoffIds.filter(
          (handoffId) => !reviewHandoffIds.includes(handoffId)
        );
    if (discardedReviewHandoffIds.length > 0) {
      discardWorkspaceReviewHandoffs(
        targetProjectId,
        discardedReviewHandoffIds
      );
      setPendingReviewHandoffIds(reviewHandoffIds);
    }
    if (requiresHumanReply && reviewHandoffIds.length > 0) {
      toast.error(
        t('chat.answer-pending-before-review', {
          defaultValue:
            'Answer the pending question before sending review feedback.',
        })
      );
      return;
    }
    const requiresApprovalDecision =
      activeInteraction?.interaction_type === 'approval';
    const isTaskBusy =
      (task.status === ChatTaskStatus.RUNNING && task.hasMessages) ||
      task.status === ChatTaskStatus.PAUSE ||
      // splitting phase: has to_sub_tasks not confirmed OR skeleton computing
      task.messages.some(
        (m) => m.step === AgentStep.TO_SUB_TASKS && !m.isConfirm
      ) ||
      (!task.messages.find((m) => m.step === AgentStep.TO_SUB_TASKS) &&
        !task.hasWaitComfirm &&
        task.messages.length > 0 &&
        task.status !== ChatTaskStatus.FINISHED) ||
      task.isTakeControl ||
      // explicit confirm wait while task is pending but card not confirmed yet
      (!!task.messages.find(
        (m) => m.step === AgentStep.TO_SUB_TASKS && !m.isConfirm
      ) &&
        task.status === ChatTaskStatus.PENDING);
    const _isTaskInProgress = ['running', 'pause'].includes(task?.status || '');
    const isReplayChatStore = task?.type === 'replay';
    if (!requiresHumanReply && isTaskBusy && !isReplayChatStore) {
      const queuedFiles = JSON.parse(
        JSON.stringify(chatStore.tasks[_taskId]?.attaches || [])
      );
      const requestId = generateUniqueId();
      try {
        await createFollowUpRequest({
          projectId: targetProjectId,
          requestId,
          content: displayContent,
          attachmentPaths: queuedFiles.map((file: File) => file.filePath),
          reviewHandoffIds,
        });
      } catch (error: any) {
        console.error('[FollowUpQueue] Failed to persist message', error);
        toast.error(error?.message || 'Failed to queue message.');
        return;
      }
      projectStore.restoreQueuedMessage(targetProjectId, {
        task_id: requestId,
        run_id: requestId,
        content: displayContent,
        timestamp: getCurrentTimestamp(),
        attaches: queuedFiles,
        source: 'local',
        reviewHandoffIds,
      });
      chatStore.setAttaches(_taskId, []);
      setMessage('');
      acknowledgeWorkspaceReviewHandoffs(targetProjectId, reviewHandoffIds);
      setPendingReviewHandoffIds([]);
      toast.success(
        t('chat.message-queued', {
          defaultValue:
            'Message queued. Eigent will send it when the current task finishes.',
        })
      );
      return;
    }

    if (shouldResumeProject) {
      void setProjectAchievedState({
        projectStore,
        projectId: targetProjectId,
        achieved: false,
      }).catch((error) => {
        console.error('[handleSend] Failed to resume achieved Project:', error);
        toast.error(
          t('chat.resumed-session-save-failed', {
            defaultValue: "Couldn't save the resumed session. Try again.",
          })
        );
      });
    }

    if (textareaRef.current) textareaRef.current.style.height = '60px';
    let messageAccepted = false;
    try {
      if (queuedRequestId) {
        chatStore.setNextTaskId(queuedRequestId);
        chatStore.setNextExecutionId(_taskId, undefined);
        const queuedFiles = queuedAttaches || [];
        const backendStatus = await fetchGet(
          `/chat/${encodeURIComponent(targetProjectId)}/status`
        );
        if (backendStatus?.has_lock) {
          await fetchPost(`/chat/${targetProjectId}`, {
            question: tempMessageContent,
            task_id: queuedRequestId,
            attaches: queuedFiles.map((file) => file.filePath),
            ...(reviewHandoffIds.length
              ? { review_handoff_ids: reviewHandoffIds }
              : {}),
            target: undefined,
          });
          // The accepted request becomes a new durable Run. Do not append its
          // user message to the completed compatibility Run: CONFIRMED owns
          // the legacy projection and RunDomainEventHub owns the event-native
          // projection. Writing here as well renders the queued prompt twice.
        } else {
          // Brain restart removes the warm compatibility consumer.  A queued
          // instruction is still a normal new Run, so start it through the
          // cold admission path with its durable request id instead of
          // retrying /chat/{project} forever.
          await chatStore.startTask(
            queuedRequestId,
            undefined,
            undefined,
            undefined,
            tempMessageContent,
            queuedFiles,
            undefined,
            targetProjectId,
            effectiveSessionMode,
            {
              preserveTaskId: true,
              awaitAdmission: true,
              ...(reviewHandoffIds.length ? { reviewHandoffIds } : {}),
            }
          );
        }
        messageAccepted = true;
      } else if (requiresHumanReply) {
        if (requiresApprovalDecision) {
          toast.error(
            t('chat.use-approval-card', {
              defaultValue:
                'Use the approval card to approve or reject this action.',
            })
          );
          return;
        }
        const humanReplyMessageId = generateUniqueId();
        chatStore.addMessages(_taskId, {
          id: humanReplyMessageId,
          role: 'user',
          content: displayContent,
          interactionResponseTo: activeInteraction?.interaction_id,
          attaches: JSON.parse(
            JSON.stringify(chatStore.tasks[_taskId]?.attaches || [])
          ),
        });
        setMessage('');

        chatStore.setIsPending(_taskId, true);

        let replyResult: any;
        try {
          replyResult = await fetchPost(
            `/chat/${targetProjectId}/human-reply`,
            {
              agent: chatStore.tasks[_taskId].activeAsk,
              reply: tempMessageContent,
              interaction_id: activeInteraction?.interaction_id,
              decision_request_id: activeInteraction?.interaction_id
                ? `desktop-reply:${activeInteraction.interaction_id}`
                : undefined,
            }
          );
        } catch (error: any) {
          // The optimistic answer must not become a historical receipt unless
          // the backend accepted it. Keep the active request available for a
          // retry and restore the draft on transport failure.
          chatStore.removeMessage(_taskId, humanReplyMessageId);
          chatStore.setIsPending(_taskId, false);
          setMessage(tempMessageContent);
          toast.error(error?.message || 'Failed to send your reply.');
          return;
        }
        if (replyResult?.code === 1) {
          chatStore.removeMessage(_taskId, humanReplyMessageId);
          chatStore.setIsPending(_taskId, false);
          chatStore.setActiveAskList(_taskId, []);
          chatStore.setActiveAsk(_taskId, '');
          setMessage(tempMessageContent);
          toast.error(
            replyResult.text || 'This task is no longer waiting for a reply.'
          );
          return;
        }
        messageAccepted = true;
        chatStore.setAttaches(_taskId, []);
        if (chatStore.tasks[_taskId].askList.length === 0) {
          chatStore.setActiveAsk(_taskId, '');
        } else {
          let activeAskList = chatStore.tasks[_taskId].askList;
          let message = activeAskList.shift();
          chatStore.setActiveAskList(_taskId, [...activeAskList]);
          chatStore.setActiveAsk(_taskId, message?.agent_name || '');
          chatStore.setIsPending(_taskId, false);
          chatStore.addMessages(_taskId, message!);
        }
      } else {
        // Check if we should continue the conversation or start a new task
        const hasMessages =
          chatStore.tasks[_taskId as string].messages.length > 0;
        const isFinished =
          chatStore.tasks[_taskId as string].status === 'finished';
        const hasWaitComfirm =
          chatStore.tasks[_taskId as string]?.hasWaitComfirm;

        // Check if this task was manually stopped (finished but without natural completion)
        const wasTaskStopped =
          isFinished &&
          !chatStore.tasks[_taskId as string].messages.some(
            (m) => m.step === 'end' // Natural completion has an "end" step message
          );

        // Continue conversation if:
        // 1. Has wait confirm (simple query response) - but not if task was stopped
        // 2. Task is naturally finished (complex task completed) - but not if task was stopped
        // 3. Has any messages but pending (ongoing conversation)
        const shouldContinueConversation =
          (hasWaitComfirm && !wasTaskStopped) ||
          (isFinished && !wasTaskStopped) ||
          (hasMessages &&
            chatStore.tasks[_taskId as string].status ===
              ChatTaskStatus.PENDING);

        if (shouldContinueConversation) {
          // Check if this is the very first message and task hasn't started
          const hasSimpleResponse = chatStore.tasks[
            _taskId as string
          ].messages.some((m) => m.step === 'wait_confirm');
          const hasComplexTask = chatStore.tasks[
            _taskId as string
          ].messages.some((m) => m.step === 'to_sub_tasks');
          const hasErrorMessage = chatStore.tasks[
            _taskId as string
          ].messages.some(
            (m) => m.role === 'agent' && m.content.startsWith('❌ **Error**:')
          );

          // Only start a new task if: pending, no messages processed yet
          // OR while or after replaying a project
          if (
            (chatStore.tasks[_taskId as string].status ===
              ChatTaskStatus.PENDING &&
              !hasSimpleResponse &&
              !hasComplexTask &&
              !isFinished) ||
            chatStore.tasks[_taskId].type === 'replay' ||
            hasErrorMessage
          ) {
            if (!preserveComposer) setMessage('');
            // Pass the message content to startTask instead of adding it to current chatStore
            const attachesToSend =
              queuedAttaches ||
              JSON.parse(
                JSON.stringify(chatStore.tasks[_taskId]?.attaches || [])
              );
            try {
              ensureActiveProjectMode();
              await chatStore.startTask(
                _taskId,
                undefined,
                undefined,
                undefined,
                tempMessageContent,
                attachesToSend,
                executionId,
                targetProjectId,
                effectiveSessionMode,
                reviewHandoffIds.length ? { reviewHandoffIds } : undefined
              );
              messageAccepted = true;
              if (!preserveComposer) chatStore.setAttaches(_taskId, []);
              // If activeTaskId changed (new task created), clear its draft too
              const newActiveId = chatStore.activeTaskId;
              if (newActiveId && newActiveId !== _taskId) {
                if (!preserveComposer) chatStore.setAttaches(newActiveId, []);
              }
            } catch (err: any) {
              console.error('Failed to start task:', err);
              toast.error(
                err?.message ||
                  'Failed to start task. Please check your model configuration.'
              );
              if (preserveComposer) throw err;
              return;
            }
            // keep hasWaitComfirm as true so that follow-up improves work as usual
          } else {
            // Continue conversation: simple response, complex task, or finished task
            const attachesForThisTurn =
              queuedAttaches ||
              JSON.parse(
                JSON.stringify(chatStore.tasks[_taskId]?.attaches || [])
              );
            const improveAttaches =
              attachesForThisTurn.map(
                (f: { filePath: string }) => f.filePath
              ) || [];

            // A normal follow-up is a new durable Run. Seed it before the
            // admission request completes so the reply and its pending work
            // log are visible immediately, while the completed Run remains a
            // stable history section above it.
            const nextTaskId = generateUniqueId();
            chatStore.setNextTaskId(nextTaskId);
            chatStore.setNextExecutionId(_taskId as string, executionId);
            const nextChatResult = projectStore.appendInitChatStore(
              targetProjectId,
              nextTaskId
            );
            if (!nextChatResult) {
              // Every other failure path in this handler surfaces a toast. The
              // outer catch only logs, so without this the user would click
              // Send and observe nothing at all.
              const prepareError = new Error(
                t('chat.follow-up-prepare-failed')
              );
              toast.error(prepareError.message);
              throw prepareError;
            }

            const nextChatState = nextChatResult.chatStore.getState();
            // During the remaining multi-store migration window the prepared
            // Run can live in a different store from the completed Run. Keep
            // the boundary token on both sides so CONFIRMED reuses this exact
            // task instead of creating a duplicate.
            nextChatState.setNextTaskId(nextTaskId);
            nextChatState.setTaskSessionMode(nextTaskId, effectiveSessionMode);
            nextChatState.setTaskSource(
              nextTaskId,
              executionId ? 'trigger' : 'user'
            );
            nextChatState.setExecutionId(nextTaskId, executionId);
            nextChatState.setIsPending(nextTaskId, true);
            nextChatState.setHasMessages(nextTaskId, true);
            nextChatState.addMessages(nextTaskId, {
              id: generateUniqueId(),
              role: 'user',
              content: displayContent,
              attaches: attachesForThisTurn,
            });
            if (!preserveComposer) {
              chatStore.setAttaches(_taskId, []);
              setMessage('');
            }

            try {
              // Use improve endpoint (POST /chat/{id}) - {id} is project_id.
              await fetchPost(`/chat/${targetProjectId}`, {
                question: tempMessageContent,
                task_id: nextTaskId,
                attaches: improveAttaches,
                project_context: buildProjectContinuationContext(
                  targetProjectId,
                  nextTaskId
                ),
                ...(reviewHandoffIds.length
                  ? { review_handoff_ids: reviewHandoffIds }
                  : {}),
                target: undefined,
              });
              messageAccepted = true;
            } catch (error: any) {
              // Keep the failed turn as a traceable receipt instead of moving
              // the reply back into (or mutating) the completed history Run.
              nextChatState.setIsPending(nextTaskId, false);
              nextChatState.setStatus(nextTaskId, ChatTaskStatus.FINISHED);
              nextChatState.addMessages(nextTaskId, {
                id: generateUniqueId(),
                role: 'agent',
                content:
                  error?.message ||
                  '❌ **Error**: Failed to start the follow-up task.',
              });
              toast.error(error?.message || 'Failed to send follow-up.');
              if (preserveComposer) throw error;
            }
          }
        } else {
          // For the very first message, add it to the current chatStore first, then call startTask
          const attachesToSend =
            queuedAttaches ||
            JSON.parse(
              JSON.stringify(chatStore.tasks[_taskId]?.attaches || [])
            );
          if (!preserveComposer) setMessage('');
          try {
            ensureActiveProjectMode();
            await chatStore.startTask(
              _taskId,
              undefined,
              undefined,
              undefined,
              tempMessageContent,
              attachesToSend,
              executionId,
              targetProjectId,
              effectiveSessionMode,
              reviewHandoffIds.length ? { reviewHandoffIds } : undefined
            );
            messageAccepted = true;
            chatStore.setHasWaitComfirm(_taskId as string, true);
            if (!preserveComposer) chatStore.setAttaches(_taskId, []);
            // If activeTaskId changed (new task created), clear its draft too
            const newActiveId2 = chatStore.activeTaskId;
            if (newActiveId2 && newActiveId2 !== _taskId) {
              if (!preserveComposer) chatStore.setAttaches(newActiveId2, []);
            }
          } catch (err: any) {
            console.error('Failed to start task:', err);
            toast.error(
              err?.message ||
                'Failed to start task. Please check your model configuration.'
            );
            if (preserveComposer) throw err;
            return;
          }
        }
      }
    } catch (error) {
      console.error('error:', error);
      if (preserveComposer) throw error;
    } finally {
      if (messageAccepted && !requiresHumanReply) {
        acknowledgeWorkspaceReviewHandoffs(targetProjectId, reviewHandoffIds);
        setPendingReviewHandoffIds([]);
      }
      scheduleUsageRefresh();
    }
  };

  useEffect(() => {
    handleSendRef.current = handleSend;
  });

  const handleResumeInterruptedRun = async () => {
    if (!interruptedRun || !activeProjectId || !chatStore) return;
    if (!hasModel) {
      toast.error(
        t('chat.select-model-before-resume', {
          defaultValue: 'Select a model before resuming this task.',
        })
      );
      return;
    }
    const run = interruptedRun;
    const requestId = runActionRequestId('resume', run.run_id);
    setDurableRunAction('resuming');
    try {
      ensureActiveProjectMode();
      const resumePromise = chatStore.startTask(
        run.run_id,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        activeProjectId,
        effectiveSessionMode,
        {
          preserveTaskId: true,
          skipHistoryCreate: true,
          historyId: projectStore.getHistoryId(activeProjectId),
          resumeRequestId: requestId,
        }
      );
      // Admission is now owned by the existing task card/SSE. Hide the stale
      // interrupted action immediately; a failed admission refreshes it from
      // RunJournal in the catch path.
      setInterruptedRun(null);
      await resumePromise;
      clearRunActionRequestId('resume', run.run_id);
    } catch (error: any) {
      console.error('[RunControl] Failed to resume Run', error);
      clearRunActionRequestId('resume', run.run_id);
      toast.error(error?.message || t('chat.run-resume-failed'));
      await refreshInterruptedRun();
    } finally {
      setDurableRunAction(null);
    }
  };

  const handleCancelInterruptedRun = async () => {
    if (!interruptedRun) return;
    const run = interruptedRun;
    setDurableRunAction('cancelling');
    try {
      await fetchPost(`/runs/${encodeURIComponent(run.run_id)}/cancel`, {
        request_id: runActionRequestId('cancel', run.run_id),
        reason: 'explicit_cancel_from_desktop_ui',
      });
      // The cancel response confirms the command, not that the renderer has
      // consumed the canonical run.cancelled event. Replay from the durable
      // cursor so a prior gap can be filled and needsResync can be released.
      void runEventIngressRegistry.replayRun(run.project_id, run.run_id);
      clearRunActionRequestId('cancel', run.run_id);
      setInterruptedRun(null);
      for (const { chatStore: store } of projectStore.getAllChatStores(
        run.project_id
      )) {
        const state = store.getState();
        if (!state.tasks[run.run_id]) continue;
        state.setIsPending(run.run_id, false);
        state.setStatus(run.run_id, ChatTaskStatus.FINISHED);
      }
    } catch (error: any) {
      console.error('[RunControl] Failed to cancel Run', error);
      toast.error(error?.message || t('chat.run-cancel-failed'));
      await refreshInterruptedRun();
    } finally {
      setDurableRunAction(null);
    }
  };

  // Reactive queuedMessages for the active project
  const queuedMessages = useMemo(() => {
    const pid = projectStore.activeProjectId;
    if (!pid) return [];
    const project = projectStore.getProjectById(pid);
    return (project?.queuedMessages || []).map((m) => ({
      id: m.task_id,
      content: m.content,
      timestamp: m.timestamp,
      processing: m.processing,
      canSendNow:
        !m.executionId &&
        m.source !== 'scheduled' &&
        m.source !== 'remote_control' &&
        !interruptedRun,
    }));
  }, [interruptedRun, projectStore]);

  useEffect(() => {
    const projectId = projectStore.activeProjectId;
    if (!projectId) return;
    void listPendingFollowUpRequests(projectId)
      .then((items) => {
        const durableIds = new Set(items.map((item) => item.request_id));
        const current =
          projectStore.getProjectById(projectId)?.queuedMessages || [];
        for (const local of current) {
          if (local.source && !durableIds.has(local.task_id)) {
            projectStore.removeQueuedMessage(projectId, local.task_id);
          }
        }
        for (const item of items) {
          projectStore.restoreQueuedMessage(projectId, {
            task_id: item.request_id,
            run_id: item.request_id,
            content: item.content,
            timestamp: item.created_at * 1000,
            attaches: item.attachment_paths.map((filePath) => ({
              fileName: filePath.split(/[\\/]/).pop() || filePath,
              filePath,
              source: 'local',
            })) as unknown as File[],
            sendNow: item.delivery_mode === 'send_now',
            source: item.source,
            reviewHandoffIds: item.review_handoff_ids,
          });
        }
      })
      .catch((error) => {
        console.warn(
          '[FollowUpQueue] Failed to restore pending messages',
          error
        );
      });
  }, [projectStore, projectStore.activeProjectId]);

  useEffect(() => {
    if (
      !admittedQueuedRun ||
      admittedQueuedRun.projectId !== projectStore.activeProjectId
    ) {
      return;
    }

    const projectedRun =
      eventNativeProjectSnapshot?.view.runs[admittedQueuedRun.runId];
    if (projectedRun) {
      if (TERMINAL_QUEUED_RUN_STATUSES.has(projectedRun.status)) {
        setAdmittedQueuedRun(null);
      }
      return;
    }

    const legacyTask = projectStore
      .getAllChatStores(admittedQueuedRun.projectId)
      .map(
        ({ chatStore: store }) =>
          store.getState().tasks[admittedQueuedRun.runId]
      )
      .find(Boolean);
    if (legacyTask?.status === ChatTaskStatus.FINISHED) {
      setAdmittedQueuedRun(null);
    }
  }, [
    admittedQueuedRun,
    chatStore?.tasks,
    eventNativeProjectSnapshot?.revision,
    eventNativeProjectSnapshot?.view.runs,
    projectStore,
    projectStore.activeProjectId,
  ]);

  useEffect(() => {
    const projectId = projectStore.activeProjectId;
    const activeId = chatStore?.activeTaskId;
    if (
      !projectId ||
      !activeId ||
      isTaskBusy ||
      activeAsk ||
      interruptedRun ||
      !hasModel ||
      isCloudUsageLimited
    )
      return;
    // HTTP admission completes before the new Run necessarily reaches either
    // renderer projection. Keep a Project-scoped barrier until that exact Run
    // is terminal so React batching cannot drain the next FIFO row early.
    if (admittedQueuedRun?.projectId === projectId) return;
    if (queuedDispatchRef.current) return;

    const project = projectStore.getProjectById(projectId);
    const candidates = (project?.queuedMessages || []).filter(
      (item) => !item.executionId && !item.processing
    );
    const next = candidates.find((item) => item.sendNow) || candidates[0];
    if (!next) return;
    const sendQueuedMessage = handleSendRef.current;
    if (!sendQueuedMessage) return;

    queuedDispatchRef.current = next.task_id;
    projectStore.setQueuedMessageProcessing(projectId, next.task_id, true);
    void sendQueuedMessage(
      next.content,
      activeId,
      undefined,
      next.attaches,
      next.task_id,
      next.reviewHandoffIds
    )
      .then(() => {
        setAdmittedQueuedRun({ projectId, runId: next.task_id });
        projectStore.removeQueuedMessage(projectId, next.task_id);
      })
      .catch((error) => {
        console.error('[FollowUpQueue] Failed to admit queued message', error);
        const rejection = terminalContinuationAdmissionRejection(error);
        if (rejection) {
          // Brain has durably cancelled this queue row. Remove only the
          // renderer projection and leave the typed explanation visible.
          projectStore.removeQueuedMessage(projectId, next.task_id);
          toast.error(rejection.message);
          return;
        }
        projectStore.setQueuedMessageProcessing(projectId, next.task_id, false);
        toast.error(error?.message || 'Failed to send queued message.');
      })
      .finally(() => {
        queuedDispatchRef.current = null;
      });
  }, [
    activeAsk,
    admittedQueuedRun,
    chatStore?.activeTaskId,
    hasModel,
    isCloudUsageLimited,
    isTaskBusy,
    interruptedRun,
    projectStore,
    queuedMessages,
  ]);

  useEffect(() => {
    if (share_token && isConfigLoaded) {
      handleSendShare(share_token);
    }
  }, [share_token, isConfigLoaded, handleSendShare]);

  if (!chatStore) {
    return <div>Loading...</div>;
  }

  const handleConfirmTask = async (taskId?: string) => {
    const _taskId = taskId || chatStore.activeTaskId;
    if (!_taskId || !projectStore.activeProjectId) {
      return;
    }
    setLoading(true);
    await chatStore.handleConfirmTask(projectStore.activeProjectId, _taskId);
    setLoading(false);
  };

  // File selection handler
  const handleFileSelect = async () => {
    try {
      const taskId = chatStore.activeTaskId as string;
      const existingFiles = chatStore.tasks[taskId].attaches || [];

      if (isWeb()) {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.onchange = async () => {
          if (!input.files?.length) {
            return;
          }

          const uploadedFiles: File[] = [];
          for (const selectedFile of Array.from(input.files)) {
            try {
              const result = await uploadFileToBrain(selectedFile);
              uploadedFiles.push({
                fileName: result.filename,
                filePath: result.file_id,
                fileId: result.file_id,
                source: 'upload',
              } as File);
            } catch (error) {
              console.error('Select File Upload Error:', error);
              toast.error(
                t('chat.file-upload-failed', {
                  name: selectedFile.name,
                  defaultValue: 'Failed to upload {{name}}',
                })
              );
            }
          }

          if (uploadedFiles.length === 0) {
            return;
          }

          const files = [
            ...existingFiles,
            ...uploadedFiles.filter(
              (uploaded) =>
                !existingFiles.some(
                  (existing) => existing.filePath === uploaded.filePath
                )
            ),
          ];
          chatStore.setAttaches(taskId, files);
        };
        input.click();
        return;
      }

      const result = await host?.electronAPI?.selectFile({
        title: t('chat.select-file'),
        filters: [{ name: t('chat.all-files'), extensions: ['*'] }],
      });

      if (result?.success && result.files && result.files.length > 0) {
        const files = [
          ...existingFiles,
          ...result.files.filter(
            (r: File) =>
              !existingFiles.some((f: File) => f.filePath === r.filePath)
          ),
        ];
        chatStore.setAttaches(taskId, files);
      }
    } catch (error) {
      console.error('Select File Error:', error);
    }
  };

  // Stop task handler - triggers Action.skip_task which preserves context
  const handleSkip = async () => {
    const taskId = chatStore.activeTaskId as string;
    setIsPauseResumeLoading(true);

    try {
      // Call skip-task endpoint to trigger Action.skip_task
      // This will stop the task gracefully while preserving context for multi-turn
      await fetchPost(`/chat/${projectStore.activeProjectId}/skip-task`, {
        project_id: projectStore.activeProjectId,
      });

      // DO NOT call chatStore.stopTask here!
      // Keep SSE connection alive to receive "end" event from backend
      // The "end" event will set status to 'finished' and allow multi-turn conversation

      // Only set isPending to false so UI shows task is stopped
      chatStore.setIsPending(taskId, false);

      toast.success(
        t('chat.task-stopped-successfully', {
          defaultValue: 'Task stopped successfully',
        }),
        {
          closeButton: true,
        }
      );
    } catch (error) {
      console.error('[STOP-BUTTON] ❌ Failed to stop task:', error);

      // If backend call failed, close SSE connection as fallback
      try {
        chatStore.stopTask(taskId);
        chatStore.setIsPending(taskId, false);
        toast.warning(
          t('chat.task-stopped-backend-notification-failed', {
            defaultValue:
              'Task stopped locally, but backend notification failed. Backend task may continue running.',
          }),
          {
            closeButton: true,
            duration: 5000,
          }
        );
      } catch (localError) {
        console.error(
          '[STOP-BUTTON] ❌ Failed to stop task locally:',
          localError
        );
        toast.error(
          t('chat.task-stop-failed-refresh', {
            defaultValue:
              'Failed to stop task completely. Please refresh the page.',
          }),
          {
            closeButton: true,
          }
        );
      }
    } finally {
      setIsPauseResumeLoading(false);
    }
  };

  const handleTaskControl = async (action: 'pause' | 'resume') => {
    const taskId = chatStore.activeTaskId;
    const projectId = projectStore.activeProjectId;
    if (!taskId || !projectId || isPauseResumeLoading) return;
    setIsPauseResumeLoading(true);
    try {
      const changed = await takeControlOfTask({
        chatStore,
        action,
        projectId,
        taskId,
      });
      if (!changed) {
        toast.error(
          t(`chat.${action}-task-failed`, {
            defaultValue: `Failed to ${action} the task.`,
          })
        );
      }
    } finally {
      setIsPauseResumeLoading(false);
    }
  };

  const handleSendQueuedMessageNow = async (taskId: string) => {
    const projectId = projectStore.activeProjectId;
    if (!projectId) return;

    try {
      await prioritizeFollowUpRequest(projectId, taskId);
      projectStore.prioritizeQueuedMessage(projectId, taskId);
      if (!isTaskBusy) return;
      await fetchPost(`/chat/${projectId}/skip-task`, {
        project_id: projectId,
      });
      toast.success(
        t('chat.stopping-current-task-queued-next', {
          defaultValue:
            'Stopping the current task. Your queued message will start next.',
        })
      );
    } catch (error: any) {
      console.error('[FollowUpQueue] Failed to stop active Run', error);
      toast.error(error?.message || 'Failed to send the queued message now.');
    }
  };

  // Edit query handler
  const handleEditQuery = async () => {
    const taskId = chatStore.activeTaskId as string;
    const projectId = projectStore.activeProjectId;

    // Early validation
    if (!projectId) {
      console.error('No active project ID found for edit operation');
      return;
    }

    // Get question and attachments before any deletions
    const messageIndex = chatStore.tasks[taskId].messages.findLastIndex(
      (item) => item.step === 'to_sub_tasks'
    );
    const questionMessage = chatStore.tasks[taskId].messages[messageIndex - 2];
    const question = questionMessage.content;
    // Get the file attachments from the original user message (not from task.attaches which gets cleared after sending)
    const attachments = questionMessage.attaches || [];

    // Delete task from backend first
    try {
      await fetchDelete(`/chat/${projectId}`);
    } catch (error) {
      console.error('Failed to delete task from backend:', error);
      // Continue with local cleanup even if backend fails
    }

    // Delete chat history
    const history_id = projectStore.getHistoryId(projectId);
    if (history_id) {
      try {
        await proxyFetchDelete(`/api/v1/chat/history/${history_id}`);
      } catch (error) {
        console.error(
          `Failed to delete chat history (ID: ${history_id}) for project ${projectId}:`,
          error
        );
      }
    } else {
      console.warn(
        `No history ID found for project ${projectId} during edit operation`
      );
    }

    // Create new task and clean up locally
    let id = chatStore.create();
    chatStore.setHasMessages(id, true);
    // Copy the file attachments to the new task
    if (attachments.length > 0) {
      chatStore.setAttaches(id, attachments);
    }
    chatStore.removeTask(taskId);
    setMessage(question);
  };

  // Determine BottomBox state
  const getBottomBoxState = () => {
    if (!chatStore.activeTaskId) return 'input';
    const task = chatStore.tasks[chatStore.activeTaskId];

    // The plan-mode splitting UI now lives in PlanTaskBox, not BottomBox.
    // BottomBox surfaces the action for the unconfirmed plan: `save` if the
    // user has unsaved subtask edits, otherwise `confirm`.
    const toSubTasksMessage = task.messages.find(
      (m) => m.step === 'to_sub_tasks' && !m.isConfirm
    );

    if (
      toSubTasksMessage &&
      !toSubTasksMessage.isConfirm &&
      task.status === 'pending'
    ) {
      return task.planDirty ? 'save' : 'confirm';
    }
    if (toSubTasksMessage && !toSubTasksMessage.isConfirm) {
      return task.planDirty ? 'save' : 'confirm';
    }

    // Check task status
    if (task.status === ChatTaskStatus.PAUSE) {
      return 'running';
    }
    if (task.status === ChatTaskStatus.RUNNING) {
      const hasSubTasks = task.messages.some(
        (m) => m.step === AgentStep.TO_SUB_TASKS
      );
      const isDirectMode =
        !hasSubTasks && (task.taskAssigning?.length ?? 0) > 0;
      return isDirectMode ? 'input' : 'running';
    }

    if (task.status === 'finished' && task.type !== '') {
      return 'finished';
    }

    return 'input';
  };

  const handleRemoveTaskQueue = async (task_id: string) => {
    const project_id = projectStore.activeProjectId;
    if (!project_id) {
      console.error('No active project ID found');
      return;
    }

    const project = projectStore.getProjectById(project_id);
    const queued = project?.queuedMessages.find(
      (item) => item.task_id === task_id
    );
    if (!queued) {
      console.error(`Task with id ${task_id} not found in project queue`);
      return;
    }

    try {
      // Update the backend execution status if it has an executionId
      if (queued.executionId) {
        await proxyUpdateTriggerExecution(
          queued.executionId,
          {
            status: ExecutionStatus.Cancelled,
            error_message: 'Task was removed from queue by user.',
          },
          {
            projectId: project_id,
          }
        );
      } else {
        await cancelFollowUpRequest(project_id, task_id);
      }
      projectStore.removeQueuedMessage(project_id, task_id);
    } catch (error) {
      console.error(`[ChatBox] Failed to cancel task ${task_id}:`, error);
      toast.error(
        t('chat.cancel-task-failed', {
          defaultValue: 'Failed to cancel task',
        }),
        {
          description:
            error instanceof Error
              ? error.message
              : t('chat.unknown-error', { defaultValue: 'Unknown error' }),
        }
      );
    }
  };

  const handleEventNativeResumeRun = (runId: string) => {
    if (runId !== interruptedRun?.run_id || isCloudRestoredRun) return;
    void handleResumeInterruptedRun();
  };

  const handleEventNativeCancelRun = (runId: string) => {
    if (runId !== interruptedRun?.run_id || isCloudRestoredRun) return;
    void handleCancelInterruptedRun();
  };

  const handleEventNativeStopRun = async (runId: string) => {
    const currentRunId = selectEventNativeActiveRunId(
      eventNativeProjectSnapshot,
      eligibleLegacyActiveRunId
    );
    const currentRun = currentRunId
      ? eventNativeProjectSnapshot?.view.runs[currentRunId]
      : undefined;
    if (
      runId !== currentRunId ||
      currentRun?.status !== 'running' ||
      isPauseResumeLoading
    ) {
      return;
    }

    setIsPauseResumeLoading(true);
    try {
      await cancelProjectRun(
        runId,
        runActionRequestId('cancel', runId),
        'explicit_stop_from_event_native_chatbox'
      );
      clearRunActionRequestId('cancel', runId);
      if (chatStore.tasks[runId]) chatStore.setIsPending(runId, false);
      toast.success(t('chat.task-stopped', { defaultValue: 'Task stopped' }), {
        closeButton: true,
      });
    } catch (error: any) {
      console.error('[RunControl] Failed to stop Run', error);
      toast.error(
        error?.message ||
          t('chat.run-stop-failed', {
            defaultValue: 'Failed to stop this Run.',
          })
      );
    } finally {
      setIsPauseResumeLoading(false);
    }
  };

  let eventNativeRunControlVariant: BottomBoxRunControlVariant | null = null;
  if (
    eventNativeTimelineEnabled &&
    interruptedRun &&
    (isCloudRestoredRun || eventNativeInterruptedRun)
  ) {
    eventNativeRunControlVariant = {
      kind: 'run_control',
      header: {
        title: t(
          isCloudRestoredRun
            ? 'chat.run-cloud-restored-title'
            : 'chat.run-interrupted-title'
        ),
        description: isCloudRestoredRun
          ? undefined
          : t('chat.run-interrupted-description'),
      },
      runId: interruptedRun.run_id,
      state: isCloudRestoredRun
        ? 'read_only'
        : (durableRunAction ?? 'interrupted'),
      resumeLabel: t('chat.run-resume'),
      resumingLabel: t('chat.run-resuming'),
      cancelLabel: t('chat.run-cancel'),
      cancellingLabel: t('chat.run-cancelling'),
      readOnlyLabel: t('chat.run-cloud-restored-description'),
      onResume: isCloudRestoredRun ? undefined : handleEventNativeResumeRun,
      onCancel: isCloudRestoredRun ? undefined : handleEventNativeCancelRun,
    };
  } else if (eventNativeTimelineEnabled && eventNativeReadOnlyRun) {
    const restoredFromCloud = eventNativeReadOnlyRun.origin === 'cloud_restore';
    eventNativeRunControlVariant = {
      kind: 'run_control',
      header: {
        title: t(
          restoredFromCloud
            ? 'chat.run-cloud-restored-title'
            : 'chat.run-interrupted-title'
        ),
      },
      runId: eventNativeReadOnlyRun.runId,
      state: 'read_only',
      readOnlyLabel: restoredFromCloud
        ? t('chat.run-cloud-restored-description')
        : undefined,
    };
  }

  const legacyApprovalVariant =
    activeAsk && isInteractiveHumanReply && activeAskMessage
      ? createLegacyApprovalVariant({
          interaction: activeInteraction,
          fallbackQuestion: activeAskMessage.content.trim(),
          submitting: legacyApprovalSubmitting,
          t,
          onApprove: (scope) =>
            void handleLegacyApprovalDecision('approved', scope),
          onReject: () => void handleLegacyApprovalDecision('rejected', 'once'),
        })
      : null;
  const legacyHumanInputVariant: BottomBoxInputVariant | 'input' =
    activeAsk && isInteractiveHumanReply && activeAskMessage
      ? {
          kind: 'input',
          header: {
            eyebrow: t('chat.control-input-required'),
            title:
              activeInteraction?.question || activeAskMessage.content.trim(),
          },
        }
      : 'input';
  // Timeline density is presentation-only. Select one shared BottomBox control
  // from the active authority before rendering Normal, Detailed, or Summarised.
  const bottomBoxControl = selectBottomBoxControl({
    humanInteractionVariant: eventNativeTimelineEnabled
      ? eventNativeHumanControl.variant
      : legacyApprovalVariant,
    runControlVariant: eventNativeTimelineEnabled
      ? eventNativeRunControlVariant
      : null,
    composerVariant: eventNativeTimelineEnabled
      ? 'input'
      : legacyHumanInputVariant,
  });
  const bottomBoxVariant = bottomBoxControl.variant;
  const hasControlledBottomBoxVariant = bottomBoxControl.isControlled;
  const composerTaskControlState = selectComposerTaskControlState({
    eventNativeTimelineEnabled,
    legacyControlRunId: legacyControlTaskId,
    activeTaskStatus: activeTask?.status,
    eventNativeActiveRunId,
    allowLegacyFallbackControl,
  });
  const showFloatingStop =
    shouldRenderChatTimeline &&
    composerTaskControlState === 'running' &&
    eventNativeActiveProjectedRun?.status !== 'cancelling';
  const handleFloatingStop = () => {
    if (eventNativeActiveProjectedRun?.status === 'running') {
      void handleEventNativeStopRun(eventNativeActiveProjectedRun.runId);
      return;
    }
    void handleSkip();
  };
  const chatColumn = (
    <>
      {/* Main: scroll (scrollbar on panel edge) + BottomBox overlay when chatting */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div
          ref={scrollContainerRef}
          className="scrollbar-always-visible min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto pl-2.5"
        >
          {shouldRenderChatTimeline &&
          shouldRenderEventNativeTimeline &&
          activeProjectId ? (
            <EventNativeProjectTimeline
              chatStore={projectStore.getActiveChatStore() ?? undefined}
              detailLevel={chatTimelineDetailLevel}
              paused={composerTaskControlState === 'paused'}
              projectId={activeProjectId}
              sessionMode={displaySessionMode}
              scrollContainerRef={scrollContainerRef}
              scrollBottomInsetPx={scrollBottomInsetPx}
            />
          ) : shouldRenderChatTimeline ? (
            <ProjectChatContainer
              scrollContainerRef={scrollContainerRef}
              scrollBottomInsetPx={scrollBottomInsetPx}
            />
          ) : (
            <div className="mx-auto flex min-h-full w-full max-w-[600px] flex-col">
              <div className="flex flex-1 flex-col items-center justify-end gap-1 pb-4"></div>

              {interruptedRun && !eventNativeTimelineEnabled && (
                <InterruptedRunBanner
                  title={t(
                    isCloudRestoredRun
                      ? 'chat.run-cloud-restored-title'
                      : 'chat.run-interrupted-title'
                  )}
                  description={t(
                    isCloudRestoredRun
                      ? 'chat.run-cloud-restored-description'
                      : 'chat.run-interrupted-description'
                  )}
                  action={durableRunAction}
                  resumeLabel={t('chat.run-resume')}
                  resumingLabel={t('chat.run-resuming')}
                  cancelLabel={t('chat.run-cancel')}
                  cancellingLabel={t('chat.run-cancelling')}
                  onResume={handleResumeInterruptedRun}
                  onCancel={handleCancelInterruptedRun}
                  readOnly={isCloudRestoredRun}
                />
              )}

              {chatStore.activeTaskId && (
                <BottomBox
                  state="input"
                  queuedMessages={queuedMessages}
                  onRemoveQueuedMessage={(id) => handleRemoveTaskQueue(id)}
                  onSendQueuedMessageNow={handleSendQueuedMessageNow}
                  usageLimitBanner={usageLimitBanner}
                  noModelOverlay={!hasModel && !isCloudUsageLimited}
                  onSelectModel={handleSelectModel}
                  inputProps={{
                    value: message,
                    onChange: setMessage,
                    onSend: handleSend,
                    taskControlState: composerTaskControlState,
                    onPauseTask: () => void handleTaskControl('pause'),
                    onResumeTask: () => void handleTaskControl('resume'),
                    taskControlLoading: isPauseResumeLoading,
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
                    disabled: isInputDisabled,
                    textareaRef: textareaRef,
                    allowDragDrop: true,
                    useCloudModelInDev: useCloudModelInDev,
                  }}
                  sessionMode={effectiveSessionMode}
                  sessionModeSelectInteractive={false}
                  modelSelectProjectId={activeProjectId}
                />
              )}
            </div>
          )}
        </div>

        {showFloatingStop && (
          <div
            data-floating-stop-control
            className="pointer-events-none absolute inset-x-0 z-20 flex justify-center px-2.5"
            style={{ bottom: scrollBottomInsetPx }}
          >
            <FloatingAction
              className="static mt-0 w-auto"
              status={ChatTaskStatus.RUNNING}
              onSkip={handleFloatingStop}
              loading={isPauseResumeLoading}
            />
          </div>
        )}

        {chatStore.activeTaskId && hasAnyMessages ? (
          <div id={PLAN_OVERLAY_SLOT_ID} className="contents" />
        ) : null}
        {shouldRenderBottomBoxOverlay && (
          <div
            ref={bottomBoxOverlayRef}
            data-bottom-box-overlay
            className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-2.5"
          >
            <div className="pointer-events-auto mx-auto w-full max-w-[600px] rounded-t-3xl bg-ds-neutral-subtle-default pb-1">
              {interruptedRun && !eventNativeTimelineEnabled && (
                <InterruptedRunBanner
                  compact
                  title={t(
                    isCloudRestoredRun
                      ? 'chat.run-cloud-restored-title'
                      : 'chat.run-interrupted-title'
                  )}
                  description={t(
                    isCloudRestoredRun
                      ? 'chat.run-cloud-restored-description'
                      : 'chat.run-interrupted-description'
                  )}
                  attemptNumber={interruptedRun.latest_attempt?.attempt_number}
                  action={durableRunAction}
                  resumeLabel={t('chat.run-resume')}
                  resumingLabel={t('chat.run-resuming')}
                  cancelLabel={t('chat.run-cancel')}
                  cancellingLabel={t('chat.run-cancelling')}
                  onResume={handleResumeInterruptedRun}
                  onCancel={handleCancelInterruptedRun}
                  readOnly={isCloudRestoredRun}
                />
              )}
              <BottomBox
                state={
                  hasControlledBottomBoxVariant
                    ? 'running'
                    : getBottomBoxState()
                }
                variant={bottomBoxVariant}
                queuedMessages={queuedMessages}
                onRemoveQueuedMessage={(id) => handleRemoveTaskQueue(id)}
                onSendQueuedMessageNow={handleSendQueuedMessageNow}
                usageLimitBanner={usageLimitBanner}
                noModelOverlay={!hasModel && !isCloudUsageLimited}
                onSelectModel={handleSelectModel}
                subtitle={
                  getBottomBoxState() === 'confirm' ||
                  getBottomBoxState() === 'save'
                    ? (() => {
                        const messages = activeTask?.messages || [];
                        const lastUserMessage = messages
                          .slice()
                          .reverse()
                          .find((msg) => msg.role === 'user');
                        return (
                          lastUserMessage?.content || activeTask?.summaryTask
                        );
                      })()
                    : activeTask?.summaryTask
                }
                autoStartDeadline={activeTask?.autoConfirmDeadline}
                onStartTask={() => handleConfirmTask()}
                onSavePlan={async () => {
                  if (chatStore.activeTaskId) {
                    setLoading(true);
                    await chatStore.savePlan(chatStore.activeTaskId);
                    setLoading(false);
                  }
                }}
                onEdit={handleEditQuery}
                loading={loading}
                inputProps={{
                  value: message,
                  onChange: setMessage,
                  onSend: handleSend,
                  taskControlState: composerTaskControlState,
                  onPauseTask: () => void handleTaskControl('pause'),
                  onResumeTask: () => void handleTaskControl('resume'),
                  taskControlLoading: isPauseResumeLoading,
                  files:
                    activeTask?.attaches?.map((f) => ({
                      fileName: f.fileName,
                      filePath: f.filePath,
                    })) || [],
                  onFilesChange: (files) => {
                    if (!chatStore.activeTaskId) return;
                    chatStore.setAttaches(chatStore.activeTaskId, files as any);
                  },
                  onAddFile: handleFileSelect,
                  placeholder: t('chat.follow-up-placeholder'),
                  disabled: isInputDisabled,
                  textareaRef: textareaRef,
                  allowDragDrop: true,
                  useCloudModelInDev: useCloudModelInDev,
                }}
                sessionMode={displaySessionMode}
                sessionModeSelectInteractive={false}
                modelSelectProjectId={activeProjectId}
              />
            </div>
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      {chatColumn}
    </div>
  );
}
