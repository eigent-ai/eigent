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

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// The rated content itself is irrelevant here: the action row only appears once
// the message reports that typing and markdown rendering finished.
vi.mock('@/components/ChatBox/MessageItem/MarkDown', async () => {
  const { useEffect } = await import('react');
  return {
    MarkDown: ({
      onTyping,
      onMarkdownRenderComplete,
    }: {
      onTyping?: () => void;
      onMarkdownRenderComplete?: () => void;
    }) => {
      useEffect(() => {
        onTyping?.();
        onMarkdownRenderComplete?.();
      }, [onTyping, onMarkdownRenderComplete]);
      return null;
    },
  };
});

import { AgentMessageCard } from '@/components/ChatBox/MessageItem/AgentMessageCard';
import { subscribeAppEvents, type AppEvent } from '@/lib/events/appEvents';

describe('AgentMessageCard feedback', () => {
  let events: AppEvent[] = [];
  let unsubscribe: () => void = () => {};

  beforeEach(() => {
    events = [];
    unsubscribe = subscribeAppEvents((event) => {
      events.push(event);
    });
  });

  afterEach(() => {
    unsubscribe();
  });

  it('emits a rated app event for a thumb up', () => {
    render(
      <AgentMessageCard
        id="message-up"
        content="Final answer"
        messageStep="end"
        typewriter={false}
      />
    );

    fireEvent.click(screen.getByLabelText('Thumb up'));

    expect(events).toEqual([
      expect.objectContaining({
        name: 'message_feedback',
        properties: {
          rating: 'up',
          message_id: 'message-up',
          message_step: 'end',
        },
      }),
    ]);
  });

  it('emits the logical message and Run identities instead of the render id', () => {
    render(
      <AgentMessageCard
        id="event-node-up"
        content="Final answer"
        feedbackMessageId="logical-message-up"
        feedbackRunId="run-up"
        messageStep="end"
        typewriter={false}
      />
    );

    fireEvent.click(screen.getByLabelText('Thumb up'));

    expect(events).toEqual([
      expect.objectContaining({
        name: 'message_feedback',
        properties: {
          rating: 'up',
          message_id: 'logical-message-up',
          run_id: 'run-up',
          message_step: 'end',
        },
      }),
    ]);
  });

  it('emits a rated app event for a thumb down', () => {
    render(
      <AgentMessageCard
        id="message-down"
        content="Final answer"
        messageStep="agent_end"
        typewriter={false}
      />
    );

    fireEvent.click(screen.getByLabelText('Thumb down'));

    expect(events).toEqual([
      expect.objectContaining({
        name: 'message_feedback',
        properties: {
          rating: 'down',
          message_id: 'message-down',
          message_step: 'agent_end',
        },
      }),
    ]);
  });

  it('records one rating per message', () => {
    render(
      <AgentMessageCard
        id="message-once"
        content="Final answer"
        typewriter={false}
      />
    );

    fireEvent.click(screen.getByLabelText('Thumb up'));
    fireEvent.click(screen.getByLabelText('Thumb up'));

    expect(events).toHaveLength(1);
  });

  it('does not record the same logical message again after a remount', () => {
    const card = (
      <AgentMessageCard
        id="event-node-once"
        content="Final answer"
        feedbackMessageId="logical-message-once"
        feedbackRunId="run-once"
        typewriter={false}
      />
    );
    const firstRender = render(card);

    fireEvent.click(screen.getByLabelText('Thumb up'));
    firstRender.unmount();
    render(card);

    expect(screen.getByLabelText('Thumb up')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByLabelText('Thumb down')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Thumb up'));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: 'message_feedback',
      properties: {
        message_id: 'logical-message-once',
        run_id: 'run-once',
      },
    });
  });
});
