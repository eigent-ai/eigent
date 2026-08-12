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

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HumanInteractionCard,
  isHumanInteractionReadOnly,
} from './HumanInteractionCard';

const mocks = vi.hoisted(() => ({
  decideHumanInteraction: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/service/humanInteractionApi', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/service/humanInteractionApi')>();
  return {
    ...original,
    decideHumanInteraction: mocks.decideHumanInteraction,
  };
});

vi.mock('@/store/authStore', () => ({
  getAuthStore: () => ({
    language: 'en-US',
    setLanguage: vi.fn(),
  }),
  useAuthStore: (selector: (state: { user_id: number }) => unknown): unknown =>
    selector({ user_id: 42 }),
}));

vi.mock('sonner', () => ({
  toast: { error: mocks.toastError },
}));

const approvalInteraction = {
  interaction_id: 'approval-1',
  interaction_type: 'approval' as const,
  run_id: 'run-1',
  version: 0,
  action_digest: 'a'.repeat(64),
  title: 'Allow todo_write?',
  question: 'The agent wants to run todo_write.',
  allowed_scopes: ['once' as const],
};

describe('HumanInteractionCard', () => {
  beforeEach(() => {
    mocks.decideHumanInteraction.mockReset();
    mocks.decideHumanInteraction.mockResolvedValue({ status: 'resolved' });
    mocks.toastError.mockReset();
  });

  it('keeps a waiting durable approval actionable after replay reattachment', async () => {
    const readOnly = isHumanInteractionReadOnly({
      interaction: approvalInteraction,
      activeTaskId: 'run-1',
      taskType: 'replay',
      taskStatus: 'finished',
      durableRunStatus: 'waiting_for_user',
    });
    expect(readOnly).toBe(false);

    const onResolved = vi.fn();
    render(
      <HumanInteractionCard
        interaction={approvalInteraction}
        readOnly={readOnly}
        onResolved={onResolved}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));

    await waitFor(() =>
      expect(mocks.decideHumanInteraction).toHaveBeenCalledWith(
        approvalInteraction,
        expect.objectContaining({
          decision: { decision: 'approved', scope: 'once' },
          actorId: 42,
        })
      )
    );
    expect(onResolved).toHaveBeenCalledWith('Approved once');
    expect(screen.queryByText('Allow todo_write?')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Approve once' })
    ).not.toBeInTheDocument();
  });

  it('keeps terminal replay history read-only', () => {
    const readOnly = isHumanInteractionReadOnly({
      interaction: approvalInteraction,
      activeTaskId: 'run-1',
      taskType: 'replay',
      taskStatus: 'finished',
      durableRunStatus: 'completed',
    });
    render(
      <HumanInteractionCard
        interaction={approvalInteraction}
        readOnly={readOnly}
      />
    );

    expect(screen.getByRole('button', { name: 'Approve once' })).toBeDisabled();
  });

  it('shows progress and keeps a timeline receipt mounted after approval', async () => {
    let resolveDecision: (() => void) | undefined;
    mocks.decideHumanInteraction.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDecision = resolve;
        })
    );
    const onResolved = vi.fn();

    render(
      <HumanInteractionCard
        interaction={approvalInteraction}
        onResolved={onResolved}
        timelineReceipt
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));

    expect(screen.getByRole('button', { name: 'Approving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Saving decision…');

    resolveDecision?.();

    await waitFor(() => {
      expect(screen.getByText('Decision saved')).toBeInTheDocument();
    });
    expect(screen.getByText('Approved once')).toBeInTheDocument();
    expect(onResolved).toHaveBeenCalledWith('Approved once');
  });

  it('offers a Space-scoped approval for an exact opaque tool matcher', async () => {
    const toolInteraction = {
      ...approvalInteraction,
      // Legacy cards deliberately hide Run scope because a Project can contain
      // multiple Runs; event-native BottomBox owns Run-scoped decisions.
      allowed_scopes: ['once', 'run', 'space'] as const,
      rule_matcher: {
        action_pattern: 'mcp.tool.write',
        resource_pattern: 'tool-identity:sha256:abc',
        matcher_kind: 'literal_tool',
      },
    };
    render(<HumanInteractionCard interaction={toolInteraction} />);

    expect(
      screen.queryByRole('button', { name: 'Allow for this Run' })
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Always allow this tool in Space',
      })
    );

    await waitFor(() =>
      expect(mocks.decideHumanInteraction).toHaveBeenCalledWith(
        toolInteraction,
        expect.objectContaining({
          decision: { decision: 'approved', scope: 'space' },
        })
      )
    );
  });

  it('shows the durable API rejection inline and allows retrying', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mocks.decideHumanInteraction.mockRejectedValueOnce(
      new Error('Approval version changed')
    );
    render(<HumanInteractionCard interaction={approvalInteraction} />);

    fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Approval version changed'
    );
    expect(mocks.toastError).toHaveBeenCalledWith('Approval version changed');
    expect(screen.getByRole('button', { name: 'Approve once' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));
    await waitFor(() => {
      expect(mocks.decideHumanInteraction).toHaveBeenCalledTimes(2);
    });
    consoleError.mockRestore();
  });

  it('only renders persistent approval actions offered by the backend', () => {
    render(<HumanInteractionCard interaction={approvalInteraction} />);

    expect(
      screen.queryByRole('button', { name: 'Allow for this Run' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Always allow in Space' })
    ).not.toBeInTheDocument();
  });

  it('renders a resolved question and its composer answer as one card', () => {
    render(
      <HumanInteractionCard
        interaction={{
          interaction_id: 'question-1',
          interaction_type: 'question',
          run_id: 'run-1',
          title: 'Input required',
          question: 'Which market should I use?',
        }}
        response="The UK market"
      />
    );

    expect(screen.getByText('Which market should I use?')).toBeInTheDocument();
    expect(screen.getByText('Your response')).toBeInTheDocument();
    expect(screen.getByText('The UK market')).toBeInTheDocument();
    expect(
      screen.getByText('The UK market').closest('[data-interaction-response]')
    ).toBeInTheDocument();
  });

  it('renders the question and answer together in a timeline receipt', () => {
    render(
      <HumanInteractionCard
        interaction={{
          interaction_id: 'choice-timeline',
          interaction_type: 'choice',
          run_id: 'run-1',
          question: 'Choose a private deployment region',
          options: [{ option_id: 'uk', label: 'United Kingdom' }],
        }}
        response="United Kingdom"
        timelineReceipt
      />
    );

    expect(screen.getByText('Input required')).toBeInTheDocument();
    expect(
      screen.getByText('Choose a private deployment region')
    ).toBeInTheDocument();
    expect(screen.getByText('United Kingdom')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'United Kingdom' })
    ).not.toBeInTheDocument();
  });

  it('keeps the question out of a pending timeline receipt', () => {
    render(
      <HumanInteractionCard
        interaction={{
          interaction_id: 'choice-pending',
          interaction_type: 'choice',
          run_id: 'run-1',
          question: 'Choose a pending deployment region',
          options: [{ option_id: 'uk', label: 'United Kingdom' }],
        }}
        timelineReceipt
      />
    );

    expect(screen.getByText('Input required')).toBeInTheDocument();
    expect(
      screen.queryByText('Choose a pending deployment region')
    ).not.toBeInTheDocument();
  });

  it('shows the selected choice label after submitting a timeline receipt', async () => {
    const onResolved = vi.fn();

    render(
      <HumanInteractionCard
        interaction={{
          interaction_id: 'choice-1',
          interaction_type: 'choice',
          run_id: 'run-1',
          question: 'Pick one',
          options: [{ option_id: 'option-a', label: 'Option A', value: 'a' }],
        }}
        onResolved={onResolved}
        timelineReceipt
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Option A' }));

    await waitFor(() => {
      expect(screen.getByText('Your response')).toBeInTheDocument();
    });
    expect(screen.getByText('Option A')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Option A' })).toBeNull();
    expect(onResolved).toHaveBeenCalledWith('Option A');
  });
});
