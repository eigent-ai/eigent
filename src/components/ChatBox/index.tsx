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
  fetchPost,
  fetchPut,
  proxyFetchDelete,
  proxyFetchGet,
  uploadFileToBrain,
} from '@/api/http';
import { isWeb } from '@/client/platform';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useModelConfigCheck } from '@/hooks/useModelConfigCheck';
import { useHost } from '@/host';
import { generateUniqueId, SITE_URL } from '@/lib';
import {
  isProjectAchieved,
  setProjectAchievedState,
} from '@/lib/projectAchievement';
import { inferSessionModeFromTask } from '@/lib/sessionMode';
import { proxyUpdateTriggerExecution } from '@/service/triggerApi';
import { useAuthStore } from '@/store/authStore';
import { buildProjectContinuationContext } from '@/store/chatStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useSpaceStore } from '@/store/spaceStore';
import { ExecutionStatus } from '@/types';
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
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import BottomBox from './BottomBox';
import { ProjectChatContainer } from './ProjectChatContainer';
import { PLAN_OVERLAY_SLOT_ID } from './TaskBox/PlanTaskBox';

/** Minimum scroll padding under messages (matches previous ~8rem floor). */
const CHAT_SCROLL_BOTTOM_MIN_PX = 128;
/** Small gap between last message and BottomBox top. */
const CHAT_SCROLL_BOTTOM_GAP_PX = 8;

