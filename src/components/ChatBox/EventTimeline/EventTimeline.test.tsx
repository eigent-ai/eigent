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

import { normalizeEvent } from '@/lib/projector';
import {
  adaptChatProjectionEvent,
  type ChatProjectionNode,
} from '@/lib/projector/chat';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EventRenderer } from './EventRenderer';
import { EventTimeline } from './EventTimeline';
import { createChatTimelinePresentationPolicyRegistry } from './presentationPolicy';
import {
  createEventRendererRegistry,
  createEventTypeRendererRegistry,
} from './rendererRegistry';

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
  title: string
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
  };
}

function noticeNode(id: string, content: string): ChatProjectionNode {
  return {
    ...commonNode,
    id,
    eventId: `event-${id}`,
    kind: 'notice',
    severity: 'info',
    content,
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
    expect(screen.getByLabelText('User message')).toHaveTextContent(
      'Start the Run'
    );
    expect(screen.getByLabelText('Assistant message')).toHaveTextContent(
      'Working on it'
    );
    expect(screen.getByLabelText('User message')).toHaveClass('rounded-br-sm');
    expect(screen.getByLabelText('User message').parentElement).toHaveClass(
      'pl-16'
    );
    expect(screen.getByLabelText('Assistant message')).not.toHaveClass(
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
    const card = screen.getByLabelText('Agent input');
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

    const card = screen.getByLabelText('Agent input');
    expect(card).toHaveTextContent('Input required');
    expect(card).not.toHaveTextContent(
      'Which dataset should I use while pending?'
    );
  });

  it('keeps an input receipt at its request position inside later work-log activity', () => {
    render(
      <EventTimeline
        nodes={[
          activityNode('preparing-agent', 'Preparing agent'),
          activityNode('human-toolkit', 'Human Toolkit'),
          interactionNode('input-request', 'requested', 'input-1', {
            prompt: 'Which dataset should I use?',
          }),
          activityNode('todo-toolkit-one', 'Todo Toolkit: first item'),
          activityNode('todo-toolkit-two', 'Todo Toolkit: second item'),
          interactionNode('input-resolution', 'responded', 'input-1', {
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

    const card = screen.getByLabelText('Agent input');
    expect(card).toHaveTextContent('Input required');
    expect(card).toHaveTextContent('Which dataset should I use?');
    expect(card).toHaveTextContent('Quarterly metrics');
  });

  it('never merges interaction receipts across ids or runs', () => {
    render(
      <EventTimeline
        nodes={[
          interactionNode('request-a', 'requested', 'interaction-a', {
            prompt: 'First question',
            runId: 'run-1',
          }),
          interactionNode('resolution-b', 'responded', 'interaction-b', {
            response: 'Answer for another interaction',
            runId: 'run-1',
          }),
          interactionNode(
            'resolution-a-other-run',
            'responded',
            'interaction-a',
            { response: 'Answer from another run', runId: 'run-2' }
          ),
        ]}
      />
    );

    const cards = screen.getAllByLabelText('Agent input');
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

    const card = screen.getByLabelText('Agent input');
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

    const card = screen.getByLabelText('Agent input');
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
    expect(screen.getAllByLabelText('Agent input')).toHaveLength(1);
  });

  it('recognizes the normalized legacy.step ASK dual-write mirror', () => {
    const normalizedLegacyRequest = adaptChatProjectionEvent(
      normalizeEvent({
        event_id: 'event-normalized-legacy-request',
        project_id: 'project-1',
        run_id: 'run-1',
        run_sequence: 1,
        run_version: 1,
        event_type: 'legacy.step',
        legacy_step: 'ask',
        payload: {
          interaction_id: 'normalized-dual-request',
          question: 'Which format should I use?',
        },
        created_at: '2026-08-11T10:00:00Z',
      })
    );

    render(
      <EventTimeline
        nodes={[
          normalizedLegacyRequest,
          interactionNode(
            'normalized-canonical-request',
            'requested',
            'normalized-dual-request',
            { prompt: 'Which format should I use?' }
          ),
        ]}
      />
    );

    const item = screen.getByRole('listitem');
    expect(item).toHaveAttribute(
      'data-event-node-id',
      'normalized-canonical-request'
    );
    expect(screen.getAllByLabelText('Agent input')).toHaveLength(1);
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
    const card = screen.getByLabelText('Agent input');
    expect(item).toHaveAttribute(
      'data-event-node-id',
      'full-canonical-request'
    );
    expect(item).toHaveAttribute(
      'data-interaction-resolution-event-id',
      'event-full-canonical-resolution'
    );
    expect(card).toHaveTextContent('Use the finance workbook');
    expect(screen.queryByLabelText('User message')).not.toBeInTheDocument();
  });

  it('fails closed when a request has multiple legacy ASK mirrors', () => {
    render(
      <EventTimeline
        nodes={[
          interactionNode(
            'ambiguous-canonical-request',
            'requested',
            'ambiguous-request'
          ),
          interactionNode(
            'ambiguous-legacy-request-one',
            'requested',
            'ambiguous-request',
            { eventType: 'legacy.ask', legacyStep: 'ask' }
          ),
          interactionNode(
            'ambiguous-legacy-request-two',
            'requested',
            'ambiguous-request',
            { eventType: 'legacy.ask', legacyStep: 'ask' }
          ),
        ]}
      />
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getAllByLabelText('Agent input')).toHaveLength(3);
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

    const card = screen.getByLabelText('Agent input');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(card).toHaveTextContent('Use quarterly metrics');
    expect(card).toHaveAttribute(
      'data-interaction-resolution-event-id',
      'event-dual-canonical'
    );
    expect(screen.queryByLabelText('User message')).not.toBeInTheDocument();
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

    const card = screen.getByLabelText('Agent input');
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
    expect(screen.getAllByLabelText('Agent input')).toHaveLength(2);
    expect(screen.getByLabelText('User message')).toHaveTextContent(
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
    expect(screen.getAllByLabelText('Agent input')).toHaveLength(3);
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
    expect(screen.getByLabelText('Agent input')).toHaveAttribute(
      'data-interaction-status',
      'requested'
    );
    expect(screen.getByLabelText('User message')).toHaveTextContent('Yes');
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
    expect(screen.getAllByLabelText('Agent input')).toHaveLength(3);
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
    expect(screen.getByLabelText('Assistant message')).toHaveTextContent(
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

    expect(screen.getByLabelText('Assistant message')).toHaveTextContent(
      'Prototype-safe answer'
    );
  });

  it('falls back to detailed presentation for a reserved detail level', () => {
    render(
      <EventTimeline
        detailLevel="compact"
        nodes={[messageNode('message-1', 'assistant', 'Detailed for now')]}
      />
    );

    const timeline = screen.getByRole('list', {
      name: 'Chat event timeline',
    });
    expect(timeline).toHaveAttribute('data-requested-detail-level', 'compact');
    expect(timeline).toHaveAttribute('data-effective-detail-level', 'detailed');
    expect(screen.getByLabelText('Assistant message')).toHaveTextContent(
      'Detailed for now'
    );
  });

  it('applies a registered detail-level presentation policy', () => {
    const presentationPolicies = createChatTimelinePresentationPolicyRegistry({
      compact: (nodes) => nodes.filter((node) => node.kind === 'notice'),
    });

    render(
      <EventTimeline
        detailLevel="compact"
        nodes={[
          messageNode('message-1', 'assistant', 'Hidden by compact policy'),
          noticeNode('notice-1', 'Compact milestone'),
        ]}
        presentationPolicies={presentationPolicies}
      />
    );

    const timeline = screen.getByRole('list', {
      name: 'Chat event timeline',
    });
    expect(timeline).toHaveAttribute('data-effective-detail-level', 'compact');
    expect(screen.queryByText('Hidden by compact policy')).toBeNull();
    expect(screen.getByText('Compact milestone')).toBeInTheDocument();
  });

  it('falls back safely when a presentation policy fails', () => {
    const presentationPolicies = createChatTimelinePresentationPolicyRegistry({
      summarized: () => {
        throw new Error('summary policy failed');
      },
    });

    render(
      <EventTimeline
        detailLevel="summarized"
        nodes={[messageNode('message-1', 'assistant', 'Preserved output')]}
        presentationPolicies={presentationPolicies}
      />
    );

    const timeline = screen.getByRole('list', {
      name: 'Chat event timeline',
    });
    expect(timeline).toHaveAttribute('data-effective-detail-level', 'detailed');
    expect(screen.getByLabelText('Assistant message')).toHaveTextContent(
      'Preserved output'
    );
  });

  it('does not expose unknown event payloads in its fallback', () => {
    render(<EventTimeline nodes={[unknownNode()]} />);

    const fallback = screen.getByRole('status', {
      name: 'Unsupported chat event',
    });
    expect(fallback).toHaveAttribute(
      'data-event-fallback',
      'unsupported-event'
    );
    expect(fallback).toHaveTextContent('future.super_event');
    expect(fallback).not.toHaveTextContent('must-not-leak');
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
      screen.getByRole('status', { name: 'Unsupported chat event' })
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
      screen.getByRole('status', { name: 'Unsupported chat event' })
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
