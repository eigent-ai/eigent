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
  ChatActivityNode,
  ChatInteractionNode,
  ChatMessageNode,
  ChatProjectionState,
  ChatUnknownNode,
} from '@/lib/projector/chat';
import type { ProjectedRun } from '@/lib/projector/types';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EventNativeProjectTimeline,
  isChatTimelineNearBottom,
  prepareEventNativeTimelineWindow,
} from '@/components/ChatBox/EventNativeProjectTimeline';
import { usePageTabStore } from '@/store/pageTabStore';

const mocks = vi.hoisted(() => ({
  projection: null as ChatProjectionState | null,
  projectedRuns: undefined as Record<string, ProjectedRun> | undefined,
  retry: vi.fn(),
  hydration: {
    status: 'ready',
    errorCode: null,
    eventsTruncated: false,
    retry: () => mocks.retry(),
  } as ProjectEventStoreHydrationState,
}));

vi.mock('@/hooks/useProjectEventRuntime', () => ({
  useProjectEventRuntime: () => ({
    projectId: 'project-1',
    hydration: mocks.hydration,
    snapshot: mocks.projection
      ? {
          chat: mocks.projection,
          view: mocks.projectedRuns
            ? { runs: mocks.projectedRuns, artifactsByRun: {} }
            : undefined,
        }
      : null,
  }),
}));
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return {
    ...actual,
    animate: vi.fn(
      (
        _from: number,
        to: number,
        options: { onComplete?: () => void; onUpdate?: (value: number) => void }
      ) => {
        options.onUpdate?.(to);
        options.onComplete?.();
        return { stop: vi.fn() };
      }
    ),
  };
});

function messageNode(
  index: number,
  role: ChatMessageNode['role'] = 'assistant'
): ChatMessageNode {
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
    role,
    content: `Message ${index}`,
    status: 'complete',
  };
}

