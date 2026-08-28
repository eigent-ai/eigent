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
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { groupRepeatedToolCalls } from './activityGrouping';
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
import { RepeatedToolCallGroup } from './RepeatedToolCallGroup';

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
}

/**
 * Presentation-only chat timeline. It consumes semantic projection nodes and
 * intentionally knows nothing about raw durable events, AgentStep, or stores.
 * Callers must pass an already bounded/windowed node slice; full-history
 * virtualization is required before this replaces the production ChatBox.
 */
export function EventTimeline({
  ariaLabel,
  className,
  detailLevel = 'trajectory',
  emptyState = null,
  eventTypeRegistry,
  nodes,
  onRendererError,
  presentationPolicies = defaultChatTimelinePresentationPolicyRegistry,
  registry,
}: EventTimelineProps) {
  const { t } = useTranslation();
  const resolvedAriaLabel =
    ariaLabel ??
    t('chat.event-timeline-label', { defaultValue: 'Chat event timeline' });
  const presentation = resolveChatTimelinePresentation(
    presentationPolicies,
    detailLevel,
    nodes
  );
  const displayRows = groupRepeatedToolCalls(presentation.nodes);

  if (displayRows.length === 0) return <>{emptyState}</>;

  return (
    <ol
      aria-label={resolvedAriaLabel}
      className={cn('m-0 flex w-full list-none flex-col gap-3 p-0', className)}
      data-effective-detail-level={presentation.effectiveDetailLevel}
      data-requested-detail-level={presentation.requestedDetailLevel}
    >
      {displayRows.map((row) => {
        if (row.rowKind === 'repeated-tool-calls') {
          return (
            <li
              className="min-w-0"
              data-event-node-id={row.id}
              data-event-node-kind="activity"
              data-run-id={row.runId}
              data-tool-call-count={row.calls.length}
              key={row.id}
            >
              <RepeatedToolCallGroup group={row} />
            </li>
          );
        }

        const node = row.node;
        return (
          <li
            className="min-w-0"
            data-event-node-id={node.id}
            data-event-node-kind={node.kind}
            data-message-role={node.kind === 'message' ? node.role : undefined}
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
            key={row.id}
          >
            <EventRenderer
              detailLevel={presentation.effectiveDetailLevel}
              eventTypeRegistry={eventTypeRegistry}
              node={node}
              onRendererError={onRendererError}
              registry={registry}
            />
          </li>
        );
      })}
    </ol>
  );
}

export type { EventTimelineProps };
