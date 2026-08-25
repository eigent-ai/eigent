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
  ChatArtifactNode,
  ChatInteractionNode,
  ChatMessageNode,
  ChatPlanNode,
  ChatProjectionState,
  ChatRunStatusNode,
  ChatUnknownNode,
} from '@/lib/projector/chat';
import {
  composeTimelineRuns,
  segmentTimelineRows,
} from '@/lib/projector/chat/presentation';
import type { ProjectedRun } from '@/lib/projector/types';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { animate } from 'framer-motion';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EventNativeProjectTimeline,
  isChatTimelineNearBottom,
  prepareEventNativeTimelineWindow,
  selectWindowedTimelineRuns,
} from '@/components/ChatBox/EventNativeProjectTimeline';
import { presentChatSemanticEntities } from '@/components/ChatBox/EventTimeline/presentationPolicy';
import type { VanillaChatStore } from '@/store/chatStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { ChatTaskStatus, SessionMode } from '@/types/constants';

const mocks = vi.hoisted(() => ({
  runtimeProjectId: 'project-1',
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
    projectId: mocks.runtimeProjectId,
    hydration: mocks.hydration,
    snapshot: mocks.projection
      ? {
          chat: mocks.projection,
          view: {
            projectId: mocks.runtimeProjectId,
            runs: mocks.projectedRuns ?? {},
            artifactsByRun: {},
          },
        }
      : null,
  }),
}));
vi.mock('@/components/ChatBox/TaskBox/PlanTaskBox', () => ({
  PlanTaskBox: ({ taskId }: { taskId: string }) => (
    <div data-interactive-plan-card={taskId}>Interactive plan</div>
  ),
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
    mocks.runtimeProjectId = 'project-1';
    mocks.projection = projection([]);
    mocks.projectedRuns = undefined;
    mocks.retry.mockClear();
    vi.mocked(animate).mockClear();
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

  it('never renders stale nodes from a previously selected Project', () => {
    const staleNode = {
      ...messageNode(1),
      projectId: 'project-previous',
      content: 'Previous Project legacy text',
    };
    mocks.projection = projection([staleNode]);

    render(
      <EventNativeProjectTimeline
        projectId="project-1"
        scrollBottomInsetPx={128}
      />
    );

    expect(
      screen.queryByText('Previous Project legacy text')
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('No messages yet. Send a message to get started.')
    ).toBeInTheDocument();
  });

  it('renders the submitted user turn and startup shimmer before the first durable event', () => {
    const chatStore = {
      getState: () => ({
        activeTaskId: 'run-1',
        tasks: {
          'run-1': {
            createdAt: Date.parse('2026-08-20T12:08:38Z'),
            messages: [
              {
                id: 'legacy-user-1',
                role: 'user',
                content: 'Create customer package',
                attaches: [],
              },
            ],
            status: ChatTaskStatus.PENDING,
            type: 'chat',
          },
        },
      }),
      subscribe: () => () => undefined,
    } as unknown as VanillaChatStore;

    const { container, rerender } = render(
      <EventNativeProjectTimeline
        chatStore={chatStore}
        detailLevel="narrative"
        projectId="project-1"
        scrollBottomInsetPx={128}
      />
    );

    expect(screen.getByText('Create customer package')).toBeInTheDocument();
    expect(screen.getByText('Preparing to start tasks')).toBeInTheDocument();
    expect(
      screen.queryByText('No messages yet. Send a message to get started.')
    ).not.toBeInTheDocument();

    const durableUser = {
      ...messageNode(0, 'user'),
      content: 'Create customer package',
      purpose: 'query' as const,
    };
    const narration = {
      ...messageNode(1),
      content: 'Reviewing the task requirements',
      purpose: 'narration' as const,
    };
    const running: ChatRunStatusNode = {
      ...messageNode(2),
      kind: 'run_status',
      eventType: 'run.running',
      status: 'running',
    };
    mocks.projection = projection([durableUser, narration, running]);
    rerender(
      <EventNativeProjectTimeline
        chatStore={chatStore}
        detailLevel="narrative"
        projectId="project-1"
        scrollBottomInsetPx={128}
      />
    );

    expect(screen.getAllByText('Create customer package')).toHaveLength(1);
    expect(screen.queryByText('Preparing to start tasks')).toBeNull();
    expect(
      container.querySelector('[data-narrative-run-work-log]')
    ).toBeInTheDocument();
  });

  it('keeps a terminal startup failure visible until durable events replace it', async () => {
    const failure =
      '❌ Backend service is not ready. Please wait a moment and try again.';
    const chatStore = {
      getState: () => ({
        activeTaskId: 'run-1',
        tasks: {
          'run-1': {
            createdAt: Date.parse('2026-08-20T12:08:38Z'),
            messages: [
              {
                id: 'legacy-user-1',
                role: 'user',
                content: 'Create customer package',
                attaches: [],
              },
              { id: 'legacy-failure-1', role: 'agent', content: failure },
            ],
            status: ChatTaskStatus.FINISHED,
            type: 'chat',
          },
        },
      }),
      subscribe: () => () => undefined,
    } as unknown as VanillaChatStore;

    const { rerender } = render(
      <EventNativeProjectTimeline
        chatStore={chatStore}
        detailLevel="narrative"
        projectId="project-1"
        scrollBottomInsetPx={128}
      />
    );

    expect(screen.getByText('Create customer package')).toBeInTheDocument();
    await waitFor(() =>
      expect(document.body).toHaveTextContent(
        'Backend service is not ready. Please wait a moment and try again.'
      )
    );
    expect(screen.queryByText('Preparing to start tasks')).toBeNull();

    const durableUser = {
      ...messageNode(0, 'user'),
      content: 'Create customer package',
      purpose: 'query' as const,
    };
    const durableFailure = {
      ...messageNode(1),
      content: failure,
      purpose: 'final' as const,
    };
    const failed: ChatRunStatusNode = {
      ...messageNode(2),
      kind: 'run_status',
      eventType: 'run.failed',
      status: 'failed',
    };
    mocks.projection = projection([durableUser, durableFailure, failed]);
    rerender(
      <EventNativeProjectTimeline
        chatStore={chatStore}
        detailLevel="narrative"
        projectId="project-1"
        scrollBottomInsetPx={128}
      />
    );

    expect(screen.getAllByText('Create customer package')).toHaveLength(1);
    await waitFor(() => {
      const occurrences = (
        document.body.textContent?.match(/Backend service is not ready/g) || []
      ).length;
      expect(occurrences).toBe(1);
    });
  });

  it('uses full width only for the trajectory timeline', () => {
    const { container, rerender } = render(
      <EventNativeProjectTimeline
        detailLevel="narrative"
        projectId="project-1"
        scrollBottomInsetPx={128}
      />
    );
    const timelineContent = () =>
      container.querySelector('[data-chat-timeline-content]');

    expect(timelineContent()).toHaveClass('max-w-[600px]');

    rerender(
      <EventNativeProjectTimeline
        detailLevel="trajectory"
        projectId="project-1"
        scrollBottomInsetPx={128}
      />
    );
    expect(timelineContent()).not.toHaveClass('max-w-[600px]');
    expect(timelineContent()).toHaveClass('w-full');
  });

  it('renders a floating run control inside the timeline content', () => {
    const { container } = render(
      <EventNativeProjectTimeline
        floatingControl={<button type="button">Stop Task</button>}
        projectId="project-1"
        scrollBottomInsetPx={128}
      />
    );

    const timelineContent = container.querySelector(
      '[data-chat-timeline-content]'
    );
    expect(timelineContent).toContainElement(
      screen.getByRole('button', { name: 'Stop Task' })
    );
  });

  it('attributes narrative work to nested agent accordions only in workforce mode', async () => {
    const alpha = {
      ...messageNode(1),
      purpose: 'narration' as const,
      agentName: 'Alpha Agent',
    };
    const beta = {
      ...messageNode(2),
      purpose: 'narration' as const,
      agentName: 'Beta Agent',
    };
    const running: ChatRunStatusNode = {
      ...messageNode(3),
      kind: 'run_status',
      eventType: 'run.running',
      status: 'running',
    };
    mocks.projection = projection([alpha, beta, running]);

    const { container, rerender } = render(
      <EventNativeProjectTimeline
        detailLevel="narrative"
        projectId="project-1"
        sessionMode={SessionMode.SINGLE_AGENT}
        scrollBottomInsetPx={128}
      />
    );

    expect(
      container.querySelector('[data-narrative-timeline]')
    ).toBeInTheDocument();
    expect(container.querySelector('[data-narrative-agent-group]')).toBeNull();
    expect(
      container.querySelector('[data-narrative-segment-agent]')
    ).toBeNull();
    expect(screen.getByText('Message 1')).toBeInTheDocument();
    expect(screen.getByText('Message 2')).toBeInTheDocument();

    rerender(
      <EventNativeProjectTimeline
        detailLevel="narrative"
        projectId="project-1"
        sessionMode={SessionMode.WORKFORCE}
        scrollBottomInsetPx={128}
      />
    );

    const groups = [
      ...container.querySelectorAll('[data-narrative-agent-group]'),
    ].map((element) => element.getAttribute('data-narrative-agent-group'));
    expect(groups).toEqual(['Alpha Agent', 'Beta Agent']);
    // Switching modes replaces the flat rows with agent groups, and the rows on
    // their way out stay mounted for the length of their fade. Only once that
    // settles does the DOM show what a collapsed group actually withholds.
    await waitFor(() =>
      expect(screen.queryByText('Message 1')).not.toBeInTheDocument()
    );
    expect(screen.getByText('Message 2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Alpha Agent' }));
    expect(screen.getByText('Message 1')).toBeInTheDocument();
  });

  it('restores the interactive card for the active unconfirmed workforce plan', () => {
    const user = messageNode(0, 'user');
    const plan: ChatPlanNode = {
      ...messageNode(1),
      kind: 'plan',
      eventType: 'legacy.to_sub_tasks',
      legacyStep: 'to_sub_tasks',
      status: 'active',
      title: 'Research plan',
      tasks: [
        { id: 'task-1', title: 'Inspect the components', status: 'pending' },
      ],
    };
    const pending: ChatRunStatusNode = {
      ...messageNode(2),
      kind: 'run_status',
      eventType: 'run.created',
      status: 'pending',
    };
    mocks.projection = projection([user, plan, pending]);
    const chatStore = {
      getState: () => ({
        activeTaskId: 'run-1',
        tasks: {
          'run-1': {
            messages: [
              {
                id: 'legacy-plan-message',
                role: 'agent',
                content: '',
                step: 'to_sub_tasks',
                isConfirm: false,
              },
            ],
          },
        },
      }),
      subscribe: () => () => undefined,
    } as unknown as VanillaChatStore;

    const { container, rerender } = render(
      <EventNativeProjectTimeline
        chatStore={chatStore}
        detailLevel="narrative"
        projectId="project-1"
        sessionMode={SessionMode.WORKFORCE}
        scrollBottomInsetPx={128}
      />
    );

    const narrativePlanCard = container.querySelector(
      '[data-interactive-plan-card="run-1"]'
    ) as HTMLElement;
    expect(narrativePlanCard).toBeInTheDocument();
    expect(
      narrativePlanCard.closest('[data-narrative-run-work-log]')
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-narrative-plan-interactive]')
    ).toContainElement(narrativePlanCard);
    expect(screen.queryByText('Research plan')).toBeNull();

    rerender(
      <EventNativeProjectTimeline
        chatStore={chatStore}
        detailLevel="trajectory"
        projectId="project-1"
        sessionMode={SessionMode.WORKFORCE}
        scrollBottomInsetPx={128}
      />
    );
    const trajectoryPlanRow = container.querySelector(
      '[data-event-node-id="message-1"]'
    ) as HTMLElement;
    expect(trajectoryPlanRow).toHaveAttribute('data-interactive-plan-event');
    expect(trajectoryPlanRow).toContainElement(
      container.querySelector(
        '[data-interactive-plan-card="run-1"]'
      ) as HTMLElement
    );
    expect(screen.queryByText('Research plan')).toBeNull();

    rerender(
      <EventNativeProjectTimeline
        chatStore={chatStore}
        detailLevel="narrative"
        projectId="project-1"
        sessionMode={SessionMode.SINGLE_AGENT}
        scrollBottomInsetPx={128}
      />
    );
    expect(container.querySelector('[data-interactive-plan-card]')).toBeNull();
    expect(container.querySelector('[data-narrative-plan-id]')).toBeNull();
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

  it('renders current Run and agent lifecycle statuses instead of stale transitions', () => {
    const runStatus = (
      eventId: string,
      sequence: number,
      status: ChatRunStatusNode['status']
    ): ChatRunStatusNode => ({
      ...messageNode(sequence),
      id: eventId,
      eventId,
      runSequence: sequence,
      kind: 'run_status',
      eventType: `run.${status}`,
      status,
    });
    const agent = (
      eventId: string,
      sequence: number,
      status: ChatActivityNode['status'],
      legacyStep: 'activate_agent' | 'deactivate_agent'
    ): ChatActivityNode => ({
      ...messageNode(sequence),
      id: eventId,
      eventId,
      runSequence: sequence,
      kind: 'activity',
      eventType: `legacy.${legacyStep}`,
      legacyStep,
      activityType: 'agent',
      agentId: 'agent-1',
      agentName: 'single_agent',
      taskId: 'task-1',
      title: 'single_agent',
      phase: status === 'completed' ? 'completed' : 'started',
      status,
    });
    mocks.projection = projection([
      runStatus('run-pending', 1, 'pending'),
      runStatus('run-running', 2, 'running'),
      agent('agent-started', 3, 'running', 'activate_agent'),
      agent('agent-completed', 4, 'completed', 'deactivate_agent'),
    ]);
    mocks.projectedRuns = {
      'run-1': {
        runId: 'run-1',
        status: 'completed',
        lastSequence: 4,
        runVersion: 1,
        updatedAt: '2026-08-19T00:00:04Z',
        totalAttemptElapsedMs: 3_000,
      },
    };

    const { container } = render(
      <EventNativeProjectTimeline
        detailLevel="trajectory"
        projectId="project-1"
        scrollBottomInsetPx={128}
      />
    );

    expect(
      container.querySelector('[data-detailed-status="pending"]')
    ).toBeNull();
    expect(
      container.querySelector('[data-detailed-status="running"]')
    ).toBeNull();
    expect(
      container.querySelectorAll('[data-detailed-status="completed"]')
    ).toHaveLength(2);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('uses the authoritative projected Run lifecycle for elapsed time', () => {
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
        detailLevel="narrative"
        projectId="project-1"
        scrollBottomInsetPx={128}
      />
    );

    expect(screen.getByText(/Worked for/)).toBeInTheDocument();
    expect(screen.getByText('5s')).toBeInTheDocument();
  });

  it('shows the edited-files card only after a final markdown response is terminal', async () => {
    const finalResponse = {
      ...messageNode(1),
      purpose: 'final' as const,
      content: '## Finished report',
    };
    const artifact: ChatArtifactNode = {
      ...messageNode(2),
      kind: 'artifact',
      eventType: 'artifact.created',
      operation: 'created',
      path: 'reports/final.md',
      relativePath: 'reports/final.md',
      name: 'final.md',
    };
    const running: ChatRunStatusNode = {
      ...messageNode(3),
      kind: 'run_status',
      eventType: 'run.running',
      status: 'running',
    };
    mocks.projection = projection([finalResponse, artifact, running]);

    const { rerender } = render(
      <EventNativeProjectTimeline
        detailLevel="narrative"
        projectId="project-1"
        scrollBottomInsetPx={128}
      />
    );

    expect(screen.queryByText('Edited 1 file')).not.toBeInTheDocument();

    mocks.projectedRuns = {
      'run-1': {
        runId: 'run-1',
        status: 'completed',
        lastSequence: 3,
        runVersion: 1,
        updatedAt: '2026-08-20T00:00:03Z',
        totalAttemptElapsedMs: 3_000,
      },
    };
    rerender(
      <EventNativeProjectTimeline
        detailLevel="narrative"
        projectId="project-1"
        scrollBottomInsetPx={128}
      />
    );

    expect(await screen.findByText('Edited 1 file')).toBeInTheDocument();
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

  it('mounts a bounded latest window and lets the user reveal older messages', () => {
    mocks.projection = projection(
      Array.from({ length: 251 }, (_, index) => messageNode(index))
    );

    render(
      <EventNativeProjectTimeline
        projectId="project-1"
        scrollBottomInsetPx={128}
      />
    );

    const showOlder = screen.getByRole('button', {
      name: 'Show older messages',
    });
    expect(screen.queryByText('Message 0')).not.toBeInTheDocument();
    expect(screen.getByText('Message 250')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(250);

    fireEvent.click(showOlder);

    expect(screen.getByText('Message 0')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(251);
    expect(
      screen.queryByRole('button', { name: 'Show older messages' })
    ).not.toBeInTheDocument();
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

  it('does not resurrect suppressed dual-write approval receipts while windowing Runs', () => {
    const toolStart = toolNode('approval-tool-start', 1, 'running', {
      phase: 'started',
    });
    const approvalRequest: ChatInteractionNode = {
      ...interactionNode('approval-requested', 'requested', 2),
      eventType: 'approval.requested',
      interactionId: 'approval:windowed-tool-call',
      interactionType: 'approval',
      prompt: 'Allow File Toolkit to inspect the mesh files?',
    };
    const legacyAskMirror: ChatInteractionNode = {
      ...approvalRequest,
      id: 'approval-legacy-ask',
      eventId: 'approval-legacy-ask',
      eventType: 'legacy.ask',
      legacyStep: 'ask',
      runSequence: 3,
    };
    const approvalDecision: ChatInteractionNode = {
      ...interactionNode('approval-decided', 'responded', 4),
      eventType: 'approval.decided',
      interactionId: 'approval:windowed-tool-call',
      interactionType: 'approval',
      response: 'approved',
    };
    const toolCompletion = toolNode('approval-tool-completed', 5, 'completed', {
      phase: 'completed',
    });
    const rawVisibleNodes = [
      toolStart,
      approvalRequest,
      legacyAskMirror,
      approvalDecision,
      toolCompletion,
    ];
    const semanticRuns = composeTimelineRuns(
      presentChatSemanticEntities(rawVisibleNodes)
    );

    // The visible slice can still be transport-shaped. Selection must retain
    // only the full semantic Run rows instead of rebuilding raw receipts.
    const [windowedRun] = selectWindowedTimelineRuns(
      semanticRuns,
      rawVisibleNodes
    );
    const interactionRows = windowedRun!.traceRows.filter(
      (row) => row.kind === 'node' && row.node.kind === 'interaction'
    );

    expect(interactionRows).toHaveLength(1);
    expect(interactionRows[0]).toMatchObject({
      id: 'approval-requested',
      node: {
        interactionId: 'approval:windowed-tool-call',
        requestEventId: 'approval-requested',
        resolutionEventId: 'approval-decided',
        response: 'approved',
        status: 'responded',
      },
    });
    expect(windowedRun!.nodes.map((node) => node.eventId)).not.toContain(
      'approval-legacy-ask'
    );
    expect(windowedRun!.nodes.map((node) => node.eventId)).not.toContain(
      'approval-decided'
    );

    // The approval is a human-executed call, so it closes the tool segment
    // and stands on its own rather than folding in with the toolkit work.
    const narrativeItems = segmentTimelineRows(windowedRun!.traceRows);
    expect(narrativeItems).toHaveLength(2);
    expect(narrativeItems[0]).toMatchObject({
      kind: 'segment',
      calls: [{ executor: 'toolkit', toolCallId: 'windowed-tool-call' }],
    });
    expect(narrativeItems[1]).toMatchObject({
      kind: 'interrupt',
      call: {
        executor: 'human',
        interactionId: 'approval:windowed-tool-call',
        output: 'approved',
        title: 'You · Allowed',
      },
    });
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
        detailLevel="trajectory"
        projectId="project-1"
        scrollBottomInsetPx={128}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Search Toolkit/i }));
    expect(screen.getByText('{"query":"ISS modules"}')).toBeInTheDocument();
    expect(screen.getByText('Found 4 sources')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Show older messages' })
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
      {
        ...messageNode(2, 'user'),
        id: 'run-2-user',
        eventId: 'run-2-user',
        runId: 'run-2',
        purpose: 'query',
      },
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

  it('does not restart the anchor when an optimistic query becomes durable', () => {
    const scrollContainer = createScrollContainer({
      scrollTop: 500,
      clientHeight: 400,
      scrollHeight: 2000,
    });
    const scrollContainerRef = { current: scrollContainer };
    const legacyState = {
      activeTaskId: 'run-1',
      tasks: {
        'run-1': {
          messages: [{ id: 'legacy-user-1', role: 'user', content: 'First' }],
          status: ChatTaskStatus.RUNNING,
          type: 'chat',
        },
      },
    } as any;
    const chatStore = {
      getState: () => legacyState,
      subscribe: () => () => undefined,
    } as unknown as VanillaChatStore;
    const firstUser = {
      ...messageNode(0, 'user'),
      content: 'First',
      purpose: 'query' as const,
    };
    mocks.projection = projection([firstUser, messageNode(1)]);

    const { rerender } = render(
      <EventNativeProjectTimeline
        chatStore={chatStore}
        projectId="project-1"
        scrollContainerRef={scrollContainerRef}
        scrollBottomInsetPx={200}
      />
    );
    vi.mocked(animate).mockClear();

    legacyState.activeTaskId = 'run-2';
    legacyState.tasks['run-2'] = {
      messages: [{ id: 'legacy-user-2', role: 'user', content: 'Second' }],
      status: ChatTaskStatus.PENDING,
      type: 'chat',
    };
    rerender(
      <EventNativeProjectTimeline
        chatStore={chatStore}
        projectId="project-1"
        scrollContainerRef={scrollContainerRef}
        scrollBottomInsetPx={200}
      />
    );
    expect(animate).toHaveBeenCalledTimes(1);

    const secondUser = {
      ...messageNode(2, 'user'),
      id: 'durable-user-2',
      eventId: 'durable-user-2',
      runId: 'run-2',
      content: 'Second',
      purpose: 'query' as const,
    };
    mocks.projection = projection([firstUser, messageNode(1), secondUser]);
    rerender(
      <EventNativeProjectTimeline
        chatStore={chatStore}
        projectId="project-1"
        scrollContainerRef={scrollContainerRef}
        scrollBottomInsetPx={200}
      />
    );

    expect(animate).toHaveBeenCalledTimes(1);
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
