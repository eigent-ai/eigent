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

import { decideHumanInteraction } from '@/service/humanInteractionApi';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HumanInteractionCard,
  isHumanInteractionReadOnly,
} from './HumanInteractionCard';

vi.mock('@/service/humanInteractionApi', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/service/humanInteractionApi')>();
  return { ...actual, decideHumanInteraction: vi.fn() };
});

vi.mock('@/store/authStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/authStore')>();
  return {
    ...actual,
    useAuthStore: (selector: (state: { user_id: number }) => unknown) =>
      selector({ user_id: 42 }),
  };
});

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const interaction = {
  interaction_id: 'approval-1',
  interaction_type: 'approval' as const,
  run_id: 'run-1',
  version: 0,
  action_digest: 'a'.repeat(64),
  title: 'Allow todo_write?',
  question: 'The agent wants to run todo_write.',
  allowed_scopes: ['once' as const],
};

describe('HumanInteractionCard durable approval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(decideHumanInteraction).mockResolvedValue({});
  });

  it('keeps a waiting durable approval actionable after replay reattachment', async () => {
    const readOnly = isHumanInteractionReadOnly({
      interaction,
      activeTaskId: 'run-1',
      taskType: 'replay',
      taskStatus: 'finished',
      durableRunStatus: 'waiting_for_user',
    });
    expect(readOnly).toBe(false);

    const onResolved = vi.fn();
    render(
      <HumanInteractionCard
        interaction={interaction}
        readOnly={readOnly}
        onResolved={onResolved}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));

    await waitFor(() =>
      expect(decideHumanInteraction).toHaveBeenCalledWith(
        interaction,
        expect.objectContaining({
          decision: { decision: 'approved', scope: 'once' },
          actorId: 42,
        })
      )
    );
    expect(onResolved).toHaveBeenCalledOnce();
    expect(screen.queryByText('Allow todo_write?')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Approve once' })
    ).not.toBeInTheDocument();
  });

  it('keeps terminal replay history read-only', () => {
    const readOnly = isHumanInteractionReadOnly({
      interaction,
      activeTaskId: 'run-1',
      taskType: 'replay',
      taskStatus: 'finished',
      durableRunStatus: 'completed',
    });
    render(
      <HumanInteractionCard interaction={interaction} readOnly={readOnly} />
    );

    expect(screen.getByRole('button', { name: 'Approve once' })).toBeDisabled();
  });

  it('offers a Space-scoped approval for an exact opaque tool matcher', async () => {
    const toolInteraction = {
      ...interaction,
      // Legacy pending cards may still carry run. The current UI contract
      // deliberately hides it because one Project contains multiple Runs.
      allowed_scopes: ['once', 'run', 'space'] as const,
      rule_matcher: {
        action_pattern: 'mcp.tool.write',
        resource_pattern: 'tool-identity:sha256:abc',
        matcher_kind: 'literal_tool',
      },
    };
    render(<HumanInteractionCard interaction={toolInteraction} />);

    expect(
      screen.queryByRole('button', {
        name: 'Allow this tool for this Run',
      })
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Always allow this tool in Space',
      })
    );

    await waitFor(() =>
      expect(decideHumanInteraction).toHaveBeenCalledWith(
        toolInteraction,
        expect.objectContaining({
          decision: { decision: 'approved', scope: 'space' },
        })
      )
    );
  });

  it('shows a durable API rejection inline and re-enables retry', async () => {
    vi.mocked(decideHumanInteraction).mockRejectedValueOnce(
      new Error('Approval version changed')
    );
    render(<HumanInteractionCard interaction={interaction} />);

    fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Approval version changed'
    );
    expect(screen.getByRole('button', { name: 'Approve once' })).toBeEnabled();
  });
});
