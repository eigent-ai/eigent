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

import { Button } from '@/components/ui/button';
import { useProjectEventRuntime } from '@/hooks/useProjectEventRuntime';
import {
  selectRenderableChatNodes,
  type ChatMessageNode,
  type ChatProjectionNode,
  type ChatRunStatusNode,
} from '@/lib/projector/chat';
import {
  composeTimelineRuns,
  reconcileTimelineRuns,
  type TimelineRunView,
} from '@/lib/projector/chat/presentation';
import { cn } from '@/lib/utils';
import type { VanillaChatStore } from '@/store/chatStore';
import { usePageTabStore } from '@/store/pageTabStore';
import type { ChatTimelineDetailLevel } from '@/types/chatTimeline';
import {
  AgentStep,
  ChatTaskStatus,
  SessionMode,
  type SessionModeType,
} from '@/types/constants';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';

import {
  animateChatTimelineAnchor,
  type ChatTimelineScrollAnimation,
} from './chatTimelineScroll';
import { presentChatSemanticEntities } from './EventTimeline/presentationPolicy';
import { PlanTaskBox } from './TaskBox/PlanTaskBox';
import { TimelineModeRenderer } from './TimelineModes';

/** Temporary DOM window until the event timeline has variable-height virtualization. */
const MAX_MOUNTED_EVENT_NODES = 250;
/** Extra slack beyond the BottomBox inset so "last message visible" still counts as pinned. */
const NEAR_BOTTOM_SLACK_PX = 48;

export function isChatTimelineNearBottom(
  distanceFromBottom: number,
  bottomInsetPx: number,
  slackPx = NEAR_BOTTOM_SLACK_PX
): boolean {
  return distanceFromBottom <= Math.max(0, bottomInsetPx) + slackPx;
}

interface EventNativeTimelineWindow {
  hiddenNodeCount: number;
  nodes: readonly ChatProjectionNode[];
}

/**
 * Apply the temporary DOM window to already-composed semantic Runs.
 *
 * Re-composing the visible input is unsafe because the visible slice may
 * contain transport receipts that the full semantic pass intentionally
 * suppressed (for example an approval decision or a legacy ASK mirror). Keep
 * the full Run's collapsed rows and select them only by the semantic event
 * identities that survived the window instead.
 */
export function selectWindowedTimelineRuns(
  allRuns: readonly TimelineRunView[],
  visibleNodes: readonly ChatProjectionNode[]
): TimelineRunView[] {
  const visibleEventIds = new Set(visibleNodes.map((node) => node.eventId));

  return allRuns.flatMap((run): TimelineRunView[] => {
    const nodes = run.nodes.filter((node) => visibleEventIds.has(node.eventId));
    if (nodes.length === 0) return [];

    const traceRows = run.traceRows.filter((row) =>
      row.kind === 'node'
        ? visibleEventIds.has(row.node.eventId)
        : row.invocation.nodes.some((node) => visibleEventIds.has(node.eventId))
    );

    // Summary/final/file data stay whole. Tool rows also retain their complete
    // lifecycle so a visible completion can show the safe request that began
    // outside the mounted window.
    return [{ ...run, nodes, traceRows }];
  });
}

/**
 * Resolve transcript/message/control entities before applying the temporary
 * DOM window. Late receipts can otherwise enter the window without the
 * semantic entity they complete.
 */
export function prepareEventNativeTimelineWindow(
  sourceNodes: readonly ChatProjectionNode[],
  maxMountedNodes = MAX_MOUNTED_EVENT_NODES
): EventNativeTimelineWindow {
  const presentedNodes = presentChatSemanticEntities(sourceNodes);
  const safeLimit = Number.isFinite(maxMountedNodes)
    ? Math.max(0, Math.floor(maxMountedNodes))
    : MAX_MOUNTED_EVENT_NODES;
  const hiddenNodeCount = Math.max(0, presentedNodes.length - safeLimit);

  return {
    hiddenNodeCount,
    nodes:
      hiddenNodeCount > 0
        ? safeLimit === 0
          ? []
          : presentedNodes.slice(-safeLimit)
        : presentedNodes,
  };
}

