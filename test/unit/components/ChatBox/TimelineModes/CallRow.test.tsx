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

import { CallRow } from '@/components/ChatBox/TimelineModes/CallRow';
import type { TimelineCall } from '@/lib/projector/chat/presentation';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

function humanCall(status: TimelineCall['status']): TimelineCall {
  return {
    id: 'question-1',
    runId: 'run-1',
    executor: 'human',
    title: 'You · Answer',
    actionKind: 'message',
    status,
    input: 'Which format should the report use?',
    inputLabel: 'Question',
    outputLabel: 'Answer',
    interactionId: 'interaction-1',
  } as TimelineCall;
}

describe('CallRow', () => {
  it('folds an answered question even after the user toggled it', () => {
    const { rerender } = render(
      <CallRow call={humanCall('pending')} runActive reducedMotion />
    );
    const trigger = screen.getByRole('button', { name: /You · Answer/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    rerender(<CallRow call={humanCall('completed')} runActive reducedMotion />);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps a manual choice on a call that was never pending', () => {
    const toolCall = {
      ...humanCall('running'),
      executor: 'toolkit',
      title: 'Search Toolkit · search',
      actionKind: 'search',
    } as TimelineCall;
    const { rerender } = render(
      <CallRow call={toolCall} runActive reducedMotion />
    );
    const trigger = screen.getByRole('button', { name: /Search Toolkit/ });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    rerender(
      <CallRow
        call={{ ...toolCall, status: 'completed' }}
        runActive
        reducedMotion
      />
    );
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });
});
