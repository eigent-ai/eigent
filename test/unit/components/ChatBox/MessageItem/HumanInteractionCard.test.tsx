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

import {
  HumanInteractionCard,
  isHumanInteractionReadOnly,
} from '@/components/ChatBox/MessageItem/HumanInteractionCard';
import {
  isHumanInteractionStillPending,
  type HumanInteractionPayload,
} from '@/service/humanInteractionApi';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  decideHumanInteraction: vi.fn(),
  isHumanInteractionStillPending: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/service/humanInteractionApi', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/service/humanInteractionApi')>();
  return {
    ...original,
    decideHumanInteraction: mocks.decideHumanInteraction,
    isHumanInteractionStillPending: mocks.isHumanInteractionStillPending,
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

const approvalInteraction: HumanInteractionPayload = {
  interaction_id: 'approval-1',
  interaction_type: 'approval' as const,
  run_id: 'run-1',
  version: 0,
  action_digest: 'a'.repeat(64),
  title: 'Allow todo_write?',
  question: 'The agent wants to run todo_write.',
  allowed_scopes: ['once' as const],
};
const interaction = approvalInteraction;

describe('HumanInteractionCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.decideHumanInteraction.mockResolvedValue({ status: 'resolved' });
    mocks.isHumanInteractionStillPending.mockResolvedValue(false);
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

  it('keeps terminal replay history read-only', async () => {
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

    await waitFor(() =>
      expect(isHumanInteractionStillPending).toHaveBeenCalledWith(interaction)
    );
    expect(screen.getByRole('button', { name: 'Approve once' })).toBeDisabled();
  });

  it('keeps a current pending approval actionable while legacy replay flags are stale', () => {
    const readOnly = isHumanInteractionReadOnly({
      interaction,
      activeTaskId: 'run-1',
      taskType: 'replay',
      taskStatus: 'finished',
      durableRunStatus: undefined,
    });

    expect(readOnly).toBe(false);
  });

  it('renders an approval timeline receipt as only Input required', () => {
    const { container } = render(
      <HumanInteractionCard
        interaction={approvalInteraction}
        response="Approved once"
        timelineReceipt
      />
    );

    const receipt = container.querySelector('[data-approval-timeline-receipt]');
    expect(receipt).toHaveTextContent(/^Input required$/);
    expect(screen.queryByText(approvalInteraction.question!)).toBeNull();
    expect(screen.queryByText('Your response')).toBeNull();
    expect(screen.queryByText('Approved once')).toBeNull();
    expect(screen.queryByText('Decision saved')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers a Space-scoped approval for an exact opaque tool matcher', async () => {
    const toolInteraction: HumanInteractionPayload = {
      ...approvalInteraction,
      // Legacy cards deliberately hide Run scope because a Project can contain
      // multiple Runs; event-native BottomBox owns Run-scoped decisions.
      allowed_scopes: ['once', 'run', 'space'] as const,
      rule_matcher: {
        action_pattern: 'action-identity:sha256:opaque-digest',
        display_operation: 'mcp.tool.write',
        resource_pattern: 'tool-identity:sha256:abc',
        matcher_kind: 'literal_tool',
      },
    };
    render(<HumanInteractionCard interaction={toolInteraction} />);

    expect(
      screen.queryByRole('button', { name: 'Allow for this task' })
    ).not.toBeInTheDocument();
    expect(screen.getByText(/mcp\.tool\.write/)).toBeInTheDocument();
    expect(
      screen.queryByText(/action-identity:sha256/)
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Always allow',
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

  it('shows a durable API rejection inline and re-enables retry', async () => {
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
      screen.queryByRole('button', { name: 'Allow for this task' })
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

  it('unlocks a legacy Project-keyed card only after Brain confirms it is still pending', async () => {
    vi.mocked(isHumanInteractionStillPending).mockResolvedValueOnce(true);
    const toolInteraction: HumanInteractionPayload = {
      ...interaction,
      allowed_scopes: ['once', 'space'],
      rule_matcher: {
        action_pattern: 'action-identity:sha256:opaque-digest',
        display_operation: 'mcp.tool.write',
        resource_pattern: 'tool-identity:sha256:abc',
        matcher_kind: 'literal_tool',
      },
    };

    render(<HumanInteractionCard interaction={toolInteraction} readOnly />);

    const persistentButton = screen.getByRole('button', {
      name: 'Always allow',
    });
    expect(persistentButton).toBeDisabled();
    await waitFor(() => expect(persistentButton).toBeEnabled());
    expect(isHumanInteractionStillPending).toHaveBeenCalledWith(
      toolInteraction
    );
  });
});
