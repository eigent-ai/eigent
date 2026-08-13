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
  type ChatProjectionNode,
} from '@/lib/projector/chat';
import { usePageTabStore } from '@/store/pageTabStore';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';

import {
  animateChatTimelineAnchor,
  type ChatTimelineScrollAnimation,
} from './chatTimelineScroll';
import { EventTimeline, type ChatTimelineDetailLevel } from './EventTimeline';
import { presentChatSemanticEntities } from './EventTimeline/presentationPolicy';

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
          className={`${height} ${index % 2 === 0 ? 'ml-auto' : ''} ${width} animate-pulse rounded-xl bg-ds-bg-neutral-strong-default`}
        />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

interface EventNativeProjectTimelineProps {
  detailLevel?: ChatTimelineDetailLevel;
  projectId: string;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
  scrollBottomInsetPx: number;
}

/**
 * Production integration boundary for the event-native read path. Raw durable
 * events and legacy AgentStep values never reach this component: it consumes
 * semantic projection nodes and delegates component selection to the renderer
 * registry owned by EventTimeline.
 */
export function EventNativeProjectTimeline({
  detailLevel = 'detailed',
  projectId,
  scrollContainerRef,
  scrollBottomInsetPx,
}: EventNativeProjectTimelineProps) {
  const { t } = useTranslation();
  const runtime = useProjectEventRuntime();
  const hydration = runtime.hydration;
  const projection =
    runtime.projectId === projectId ? runtime.snapshot?.chat : undefined;
  const allNodes = useMemo(
    () => (projection ? selectRenderableChatNodes(projection) : []),
    [projection]
  );
  const timelineWindow = useMemo(
    () => prepareEventNativeTimelineWindow(allNodes),
    [allNodes]
  );
  const { hiddenNodeCount, nodes: visibleNodes } = timelineWindow;
  const previousScrollHeightRef = useRef(0);
  const previousLatestUserEventIdRef = useRef<string | undefined>(undefined);
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
  const userMessageNodes = visibleNodes.filter(
    (node) => node.kind === 'message' && node.role === 'user'
  );
  const latestUserEventId = userMessageNodes.at(-1)?.eventId;

  useLayoutEffect(() => {
    const container = scrollContainerRef?.current;
    if (!container) return;
    const content = contentRef.current;
    if (previousProjectIdRef.current !== projectId) {
      previousProjectIdRef.current = projectId;
      previousLatestUserEventIdRef.current = undefined;
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

    const previousHeight = previousScrollHeightRef.current;
    const wasNearBottom =
      previousHeight === 0 ||
      (pinToBottomRef.current &&
        isChatTimelineNearBottom(
          previousHeight - container.scrollTop - container.clientHeight,
          scrollBottomInsetPx
        ));
    const hadRenderedUserMessage =
      previousLatestUserEventIdRef.current !== undefined;
    const isNewUserMessage =
      latestUserEventId !== undefined &&
      latestUserEventId !== previousLatestUserEventIdRef.current;
    const shouldAnchorNewQuery =
      isNewUserMessage &&
      hadRenderedUserMessage &&
      userMessageNodes.length >= 2;

    // A follow-up query starts a new reading viewport: its user row aligns just
    // below the Session header and streaming output grows beneath it. The first
    // query keeps the original bottom reveal behavior.
    if (shouldAnchorNewQuery) {
      const target = Array.from(
        contentRef.current?.querySelectorAll<HTMLElement>(
          '[data-message-role="user"]'
        ) || []
      ).at(-1);
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
    } else if (isNewUserMessage || wasNearBottom) {
      pinToBottomRef.current = true;
      container.scrollTo({ top: container.scrollHeight, behavior: 'auto' });
    }
    previousLatestUserEventIdRef.current = latestUserEventId;
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
    latestUserEventId,
    latestNode?.runSequence,
    projectId,
    scrollBottomInsetPx,
    scrollContainerRef,
    userMessageNodes.length,
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
    if (!target) return;

    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    container.scrollTo({
      top: container.scrollTop + targetRect.top - containerRect.top,
      behavior: 'smooth',
    });
    setScrollToTurnRequest(null);
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
        className="mx-auto w-full max-w-[600px] pt-0"
        style={{ paddingBottom: scrollBottomInsetPx }}
      >
        {hiddenNodeCount > 0 ? (
          <span
            className="block px-4 py-2 text-center text-label-sm font-normal text-ds-text-neutral-muted-default"
            role="status"
          >
            {t('chat.timeline-older-hidden')}
          </span>
        ) : null}
        {hydration.eventsTruncated ? (
          <span
            className="block px-4 py-2 text-center text-label-sm font-normal text-ds-text-neutral-muted-default"
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
            <span className="text-center text-body-sm font-normal text-ds-text-status-error-default-default">
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
        <EventTimeline
          ariaLabel={t('chat.timeline-label')}
          detailLevel={detailLevel}
          emptyState={
            hydration.status === 'error' ? (
              <div
                className="flex flex-col items-center gap-2 px-4 py-6"
                role="alert"
              >
                <span className="text-center text-body-sm font-normal text-ds-text-status-error-default-default">
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
                className="block px-4 py-6 text-center text-body-sm font-normal text-ds-text-neutral-muted-default"
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
            )
          }
          nodes={visibleNodes}
        />
      </div>
    </div>
  );
}

export type { EventNativeProjectTimelineProps };
