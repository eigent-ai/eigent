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
import { HostProvider } from '@/host';
import { type HumanInteractionPayload } from '@/service/humanInteractionApi';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  decideHumanInteraction: vi.fn(),
  isHumanInteractionStillPending: vi.fn(),
  toastError: vi.fn(),
  getHumanInteractionReceipt: vi.fn(),
}));

vi.mock('@/service/humanInteractionApi', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/service/humanInteractionApi')>();
  return {
    ...original,
    decideHumanInteraction: mocks.decideHumanInteraction,
    getHumanInteractionReceipt: mocks.getHumanInteractionReceipt,
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
    vi.resetAllMocks();
    mocks.decideHumanInteraction.mockResolvedValue({ status: 'resolved' });
    mocks.isHumanInteractionStillPending.mockResolvedValue(true);
    mocks.getHumanInteractionReceipt.mockResolvedValue(null);
  });

  it('clears a failed submission during recovery and permits retry only after revalidation', async () => {
    let failDecision!: (error: Error) => void;
    mocks.decideHumanInteraction.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failDecision = reject;
        })
    );
    render(<HumanInteractionCard interaction={interaction} />);
    const approve = screen.getByRole('button', { name: 'Approve once' });
    await waitFor(() => expect(approve).toBeEnabled());
    fireEvent.click(approve);
    await waitFor(() =>
      expect(mocks.decideHumanInteraction).toHaveBeenCalledTimes(1)
    );
    let finishCheck!: (pending: boolean) => void;
    mocks.isHumanInteractionStillPending.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finishCheck = resolve;
        })
    );
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await act(async () => {
      failDecision(new Error('Decision transport interrupted'));
    });
    expect(approve).toBeDisabled();
    await act(async () => {
      finishCheck(true);
    });
    expect(approve).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Decision transport interrupted'
    );
    expect(mocks.toastError).toHaveBeenCalledWith(
      'Decision transport interrupted'
    );
    fireEvent.click(approve);
    await waitFor(() =>
      expect(mocks.decideHumanInteraction).toHaveBeenCalledTimes(2)
    );
  });

  it('accepts the current POST success while recovery validation is pending', async () => {
    let finishDecision!: (value: object) => void;
    mocks.decideHumanInteraction.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishDecision = resolve;
        })
    );
    const onResolved = vi.fn();
    render(
      <HumanInteractionCard interaction={interaction} onResolved={onResolved} />
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Approve once' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));
    await waitFor(() =>
      expect(mocks.decideHumanInteraction).toHaveBeenCalledTimes(1)
    );
    let finishCheck!: (pending: boolean) => void;
    mocks.isHumanInteractionStillPending.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finishCheck = resolve;
        })
    );
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await act(async () => {
      finishDecision({ status: 'resolved' });
    });
    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(onResolved).toHaveBeenCalledWith('Approved once');
    expect(screen.queryByRole('button')).toBeNull();
    await act(async () => {
      finishCheck(true);
    });
    expect(screen.queryByRole('button')).toBeNull();
    expect(mocks.decideHumanInteraction).toHaveBeenCalledTimes(1);
  });

  it.each(['success', 'failure'])(
    'ignores an old submission %s without clearing a newer submission',
    async (outcome) => {
      let finishOld!: (value: object) => void;
      let failOld!: (error: Error) => void;
      let finishNew!: (value: object) => void;
      mocks.decideHumanInteraction
        .mockImplementationOnce(
          () =>
            new Promise((resolve, reject) => {
              finishOld = resolve;
              failOld = reject;
            })
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishNew = resolve;
            })
        );
      const onResolved = vi.fn();
      const view = render(
        <HumanInteractionCard
          interaction={interaction}
          onResolved={onResolved}
        />
      );
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Approve once' })
        ).toBeEnabled()
      );
      fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));
      await waitFor(() =>
        expect(mocks.decideHumanInteraction).toHaveBeenCalledTimes(1)
      );
      const next = {
        ...interaction,
        interaction_id: 'new-approval',
        approval_id: 'new-approval',
        version: 3,
        action_digest: 'new-digest',
      };
      view.rerender(
        <HumanInteractionCard interaction={next} onResolved={onResolved} />
      );
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Approve once' })
        ).toBeEnabled()
      );
      fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));
      await waitFor(() =>
        expect(mocks.decideHumanInteraction).toHaveBeenCalledTimes(2)
      );
      await act(async () => {
        if (outcome === 'success') finishOld({ status: 'resolved' });
        else failOld(new Error('Old approval failed'));
      });
      expect(screen.getByRole('button', { name: 'Approving…' })).toBeDisabled();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(mocks.toastError).not.toHaveBeenCalled();
      expect(onResolved).not.toHaveBeenCalled();
      await act(async () => {
        finishNew({ status: 'resolved' });
      });
      expect(onResolved).toHaveBeenCalledTimes(1);
      expect(onResolved).toHaveBeenCalledWith('Approved once');
      expect(mocks.decideHumanInteraction.mock.calls[1][0]).toEqual(next);
      expect(
        mocks.decideHumanInteraction.mock.calls[1][1].decisionRequestId
      ).not.toBe(
        mocks.decideHumanInteraction.mock.calls[0][1].decisionRequestId
      );
    }
  );

  it.each(['success', 'failure'])(
    'ignores a submission %s after the same approval becomes terminal',
    async (outcome) => {
      let finish!: (value: object) => void;
      let fail!: (error: Error) => void;
      mocks.decideHumanInteraction.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            finish = resolve;
            fail = reject;
          })
      );
      const onResolved = vi.fn();
      const view = render(
        <HumanInteractionCard
          interaction={interaction}
          onResolved={onResolved}
        />
      );
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Approve once' })
        ).toBeEnabled()
      );
      fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));
      await waitFor(() =>
        expect(mocks.decideHumanInteraction).toHaveBeenCalledTimes(1)
      );
      view.rerender(
        <HumanInteractionCard
          interaction={{
            ...interaction,
            status: 'cancelled',
            reason: 'tool_terminal_before_dispatch',
          }}
          onResolved={onResolved}
        />
      );
      await act(async () => {
        if (outcome === 'success') finish({ status: 'resolved' });
        else fail(new Error('Retired approval failed'));
      });
      expect(screen.getByText('Approval cancelled')).toBeInTheDocument();
      expect(screen.queryByRole('button')).toBeNull();
      expect(onResolved).not.toHaveBeenCalled();
      expect(mocks.toastError).not.toHaveBeenCalled();
    }
  );

  it('ignores an old submission preflight result after the approval identity changes', async () => {
    const view = render(<HumanInteractionCard interaction={interaction} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Approve once' })).toBeEnabled()
    );
    let finish!: (pending: boolean) => void;
    mocks.isHumanInteractionStillPending.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));
    const next = {
      ...interaction,
      interaction_id: 'new-approval',
      version: 3,
      action_digest: 'new-digest',
    };
    view.rerender(<HumanInteractionCard interaction={next} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Approve once' })).toBeEnabled()
    );
    await act(async () => {
      finish(false);
    });
    expect(screen.getByRole('button', { name: 'Approve once' })).toBeEnabled();
    expect(mocks.decideHumanInteraction).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'requested', reason: undefined },
    { status: 'requested', reason: 'approval_expired' },
    { status: 'expired', reason: 'approval_expired' },
    { status: 'cancelled', reason: undefined },
  ])(
    'preserves the terminal interaction reason when snapshot is $status / $reason',
    async (receipt) => {
      let finish!: (receipt: object) => void;
      mocks.getHumanInteractionReceipt.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
      render(
        <HumanInteractionCard
          interaction={{
            ...interaction,
            status: 'cancelled',
            reason: 'tool_terminal_before_dispatch',
          }}
        />
      );
      const reason = i18next.t('chat.approval-tool-ended-description');
      expect(screen.getByText(reason)).toBeInTheDocument();
      await act(async () => {
        finish(receipt);
      });
      expect(screen.getByText('Approval cancelled')).toBeInTheDocument();
      expect(screen.getByText(reason)).toBeInTheDocument();
      expect(screen.queryByRole('button')).toBeNull();
      expect(mocks.isHumanInteractionStillPending).not.toHaveBeenCalled();
      expect(mocks.decideHumanInteraction).not.toHaveBeenCalled();
    }
  );

  it('only enriches a terminal interaction from a matching terminal snapshot', async () => {
    mocks.getHumanInteractionReceipt.mockResolvedValue({
      status: 'requested',
      reason: 'approval_expired',
    });
    render(
      <HumanInteractionCard
        interaction={{ ...interaction, status: 'cancelled' }}
      />
    );
    await act(async () => {});
    expect(screen.getByText('Approval cancelled')).toBeInTheDocument();
    expect(
      screen.queryByText(i18next.t('chat.approval-expired-description'))
    ).toBeNull();
    mocks.getHumanInteractionReceipt.mockResolvedValue({
      status: 'cancelled',
      reason: 'tool_terminal_before_dispatch',
    });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(
      screen.getByText(i18next.t('chat.approval-tool-ended-description'))
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each(['focus', 'backend-ready'])(
    'retries failed pending validation on %s and waits for fresh authority',
    async (recoveryEvent) => {
      const listeners = new Map<string, Set<() => void>>();
      const ipcRenderer = {
        on: vi.fn((channel: string, listener: () => void) => {
          const callbacks = listeners.get(channel) || new Set();
          callbacks.add(listener);
          listeners.set(channel, callbacks);
        }),
        off: vi.fn((channel: string, listener: () => void) => {
          const callbacks = listeners.get(channel);
          callbacks?.delete(listener);
          if (!callbacks?.size) listeners.delete(channel);
        }),
      };
      mocks.isHumanInteractionStillPending.mockRejectedValueOnce(
        new Error('Brain restarting')
      );
      mocks.getHumanInteractionReceipt.mockRejectedValueOnce(
        new Error('Brain restarting')
      );
      const view = render(
        <HostProvider host={{ electronAPI: null, ipcRenderer }}>
          <HumanInteractionCard interaction={interaction} />
        </HostProvider>
      );
      await act(async () => {});
      expect(
        screen.getByRole('button', { name: 'Approve once' })
      ).toBeDisabled();

      let finish!: (pending: boolean) => void;
      mocks.isHumanInteractionStillPending.mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            finish = resolve;
          })
      );
      mocks.getHumanInteractionReceipt.mockResolvedValue({
        status: 'requested',
      });
      await act(async () => {
        if (recoveryEvent === 'focus') window.dispatchEvent(new Event('focus'));
        else listeners.get('backend-ready')?.forEach((listener) => listener());
      });
      expect(mocks.isHumanInteractionStillPending).toHaveBeenCalledTimes(2);
      expect(
        screen.getByRole('button', { name: 'Approve once' })
      ).toBeDisabled();
      expect(mocks.decideHumanInteraction).not.toHaveBeenCalled();
      await act(async () => {
        finish(true);
      });
      expect(
        screen.getByRole('button', { name: 'Approve once' })
      ).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));
      await waitFor(() =>
        expect(mocks.decideHumanInteraction).toHaveBeenCalledWith(
          interaction,
          expect.objectContaining({
            decision: { decision: 'approved', scope: 'once' },
          })
        )
      );
      view.unmount();
      expect(listeners.has('backend-ready')).toBe(false);
    }
  );

  it('ignores an older pending success after recovery confirms the approval is unavailable', async () => {
    let finish!: (pending: boolean) => void;
    mocks.isHumanInteractionStillPending.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        })
    );
    render(<HumanInteractionCard interaction={interaction} />);
    mocks.isHumanInteractionStillPending.mockResolvedValue(false);
    mocks.getHumanInteractionReceipt.mockResolvedValue({ status: 'requested' });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(screen.getByText('Approval no longer active')).toBeInTheDocument();
    await act(async () => {
      finish(true);
    });
    expect(screen.queryByRole('button')).toBeNull();
    expect(mocks.decideHumanInteraction).not.toHaveBeenCalled();
  });

  it('enriches a terminal receipt with its missing reason without accepting a late pending snapshot', async () => {
    mocks.getHumanInteractionReceipt.mockResolvedValue({ status: 'cancelled' });
    render(<HumanInteractionCard interaction={interaction} />);
    expect(await screen.findByText('Approval cancelled')).toBeInTheDocument();
    mocks.getHumanInteractionReceipt.mockResolvedValue({
      status: 'cancelled',
      reason: 'tool_terminal_before_dispatch',
    });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    const reason = i18next.t('chat.approval-tool-ended-description');
    expect(screen.getByText(reason)).toBeInTheDocument();
    for (const receipt of [
      { status: 'cancelled' },
      { status: 'requested', reason: 'approval_expired' },
    ]) {
      mocks.getHumanInteractionReceipt.mockResolvedValue(receipt);
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
      });
      expect(screen.getByText('Approval cancelled')).toBeInTheDocument();
      expect(screen.getByText(reason)).toBeInTheDocument();
      expect(screen.queryByRole('button')).toBeNull();
    }
    expect(mocks.decideHumanInteraction).not.toHaveBeenCalled();
  });

  it('ignores a recovery pending check that resolves after a terminal receipt', async () => {
    render(<HumanInteractionCard interaction={interaction} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Approve once' })).toBeEnabled()
    );
    let finish!: (pending: boolean) => void;
    mocks.isHumanInteractionStillPending.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        })
    );
    mocks.getHumanInteractionReceipt.mockResolvedValue({
      status: 'cancelled',
      reason: 'tool_terminal_before_dispatch',
    });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(mocks.isHumanInteractionStillPending).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Approval cancelled')).toBeInTheDocument();
    await act(async () => {
      finish(true);
    });
    expect(screen.getByText('Approval cancelled')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(mocks.decideHumanInteraction).not.toHaveBeenCalled();
  });

  it.each(['interrupted', 'completed', 'failed', 'cancelled', 'stopped'])(
    'retires a same-run card when the durable task is %s, even without replay flags',
    (durableRunStatus) => {
      expect(
        isHumanInteractionReadOnly({
          interaction,
          activeTaskId: 'run-1',
          taskStatus: 'running',
          durableRunStatus,
        })
      ).toBe(true);
    }
  );

  it('never re-enables an explicit read-only receipt from a late pending read', async () => {
    mocks.isHumanInteractionStillPending.mockResolvedValue(true);
    render(<HumanInteractionCard interaction={interaction} readOnly />);
    await Promise.resolve();
    const approve = screen.queryByRole('button', { name: 'Approve once' });
    if (approve) {
      expect(approve).toBeDisabled();
      fireEvent.click(approve);
    }
    expect(mocks.decideHumanInteraction).not.toHaveBeenCalled();
    expect(screen.getByText('Approval no longer active')).toBeInTheDocument();
  });

  it.each([
    ['expired', 'approval_expired', 'Approval expired'],
    ['cancelled', 'tool_terminal_before_dispatch', 'Approval cancelled'],
  ])(
    'keeps a %s receipt after remount without offering decisions',
    (status, reason, title) => {
      const receipt = { ...interaction, status, reason };
      const first = render(
        <HumanInteractionCard interaction={receipt} timelineReceipt />
      );
      expect(screen.getByText(title)).toBeInTheDocument();
      expect(screen.queryByRole('button')).toBeNull();
      first.unmount();
      render(
        <HumanInteractionCard
          interaction={JSON.parse(JSON.stringify(receipt))}
        />
      );
      expect(screen.getByText(title)).toBeInTheDocument();
      expect(screen.queryByRole('button')).toBeNull();
    }
  );

  it.each([false, true])(
    'removes authority at the persisted deadline without inventing an expired outcome (legacy journal metadata: %s)',
    async (legacy) => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-09-01T00:00:00Z'));
        const expires_at = Date.now() / 1000 + 10;
        if (legacy)
          mocks.getHumanInteractionReceipt.mockResolvedValue({
            status: 'requested',
            expires_at,
          });
        render(
          <HumanInteractionCard
            interaction={legacy ? interaction : { ...interaction, expires_at }}
          />
        );
        await act(async () => {
          await Promise.resolve();
        });
        expect(
          screen.getByRole('button', { name: 'Approve once' })
        ).toBeEnabled();
        await act(async () => {
          vi.advanceTimersByTime(10_000);
        });
        expect(screen.queryByRole('button')).toBeNull();
        expect(
          screen.getByText('Approval no longer active')
        ).toBeInTheDocument();
        expect(screen.queryByText('Approval expired')).toBeNull();
        expect(mocks.decideHumanInteraction).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    }
  );

  it('never lets a late pending snapshot overwrite a terminal journal receipt', async () => {
    let finish!: (receipt: object) => void;
    mocks.getHumanInteractionReceipt.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    render(<HumanInteractionCard interaction={interaction} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Approve once' })).toBeEnabled()
    );
    mocks.getHumanInteractionReceipt.mockResolvedValue({
      status: 'cancelled',
      reason: 'tool_terminal_before_dispatch',
    });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(screen.getByText('Approval cancelled')).toBeInTheDocument();
    await act(async () => {
      finish({ status: 'requested' });
    });
    expect(screen.getByText('Approval cancelled')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('cancels a pending verification when the card becomes a terminal receipt', async () => {
    const view = render(<HumanInteractionCard interaction={interaction} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Approve once' })).toBeEnabled()
    );
    let finish!: (pending: boolean) => void;
    mocks.isHumanInteractionStillPending.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));
    view.rerender(<HumanInteractionCard interaction={interaction} readOnly />);
    await act(async () => {
      finish(true);
    });
    expect(mocks.decideHumanInteraction).not.toHaveBeenCalled();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('rehydrates the actual cancellation reason from the journal without reviving controls', async () => {
    mocks.getHumanInteractionReceipt.mockResolvedValue({
      status: 'cancelled',
      reason: 'tool_terminal_before_dispatch',
    });
    render(
      <HumanInteractionCard
        interaction={{ ...interaction, receipt: { runStatus: 'interrupted' } }}
        timelineReceipt
      />
    );
    expect(await screen.findByText('Approval cancelled')).toBeInTheDocument();
    expect(
      screen.getByText(i18next.t('chat.approval-tool-ended-description'))
    ).toBeInTheDocument();
    expect(screen.queryByText('Approval expired')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('uses a fresh decision request and only the new approval tuple after Resume', async () => {
    const view = render(<HumanInteractionCard interaction={interaction} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Approve once' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));
    await waitFor(() =>
      expect(mocks.decideHumanInteraction).toHaveBeenCalledTimes(1)
    );
    const previousRequestId =
      mocks.decideHumanInteraction.mock.calls[0][1].decisionRequestId;
    const next = {
      ...interaction,
      interaction_id: 'new-approval',
      approval_id: 'new-approval',
      version: 2,
      action_digest: 'new-digest',
    };
    view.rerender(<HumanInteractionCard interaction={next} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Approve once' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));
    await waitFor(() =>
      expect(mocks.decideHumanInteraction).toHaveBeenCalledTimes(2)
    );
    expect(mocks.decideHumanInteraction.mock.calls[1][0]).toEqual(next);
    expect(
      mocks.decideHumanInteraction.mock.calls[1][1].decisionRequestId
    ).not.toBe(previousRequestId);
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

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Approve once' })).toBeEnabled()
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

    expect(screen.queryByRole('button', { name: 'Approve once' })).toBeNull();
    expect(screen.getByText('Approval no longer active')).toBeInTheDocument();
  });

  it('keeps replay read-only until a durable waiter is known', () => {
    const readOnly = isHumanInteractionReadOnly({
      interaction,
      activeTaskId: 'run-1',
      taskType: 'replay',
      taskStatus: 'finished',
      durableRunStatus: undefined,
    });

    expect(readOnly).toBe(true);
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

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Always allow' })).toBeEnabled()
    );
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

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Approve once' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Approval version changed'
    );
    expect(mocks.toastError).toHaveBeenCalledWith('Approval version changed');
    expect(screen.getByRole('button', { name: 'Approve once' })).toBeEnabled();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Approve once' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));
    await waitFor(() => {
      expect(mocks.decideHumanInteraction).toHaveBeenCalledTimes(2);
    });
    consoleError.mockRestore();
  });

  it('only renders persistent approval actions offered by the backend', async () => {
    render(<HumanInteractionCard interaction={approvalInteraction} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Approve once' })).toBeEnabled()
    );

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

  it('enables a current legacy card only after Brain confirms it is still pending', async () => {
    mocks.isHumanInteractionStillPending.mockResolvedValueOnce(true);
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

    render(<HumanInteractionCard interaction={toolInteraction} />);

    const persistentButton = screen.getByRole('button', {
      name: 'Always allow',
    });
    expect(persistentButton).toBeDisabled();
    await waitFor(() => expect(persistentButton).toBeEnabled());
    expect(mocks.isHumanInteractionStillPending).toHaveBeenCalledWith(
      toolInteraction
    );
  });
});
