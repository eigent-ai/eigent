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
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EventRenderer } from '@/components/ChatBox/EventTimeline/EventRenderer';
import { EventTimeline } from '@/components/ChatBox/EventTimeline/EventTimeline';
import { createChatTimelinePresentationPolicyRegistry } from '@/components/ChatBox/EventTimeline/presentationPolicy';
import {
  createEventRendererRegistry,
  createEventTypeRendererRegistry,
} from '@/components/ChatBox/EventTimeline/rendererRegistry';

const commonNode = {
  projectId: 'project-1',
  runId: 'run-1',
  createdAt: '2026-08-11T10:00:00Z',
  runSequence: 1,
  cloudCursor: null,
  eventType: 'test.event',
  legacyStep: null,
};

function messageNode(
  id: string,
  role: 'user' | 'assistant',
  content: string,
  eventType = 'test.event'
): ChatProjectionNode {
  return {
    ...commonNode,
    id,
    eventId: `event-${id}`,
    eventType,
    kind: 'message',
    role,
    content,
    status: 'complete',
  };
}

function interactionNode(
  id: string,
  status: 'requested' | 'responded' | 'cancelled' | 'expired',
  interactionId: string | undefined,
  overrides: Partial<Extract<ChatProjectionNode, { kind: 'interaction' }>> = {}
): Extract<ChatProjectionNode, { kind: 'interaction' }> {
  return {
    ...commonNode,
    id,
    eventId: `event-${id}`,
    eventType:
      status === 'requested'
        ? 'interaction.requested'
        : status === 'expired'
          ? 'interaction.expired'
          : status === 'cancelled'
            ? 'interaction.cancelled'
            : 'interaction.resolved',
    kind: 'interaction',
    interactionId,
    interactionType: 'choice',
    status,
    ...overrides,
  };
}

function correlatedHumanReplyNode(
  id: string,
  content: string,
  interactionId: string,
  runId = 'run-1'
): Extract<ChatProjectionNode, { kind: 'message' }> {
  return {
    ...commonNode,
    id,
    eventId: `event-${id}`,
    eventType: 'legacy.human_reply',
    runId,
    kind: 'message',
    role: 'user',
    content,
    status: 'complete',
    interactionId,
    interactionResponse: true,
  };
}

function activityNode(
  id: string,
  title: string,
  overrides: Partial<Extract<ChatProjectionNode, { kind: 'activity' }>> = {}
): Extract<ChatProjectionNode, { kind: 'activity' }> {
  return {
    ...commonNode,
    id,
    eventId: `event-${id}`,
    eventType: 'tool.completed',
    kind: 'activity',
    activityType: 'tool',
    status: 'completed',
    title,
    ...overrides,
  };
}

function noticeNode(
  id: string,
  content: string,
  overrides: Partial<Extract<ChatProjectionNode, { kind: 'notice' }>> = {}
): ChatProjectionNode {
  return {
    ...commonNode,
    id,
    eventId: `event-${id}`,
    kind: 'notice',
    severity: 'info',
    content,
    ...overrides,
  };
}

function unknownNode(): ChatProjectionNode {
  const node = {
    ...commonNode,
    id: 'unknown-1',
    eventId: 'event-unknown-1',
    kind: 'unknown',
    eventType: 'future.super_event',
    summary: 'Unsupported future event',
    data: { secret: 'must-not-leak' },
  } as const;

  return node;
}

function artifactNode(): ChatProjectionNode {
  return {
    ...commonNode,
    id: 'artifact-1',
    eventId: 'event-artifact-1',
    eventType: 'artifact.created',
    kind: 'artifact',
    operation: 'created',
    path: '/Users/alice/private-project/report.md',
    name: '/Users/alice/private-project/report.md',
  };
}

