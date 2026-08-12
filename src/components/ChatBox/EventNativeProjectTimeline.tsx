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

import { useProjectEventStoreHydration } from '@/hooks/useProjectEventStoreHydration';
import { useProjectChatProjection } from '@/hooks/useProjectEventView';
import {
  selectRenderableChatNodes,
  type ChatProjectionNode,
} from '@/lib/projector/chat';
import { useLayoutEffect, useMemo, useRef, type RefObject } from 'react';

import { EventTimeline, type ChatTimelineDetailLevel } from './EventTimeline';
import { presentHumanInteractionReceipts } from './EventTimeline/presentationPolicy';

/** Temporary DOM window until the event timeline has variable-height virtualization. */
const MAX_MOUNTED_EVENT_NODES = 250;

interface EventNativeTimelineWindow {
  hiddenNodeCount: number;
  nodes: readonly ChatProjectionNode[];
}

/**
 * Resolve correlated interaction receipts before applying the temporary DOM
 * window. A late resolution can otherwise enter the window without its
 * request, rendering an orphan row instead of one receipt anchored where the
 * agent originally asked for input.
 */
export function prepareEventNativeTimelineWindow(
  sourceNodes: readonly ChatProjectionNode[],
  maxMountedNodes = MAX_MOUNTED_EVENT_NODES
): EventNativeTimelineWindow {
  const presentedNodes = presentHumanInteractionReceipts(sourceNodes);
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
  const hydration = useProjectEventStoreHydration({
    projectId,
    enabled: true,
  });
  const projection = useProjectChatProjection(projectId);
  const allNodes = useMemo(
    () => selectRenderableChatNodes(projection),
    [projection]
  );
  const timelineWindow = useMemo(
    () => prepareEventNativeTimelineWindow(allNodes),
    [allNodes]
  );
  const { hiddenNodeCount, nodes: visibleNodes } = timelineWindow;
  const previousScrollHeightRef = useRef(0);
  const latestNode = visibleNodes.at(-1);

  useLayoutEffect(() => {
    const container = scrollContainerRef?.current;
    if (!container) return;
    const previousHeight = previousScrollHeightRef.current;
    const wasNearBottom =
      previousHeight === 0 ||
      previousHeight - container.scrollTop - container.clientHeight <= 120;
    if (wasNearBottom) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'auto' });
    }
    previousScrollHeightRef.current = container.scrollHeight;
  }, [
    latestNode?.eventId,
    latestNode?.runSequence,
    scrollBottomInsetPx,
    scrollContainerRef,
  ]);

  return (
    <div
      className="relative z-10 w-full"
      data-chat-timeline-source="durable-events"
    >
      <div
        className="mx-auto w-full max-w-[600px] pt-0"
        style={{ paddingBottom: scrollBottomInsetPx }}
      >
        {hiddenNodeCount > 0 ? (
          <p
            className="px-4 py-2 text-center text-label-sm text-ds-text-neutral-muted-default"
            role="status"
          >
            {hiddenNodeCount} earlier events are not mounted in this preview.
          </p>
        ) : null}
        {hydration.eventsTruncated ? (
          <p
            className="px-4 py-2 text-center text-label-sm text-ds-text-neutral-muted-default"
            role="status"
          >
            Showing the latest durable Runs; earlier history is outside this
            local window.
          </p>
        ) : null}
        {hydration.status === 'error' && allNodes.length > 0 ? (
          <p
            className="px-4 py-2 text-center text-body-sm text-ds-text-status-error-default-default"
            role="alert"
          >
            Durable history could not be loaded safely.
          </p>
        ) : null}
        <EventTimeline
          detailLevel={detailLevel}
          emptyState={
            <p
              className="px-4 py-6 text-center text-body-sm text-ds-text-neutral-muted-default"
              role={hydration.status === 'error' ? 'alert' : 'status'}
            >
              {hydration.status === 'error'
                ? 'Durable history is unavailable.'
                : hydration.status === 'retrying'
                  ? 'Reconnecting durable history…'
                  : 'Loading durable history…'}
            </p>
          }
          nodes={visibleNodes}
        />
      </div>
    </div>
  );
}

export type { EventNativeProjectTimelineProps };