/**
 * Placeholder rows sized to a short and a long message so the container keeps
 * its height when the real conversation replaces them.
 */
function ChatTimelineSkeleton({ label }: { label: string }) {
  return (
    <div
      aria-busy
      aria-label={label}
      className="flex w-full flex-col gap-3"
      data-chat-timeline-skeleton
      role="status"
    >
      {[
        ['w-2/5', 'h-16'],
        ['w-full', 'h-24'],
        ['w-1/3', 'h-16'],
      ].map(([width, height], index) => (
        <div
          key={`chat-skeleton-${index}`}
          className={`${height} ${index % 2 === 0 ? 'ml-auto' : ''} ${width} animate-pulse rounded-xl bg-ds-neutral-strong-default`}
        />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

interface EventNativeProjectTimelineProps {
  /** Temporary control bridge until plan editing is backed by Run commands. */
  chatStore?: VanillaChatStore;
  detailLevel?: ChatTimelineDetailLevel;
  /** The user has taken control; timers and progress animations hold. */
  paused?: boolean;
  floatingControl?: ReactNode;
  projectId: string;
  sessionMode?: SessionModeType;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
  scrollBottomInsetPx: number;
}

/**
 * Production integration boundary for the event-native read path. Raw durable
 * events and legacy AgentStep values never reach this component: it consumes
 * semantic projection nodes, composes complete Run models, and delegates to a
 * mode-owned renderer. Timeline style never changes control authority.
 */
export function EventNativeProjectTimeline({
  chatStore,
  detailLevel = 'trajectory',
  paused = false,
  floatingControl,
  projectId,
  sessionMode,
  scrollContainerRef,
  scrollBottomInsetPx,
}: EventNativeProjectTimelineProps) {
  const { t } = useTranslation();
  const runtime = useProjectEventRuntime();
  const hydration = runtime.hydration;
  const projection =
    runtime.projectId === projectId &&
    runtime.snapshot?.chat.projectId === projectId
      ? runtime.snapshot.chat
      : undefined;
  const durableNodes = useMemo(
    () =>
      projection
        ? selectRenderableChatNodes(projection).filter(
            (node) => node.projectId === projectId
          )
        : [],
    [projectId, projection]
  );
  const legacyState = chatStore?.getState();
  const legacyTaskId = legacyState?.activeTaskId;
  const legacyTask = legacyTaskId
    ? legacyState?.tasks[legacyTaskId]
    : undefined;
  const latestLegacyUserMessage = legacyTask?.messages.findLast(
    (message) => message.role === 'user'
  );
  const latestLegacyAgentMessage = legacyTask?.messages.findLast(
    (message) => message.role === 'agent' && Boolean(message.content?.trim())
  );
  const hasDurableNodeForLegacyRun = Boolean(
    legacyTaskId && durableNodes.some((node) => node.runId === legacyTaskId)
  );
  const hasDurableUserQuery = Boolean(
    legacyTaskId &&
    durableNodes.some(
      (node) =>
        node.runId === legacyTaskId &&
        node.kind === 'message' &&
        node.role === 'user'
    )
  );
  const optimisticUserQuery = useMemo<ChatMessageNode | null>(() => {
    if (
      !legacyTaskId ||
      !legacyTask ||
      !latestLegacyUserMessage ||
      hasDurableUserQuery ||
      legacyTask.type === 'replay' ||
      legacyTask.type === 'share'
    ) {
      return null;
    }
    return {
      id: `optimistic-user:${legacyTaskId}:${latestLegacyUserMessage.id}`,
      eventId: `optimistic-user:${legacyTaskId}:${latestLegacyUserMessage.id}`,
      projectId,
      runId: legacyTaskId,
      createdAt: Number.isFinite(legacyTask.createdAt)
        ? new Date(legacyTask.createdAt).toISOString()
        : null,
      runSequence: 0,
      cloudCursor: null,
      eventType: 'ui.optimistic_user_query',
      legacyStep: null,
      kind: 'message',
      role: 'user',
      content: latestLegacyUserMessage.content,
      status: 'complete',
      purpose: 'query',
      attachments: latestLegacyUserMessage.attaches?.map((file) => ({
        fileName: file.fileName,
        filePath: file.filePath,
        source: 'local',
      })),
    };
  }, [
    hasDurableUserQuery,
    latestLegacyUserMessage,
    legacyTask,
    legacyTaskId,
    projectId,
  ]);
  const optimisticLegacyTerminalResponse =
    useMemo<ChatMessageNode | null>(() => {
      if (
        !legacyTaskId ||
        !legacyTask ||
        legacyTask.status !== ChatTaskStatus.FINISHED ||
        hasDurableNodeForLegacyRun ||
        !latestLegacyAgentMessage
      ) {
        return null;
      }
      return {
        id: `optimistic-terminal:${legacyTaskId}:${latestLegacyAgentMessage.id}`,
        eventId: `optimistic-terminal:${legacyTaskId}:${latestLegacyAgentMessage.id}`,
        projectId,
        runId: legacyTaskId,
        createdAt: null,
        runSequence: 1,
        cloudCursor: null,
        eventType: 'ui.optimistic_terminal_response',
        legacyStep: null,
        kind: 'message',
        role: 'assistant',
        content: latestLegacyAgentMessage.content,
        status: 'complete',
        purpose: 'final',
      };
    }, [
      hasDurableNodeForLegacyRun,
      latestLegacyAgentMessage,
      legacyTask,
      legacyTaskId,
      projectId,
    ]);
  const optimisticLegacyTerminalStatus: ChatRunStatusNode['status'] | null =
    optimisticLegacyTerminalResponse
      ? legacyTask?.durableRunStatus === 'failed' ||
        latestLegacyAgentMessage?.content.trim().startsWith('❌')
        ? 'failed'
        : legacyTask?.durableRunStatus === 'cancelled' ||
            legacyTask?.durableRunStatus === 'stopped'
          ? 'cancelled'
          : legacyTask?.durableRunStatus === 'interrupted'
            ? 'interrupted'
            : 'completed'
      : null;
  const optimisticRunStatus = useMemo<ChatRunStatusNode | null>(() => {
    if (
      !optimisticUserQuery ||
      !legacyTaskId ||
      (legacyTask?.status === ChatTaskStatus.FINISHED &&
        !optimisticLegacyTerminalStatus) ||
      durableNodes.some(
        (node) => node.runId === legacyTaskId && node.kind === 'run_status'
      )
    ) {
      return null;
    }
    const terminalStatus = optimisticLegacyTerminalStatus;
    return {
      ...optimisticUserQuery,
      id: `optimistic-run:${legacyTaskId}`,
      eventId: `optimistic-run:${legacyTaskId}`,
      runSequence: terminalStatus ? 2 : 1,
      eventType: terminalStatus
        ? `ui.optimistic_run_${terminalStatus}`
        : 'ui.optimistic_run_pending',
      kind: 'run_status',
      status: terminalStatus || 'pending',
    };
  }, [
    durableNodes,
    legacyTask?.status,
    legacyTaskId,
    optimisticLegacyTerminalStatus,
    optimisticUserQuery,
  ]);
  const allNodes = useMemo(
    () => [
      ...durableNodes,
      ...(optimisticUserQuery ? [optimisticUserQuery] : []),
      ...(optimisticLegacyTerminalResponse
        ? [optimisticLegacyTerminalResponse]
        : []),
      ...(optimisticRunStatus ? [optimisticRunStatus] : []),
    ],
    [
      durableNodes,
      optimisticLegacyTerminalResponse,
      optimisticRunStatus,
      optimisticUserQuery,
    ]
  );
  const [timelineWindowState, setTimelineWindowState] = useState({
    projectId,
    maxNodes: MAX_MOUNTED_EVENT_NODES,
  });
  const maxMountedNodes =
    timelineWindowState.projectId === projectId
      ? timelineWindowState.maxNodes
      : MAX_MOUNTED_EVENT_NODES;
  const timelineWindow = useMemo(
    () => prepareEventNativeTimelineWindow(allNodes, maxMountedNodes),
    [allNodes, maxMountedNodes]
  );
  const { hiddenNodeCount, nodes: visibleNodes } = timelineWindow;
  const projectedRunsById =
    runtime.projectId === projectId &&
    runtime.snapshot?.view.projectId === projectId
      ? runtime.snapshot.view.runs
      : undefined;
  const allRuns = useMemo(
    () =>
      reconcileTimelineRuns(
        composeTimelineRuns(presentChatSemanticEntities(allNodes)),
        projectedRunsById
      ),
    [allNodes, projectedRunsById]
  );
  const visibleRuns = useMemo(
    () => selectWindowedTimelineRuns(allRuns, visibleNodes),
    [allRuns, visibleNodes]
  );
  const interactivePlansByRun = (() => {
    if (sessionMode !== SessionMode.WORKFORCE || !chatStore) return undefined;
    const state = chatStore.getState();
    const taskId = state.activeTaskId;
    const task = taskId ? state.tasks[taskId] : undefined;
    const latestPlanMessage = task?.messages.findLast(
      (message) => message.step === AgentStep.TO_SUB_TASKS
    );
    if (!taskId || !task || !latestPlanMessage || latestPlanMessage.isConfirm) {
      return undefined;
    }

    const run = visibleRuns.find((candidate) => candidate.runId === taskId);
    const plan = run?.plans.findLast(
      (candidate) =>
        candidate.legacyStep === AgentStep.TO_SUB_TASKS ||
        candidate.status === 'active'
    );
    if (!run || !plan) return undefined;

    return {
      [run.runId]: {
        eventId: plan.eventId,
        content: (
          <PlanTaskBox
            chatStore={chatStore}
            taskId={taskId}
            userPrompt={run.userQuery?.content}
          />
        ),
      },
    };
  })();
  const projectedArtifactsByRun =
    runtime.projectId === projectId &&
    runtime.snapshot?.view.projectId === projectId
      ? runtime.snapshot.view.artifactsByRun
      : undefined;
  const previousScrollHeightRef = useRef(0);
  const pendingOlderRevealRef = useRef<{
    projectId: string;
    scrollHeight: number;
    scrollTop: number;
  } | null>(null);
  const previousLatestUserQueryKeyRef = useRef<string | undefined>(undefined);
  const previousProjectIdRef = useRef(projectId);
  const pinToBottomRef = useRef(true);
  const ignoreAnchorScrollRef = useRef(false);
  const anchorAnimationRef = useRef<ChatTimelineScrollAnimation | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollToTurnRequest = usePageTabStore(
    (state) => state.scrollToTurnRequest
  );
  const setScrollToTurnRequest = usePageTabStore(
    (state) => state.setScrollToTurnRequest
  );
  const latestNode = visibleNodes.at(-1);
  const latestEventId = latestNode?.eventId;
  const userQueryNodes = visibleNodes.filter(
    (node) =>
      node.kind === 'message' &&
      node.role === 'user' &&
      node.purpose !== 'interaction_response' &&
      !node.interactionResponse
  );
  const latestUserQueryKey = userQueryNodes.at(-1)?.runId;
  const showOlderMessages = () => {
    const container = scrollContainerRef?.current;
    if (container) {
      pendingOlderRevealRef.current = {
        projectId,
        scrollHeight: container.scrollHeight,
        scrollTop: container.scrollTop,
      };
    }
    setTimelineWindowState((current) => ({
      projectId,
      maxNodes:
        (current.projectId === projectId
          ? current.maxNodes
          : MAX_MOUNTED_EVENT_NODES) + MAX_MOUNTED_EVENT_NODES,
    }));
  };

  useLayoutEffect(() => {
    const container = scrollContainerRef?.current;
    if (!container) return;
    const content = contentRef.current;
    if (previousProjectIdRef.current !== projectId) {
      previousProjectIdRef.current = projectId;
      previousLatestUserQueryKeyRef.current = undefined;
      pinToBottomRef.current = true;
      ignoreAnchorScrollRef.current = false;
      anchorAnimationRef.current?.stop();
      anchorAnimationRef.current = null;
      if (content) content.style.minHeight = '';
    }

    const updatePinFromScroll = () => {
      if (ignoreAnchorScrollRef.current) return;
      pinToBottomRef.current = isChatTimelineNearBottom(
        container.scrollHeight - container.scrollTop - container.clientHeight,
        scrollBottomInsetPx
      );
    };
    container.addEventListener('scroll', updatePinFromScroll, {
      passive: true,
    });

    const pendingOlderReveal = pendingOlderRevealRef.current;
    const revealedOlder = pendingOlderReveal?.projectId === projectId;
    if (pendingOlderReveal && revealedOlder) {
      pendingOlderRevealRef.current = null;
      const heightDelta =
        container.scrollHeight - pendingOlderReveal.scrollHeight;
      container.scrollTo({
        top: pendingOlderReveal.scrollTop + Math.max(0, heightDelta),
        behavior: 'auto',
      });
      pinToBottomRef.current = false;
    } else if (pendingOlderReveal) {
      pendingOlderRevealRef.current = null;
    }

    const previousHeight = previousScrollHeightRef.current;
    const wasNearBottom =
      previousHeight === 0 ||
      (pinToBottomRef.current &&
        isChatTimelineNearBottom(
          previousHeight - container.scrollTop - container.clientHeight,
          scrollBottomInsetPx
        ));
    const hadRenderedUserMessage =
      previousLatestUserQueryKeyRef.current !== undefined;
    const isNewUserMessage =
      latestUserQueryKey !== undefined &&
      latestUserQueryKey !== previousLatestUserQueryKeyRef.current;
    const shouldAnchorNewQuery =
      isNewUserMessage && hadRenderedUserMessage && userQueryNodes.length >= 2;

    // A follow-up query starts a new reading viewport: its user row aligns just
    // below the Session header and streaming output grows beneath it. The first
    // query keeps the original bottom reveal behavior.
    if (!revealedOlder && shouldAnchorNewQuery) {
      const target = Array.from(
        contentRef.current?.querySelectorAll<HTMLElement>(
          '[data-message-role="user"]'
        ) || []
      ).findLast(
        (element) =>
          element.closest<HTMLElement>('[data-run-id]')?.dataset.runId ===
          latestUserQueryKey
      );
      if (target) {
        anchorAnimationRef.current?.stop();
        ignoreAnchorScrollRef.current = true;
        pinToBottomRef.current = false;
        anchorAnimationRef.current = animateChatTimelineAnchor(
          container,
          target,
          content,
          () => {
            ignoreAnchorScrollRef.current = false;
            pinToBottomRef.current = false;
          }
        );
      }
    } else if (!revealedOlder && (isNewUserMessage || wasNearBottom)) {
      pinToBottomRef.current = true;
      container.scrollTo({ top: container.scrollHeight, behavior: 'auto' });
    }
    previousLatestUserQueryKeyRef.current = latestUserQueryKey;
    previousScrollHeightRef.current = container.scrollHeight;

    const resizeObserver =
      content &&
      new ResizeObserver(() => {
        if (!pinToBottomRef.current) return;
        container.scrollTo({ top: container.scrollHeight, behavior: 'auto' });
        previousScrollHeightRef.current = container.scrollHeight;
      });
    if (content) resizeObserver?.observe(content);

    return () => {
      container.removeEventListener('scroll', updatePinFromScroll);
      resizeObserver?.disconnect();
    };
  }, [
    latestEventId,
    latestUserQueryKey,
    latestNode?.runSequence,
    projectId,
    scrollBottomInsetPx,
    scrollContainerRef,
    userQueryNodes.length,
  ]);

  useEffect(
    () => () => {
      anchorAnimationRef.current?.stop();
    },
    []
  );

  useEffect(() => {
    if (
      !scrollToTurnRequest ||
      scrollToTurnRequest.projectId !== projectId ||
      !scrollContainerRef?.current
    ) {
      return;
    }
    const container = scrollContainerRef.current;
    const target = Array.from(
      container.querySelectorAll<HTMLElement>('[data-run-id]')
    ).find(
      (element) =>
        element.getAttribute('data-run-id') === scrollToTurnRequest.taskId
    );
    // A request is a one-shot command. Clear it even when the requested Run
    // is outside the bounded DOM window so it cannot fire unexpectedly after
    // later timeline updates mount that Run.
    setScrollToTurnRequest(null);
    if (!target) return;

    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    container.scrollTo({
      top: container.scrollTop + targetRect.top - containerRect.top,
      behavior: 'smooth',
    });
  }, [
    projectId,
    scrollContainerRef,
    scrollToTurnRequest,
    setScrollToTurnRequest,
    visibleNodes,
  ]);

  return (
    <div
      className="relative z-10 w-full"
      data-chat-timeline-source="durable-events"
    >
      <div
        ref={contentRef}
        className={cn(
          'mx-auto w-full pt-0',
          detailLevel !== 'trajectory' && 'max-w-[600px]'
        )}
        data-chat-timeline-content
        style={{ paddingBottom: scrollBottomInsetPx }}
      >
        {hiddenNodeCount > 0 ? (
          <div className="flex justify-center px-4 py-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              buttonRadius="full"
              onClick={showOlderMessages}
            >
              {t('chat.timeline-show-older')}
            </Button>
          </div>
        ) : null}
        {hydration.eventsTruncated ? (
          <span
            className="block px-4 py-2 text-center text-ds-text-base font-normal text-ds-ink-muted-default"
            role="status"
          >
            {t('chat.timeline-history-window')}
          </span>
        ) : null}
        {hydration.status === 'error' && allNodes.length > 0 ? (
          <div
            className="flex flex-col items-center gap-2 px-4 py-2"
            role="alert"
          >
            <span className="text-center text-ds-text-base font-normal text-ds-text-status-error-default-default">
              {t('chat.timeline-history-partial-error')}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              buttonRadius="full"
              onClick={hydration.retry}
            >
              {t('chat.timeline-history-retry')}
            </Button>
          </div>
        ) : null}
        {visibleRuns.length > 0 ? (
          <TimelineModeRenderer
            detailLevel={detailLevel}
            interactivePlansByRun={interactivePlansByRun}
            paused={paused}
            projectedArtifactsByRun={projectedArtifactsByRun}
            runs={visibleRuns}
            sessionMode={sessionMode}
          />
        ) : hydration.status === 'error' ? (
          <div
            className="flex flex-col items-center gap-2 px-4 py-6"
            role="alert"
          >
            <span className="text-center text-ds-text-base font-normal text-ds-text-status-error-default-default">
              {t('chat.timeline-history-error')}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              buttonRadius="full"
              onClick={hydration.retry}
            >
              {t('chat.timeline-history-retry')}
            </Button>
          </div>
        ) : hydration.status === 'ready' || hydration.status === 'idle' ? (
          <span
            className="block px-4 py-6 text-center text-ds-text-base font-normal text-ds-ink-muted-default"
            role="status"
          >
            {t('chat.timeline-empty')}
          </span>
        ) : (
          <ChatTimelineSkeleton
            label={
              hydration.status === 'retrying'
                ? t('chat.timeline-history-reconnecting')
                : t('chat.timeline-history-loading')
            }
          />
        )}
        {floatingControl}
      </div>
    </div>
  );
}

export type { EventNativeProjectTimelineProps };