const USAGE_WARNING_RATIO = 0.75;
const FREE_STARTING_CREDITS = 500;

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
  const host = useHost();

  //Get Chatstore for the active project's task
  const { chatStore, projectStore } = useChatStoreAdapter();

  const { t } = useTranslation();
  const textareaRef = useRef<HTMLDivElement>(null);
  const workspaceChatFocusRequestId = usePageTabStore(
    (s) => s.workspaceChatFocusRequestId
  );
  const activeProjectId = projectStore.activeProjectId;
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
  const { modelType, token } = useAuthStore();
  const [subscriptionUsage, setSubscriptionUsage] =
    useState<SubscriptionLimitInfo | null>(null);
  const [currentCredits, setCurrentCredits] = useState<number | null>(null);
  const [dismissedUsageLimitBannerId, setDismissedUsageLimitBannerId] =
    useState<string | null>(null);

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

    const intervalId = window.setInterval(refreshUsageLimits, 60000);
    window.addEventListener('focus', refreshUsageLimits);

    return () => {
      window.clearInterval(intervalId);
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
    proxyFetchGet('/api/v1/configs').catch((err) =>
      console.error('Failed to fetch configs:', err)
    );
  }, []);
  const [searchParams, setSearchParams] = useSearchParams();
  const share_token = searchParams.get('share_token');
  const skill_prompt = searchParams.get('skill_prompt');

  const handleSendRef = useRef<
    ((messageStr?: string, taskId?: string) => Promise<void>) | null
  >(null);

  const navigate = useNavigate();

  const handleSelectModel = useCallback(() => {
    navigate('/history?tab=agents');
  }, [navigate]);

  // Task time tracking
  const [taskTime, setTaskTime] = useState(
    chatStore?.getFormattedTaskTime(chatStore?.activeTaskId as string) ||
      '00:00'
  );

  const [loading, setLoading] = useState(false);
  const [isPauseResumeLoading, setIsPauseResumeLoading] = useState(false);

  const activeTaskId = chatStore?.activeTaskId;
  const activeAsk = chatStore?.tasks[activeTaskId as string]?.activeAsk;

  useEffect(() => {
    if (!chatStore?.activeTaskId) return;
    const interval = setInterval(() => {
      if (chatStore.activeTaskId) {
        setTaskTime(chatStore.getFormattedTaskTime(chatStore.activeTaskId));
      }
    }, 500);
    return () => clearInterval(interval);
  }, [chatStore?.activeTaskId, chatStore]);

  useEffect(() => {
    if (!chatStore) return;
    const _activeAsk = activeAsk;
    let timer: NodeJS.Timeout;
    if (_activeAsk && _activeAsk !== '') {
      const _taskId = chatStore.activeTaskId as string;
      timer = setTimeout(() => {
        if (handleSendRef.current) {
          handleSendRef.current('skip', _taskId);
        }
      }, 30000); // 30 seconds
      return () => clearTimeout(timer); // clear previous timer
    }
    // if activeAsk is empty, also clear timer
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [activeAsk, chatStore, activeTaskId]);

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

  useLayoutEffect(() => {
    if (!chatStore?.activeTaskId || !hasAnyMessages) return;

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
  }, [chatStore?.activeTaskId, hasAnyMessages]);

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

    if (isTaskBusy) return true;

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
    isTaskBusy,
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
        toast.error('Please select a model first.');
        navigate('/history?tab=agents');
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
      navigate,
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

  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current) {
      setTimeout(() => {
        scrollContainerRef.current!.scrollTo({
          top: scrollContainerRef.current!.scrollHeight + 20,
          behavior: 'smooth',
        });
      }, 200);
    }
  }, []);

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
    executionId?: string
  ) => {
    const _taskId = taskId || chatStore.activeTaskId;
    if (message.trim() === '' && !messageStr) return;

    if (!hasModel) {
      if (isCloudUsageLimited) {
        toast.error(
          cloudUsageLimitMessage || t('chat.usage-limit-trial-daily-exhausted')
        );
        return;
      }
      toast.error('Please select a model first.');
      navigate('/history?tab=agents');
      return;
    }

    const targetProjectId = projectStore.activeProjectId;
    if (!targetProjectId) {
      toast.error('No active Project selected.');
      return;
    }

    const targetProjectMeta = useSpaceStore
      .getState()
      .getProjectMeta(targetProjectId);
    const shouldResumeProject = isProjectAchieved(targetProjectMeta?.metadata);

    const rawMessageContent = messageStr || message;
    let tempMessageContent = rawMessageContent;
    const displayContent = tempMessageContent;

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
      toast.error(
        'Current task is in progress. Please wait for it to finish before sending a new request.',
        {
          closeButton: true,
        }
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
        toast.error('Failed to persist resumed Project state.');
      });
    }

    if (textareaRef.current) textareaRef.current.style.height = '60px';
    try {
      if (requiresHumanReply) {
        chatStore.addMessages(_taskId, {
          id: generateUniqueId(),
          role: 'user',
          content: displayContent,
          attaches:
            JSON.parse(JSON.stringify(chatStore.tasks[_taskId]?.attaches)) ||
            [],
        });
        setMessage('');

        // Scroll to bottom after adding user message
        setTimeout(() => {
          scrollToBottom();
        }, 200);

        chatStore.setIsPending(_taskId, true);

        await fetchPost(`/chat/${targetProjectId}/human-reply`, {
          agent: chatStore.tasks[_taskId].activeAsk,
          reply: tempMessageContent,
        });
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
            setMessage('');
            // Pass the message content to startTask instead of adding it to current chatStore
            const attachesToSend =
              JSON.parse(JSON.stringify(chatStore.tasks[_taskId]?.attaches)) ||
              [];
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
                effectiveSessionMode
              );
              chatStore.setAttaches(_taskId, []);
              // If activeTaskId changed (new task created), clear its draft too
              const newActiveId = chatStore.activeTaskId;
              if (newActiveId && newActiveId !== _taskId) {
                chatStore.setAttaches(newActiveId, []);
              }
            } catch (err: any) {
              console.error('Failed to start task:', err);
              toast.error(
                err?.message ||
                  'Failed to start task. Please check your model configuration.'
              );
              return;
            }
            // keep hasWaitComfirm as true so that follow-up improves work as usual
          } else {
            // Continue conversation: simple response, complex task, or finished task
            const attachesForThisTurn = JSON.parse(
              JSON.stringify(chatStore.tasks[_taskId]?.attaches || [])
            );
            const improveAttaches =
              attachesForThisTurn.map(
                (f: { filePath: string }) => f.filePath
              ) || [];

            //Generate nextId in case new chatStore is created to sync with the backend beforehand
            const nextTaskId = generateUniqueId();
            chatStore.setNextTaskId(nextTaskId);
            chatStore.setNextExecutionId(_taskId as string, executionId);

            // Use improve endpoint (POST /chat/{id}) - {id} is project_id
            fetchPost(`/chat/${targetProjectId}`, {
              question: tempMessageContent,
              task_id: nextTaskId,
              attaches: improveAttaches,
              project_context: buildProjectContinuationContext(
                targetProjectId,
                nextTaskId
              ),
              target: undefined,
            });
            chatStore.setIsPending(_taskId, true);
            chatStore.addMessages(_taskId, {
              id: generateUniqueId(),
              role: 'user',
              content: displayContent,
              attaches: attachesForThisTurn,
            });
            chatStore.setAttaches(_taskId, []);
            setMessage('');
          }
        } else {
          setTimeout(() => {
            scrollToBottom();
          }, 200);

          // For the very first message, add it to the current chatStore first, then call startTask
          const attachesToSend =
            JSON.parse(JSON.stringify(chatStore.tasks[_taskId]?.attaches)) ||
            [];
          setMessage('');
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
              effectiveSessionMode
            );
            chatStore.setHasWaitComfirm(_taskId as string, true);
            chatStore.setAttaches(_taskId, []);
            // If activeTaskId changed (new task created), clear its draft too
            const newActiveId2 = chatStore.activeTaskId;
            if (newActiveId2 && newActiveId2 !== _taskId) {
              chatStore.setAttaches(newActiveId2, []);
            }
          } catch (err: any) {
            console.error('Failed to start task:', err);
            toast.error(
              err?.message ||
                'Failed to start task. Please check your model configuration.'
            );
            return;
          }
        }
      }
    } catch (error) {
      console.error('error:', error);
    } finally {
      scheduleUsageRefresh();
    }
  };

  handleSendRef.current = handleSend;

  // Reactive queuedMessages for the active project
  const queuedMessages = useMemo(() => {
    const pid = projectStore.activeProjectId;
    if (!pid) return [];
    const project = projectStore.getProjectById(pid);
    return (project?.queuedMessages || []).map((m) => ({
      id: m.task_id,
      content: m.content,
      timestamp: m.timestamp,
    }));
  }, [projectStore]);

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
              toast.error(`Failed to upload ${selectedFile.name}`);
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

  // Pause/Resume handler
  const handlePauseResume = () => {
    const taskId = chatStore.activeTaskId as string;
    const task = chatStore.tasks[taskId];
    const type = task.status === 'running' ? 'pause' : 'resume';

    setIsPauseResumeLoading(true);
    if (type === 'pause') {
      let { taskTime, elapsed } = task;
      const now = Date.now();
      elapsed += now - taskTime;
      chatStore.setElapsed(taskId, elapsed);
      chatStore.setTaskTime(taskId, 0);
      chatStore.setStatus(taskId, 'pause');
    } else {
      chatStore.setTaskTime(taskId, Date.now());
      chatStore.setStatus(taskId, 'running');
    }

    fetchPut(`/task/${projectStore.activeProjectId}/take-control`, {
      action: type,
    });
    setIsPauseResumeLoading(false);
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

      toast.success('Task stopped successfully', {
        closeButton: true,
      });
    } catch (error) {
      console.error('[STOP-BUTTON] ❌ Failed to stop task:', error);

      // If backend call failed, close SSE connection as fallback
      try {
        chatStore.stopTask(taskId);
        chatStore.setIsPending(taskId, false);
        toast.warning(
          'Task stopped locally, but backend notification failed. Backend task may continue running.',
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
          'Failed to stop task completely. Please refresh the page.',
          {
            closeButton: true,
          }
        );
      }
    } finally {
      setIsPauseResumeLoading(false);
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

    // Remove from projectStore's queuedMessages
    const removed = projectStore.removeQueuedMessage(project_id, task_id);
    if (!removed || !removed.task_id) {
      console.error(`Task with id ${task_id} not found in project queue`);
      return;
    }

    try {
      // Update the backend execution status if it has an executionId
      if (removed.executionId) {
        await proxyUpdateTriggerExecution(
          removed.executionId,
          {
            status: ExecutionStatus.Cancelled,
            error_message: 'Task was removed from queue by user.',
          },
          {
            projectId: project_id,
          }
        );
      }
    } catch (error) {
      console.error(`[ChatBox] Failed to cancel task ${task_id}:`, error);
      // Restore the message if backend update failed
      projectStore.restoreQueuedMessage(project_id, removed);
      toast.error('Failed to cancel task', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  const chatColumn = (
    <>
      {/* Main: scroll (scrollbar on panel edge) + BottomBox overlay when chatting */}
      <div className="min-h-0 min-w-0 relative flex flex-1 flex-col overflow-hidden">
        <div
          ref={scrollContainerRef}
          className="scrollbar-always-visible min-h-0 min-w-0 pl-2 flex-1 overflow-x-hidden overflow-y-auto"
        >
          {hasAnyMessages ? (
            <ProjectChatContainer
              scrollContainerRef={scrollContainerRef}
              scrollBottomInsetPx={scrollBottomInsetPx}
              onSkip={handleSkip}
              isPauseResumeLoading={isPauseResumeLoading}
            />
          ) : (
            <div className="mx-auto flex min-h-full w-full max-w-[600px] flex-col">
              <div className="gap-1 pb-4 flex flex-1 flex-col items-center justify-end"></div>

              {chatStore.activeTaskId && (
                <BottomBox
                  state="input"
                  queuedMessages={queuedMessages}
                  onRemoveQueuedMessage={(id) => handleRemoveTaskQueue(id)}
                  usageLimitBanner={usageLimitBanner}
                  noModelOverlay={!hasModel && !isCloudUsageLimited}
                  onSelectModel={handleSelectModel}
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
                    disabled: isInputDisabled,
                    textareaRef: textareaRef,
                    allowDragDrop: true,
                    useCloudModelInDev: useCloudModelInDev,
                    sessionMode: effectiveSessionMode,
                    sessionModeSelectInteractive: false,
                  }}
                />
              )}
            </div>
          )}
        </div>

        {chatStore.activeTaskId && hasAnyMessages && (
          <div id={PLAN_OVERLAY_SLOT_ID} className="contents" />
        )}
        {chatStore.activeTaskId && hasAnyMessages && (
          <div
            ref={bottomBoxOverlayRef}
            data-bottom-box-overlay
            className="inset-x-0 bottom-0 pointer-events-none absolute z-30 flex justify-center"
          >
            <div className="px-2 pointer-events-auto mx-auto w-full max-w-[600px]">
              <BottomBox
                state={getBottomBoxState()}
                queuedMessages={queuedMessages}
                onRemoveQueuedMessage={(id) => handleRemoveTaskQueue(id)}
                usageLimitBanner={usageLimitBanner}
                noModelOverlay={!hasModel && !isCloudUsageLimited}
                onSelectModel={handleSelectModel}
                subtitle={
                  getBottomBoxState() === 'confirm' ||
                  getBottomBoxState() === 'save'
                    ? (() => {
                        const messages =
                          chatStore.tasks[chatStore.activeTaskId]?.messages ||
                          [];
                        const lastUserMessage = messages
                          .slice()
                          .reverse()
                          .find((msg) => msg.role === 'user');
                        return (
                          lastUserMessage?.content ||
                          chatStore.tasks[chatStore.activeTaskId]?.summaryTask
                        );
                      })()
                    : chatStore.tasks[chatStore.activeTaskId]?.summaryTask
                }
                autoStartDeadline={
                  chatStore.tasks[chatStore.activeTaskId]?.autoConfirmDeadline
                }
                onStartTask={() => handleConfirmTask()}
                onSavePlan={async () => {
                  if (chatStore.activeTaskId) {
                    setLoading(true);
                    await chatStore.savePlan(chatStore.activeTaskId);
                    setLoading(false);
                  }
                }}
                onEdit={handleEditQuery}
                taskTime={taskTime}
                taskStatus={chatStore.tasks[chatStore.activeTaskId]?.status}
                onPauseResume={handlePauseResume}
                pauseResumeLoading={isPauseResumeLoading}
                loading={loading}
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
                  placeholder: t('chat.follow-up-placeholder'),
                  disabled: isInputDisabled,
                  textareaRef: textareaRef,
                  allowDragDrop: true,
                  useCloudModelInDev: useCloudModelInDev,
                  sessionMode: displaySessionMode,
                  sessionModeSelectInteractive: false,
                }}
              />
            </div>
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="min-h-0 relative flex h-full w-full flex-1 flex-col overflow-hidden">
      {chatColumn}
    </div>
  );
}