function createScrollContainer(options?: {
  clientHeight?: number;
  scrollHeight?: number;
  scrollTop?: number;
}) {
  const el = document.createElement('div');
  let scrollTop = options?.scrollTop ?? 0;
  const clientHeight = options?.clientHeight ?? 400;
  const scrollHeight = options?.scrollHeight ?? 2000;
  Object.defineProperties(el, {
    clientHeight: { get: () => clientHeight },
    scrollHeight: { get: () => scrollHeight },
    scrollTop: {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    },
  });
  el.scrollTo = vi.fn((arg?: ScrollToOptions | number, y?: number) => {
    if (typeof arg === 'number') {
      scrollTop = y ?? arg;
      return;
    }
    if (arg && typeof arg.top === 'number') {
      scrollTop = arg.top;
    }
  });
  return el;
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

function toolNode(
  eventId: string,
  sequence: number,
  status: ChatActivityNode['status'],
  fields: Pick<ChatActivityNode, 'input' | 'output' | 'phase'>
): ChatActivityNode {
  return {
    id: eventId,
    eventId,
    projectId: 'project-1',
    runId: 'run-1',
    createdAt: null,
    runSequence: sequence,
    cloudCursor: null,
    eventType: `tool.${fields.phase}`,
    legacyStep: null,
    kind: 'activity',
    activityType: 'tool',
    toolCallId: 'windowed-tool-call',
    title: 'Search Toolkit',
    status,
    ...fields,
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

describe('isChatTimelineNearBottom', () => {
  it('treats the composer inset as still pinned, not a 120px padding zone', () => {
    expect(isChatTimelineNearBottom(150, 200)).toBe(true);
    expect(isChatTimelineNearBottom(120, 128)).toBe(true);
    expect(isChatTimelineNearBottom(400, 200)).toBe(false);
  });
});

describe('EventNativeProjectTimeline', () => {
  beforeEach(() => {
    mocks.projection = projection([]);
    mocks.projectedRuns = undefined;
    mocks.retry.mockClear();
    mocks.hydration = {
      status: 'ready',
      errorCode: null,
      eventsTruncated: false,
      retry: mocks.retry,
    };
    usePageTabStore.getState().setScrollToTurnRequest(null);
    if (!globalThis.ResizeObserver) {
      globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;
    }
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
    const unsupportedRow = container.querySelector(
      '[data-event-node-id="message-2"]'
    ) as HTMLElement;
    expect(unsupportedRow).toHaveAttribute('data-expanded', 'false');
    fireEvent.click(screen.getByRole('button', { name: /Unsupported event/i }));
    expect(
      within(unsupportedRow).getByText(
        "This part of the conversation can't be shown in this version of Eigent."
      )
    ).toBeInTheDocument();
  });

  it('uses the authoritative projected Run lifecycle in Summarised mode', () => {
    mocks.projection = projection([messageNode(1)]);
    mocks.projectedRuns = {
      'run-1': {
        runId: 'run-1',
        status: 'completed',
        lastSequence: 1,
        runVersion: 1,
        updatedAt: '2026-08-19T00:00:05Z',
        totalAttemptElapsedMs: 5_000,
      },
    };

    render(
      <EventNativeProjectTimeline
        detailLevel="summarized"
        projectId="project-1"
        scrollBottomInsetPx={128}
      />
    );

    expect(screen.getByText('Run completed')).toBeInTheDocument();
    expect(screen.getByText('5s')).toBeInTheDocument();
    expect(screen.getByText('Files changed')).toBeInTheDocument();
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

    const card = screen.getByLabelText('Agent request');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(card).toHaveTextContent('Input required');
    expect(card).toHaveTextContent('Choose a format');
    expect(card).not.toHaveTextContent('PDF document');
    fireEvent.click(within(card).getByRole('button'));
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
      screen.getByText("Older messages aren't shown here.")
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
    const interaction = screen.getByLabelText('Agent request');
    expect(interaction).not.toHaveTextContent('PDF document');
    fireEvent.click(within(interaction).getByRole('button'));
    expect(interaction).toHaveTextContent('PDF document');
    expect(
      screen.queryByText(/Older messages aren't shown here/)
    ).not.toBeInTheDocument();
  });

  it('keeps safe tool input when its start receipt falls outside the DOM window', () => {
    const start = toolNode('tool-start', 1, 'running', {
      input: '{"query":"ISS modules"}',
      phase: 'started',
    });
    const interveningMessages = Array.from({ length: 249 }, (_, index) =>
      messageNode(index + 1)
    );
    const completion = toolNode('tool-completed', 251, 'completed', {
      output: 'Found 4 sources',
      phase: 'completed',
    });
    mocks.projection = projection([start, ...interveningMessages, completion]);

    render(
      <EventNativeProjectTimeline
        detailLevel="detailed"
        projectId="project-1"
        scrollBottomInsetPx={128}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Search Toolkit/i }));
    expect(screen.getByText('{"query":"ISS modules"}')).toBeInTheDocument();
    expect(screen.getByText('Found 4 sources')).toBeInTheDocument();
    expect(
      screen.getByText("Older messages aren't shown here.")
    ).toBeInTheDocument();
  });

  it('surfaces a fail-closed hydration error instead of waiting forever', () => {
    mocks.hydration = {
      status: 'error',
      errorCode: 'limit_exceeded',
      eventsTruncated: false,
      retry: mocks.retry,
    };

    render(
      <EventNativeProjectTimeline
        projectId="project-1"
        scrollBottomInsetPx={128}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load this conversation."
    );
    expect(
      screen.getByRole('button', { name: 'Try again' })
    ).toBeInTheDocument();
  });

  it('discloses when the existing Run-list API produced a partial window', () => {
    mocks.hydration = {
      status: 'ready',
      errorCode: null,
      eventsTruncated: true,
      retry: mocks.retry,
    };

    render(
      <EventNativeProjectTimeline
        projectId="project-1"
        scrollBottomInsetPx={128}
      />
    );

    expect(
      screen.getByText(/Only your most recent activity is shown here/)
    ).toBeInTheDocument();
  });

  it('pins to a new user task even when the user was reading earlier history', () => {
    const scrollContainer = createScrollContainer({
      scrollTop: 0,
      clientHeight: 400,
      scrollHeight: 2000,
    });
    const scrollContainerRef = { current: scrollContainer };
    mocks.projection = projection([messageNode(0)]);

    const { rerender } = render(
      <EventNativeProjectTimeline
        projectId="project-1"
        scrollContainerRef={scrollContainerRef}
        scrollBottomInsetPx={200}
      />
    );

    expect(scrollContainer.scrollTo).toHaveBeenCalled();
    vi.mocked(scrollContainer.scrollTo).mockClear();
    scrollContainer.scrollTop = 0;
    scrollContainer.dispatchEvent(new Event('scroll'));

    mocks.projection = projection([messageNode(0), messageNode(1, 'user')]);
    rerender(
      <EventNativeProjectTimeline
        projectId="project-1"
        scrollContainerRef={scrollContainerRef}
        scrollBottomInsetPx={200}
      />
    );

    expect(scrollContainer.scrollTo).toHaveBeenCalledWith({
      top: 2000,
      behavior: 'auto',
    });
  });

  it('anchors the second user query below the Session header gap', () => {
    const scrollContainer = createScrollContainer({
      scrollTop: 500,
      clientHeight: 400,
      scrollHeight: 2000,
    });
    const scrollContainerRef = { current: scrollContainer };
    mocks.projection = projection([
      messageNode(0, 'user'),
      messageNode(1, 'assistant'),
    ]);

    const { rerender } = render(
      <EventNativeProjectTimeline
        projectId="project-1"
        scrollContainerRef={scrollContainerRef}
        scrollBottomInsetPx={200}
      />
    );

    vi.mocked(scrollContainer.scrollTo).mockClear();
    scrollContainer.scrollTop = 500;
    scrollContainer.dispatchEvent(new Event('scroll'));

    mocks.projection = projection([
      messageNode(0, 'user'),
      messageNode(1, 'assistant'),
      messageNode(2, 'user'),
    ]);
    rerender(
      <EventNativeProjectTimeline
        projectId="project-1"
        scrollContainerRef={scrollContainerRef}
        scrollBottomInsetPx={200}
      />
    );

    expect(scrollContainer.scrollTop).toBe(456);
    expect(scrollContainer.scrollTo).not.toHaveBeenCalledWith({
      top: 2000,
      behavior: 'auto',
    });
  });

  it('does not follow a new assistant event when the user has scrolled up', () => {
    const scrollContainer = createScrollContainer({
      scrollTop: 0,
      clientHeight: 400,
      scrollHeight: 2000,
    });
    const scrollContainerRef = { current: scrollContainer };
    mocks.projection = projection([messageNode(0)]);

    const { rerender } = render(
      <EventNativeProjectTimeline
        projectId="project-1"
        scrollContainerRef={scrollContainerRef}
        scrollBottomInsetPx={200}
      />
    );

    vi.mocked(scrollContainer.scrollTo).mockClear();
    scrollContainer.scrollTop = 0;
    scrollContainer.dispatchEvent(new Event('scroll'));

    mocks.projection = projection([messageNode(0), messageNode(1)]);
    rerender(
      <EventNativeProjectTimeline
        projectId="project-1"
        scrollContainerRef={scrollContainerRef}
        scrollBottomInsetPx={200}
      />
    );

    expect(scrollContainer.scrollTo).not.toHaveBeenCalled();
  });

  it('consumes a missed scroll-to-run request only once', () => {
    const scrollContainer = createScrollContainer();
    const scrollContainerRef = { current: scrollContainer };
    mocks.projection = projection([messageNode(0)]);
    usePageTabStore.getState().setScrollToTurnRequest({
      projectId: 'project-1',
      taskId: 'run-not-mounted',
    });

    const { rerender } = render(
      <EventNativeProjectTimeline
        projectId="project-1"
        scrollContainerRef={scrollContainerRef}
        scrollBottomInsetPx={128}
      />
    );

    expect(usePageTabStore.getState().scrollToTurnRequest).toBeNull();
    vi.mocked(scrollContainer.scrollTo).mockClear();

    mocks.projection = projection([
      messageNode(0),
      { ...messageNode(1), runId: 'run-not-mounted' },
    ]);
    rerender(
      <EventNativeProjectTimeline
        projectId="project-1"
        scrollContainerRef={scrollContainerRef}
        scrollBottomInsetPx={128}
      />
    );

    expect(scrollContainer.scrollTo).not.toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'smooth' })
    );
  });
});
