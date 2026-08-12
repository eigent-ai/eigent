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

import type { ProjectEventStoreHydrationState } from '@/hooks/useProjectEventStoreHydration';
import type {
  ChatInteractionNode,
  ChatMessageNode,
  ChatProjectionState,
  ChatUnknownNode,
} from '@/lib/projector/chat';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EventNativeProjectTimeline,
  prepareEventNativeTimelineWindow,
} from './EventNativeProjectTimeline';

const mocks = vi.hoisted(() => ({
  projection: null as ChatProjectionState | null,
  hydration: {
    status: 'ready',
    errorCode: null,
    eventsTruncated: false,
  } as ProjectEventStoreHydrationState,
}));

vi.mock('@/hooks/useProjectEventView', () => ({
  useProjectChatProjection: () => mocks.projection,
}));
vi.mock('@/hooks/useProjectEventStoreHydration', () => ({
  useProjectEventStoreHydration: () => mocks.hydration,
}));

function messageNode(index: number): ChatMessageNode {
  return {
    id: `message-${index}`,
    eventId: `event-${index}`,
    projectId: 'project-1',
    runId: 'run-1',
    createdAt: null,
    runSequence: index + 1,
    cloudCursor: null,
    eventType: 'message.completed',
    legacyStep: null,
    kind: 'message',
    role: 'assistant',
    content: `Message ${index}`,
    status: 'complete',
  };
}

function interactionNode(
  eventId: string,
  status: 'requested' | 'responded',
  sequence: number
): ChatInteractionNode {
  return {
    id: eventId,
    eventId,
    projectId: 'project-1',
    runId: 'run-1',
    createdAt: null,
    runSequence: sequence,
    cloudCursor: null,
    eventType:
      status === 'requested' ? 'interaction.requested' : 'interaction.resolved',
    legacyStep: null,
    kind: 'interaction',
    interactionId: 'format-choice',
    interactionType: 'choice',
    status,
  };
}

function projection(nodes: ChatProjectionState['nodes']): ChatProjectionState {
  return {
    projectId: 'project-1',
    nodes,
    nodeById: Object.fromEntries(nodes.map((node) => [node.id, node])),
    seenEventIds: Object.fromEntries(
      nodes.map((node) => [node.eventId, true as const])
    ),
  };
}

describe('EventNativeProjectTimeline', () => {
  beforeEach(() => {
    mocks.projection = projection([]);
    mocks.hydration = {
      status: 'ready',
      errorCode: null,
      eventsTruncated: false,
    };
  });

  it('renders semantic event nodes through the event timeline', () => {
    const unknown: ChatUnknownNode = {
      ...messageNode(2),
      kind: 'unknown',
      summary: 'Unsupported event',
    };
    mocks.projection = projection([messageNode(1), unknown]);

    const { container } = render(
      <EventNativeProjectTimeline
        projectId="project-1"
        scrollBottomInsetPx={128}
      />
    );

    expect(container.firstElementChild).toHaveAttribute(
      'data-chat-timeline-source',
      'durable-events'
    );
    expect(screen.getByText('Message 1')).toBeInTheDocument();
    expect(
      screen.getByText('This event is not available in this version.')
    ).toBeInTheDocument();
  });

  it('shows a durable request and resolution as one interaction receipt', () => {
    const request = {
      ...interactionNode('format-requested', 'requested', 1),
      prompt: 'Choose a format',
      options: [{ id: 'pdf', label: 'PDF document' }],
    };
    const resolution = {
      ...interactionNode('format-resolved', 'responded', 2),
      responseOptionIds: ['pdf'],
    };
    mocks.projection = projection([request, resolution]);

    render(
      <EventNativeProjectTimeline
        projectId="project-1"
        scrollBottomInsetPx={128}
      />
    );

    const card = screen.getByLabelText('Agent input');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(card).toHaveTextContent('Input required');
    expect(card).toHaveTextContent('Choose a format');
    expect(card).toHaveTextContent('PDF document');
    expect(card).toHaveAttribute(
      'data-interaction-request-event-id',
      'format-requested'
    );
    expect(card).toHaveAttribute(
      'data-interaction-resolution-event-id',
      'format-resolved'
    );
    expect(mocks.projection.nodes).toEqual([request, resolution]);
  });

  it('mounts a bounded latest window until timeline virtualization lands', () => {
    mocks.projection = projection(
      Array.from({ length: 251 }, (_, index) => messageNode(index))
    );

    render(
      <EventNativeProjectTimeline
        projectId="project-1"
        scrollBottomInsetPx={128}
      />
    );

    expect(
      screen.getByText('1 earlier events are not mounted in this preview.')
    ).toBeInTheDocument();
    expect(screen.queryByText('Message 0')).not.toBeInTheDocument();
    expect(screen.getByText('Message 250')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(250);
  });

  it('correlates an interaction before slicing the bounded DOM window', () => {
    const request = {
      ...interactionNode('window-format-requested', 'requested', 1),
      prompt: 'Choose a window format',
      options: [{ id: 'pdf', label: 'PDF document' }],
    };
    const interveningMessages = Array.from({ length: 249 }, (_, index) =>
      messageNode(index + 1)
    );
    const resolution = {
      ...interactionNode('window-format-resolved', 'responded', 251),
      responseOptionIds: ['pdf'],
    };
    const sourceNodes = [request, ...interveningMessages, resolution] as const;
    mocks.projection = projection([...sourceNodes]);

    const preparedWindow = prepareEventNativeTimelineWindow(sourceNodes);

    expect(preparedWindow.nodes).toHaveLength(250);
    expect(preparedWindow.hiddenNodeCount).toBe(0);
    expect(preparedWindow.nodes[0]).toMatchObject({
      eventId: 'window-format-requested',
      requestEventId: 'window-format-requested',
      resolutionEventId: 'window-format-resolved',
      status: 'responded',
    });
    expect(sourceNodes[0]).toBe(request);
    expect(request).toMatchObject({
      eventId: 'window-format-requested',
      status: 'requested',
    });

    render(
      <EventNativeProjectTimeline
        projectId="project-1"
        scrollBottomInsetPx={128}
      />
    );

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(250);
    expect(items[0]).toHaveAttribute(
      'data-event-node-id',
      'window-format-requested'
    );
    expect(items[0]).toHaveAttribute(
      'data-interaction-resolution-event-id',
      'window-format-resolved'
    );
    expect(screen.getByLabelText('Agent input')).toHaveTextContent(
      'PDF document'
    );
    expect(
      screen.queryByText(/earlier events are not mounted/)
    ).not.toBeInTheDocument();
  });

  it('surfaces a fail-closed hydration error instead of waiting forever', () => {
    mocks.hydration = {
      status: 'error',
      errorCode: 'limit_exceeded',
      eventsTruncated: false,
    };

    render(
      <EventNativeProjectTimeline
        projectId="project-1"
        scrollBottomInsetPx={128}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Durable history is unavailable.'
    );
  });

  it('discloses when the existing Run-list API produced a partial window', () => {
    mocks.hydration = {
      status: 'ready',
      errorCode: null,
      eventsTruncated: true,
    };

    render(
      <EventNativeProjectTimeline
        projectId="project-1"
        scrollBottomInsetPx={128}
      />
    );

    expect(
      screen.getByText(/earlier history is outside this local window/)
    ).toBeInTheDocument();
  });
});
