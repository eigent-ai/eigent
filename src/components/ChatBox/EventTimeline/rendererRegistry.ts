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
import type { ComponentType } from 'react';

import {
  ActivityEventRenderer,
  ArtifactEventRenderer,
  InteractionEventRenderer,
  MessageEventRenderer,
  NoticeEventRenderer,
  PlanEventRenderer,
  RunStatusEventRenderer,
  UnknownEventRenderer,
} from './DefaultEventRenderers';
import type { ChatTimelineDetailLevel } from './presentationPolicy';

type ChatProjectionNodeKind = ChatProjectionNode['kind'];
type ChatProjectionNodeOfKind<K extends ChatProjectionNodeKind> = Extract<
  ChatProjectionNode,
  { kind: K }
>;

interface EventRendererProps<
  N extends ChatProjectionNode = ChatProjectionNode,
> {
  detailLevel: ChatTimelineDetailLevel;
  node: N;
}

type EventRendererComponent<N extends ChatProjectionNode = ChatProjectionNode> =
  ComponentType<EventRendererProps<N>>;

type EventRendererRegistry = Readonly<{
  [K in ChatProjectionNodeKind]?: EventRendererComponent<
    ChatProjectionNodeOfKind<K>
  >;
}>;

/** Exact durable event-type overrides still receive semantic nodes only. */
type EventTypeRendererRegistry = Readonly<
  Record<string, EventRendererComponent<ChatProjectionNode>>
>;

const defaultEventRendererRegistry = Object.freeze({
  message: MessageEventRenderer,
  notice: NoticeEventRenderer,
  interaction: InteractionEventRenderer,
  plan: PlanEventRenderer,
  activity: ActivityEventRenderer,
  artifact: ArtifactEventRenderer,
  run_status: RunStatusEventRenderer,
  unknown: UnknownEventRenderer,
} satisfies EventRendererRegistry);

const defaultEventTypeRendererRegistry = Object.freeze(
  Object.create(null) as Record<
    string,
    EventRendererComponent<ChatProjectionNode>
  >
) satisfies EventTypeRendererRegistry;

/** Creates an immutable registry while allowing product-owned renderer overrides. */
function createEventRendererRegistry(
  overrides: EventRendererRegistry = {}
): EventRendererRegistry {
  return Object.freeze({
    ...defaultEventRendererRegistry,
    ...overrides,
  });
}

/** Creates an immutable exact-event-type renderer registry. */
function createEventTypeRendererRegistry(
  overrides: EventTypeRendererRegistry = {}
): EventTypeRendererRegistry {
  return Object.freeze({ ...overrides });
}

type ResolvedEventRenderer = ComponentType<
  EventRendererProps<ChatProjectionNode>
>;

function resolveEventRenderer(
  registry: EventRendererRegistry,
  node: ChatProjectionNode,
  eventTypeRegistry: EventTypeRendererRegistry = defaultEventTypeRendererRegistry
): ResolvedEventRenderer | undefined {
  if (Object.prototype.hasOwnProperty.call(eventTypeRegistry, node.eventType)) {
    return eventTypeRegistry[node.eventType];
  }

  // The discriminant guarantees that a renderer registered for K receives the
  // matching Extract<ChatProjectionNode, { kind: K }> at runtime.
  return registry[node.kind] as ResolvedEventRenderer | undefined;
}

export {
  createEventRendererRegistry,
  createEventTypeRendererRegistry,
  defaultEventRendererRegistry,
  defaultEventTypeRendererRegistry,
  resolveEventRenderer,
};
export type {
  ChatProjectionNodeKind,
  ChatProjectionNodeOfKind,
  EventRendererComponent,
  EventRendererProps,
  EventRendererRegistry,
  EventTypeRendererRegistry,
};
