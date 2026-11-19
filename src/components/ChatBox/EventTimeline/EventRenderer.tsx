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

import {
  EventRendererBoundary,
  type EventRendererErrorHandler,
} from './EventRendererBoundary';
import type { ChatTimelineDetailLevel } from './presentationPolicy';
import {
  defaultEventRendererRegistry,
  defaultEventTypeRendererRegistry,
  resolveEventRenderer,
  type EventRendererRegistry,
  type EventTypeRendererRegistry,
} from './rendererRegistry';
import { UnknownEventFallback } from './UnknownEventFallback';

interface EventRendererProps {
  detailLevel?: ChatTimelineDetailLevel;
  eventTypeRegistry?: EventTypeRendererRegistry;
  node: ChatProjectionNode;
  onRendererError?: EventRendererErrorHandler;
  registry?: EventRendererRegistry;
}

export function EventRenderer({
  detailLevel = 'trajectory',
  eventTypeRegistry = defaultEventTypeRendererRegistry,
  node,
  onRendererError,
  registry = defaultEventRendererRegistry,
}: EventRendererProps) {
  const Renderer = resolveEventRenderer(registry, node, eventTypeRegistry);
  if (!Renderer) {
    return <UnknownEventFallback node={node} reason="missing-renderer" />;
  }

  const resetKey = `${node.id}:${node.kind}:${node.eventId}:${node.runSequence}:${node.eventType}:${detailLevel}`;

  return (
    <EventRendererBoundary
      details={{ nodeId: node.id, nodeKind: node.kind }}
      fallback={<UnknownEventFallback node={node} reason="renderer-error" />}
      onError={onRendererError}
      resetKey={resetKey}
    >
      <Renderer detailLevel={detailLevel} node={node} />
    </EventRendererBoundary>
  );
}

export type { EventRendererProps };
