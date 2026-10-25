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

import { HumanDecisionCard } from '@/components/ChatBox/BottomBox/HumanDecisionCard';
import type { BottomBoxApprovalVariant } from '@/components/ChatBox/BottomBox/types';
import { useEventNativeHumanControl } from '@/components/ChatBox/BottomBox/useEventNativeHumanControl';
import type { HumanControlInteraction } from '@/lib/projector/control';
import {
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  interaction: null as HumanControlInteraction | null,
}));

vi.mock('@/hooks/useProjectEventView', () => ({
  useProjectHumanControlProjection: () =>
    mocks.interaction
      ? {
          projectId: mocks.interaction.projectId,
          interactionById: {
            [mocks.interaction.interactionId]: mocks.interaction,
          },
          orderedInteractionIds: [mocks.interaction.interactionId],
          seenEventIds: {},
        }
      : null,
}));

vi.mock('@/service/humanInteractionApi', () => ({
  decideHumanInteraction: vi.fn(),
}));

vi.mock('@/service/humanInteractionEventReconciliation', () => ({
  reconcileHumanInteractionEvents: vi.fn(),
}));

vi.mock('@/store/authStore', () => ({
  getAuthStore: () => ({ user_id: 42 }),
  useAuthStore: (selector: (state: { user_id: number }) => unknown) =>
    selector({ user_id: 42 }),
}));

function approval(
  onApprove: BottomBoxApprovalVariant['onApprove']
): BottomBoxApprovalVariant {
  return {
    kind: 'approval',
    header: { title: 'Allow this action?' },
    options: [{ scope: 'once', label: 'Approve once' }],
    onApprove,
    onReject: vi.fn(),
  };
}

describe('HumanDecisionCard', () => {
  it('shows the approval type, title, target and arguments above its controls', () => {
    const { container } = render(
      <HumanDecisionCard
        requestKey="run:approval-1"
        variant={{
          ...approval(vi.fn()),
          header: {
            eyebrow: 'Input required',
            title: 'Run shell_exec?',
            description: 'Technical context',
            contextItems: [{ id: 'agent', label: 'single_agent' }],
            details: [
              { id: 'args', label: 'Review details', content: 'secret' },
            ],
          },
        }}
      />
    );

    expect(screen.getByText('Input required')).toBeInTheDocument();
    expect(screen.getByText('Run shell_exec?')).toBeInTheDocument();
    expect(screen.queryByText('Technical context')).not.toBeInTheDocument();
    expect(screen.getByText('single_agent')).toBeInTheDocument();
    expect(screen.getByText('Review details')).toBeInTheDocument();
    const card = container.querySelector('[data-human-decision-card]');
    expect(card).toHaveClass(
      'rounded-ds-card',
      'border',
      'border-ds-hairline-default-default'
    );
    expect(card).not.toHaveClass('shadow-ds-elevation-popover');
    const approvalSurface = container.querySelector('[data-approval-surface]');
    expect(approvalSurface).not.toHaveClass('border');
    expect(approvalSurface).not.toHaveClass('border-x');
    expect(approvalSurface).not.toHaveClass('border-y');
    expect(
      screen.queryByText('This action supports one-time approval only.')
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Approve once' })
    ).toBeInTheDocument();
  });

  it('shows the target and arguments of an event-native approval', () => {
    mocks.interaction = {
      interactionId: 'approval-1',
      interactionType: 'approval',
      status: 'requested',
      projectId: 'project-1',
      runId: 'run-1',
      sequence: 3,
      lastSequence: 3,
      cloudCursor: null,
      lastCloudCursor: null,
      requestEventId: 'request-1',
      requestSource: 'canonical',
      lastEventId: 'request-1',
      requestedAt: '2026-08-11T10:00:03.000Z',
      updatedAt: '2026-08-11T10:00:03.000Z',
      version: 0,
      approvalId: 'approval-1',
      actionDigest: 'digest-1',
      allowedScopes: ['once'],
      title: 'Allow shell_exec?',
      prompt: 'The agent wants to run shell_exec (terminal.exec).',
      agent: 'developer_agent',
      operation: 'terminal.exec',
      targetResources: ['notes/plan.md'],
      displayArguments: { command: 'rm -rf build' },
      ruleMatcher: null,
      options: [],
      fields: [],
    };
    const { result } = renderHook(() =>
      useEventNativeHumanControl({
        projectId: 'project-1',
        activeRunId: 'run-1',
      })
    );
    const variant = result.current.variant;
    if (variant?.kind !== 'approval') throw new Error('Expected an approval');

    const { container } = render(
      <HumanDecisionCard requestKey="run-1:approval-1" variant={variant} />
    );

    expect(
      screen.getByText('The agent wants to run shell_exec (terminal.exec).')
    ).toBeInTheDocument();
    expect(screen.getByText('notes/plan.md')).toBeInTheDocument();
    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(
      within(details as HTMLElement).getByText(
        'Review details (sensitive values hidden)'
      )
    ).toBeInTheDocument();
    expect(details).toHaveTextContent('rm -rf build');
  });

  it('keeps a failed approval decision visible without restoring technical context', () => {
    render(
      <HumanDecisionCard
        requestKey="run:approval-error"
        variant={{
          ...approval(vi.fn()),
          header: { eyebrow: 'Input required', title: 'Run shell_exec?' },
          error: 'Approval could not be submitted.',
        }}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Approval could not be submitted.'
    );
  });

  it('keeps question editing and Enter submission active, with blank answers disabled', () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    const variant = {
      kind: 'feedback' as const,
      presentation: 'question' as const,
      header: {
        title: 'Question',
        description: 'Which format would you like?',
      },
      value: 'A concise report',
      onChange,
      onSubmit,
    };
    const { rerender } = render(
      <HumanDecisionCard requestKey="run:question-1" variant={variant} />
    );
    const answer = screen.getByRole('textbox', { name: 'Feedback' });
    expect(answer.closest('[data-human-decision-card]')).toHaveClass(
      'rounded-3xl',
      'border',
      'border-ds-border-information-default-default'
    );
    expect(answer.closest('[data-human-decision-card]')).not.toHaveClass(
      'shadow-ds-elevation-popover'
    );
    fireEvent.change(answer, { target: { value: 'A detailed report' } });
    expect(onChange).toHaveBeenCalledWith('A detailed report');
    fireEvent.keyDown(answer, { key: 'Enter', shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(answer, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledOnce();
    rerender(
      <HumanDecisionCard
        requestKey="run:question-1"
        variant={{ ...variant, value: '   ' }}
      />
    );
    expect(
      screen.getByRole('button', { name: 'Send feedback' })
    ).toBeDisabled();
    fireEvent.keyDown(answer, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('requires a separate review action for a successor after the first request settles', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <HumanDecisionCard requestKey="run:request-1" variant={approval(first)} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));
    expect(first).toHaveBeenCalledOnce();

    rerender(<HumanDecisionCard requestKey={null} variant={null} />);
    rerender(
      <HumanDecisionCard
        requestKey="run:request-2"
        variant={approval(second)}
      />
    );
    expect(screen.queryByRole('button', { name: 'Approve once' })).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Review next request' })
    );
    expect(second).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));
    expect(second).toHaveBeenCalledOnce();
  });
});
