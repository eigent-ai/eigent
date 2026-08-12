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

import type { ChatProjectionNode } from '@/lib/projector/chat';
import { cn } from '@/lib/utils';
import { Fragment, type ReactNode } from 'react';

import { EventRenderer } from './EventRenderer';
import type { EventRendererErrorHandler } from './EventRendererBoundary';
import {
  defaultChatTimelinePresentationPolicyRegistry,
  resolveChatTimelinePresentation,
  type ChatTimelineDetailLevel,
  type ChatTimelinePresentationPolicyRegistry,
} from './presentationPolicy';
import type {
  EventRendererRegistry,
  EventTypeRendererRegistry,
} from './rendererRegistry';

interface EventTimelineProps {
  ariaLabel?: string;
  className?: string;
  detailLevel?: ChatTimelineDetailLevel;
  emptyState?: ReactNode;
  eventTypeRegistry?: EventTypeRendererRegistry;
  nodes: readonly ChatProjectionNode[];
  onRendererError?: EventRendererErrorHandler;
  presentationPolicies?: ChatTimelinePresentationPolicyRegistry;
  registry?: EventRendererRegistry;
  renderAfterNode?: (node: ChatProjectionNode) => ReactNode;
  renderAfterRun?: (runId: string) => ReactNode;
}

/**
 * Presentation-only chat timeline. It consumes semantic projection nodes and
 * intentionally knows nothing about raw durable events, AgentStep, or stores.
 * Callers must pass an already bounded/windowed node slice; full-history
 * virtualization is required before this replaces the production ChatBox.
 */
export function EventTimeline({
  ariaLabel = 'Chat event timeline',
  className,
  detailLevel = 'detailed',
  emptyState = null,
  eventTypeRegistry,
  nodes,
  onRendererError,
  presentationPolicies = defaultChatTimelinePresentationPolicyRegistry,
  registry,
  renderAfterNode,
  renderAfterRun,
}: EventTimelineProps) {
  const presentation = resolveChatTimelinePresentation(
    presentationPolicies,
    detailLevel,
    nodes
  );

  if (presentation.nodes.length === 0) return <>{emptyState}</>;

  const lastPresentedNodeIdByRun = new Map<string, string>();
  for (const node of presentation.nodes) {
    lastPresentedNodeIdByRun.set(node.runId, node.id);
  }

  return (
    <ol
      aria-label={ariaLabel}
      className={cn('m-0 flex w-full list-none flex-col gap-3 p-0', className)}
      data-effective-detail-level={presentation.effectiveDetailLevel}
      data-requested-detail-level={presentation.requestedDetailLevel}
    >
      {presentation.nodes.map((node) => {
        const afterNode =
          renderAfterNode?.(node) ??
          (lastPresentedNodeIdByRun.get(node.runId) === node.id
            ? renderAfterRun?.(node.runId)
            : null);
        return (
          <Fragment key={node.id}>
            <li
              className="min-w-0"
              data-event-node-id={node.id}
              data-event-node-kind={node.kind}
              data-interaction-id={
                node.kind === 'interaction' ? node.interactionId : undefined
              }
              data-interaction-request-event-id={
                node.kind === 'interaction'
                  ? node.requestEventId ||
                    (node.status === 'requested' ? node.eventId : undefined)
                  : undefined
              }
              data-interaction-resolution-event-id={
                node.kind === 'interaction' ? node.resolutionEventId : undefined
              }
              data-interaction-status={
                node.kind === 'interaction' ? node.status : undefined
              }
              data-run-id={node.runId}
            >
              <EventRenderer
                detailLevel={presentation.effectiveDetailLevel}
                eventTypeRegistry={eventTypeRegistry}
                node={node}
                onRendererError={onRendererError}
                registry={registry}
              />
            </li>
            {afterNode ? (
              <li
                className="min-w-0"
                data-after-event-node-id={node.id}
                data-run-id={node.runId}
              >
                {afterNode}
              </li>
            ) : null}
          </Fragment>
        );
      })}
    </ol>
  );
}

export type { EventTimelineProps };
