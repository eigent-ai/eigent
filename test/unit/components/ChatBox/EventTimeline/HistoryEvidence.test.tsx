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

import { EventTimeline } from '@/components/ChatBox/EventTimeline/EventTimeline';
import { partitionLegacyReplyEvidence } from '@/components/ChatBox/EventTimeline/legacyReplyEvidence';
import { normalizeLocalRunEvent } from '@/lib/projector';
import { projectChatEvents } from '@/lib/projector/chat';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { v104GuiInputEvents } from '../../../../fixtures/v104GuiInput';

function project(events = v104GuiInputEvents()) {
  return projectChatEvents(
    'project-1',
    events.map((event) => normalizeLocalRunEvent(event, 'project-1'))
  ).nodes;
}

describe('unlinked legacy input evidence', () => {
  it('shows one canonical receipt and retains the actual v1.0.4 mirror behind a keyboard-accessible disclosure', async () => {
    const nodes = project();
    const original = structuredClone(nodes);
    render(<EventTimeline nodes={nodes} />);
    const main = screen.getByRole('list', { name: 'Chat event timeline' });
    expect(within(main).getAllByRole('listitem')).toHaveLength(1);
    expect(within(main).getByText('report.csv')).toBeVisible();
    expect(within(main).queryByLabelText('Your message')).toBeNull();
    const trigger = screen.getByRole('button', {
      name: 'History evidence (1)',
    });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const evidence = screen.getByRole('region', {
      name: 'History evidence (1)',
    });
    expect(within(evidence).getAllByRole('listitem')).toHaveLength(1);
    expect(within(evidence).getByText('report.csv')).toBeVisible();
    await userEvent.keyboard(' ');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(nodes).toEqual(original);
  });

  it('retains every unlinked reply including equal text, without assigning interaction identity', () => {
    const nodes = project(
      v104GuiInputEvents(['report.csv', 'report.csv', 'other.csv'])
    );
    render(<EventTimeline nodes={nodes} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'History evidence (3)' })
    );
    const evidence = screen.getByRole('region', {
      name: 'History evidence (3)',
    });
    expect(
      within(evidence)
        .getAllByRole('listitem')
        .map((item) => item.textContent)
    ).toEqual(['report.csv', 'report.csv', 'other.csv']);
    expect(
      partitionLegacyReplyEvidence(nodes).evidence.every(
        (node) => !node.interactionId
      )
    ).toBe(true);
  });

  it('preserves standalone legacy replies in the conversation when no canonical response exists', () => {
    const nodes = project(
      v104GuiInputEvents(['report.csv', 'report.csv']).filter(
        (event) => event.event_type === 'legacy.human_reply'
      )
    );
    render(<EventTimeline nodes={nodes} />);
    expect(screen.getAllByLabelText('Your message')).toHaveLength(2);
    expect(
      screen.queryByRole('button', { name: /History evidence/ })
    ).toBeNull();
  });

  it('moves evidence when a canonical response arrives later and restores standalone presentation if the source slice changes', () => {
    const nodes = project();
    const legacy = nodes.filter((node) => node.kind === 'message');
    const { rerender } = render(<EventTimeline nodes={legacy} />);
    expect(screen.getByLabelText('Your message')).toBeVisible();
    rerender(
      <EventTimeline
        nodes={[...legacy, ...nodes.filter((node) => node.kind !== 'message')]}
      />
    );
    expect(screen.queryByLabelText('Your message')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'History evidence (1)' })
    ).toBeVisible();
    rerender(<EventTimeline nodes={legacy} />);
    expect(screen.getByLabelText('Your message')).toBeVisible();
  });

  it.each(['runId', 'projectId'] as const)(
    'does not move replies across a %s boundary',
    (scope) => {
      const nodes = project().map((node) =>
        node.kind === 'message' ? { ...node, [scope]: 'other' } : node
      );
      expect(partitionLegacyReplyEvidence(nodes).evidence).toHaveLength(0);
      expect(partitionLegacyReplyEvidence(nodes).nodes).toHaveLength(3);
    }
  );

  it('keeps explicitly correlated replies in the existing canonical receipt path', () => {
    const nodes = project().map((node) =>
      node.kind === 'message'
        ? { ...node, interactionId: 'gui-question', interactionResponse: true }
        : node
    );
    render(<EventTimeline nodes={nodes} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(
      screen.queryByRole('button', { name: /History evidence/ })
    ).toBeNull();
  });
});