describe('EventTimeline', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders semantic nodes in timeline order with stable node metadata', () => {
    render(
      <EventTimeline
        nodes={[
          messageNode('message-1', 'user', 'Start the Run'),
          messageNode('message-2', 'assistant', 'Working on it'),
        ]}
      />
    );

    const timeline = screen.getByRole('list', {
      name: 'Chat event timeline',
    });
    const items = screen.getAllByRole('listitem');

    expect(timeline).toBeInTheDocument();
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute('data-event-node-id', 'message-1');
    expect(items[1]).toHaveAttribute('data-event-node-id', 'message-2');
    expect(screen.getByLabelText('Your message')).toHaveTextContent(
      'Start the Run'
    );
    expect(screen.getByLabelText("Eigent's reply")).toHaveTextContent(
      'Working on it'
    );
    expect(screen.getByLabelText('Your message')).toHaveClass('rounded-br-sm');
    expect(screen.getByLabelText('Your message').parentElement).toHaveClass(
      'pl-16'
    );
    expect(screen.getByLabelText("Eigent's reply")).not.toHaveClass(
      'rounded-br-sm'
    );
  });

  it('presents an explicitly resolved interaction as one traceable input receipt', () => {
    const request = interactionNode(
      'format-request',
      'requested',
      'format-choice',
      {
        prompt: 'Choose output formats',
        options: [
          { id: 'pdf', label: 'PDF' },
          { id: 'docx', label: 'Word document' },
        ],
      }
    );
    const resolution = interactionNode(
      'format-resolution',
      'responded',
      'format-choice',
      { responseOptionIds: ['pdf', 'docx'] }
    );
    const sourceNodes = [request, resolution] as const;

    render(<EventTimeline nodes={sourceNodes} />);

    const item = screen.getByRole('listitem');
    const card = screen.getByLabelText('Agent request');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(item).toHaveAttribute('data-event-node-id', 'format-request');
    expect(item).toHaveAttribute('data-interaction-id', 'format-choice');
    expect(item).toHaveAttribute('data-interaction-status', 'responded');
    expect(item).toHaveAttribute(
      'data-interaction-request-event-id',
      'event-format-request'
    );
    expect(item).toHaveAttribute(
      'data-interaction-resolution-event-id',
      'event-format-resolution'
    );
    expect(item).toHaveAttribute('data-run-id', 'run-1');
    expect(card).toHaveTextContent('Input required');
    expect(card).toHaveTextContent('Choose output formats');
    expect(card).toHaveTextContent('PDF, Word document');
    expect(card).toHaveTextContent('responded');
    expect(card).toHaveAttribute('data-interaction-id', 'format-choice');
    expect(card).toHaveAttribute('data-interaction-run-id', 'run-1');
    expect(card).toHaveAttribute(
      'data-interaction-request-event-id',
      'event-format-request'
    );
    expect(card).toHaveAttribute(
      'data-interaction-resolution-event-id',
      'event-format-resolution'
    );

    // Presentation creates a receipt view; the projector's source ledger is
    // still the original immutable request and resolution pair.
    expect(sourceNodes).toHaveLength(2);
    expect(request.status).toBe('requested');
    expect(request).not.toHaveProperty('resolutionEventId');
    expect(resolution.status).toBe('responded');
  });

  it('keeps a pending question out of the timeline receipt', () => {
    render(
      <EventTimeline
        nodes={[
          interactionNode('pending-question', 'requested', 'pending-1', {
            prompt: 'Which dataset should I use while pending?',
          }),
        ]}
      />
    );

    const card = screen.getByLabelText('Agent request');
    expect(card).toHaveTextContent('Input required');
    expect(card).not.toHaveTextContent(
      'Which dataset should I use while pending?'
    );
  });

  it('keeps an input receipt at its request position inside later work-log activity', () => {
    render(
      <EventTimeline
        nodes={[
          activityNode('preparing-agent', 'Preparing agent', {
            createdAt: '2026-08-11T10:00:01Z',
          }),
          activityNode('human-toolkit', 'Human Toolkit', {
            createdAt: '2026-08-11T10:00:02Z',
          }),
          interactionNode('input-request', 'requested', 'input-1', {
            createdAt: '2026-08-11T10:00:03Z',
            prompt: 'Which dataset should I use?',
          }),
          activityNode('todo-toolkit-one', 'Todo Toolkit: first item', {
            createdAt: '2026-08-11T10:00:04Z',
          }),
          activityNode('todo-toolkit-two', 'Todo Toolkit: second item', {
            createdAt: '2026-08-11T10:00:05Z',
          }),
          interactionNode('input-resolution', 'responded', 'input-1', {
            createdAt: '2026-08-11T10:00:06Z',
            response: 'Quarterly metrics',
          }),
        ]}
      />
    );

    const items = screen.getAllByRole('listitem');
    expect(items.map((item) => item.dataset.eventNodeId)).toEqual([
      'preparing-agent',
      'human-toolkit',
      'input-request',
      'todo-toolkit-one',
      'todo-toolkit-two',
    ]);

    const card = screen.getByLabelText('Agent request');
    expect(card).toHaveTextContent('Input required');
    expect(card).toHaveTextContent('Which dataset should I use?');
    expect(card).toHaveTextContent('Quarterly metrics');
  });

  it('groups consecutive duplicate tool calls behind an optional accordion', () => {
    render(
      <EventTimeline
        nodes={[
          activityNode('web-fetch-1', 'Fetch first page', {
            toolkitName: 'WebFetchToolkit',
            methodName: 'Web_fetch_and_analyze',
            detail: 'First result',
          }),
          activityNode('web-fetch-2', 'Fetch second page', {
            toolkitName: 'WebFetchToolkit',
            methodName: 'Web_fetch_and_analyze',
            detail: 'Second result',
          }),
          activityNode('web-fetch-3', 'Fetch third page', {
            toolkitName: 'WebFetchToolkit',
            methodName: 'Web_fetch_and_analyze',
            detail: 'Third result',
          }),
        ]}
      />
    );

    const group = screen.getByLabelText(
      'Repeated tool calls: WebFetchToolkit · Web_fetch_and_analyze'
    );
    const trigger = screen.getByRole('button', {
      name: /WebFetchToolkit · Web_fetch_and_analyze · 3 events/,
    });

    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(group).toHaveAttribute('data-tool-call-count', '3');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByText('WebFetchToolkit · Web_fetch_and_analyze')
    ).not.toBeInTheDocument();

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getAllByText('WebFetchToolkit · Web_fetch_and_analyze')
    ).toHaveLength(3);
    expect(screen.getByText('Second result')).toBeInTheDocument();
  });

  it('keeps one tool call as a normal activity row without an accordion', () => {
    render(
      <EventTimeline
        nodes={[
          activityNode('single-fetch', 'Fetch one page', {
            toolkitName: 'WebFetchToolkit',
            methodName: 'Web_fetch_and_analyze',
          }),
        ]}
      />
    );

    expect(screen.getByText('Fetch one page')).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/Repeated tool calls:/)
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('does not group matching calls across a chronological boundary', () => {
    render(
      <EventTimeline
        nodes={[
          activityNode('fetch-before', 'Fetch before notice', {
            createdAt: '2026-08-11T10:00:01Z',
            toolkitName: 'WebFetchToolkit',
            methodName: 'Web_fetch_and_analyze',
          }),
          noticeNode('fetch-boundary', 'Reviewing fetched sources', {
            createdAt: '2026-08-11T10:00:02Z',
          }),
          activityNode('fetch-after', 'Fetch after notice', {
            createdAt: '2026-08-11T10:00:03Z',
            toolkitName: 'WebFetchToolkit',
            methodName: 'Web_fetch_and_analyze',
          }),
        ]}
      />
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(
      screen.queryByLabelText(/Repeated tool calls:/)
    ).not.toBeInTheDocument();
  });

  it('counts paired lifecycle events as calls rather than event frames', () => {
    const sourceNodes = [
      activityNode('fetch-1-start', 'Fetch first page', {
        createdAt: '2026-08-11T10:00:01Z',
        eventType: 'tool.started',
        status: 'running',
        toolkitName: 'WebFetchToolkit',
        methodName: 'Web_fetch_and_analyze',
        toolCallId: 'fetch-call-1',
        detail: 'First request',
      }),
      activityNode('fetch-1-end', 'Fetch first page', {
        createdAt: '2026-08-11T10:00:02Z',
        eventType: 'tool.completed',
        status: 'completed',
        toolkitName: 'WebFetchToolkit',
        methodName: 'Web_fetch_and_analyze',
        toolCallId: 'fetch-call-1',
        detail: 'First response',
      }),
      activityNode('fetch-2-start', 'Fetch second page', {
        createdAt: '2026-08-11T10:00:03Z',
        eventType: 'tool.started',
        status: 'running',
        toolkitName: 'WebFetchToolkit',
        methodName: 'Web_fetch_and_analyze',
        toolCallId: 'fetch-call-2',
      }),
      activityNode('fetch-2-end', 'Fetch second page', {
        createdAt: '2026-08-11T10:00:04Z',
        eventType: 'tool.completed',
        status: 'completed',
        toolkitName: 'WebFetchToolkit',
        methodName: 'Web_fetch_and_analyze',
        toolCallId: 'fetch-call-2',
      }),
    ] as const;

    render(<EventTimeline nodes={sourceNodes} />);

    const group = screen.getByLabelText(
      'Repeated tool calls: WebFetchToolkit · Web_fetch_and_analyze'
    );
    expect(group).toHaveAttribute('data-tool-call-count', '2');
    expect(group).toHaveTextContent(
      'WebFetchToolkit · Web_fetch_and_analyze · 2 events'
    );
    expect(sourceNodes).toHaveLength(4);
    expect(sourceNodes[0].status).toBe('running');

    fireEvent.click(screen.getByRole('button'));
    expect(
      screen.getByText(/First request\s+First response/)
    ).toBeInTheDocument();
  });

  it('preserves an open repeated-call accordion as late calls arrive', () => {
    const first = activityNode('late-fetch-1', 'First call', {
      toolkitName: 'WebFetchToolkit',
      methodName: 'Web_fetch_and_analyze',
    });
    const second = activityNode('late-fetch-2', 'Second call', {
      toolkitName: 'WebFetchToolkit',
      methodName: 'Web_fetch_and_analyze',
    });
    const third = activityNode('late-fetch-3', 'Third call', {
      toolkitName: 'WebFetchToolkit',
      methodName: 'Web_fetch_and_analyze',
    });
    const view = render(<EventTimeline nodes={[first, second]} />);

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');

    view.rerender(<EventTimeline nodes={[first, second, third]} />);

    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getAllByText('WebFetchToolkit · Web_fetch_and_analyze')
    ).toHaveLength(3);
    expect(screen.getByLabelText(/Repeated tool calls:/)).toHaveAttribute(
      'data-tool-call-count',
      '3'
    );
  });

  it('never merges interaction receipts across ids or runs', () => {
    render(
      <EventTimeline
        nodes={[
          interactionNode('request-a', 'requested', 'interaction-a', {
            createdAt: '2026-08-11T10:00:01Z',
            prompt: 'First question',
            runId: 'run-1',
          }),
          interactionNode('resolution-b', 'responded', 'interaction-b', {
            createdAt: '2026-08-11T10:00:02Z',
            response: 'Answer for another interaction',
            runId: 'run-1',
          }),
          interactionNode(
            'resolution-a-other-run',
            'responded',
            'interaction-a',
            {
              createdAt: '2026-08-11T10:00:03Z',
              response: 'Answer from another run',
              runId: 'run-2',
            }
          ),
        ]}
      />
    );

    const cards = screen.getAllByLabelText('Agent request');
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(cards.map((card) => card.dataset.interactionStatus)).toEqual([
      'requested',
      'responded',
      'responded',
    ]);
    expect(cards[0]).toHaveAttribute('data-interaction-run-id', 'run-1');
    expect(cards[2]).toHaveAttribute('data-interaction-run-id', 'run-2');
  });

  it('updates an expired request in place instead of leaving two stale boxes', () => {
    render(
      <EventTimeline
        nodes={[
          interactionNode('expired-request', 'requested', 'expired-1', {
            prompt: 'Choose a format',
          }),
          interactionNode('expired-receipt', 'expired', 'expired-1'),
        ]}
      />
    );

    const card = screen.getByLabelText('Agent request');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(card).toHaveTextContent('Input required');
    expect(card).not.toHaveTextContent('Choose a format');
    expect(card).toHaveAttribute('data-interaction-status', 'expired');
    expect(card).toHaveAttribute(
      'data-interaction-resolution-event-id',
      'event-expired-receipt'
    );
  });

  it('folds an explicitly correlated legacy human reply into its request', () => {
    render(
      <EventTimeline
        nodes={[
          interactionNode('continue-request', 'requested', 'continue-1', {
            prompt: 'Continue with the report?',
          }),
          correlatedHumanReplyNode('continue-reply', 'Yes', 'continue-1'),
        ]}
      />
    );

    const card = screen.getByLabelText('Agent request');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(card).toHaveTextContent('Input required');
    expect(card).toHaveTextContent('Continue with the report?');
    expect(card).toHaveTextContent('Yes');
    expect(card).toHaveAttribute(
      'data-interaction-resolution-event-id',
      'event-continue-reply'
    );
  });

  it('prefers a canonical pending request over one legacy ASK mirror', () => {
    render(
      <EventTimeline
        nodes={[
          interactionNode(
            'pending-legacy-request',
            'requested',
            'pending-dual-request',
            { eventType: 'legacy.ask', legacyStep: 'ask' }
          ),
          interactionNode(
            'pending-canonical-request',
            'requested',
            'pending-dual-request',
            { legacyStep: 'ask' }
          ),
        ]}
      />
    );

    const item = screen.getByRole('listitem');
    expect(item).toHaveAttribute(
      'data-event-node-id',
      'pending-canonical-request'
    );
    expect(screen.getAllByLabelText('Agent request')).toHaveLength(1);
  });

  it('collapses canonical and legacy dual writes into one canonical-anchored receipt', () => {
    render(
      <EventTimeline
        nodes={[
          interactionNode(
            'full-legacy-request',
            'requested',
            'full-dual-write',
            {
              eventType: 'legacy.ask',
              legacyStep: 'ask',
              prompt: 'Which source should I use?',
            }
          ),
          interactionNode(
            'full-canonical-request',
            'requested',
            'full-dual-write',
            { prompt: 'Which source should I use?' }
          ),
          interactionNode(
            'full-canonical-resolution',
            'responded',
            'full-dual-write',
            { response: 'Use the finance workbook' }
          ),
          correlatedHumanReplyNode(
            'full-legacy-resolution',
            'Use the finance workbook',
            'full-dual-write'
          ),
        ]}
      />
    );

    const item = screen.getByRole('listitem');
    const card = screen.getByLabelText('Agent request');
    expect(item).toHaveAttribute(
      'data-event-node-id',
      'full-canonical-request'
    );
    expect(item).toHaveAttribute(
      'data-interaction-resolution-event-id',
      'event-full-canonical-resolution'
    );
    expect(card).toHaveTextContent('Use the finance workbook');
    expect(screen.queryByLabelText('Your message')).not.toBeInTheDocument();
  });

  it('folds duplicate durable and live legacy ASK mirrors into one request', () => {
    render(
      <EventTimeline
        nodes={[
          interactionNode(
            'ambiguous-canonical-request',
            'requested',
            'ambiguous-request',
            { prompt: 'Continue the regression test?' }
          ),
          interactionNode(
            'ambiguous-legacy-request-one',
            'requested',
            'ambiguous-request',
            {
              eventType: 'legacy.ask',
              legacyStep: 'ask',
              prompt: 'Continue the regression test?',
            }
          ),
          // The live lane frame has no `event_type` of its own, so it reaches
          // the projection as `legacy.step` rather than the durable
          // `legacy.ask`. Both are the same shadow lane.
          interactionNode(
            'ambiguous-legacy-request-two',
            'requested',
            'ambiguous-request',
            {
              eventType: 'legacy.step',
              legacyStep: 'ask',
              prompt: 'Continue the regression test?',
            }
          ),
        ]}
      />
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getAllByLabelText('Agent request')).toHaveLength(1);
    expect(screen.getByRole('listitem')).toHaveAttribute(
      'data-event-node-id',
      'ambiguous-canonical-request'
    );
  });

  it('folds a live ASK frame that normalizes to the unnamed legacy namespace', () => {
    // A live `/chat` frame carries no `event_type`, so it normalizes to
    // `legacy.step` rather than `legacy.ask`, and only the legacy lane puts the
    // requesting agent at the payload top level. Treating that frame as
    // canonical made it a second canonical request whose signature disagreed
    // with the typed one, which suppressed the fold and left one pending row
    // per lane instead of a single resolved receipt.
    render(
      <EventTimeline
        nodes={[
          // The live frame arrives first; the durable replay follows it.
          interactionNode('approval-live-mirror', 'requested', 'approval-1', {
            eventType: 'legacy.step',
            legacyStep: 'ask',
            interactionType: 'approval',
            prompt: 'The agent wants to run shell_exec (process.spawn).',
            agentName: 'single_agent',
          }),
          // The typed request carries no top-level agent, so it does not match
          // the mirrors field for field. A mirror must still fold into it.
          interactionNode('approval-canonical', 'requested', 'approval-1', {
            eventType: 'approval.requested',
            interactionType: 'approval',
            prompt: 'The agent wants to run shell_exec (process.spawn).',
          }),
          interactionNode(
            'approval-durable-mirror',
            'requested',
            'approval-1',
            {
              eventType: 'legacy.ask',
              legacyStep: 'ask',
              interactionType: 'approval',
              prompt: 'The agent wants to run shell_exec (process.spawn).',
              agentName: 'single_agent',
            }
          ),
          interactionNode('approval-decided', 'responded', 'approval-1', {
            eventType: 'approval.decided',
            interactionType: 'approval',
            response: 'approved',
          }),
        ]}
      />
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getAllByLabelText('Agent request')).toHaveLength(1);
    expect(screen.getByRole('listitem')).toHaveAttribute(
      'data-event-node-id',
      'approval-canonical'
    );
    expect(screen.getByRole('listitem')).toHaveAttribute(
      'data-interaction-resolution-event-id',
      'event-approval-decided'
    );
  });

  it('keeps conflicting duplicate legacy ASK receipts visible', () => {
    render(
      <EventTimeline
        nodes={[
          interactionNode(
            'conflicting-canonical-request',
            'requested',
            'conflicting-request'
          ),
          interactionNode(
            'conflicting-legacy-request-one',
            'requested',
            'conflicting-request',
            {
              eventType: 'legacy.ask',
              legacyStep: 'ask',
              prompt: 'Continue?',
            }
          ),
          interactionNode(
            'conflicting-legacy-request-two',
            'requested',
            'conflicting-request',
            {
              eventType: 'legacy.ask',
              legacyStep: 'ask',
              prompt: 'Stop?',
            }
          ),
        ]}
      />
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getAllByLabelText('Agent request')).toHaveLength(3);
  });

  it('prefers one canonical receipt and suppresses its equal legacy mirror', () => {
    const sourceNodes = [
      interactionNode('dual-request', 'requested', 'dual-write-1'),
      interactionNode('dual-canonical', 'responded', 'dual-write-1', {
        response: 'Use quarterly metrics',
      }),
      correlatedHumanReplyNode(
        'dual-legacy-mirror',
        'Use quarterly metrics',
        'dual-write-1'
      ),
    ] as const;

    render(<EventTimeline nodes={sourceNodes} />);

    const card = screen.getByLabelText('Agent request');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(card).toHaveTextContent('Use quarterly metrics');
    expect(card).toHaveAttribute(
      'data-interaction-resolution-event-id',
      'event-dual-canonical'
    );
    expect(screen.queryByLabelText('Your message')).not.toBeInTheDocument();
    expect(sourceNodes).toHaveLength(3);
  });

  it('uses one explicit legacy mirror when the canonical receipt omits display text', () => {
    render(
      <EventTimeline
        nodes={[
          interactionNode('missing-copy-request', 'requested', 'missing-copy'),
          interactionNode(
            'missing-copy-canonical',
            'responded',
            'missing-copy'
          ),
          correlatedHumanReplyNode(
            'missing-copy-mirror',
            'Use the finance workbook',
            'missing-copy'
          ),
        ]}
      />
    );

    const card = screen.getByLabelText('Agent request');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(card).toHaveTextContent('Use the finance workbook');
    expect(card).toHaveAttribute(
      'data-interaction-resolution-event-id',
      'event-missing-copy-canonical'
    );
  });

  it('fails closed when a legacy mirror disagrees with the canonical answer', () => {
    render(
      <EventTimeline
        nodes={[
          interactionNode('conflict-request', 'requested', 'conflict-1'),
          interactionNode('conflict-canonical', 'responded', 'conflict-1', {
            response: 'Use dataset A',
          }),
          correlatedHumanReplyNode(
            'conflict-mirror',
            'Use dataset B',
            'conflict-1'
          ),
        ]}
      />
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getAllByLabelText('Agent request')).toHaveLength(2);
    expect(screen.getByLabelText('Your message')).toHaveTextContent(
      'Use dataset B'
    );
  });

  it('fails closed when canonical terminal receipts are duplicated', () => {
    render(
      <EventTimeline
        nodes={[
          interactionNode(
            'duplicate-terminal-request',
            'requested',
            'duplicate-terminal'
          ),
          interactionNode(
            'duplicate-terminal-one',
            'responded',
            'duplicate-terminal',
            { response: 'First answer' }
          ),
          interactionNode(
            'duplicate-terminal-two',
            'responded',
            'duplicate-terminal',
            { response: 'Second answer' }
          ),
        ]}
      />
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getAllByLabelText('Agent request')).toHaveLength(3);
  });

  it('keeps an uncorrelated human reply separate instead of guessing by adjacency', () => {
    render(
      <EventTimeline
        nodes={[
          interactionNode('continue-request', 'requested', 'continue-1', {
            prompt: 'Continue with the report?',
          }),
          messageNode('nearby-reply', 'user', 'Yes', 'legacy.human_reply'),
        ]}
      />
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByLabelText('Agent request')).toHaveAttribute(
      'data-interaction-status',
      'requested'
    );
    expect(screen.getByLabelText('Your message')).toHaveTextContent('Yes');
  });

  it('fails closed when an interaction id has ambiguous duplicate receipts', () => {
    render(
      <EventTimeline
        nodes={[
          interactionNode('request-one', 'requested', 'duplicate-id', {
            prompt: 'Question one',
          }),
          interactionNode('request-two', 'requested', 'duplicate-id', {
            prompt: 'Question two',
          }),
          interactionNode('resolution', 'responded', 'duplicate-id', {
            response: 'Ambiguous answer',
          }),
        ]}
      />
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getAllByLabelText('Agent request')).toHaveLength(3);
  });

  it('allows a product renderer to override one semantic node kind', () => {
    const registry = createEventRendererRegistry({
      message: ({ node }) => (
        <div data-testid="custom-message">Custom: {node.content}</div>
      ),
    });

    render(
      <EventTimeline
        nodes={[messageNode('message-1', 'assistant', 'Projected output')]}
        registry={registry}
      />
    );

    expect(screen.getByTestId('custom-message')).toHaveTextContent(
      'Custom: Projected output'
    );
  });

  it('selects related renderers from semantic node kinds', () => {
    const registry = createEventRendererRegistry({
      message: ({ node }) => (
        <div data-testid="message-kind-renderer">{node.content}</div>
      ),
      notice: ({ node }) => (
        <div data-testid="notice-kind-renderer">{node.content}</div>
      ),
    });

    render(
      <EventTimeline
        nodes={[
          messageNode('message-1', 'assistant', 'Message event'),
          noticeNode('notice-1', 'Notice event'),
        ]}
        registry={registry}
      />
    );

    expect(screen.getByTestId('message-kind-renderer')).toHaveTextContent(
      'Message event'
    );
    expect(screen.getByTestId('notice-kind-renderer')).toHaveTextContent(
      'Notice event'
    );
  });

  it('allows an exact event type to override its semantic kind renderer', () => {
    const eventTypeRegistry = createEventTypeRendererRegistry({
      'message.answer.completed': ({ node }) => (
        <div data-testid="event-type-renderer">
          {node.kind === 'message' ? node.content : node.eventType}
        </div>
      ),
    });

    render(
      <EventTimeline
        eventTypeRegistry={eventTypeRegistry}
        nodes={[
          messageNode(
            'message-special',
            'assistant',
            'Special answer',
            'message.answer.completed'
          ),
          messageNode(
            'message-default',
            'assistant',
            'Ordinary answer',
            'message.completed'
          ),
        ]}
      />
    );

    expect(screen.getByTestId('event-type-renderer')).toHaveTextContent(
      'Special answer'
    );
    expect(screen.getByLabelText("Eigent's reply")).toHaveTextContent(
      'Ordinary answer'
    );
  });

  it('does not resolve inherited object properties as event type renderers', () => {
    render(
      <EventTimeline
        eventTypeRegistry={createEventTypeRendererRegistry()}
        nodes={[
          messageNode(
            'message-1',
            'assistant',
            'Prototype-safe answer',
            'toString'
          ),
        ]}
      />
    );

    expect(screen.getByLabelText("Eigent's reply")).toHaveTextContent(
      'Prototype-safe answer'
    );
  });

  it('uses the narrative presentation policy for the narrative mode', () => {
    render(
      <EventTimeline
        detailLevel="narrative"
        nodes={[
          messageNode('message-1', 'assistant', 'Normal response'),
          activityNode('activity-1', 'Routine tool call', {
            detail: '{"internal":"payload"}',
          }),
          unknownNode(),
        ]}
      />
    );

    const timeline = screen.getByRole('list', {
      name: 'Chat event timeline',
    });
    expect(timeline).toHaveAttribute(
      'data-requested-detail-level',
      'narrative'
    );
    expect(timeline).toHaveAttribute(
      'data-effective-detail-level',
      'narrative'
    );
    expect(screen.getByLabelText("Eigent's reply")).toHaveTextContent(
      'Normal response'
    );
    expect(screen.getByText('Routine tool call')).toBeInTheDocument();
    expect(screen.queryByText('{"internal":"payload"}')).toBeNull();
    expect(screen.queryByText('future.super_event')).toBeNull();
  });

  it('applies a registered detail-level presentation policy', () => {
    const presentationPolicies = createChatTimelinePresentationPolicyRegistry({
      narrative: (nodes) => nodes.filter((node) => node.kind === 'notice'),
    });

    render(
      <EventTimeline
        detailLevel="narrative"
        nodes={[
          messageNode('message-1', 'assistant', 'Hidden by narrative policy'),
          noticeNode('notice-1', 'Compact milestone'),
        ]}
        presentationPolicies={presentationPolicies}
      />
    );

    const timeline = screen.getByRole('list', {
      name: 'Chat event timeline',
    });
    expect(timeline).toHaveAttribute(
      'data-effective-detail-level',
      'narrative'
    );
    expect(screen.queryByText('Hidden by narrative policy')).toBeNull();
    expect(screen.getByText('Compact milestone')).toBeInTheDocument();
  });

  it('falls back safely when a presentation policy fails', () => {
    const presentationPolicies = createChatTimelinePresentationPolicyRegistry({
      narrative: () => {
        throw new Error('narrative policy failed');
      },
    });

    render(
      <EventTimeline
        detailLevel="narrative"
        nodes={[messageNode('message-1', 'assistant', 'Preserved output')]}
        presentationPolicies={presentationPolicies}
      />
    );

    const timeline = screen.getByRole('list', {
      name: 'Chat event timeline',
    });
    expect(timeline).toHaveAttribute(
      'data-effective-detail-level',
      'trajectory'
    );
    expect(screen.getByLabelText("Eigent's reply")).toHaveTextContent(
      'Preserved output'
    );
  });

  it('does not expose unknown event payloads in its fallback', () => {
    render(<EventTimeline nodes={[unknownNode()]} />);

    const fallback = screen.getByRole('status', {
      name: 'Unsupported message',
    });
    expect(fallback).toHaveAttribute(
      'data-event-fallback',
      'unsupported-event'
    );
    expect(fallback).toHaveTextContent('future.super_event');
    expect(fallback).not.toHaveTextContent('must-not-leak');
  });

  it('warns that an unknown tool outcome must not be retried automatically', () => {
    render(
      <EventTimeline
        nodes={[
          activityNode('unknown-outcome', 'Send external message', {
            eventType: 'tool.outcome_unknown',
            status: 'outcome_unknown',
          }),
        ]}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The external action may have already happened'
    );
    expect(screen.getByText('outcome unknown')).toBeInTheDocument();
  });

  it('renders only a safe artifact name without exposing its full path', () => {
    render(<EventTimeline nodes={[artifactNode()]} />);

    const label = screen.getByText('report.md');
    expect(label).not.toHaveAttribute('title');
    expect(
      screen.queryByText('/Users/alice/private-project/report.md')
    ).toBeNull();
  });

  it('uses the safe fallback when no renderer is registered', () => {
    render(<EventRenderer node={unknownNode()} registry={{}} />);

    expect(
      screen.getByRole('status', { name: 'Unsupported message' })
    ).toHaveAttribute('data-event-fallback', 'missing-renderer');
  });

  it('isolates a renderer failure and continues rendering later nodes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onRendererError = vi.fn();
    const registry = createEventRendererRegistry({
      message: () => {
        throw new Error('renderer exploded');
      },
    });

    render(
      <EventTimeline
        nodes={[
          messageNode('message-1', 'assistant', 'Broken renderer'),
          noticeNode('notice-1', 'Run is still healthy'),
        ]}
        onRendererError={onRendererError}
        registry={registry}
      />
    );

    expect(
      screen.getByRole('status', { name: 'Unsupported message' })
    ).toHaveAttribute('data-event-fallback', 'renderer-error');
    expect(screen.getByText('Run is still healthy')).toBeInTheDocument();
    expect(onRendererError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'renderer exploded' }),
      { nodeId: 'message-1', nodeKind: 'message' },
      expect.objectContaining({ componentStack: expect.any(String) })
    );
  });

  it('renders a caller-owned empty state without creating an empty list', () => {
    render(
      <EventTimeline emptyState={<p>No projected events yet.</p>} nodes={[]} />
    );

    expect(screen.getByText('No projected events yet.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});
