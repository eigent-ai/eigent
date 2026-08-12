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
import { useProjectEventView } from '@/hooks/useProjectEventView';
import type { ProjectedRun } from '@/lib/projector';
import {
  selectRenderableChatNodes,
  type ChatProjectionNode,
} from '@/lib/projector/chat';
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type RefObject,
} from 'react';

import { EventTimeline, type ChatTimelineDetailLevel } from './EventTimeline';
import { presentHumanInteractionReceipts } from './EventTimeline/presentationPolicy';
import { AgentStepUnavailableFallback } from './MessageItem/AgentStepUnavailableFallback';

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
  activeRunId?: string | null;
  detailLevel?: ChatTimelineDetailLevel;
  projectId: string;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
  scrollBottomInsetPx: number;
}

const LIVE_RUN_STATUSES = new Set<ProjectedRun['status']>([
  'pending',
  'running',
  'waiting_for_user',
  'cancelling',
]);

function nodeContainsAvailableAgentStep(node: ChatProjectionNode): boolean {
  return (
    node.kind === 'activity' ||
    node.kind === 'plan' ||
    node.kind === 'artifact' ||
    node.kind === 'notice' ||
    (node.kind === 'message' && node.role === 'assistant')
  );
}

/** Runs that need a static receipt because their AgentStep cannot be proven. */
export function selectUnavailableAgentStepRuns(
  runs: readonly ProjectedRun[],
  nodes: readonly ChatProjectionNode[],
  activeRunId?: string | null
): ProjectedRun[] {
  const nodesByRun = new Map<string, ChatProjectionNode[]>();
  for (const node of nodes) {
    nodesByRun.set(node.runId, [...(nodesByRun.get(node.runId) || []), node]);
  }

  return runs
    .filter((run) => {
      const runNodes = nodesByRun.get(run.runId) || [];
      const incompleteCoverage =
        run.eventsTruncated === true || run.lastSequence < run.runVersion;
      if (incompleteCoverage) return true;

      const freshEventlessLocalRun =
        run.origin === 'local' &&
        !run.resumeBlockedReason &&
        LIVE_RUN_STATUSES.has(run.status) &&
        run.runVersion === 0 &&
        run.lastSequence === 0 &&
        runNodes.length === 0;
      if (freshEventlessLocalRun || run.runId === activeRunId) return false;

      // The first canonical start/status fact can arrive before ChatStore owns
      // an event-native-only Run. Complete live local coverage with no elapsed
      // historical work is preparation, not a lost AgentStep.
      const freshLiveLocalRun =
        run.origin === 'local' &&
        !run.resumeBlockedReason &&
        LIVE_RUN_STATUSES.has(run.status) &&
        run.runVersion === 1 &&
        run.lastSequence === 1 &&
        runNodes.length > 0 &&
        runNodes.every((node) => node.kind === 'run_status');
      if (freshLiveLocalRun) return false;

      const isHistoricalShell =
        !LIVE_RUN_STATUSES.has(run.status) ||
        run.origin !== 'local' ||
        Boolean(run.resumeBlockedReason) ||
        (run.elapsedMs ?? 0) > 0 ||
        runNodes.length > 0;
      return (
        isHistoricalShell && !runNodes.some(nodeContainsAvailableAgentStep)
      );
    })
    .sort(
      (left, right) =>
        (Date.parse(left.updatedAt) || 0) -
          (Date.parse(right.updatedAt) || 0) ||
        left.runId.localeCompare(right.runId)
    );
}

/**
 * Production integration boundary for the event-native read path. Raw durable
 * events and legacy AgentStep values never reach this component: it consumes
 * semantic projection nodes and delegates component selection to the renderer
 * registry owned by EventTimeline.
 */
export function EventNativeProjectTimeline({
  activeRunId,
  detailLevel = 'detailed',
  projectId,
  scrollContainerRef,
  scrollBottomInsetPx,
}: EventNativeProjectTimelineProps) {
  const hydration = useProjectEventStoreHydration({
    projectId,
    enabled: true,
  });
  const projectSnapshot = useProjectEventView(projectId);
  const projection = projectSnapshot.chat;
  const allNodes = useMemo(
    () => selectRenderableChatNodes(projection),
    [projection]
  );
  const timelineWindow = useMemo(
    () => prepareEventNativeTimelineWindow(allNodes),
    [allNodes]
  );
  const { hiddenNodeCount, nodes: visibleNodes } = timelineWindow;
  const runEvidence = useMemo(
    () => Object.values(projectSnapshot.view.runs),
    [projectSnapshot.view.runs]
  );
  const unavailableRuns = useMemo(
    () =>
      hydration.status === 'ready'
        ? selectUnavailableAgentStepRuns(runEvidence, allNodes, activeRunId)
        : [],
    [activeRunId, allNodes, hydration.status, runEvidence]
  );
  const unavailableRunById = useMemo(
    () => new Map(unavailableRuns.map((run) => [run.runId, run])),
    [unavailableRuns]
  );
  const allNodeRunIds = useMemo(
    () => new Set(allNodes.map((node) => node.runId)),
    [allNodes]
  );
  const visibleNodeRunIds = useMemo(
    () => new Set(visibleNodes.map((node) => node.runId)),
    [visibleNodes]
  );
  const hiddenBoundaryUnavailableRuns = unavailableRuns.filter(
    (run) => allNodeRunIds.has(run.runId) && !visibleNodeRunIds.has(run.runId)
  );
  const unanchoredUnavailableRuns = unavailableRuns.filter(
    (run) => !allNodeRunIds.has(run.runId)
  );
  const renderUnavailableAfterRun = useCallback(
    (runId: string) => {
      const run = unavailableRunById.get(runId);
      return run ? (
        <AgentStepUnavailableFallback elapsedMs={run.elapsedMs ?? 0} />
      ) : null;
    },
    [unavailableRunById]
  );
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
        {hiddenBoundaryUnavailableRuns.length > 0 ? (
          <ol
            aria-label="Unavailable agent steps in earlier history"
            className="m-0 flex w-full list-none flex-col gap-3 p-0 px-4"
          >
            {hiddenBoundaryUnavailableRuns.map((run) => (
              <li data-run-id={run.runId} key={run.runId}>
                <AgentStepUnavailableFallback elapsedMs={run.elapsedMs ?? 0} />
              </li>
            ))}
          </ol>
        ) : null}
        {hydration.eventsTruncated && unavailableRuns.length === 0 ? (
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
            unavailableRuns.length === 0 ? (
              <p
                className="px-4 py-6 text-center text-body-sm text-ds-text-neutral-muted-default"
                role={hydration.status === 'error' ? 'alert' : 'status'}
              >
                {hydration.status === 'error'
                  ? 'Durable history is unavailable.'
                  : hydration.status === 'retrying'
                    ? 'Reconnecting durable history…'
                    : hydration.status === 'ready'
                      ? 'No activity yet.'
                      : 'Loading durable history…'}
              </p>
            ) : null
          }
          nodes={visibleNodes}
          renderAfterRun={renderUnavailableAfterRun}
        />
        {unanchoredUnavailableRuns.length > 0 ? (
          <ol
            aria-label="Unavailable agent steps"
            className="m-0 flex w-full list-none flex-col gap-3 p-0 px-4"
          >
            {unanchoredUnavailableRuns.map((run) => (
              <li data-run-id={run.runId} key={run.runId}>
                <AgentStepUnavailableFallback elapsedMs={run.elapsedMs ?? 0} />
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );
}

export type { EventNativeProjectTimelineProps };
