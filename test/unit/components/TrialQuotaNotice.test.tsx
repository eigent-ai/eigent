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

import { UsageLimitBanner } from '@/components/ChatBox/BottomBox/UsageLimitBanner';
import { TaskErrorNotice } from '@/components/ChatBox/TaskErrorNotice';
import { useUsageIncidentBanner } from '@/hooks/useUsageIncidentBanner';
import {
  acknowledgeUsageNotice,
  refreshUsage,
  reportUsageIncident,
  setUsageAccount,
  setUsageModelType,
  useUsageNoticeStore,
} from '@/store/usageNoticeStore';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  error: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock('@/api/http', () => ({ proxyFetchGet: mocks.get }));
vi.mock('sonner', () => ({
  toast: { error: mocks.error, dismiss: mocks.dismiss },
}));
vi.mock('@/host/createHost', () => ({ createHost: () => ({}) }));

const trial = {
  plan_key: 'pro',
  is_trialing: true,
  trial_daily_credits_limit: 300,
  trial_daily_credits_used: 300,
  trial_daily_credits_remaining: 0,
  trial_total_credits_limit: 1000,
  trial_total_credits_used: 528,
  trial_total_credits_remaining: 472,
};
function respond(subscription: object = trial, credits = 472) {
  mocks.get.mockImplementation(async (url: string) =>
    url.endsWith('subscription')
      ? subscription
      : url.endsWith('current_credits')
        ? { credits }
        : { value: 'fixture-key' }
  );
}
function LiveNotice({ modelType = 'cloud' }: { modelType?: string }) {
  const props = useUsageIncidentBanner(modelType);
  return props ? <UsageLimitBanner {...props} /> : null;
}

describe('live trial quota notices', () => {
  beforeEach(() => {
    setUsageAccount(null);
    vi.clearAllMocks();
    setUsageAccount('account-a');
    setUsageModelType('cloud');
    respond();
  });
  afterEach(cleanup);

  it.each(['trial-daily', 'trial-total'] as const)(
    'uses the confirmed plan for the %s banner and toast, without changing historical errors',
    async (reason) => {
      useUsageNoticeStore.setState({ subscription: trial });
      reportUsageIncident({ reason });
      render(
        <>
          <LiveNotice />
          <TaskErrorNotice reason={reason} />
        </>
      );
      const copy =
        reason === 'trial-daily'
          ? 'You’ve used today’s Pro trial credits.'
          : 'You’ve used all your Pro trial credits.';
      expect(screen.getByText(copy)).toBeVisible();
      expect(mocks.error).toHaveBeenCalledWith(
        copy,
        expect.objectContaining({ duration: Infinity, closeButton: true })
      );
      expect(document.querySelector('[data-task-error]')).not.toHaveTextContent(
        /Pro|free trial/i
      );
      expect(
        screen.queryByRole('button', { name: /upgrade/i })
      ).not.toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'Refresh' })).toHaveLength(
        2
      );
      expect(document.querySelector('[role="alert"]')).toBeNull(); // Sonner owns the announcement.
    }
  );

  it('updates an existing toast when subscription data arrives, but does not repeat identical or dismissed reminders', async () => {
    reportUsageIncident({ reason: 'trial-daily' });
    render(<LiveNotice />);
    expect(
      screen.getByText('You’ve used today’s trial credits.')
    ).toBeVisible();
    await act(() => refreshUsage());
    expect(
      screen.getByText('You’ve used today’s Pro trial credits.')
    ).toBeVisible();
    expect(mocks.error).toHaveBeenCalledTimes(2);
    await act(() => refreshUsage());
    expect(mocks.error).toHaveBeenCalledTimes(2);
    act(() => acknowledgeUsageNotice());
    await act(() => refreshUsage());
    expect(mocks.error).toHaveBeenCalledTimes(2);
    expect(
      screen.getByText('You’ve used today’s Pro trial credits.')
    ).toBeVisible();
  });

  it('drops the trial label on a paid update even when an unverified blocker remains', async () => {
    await refreshUsage();
    render(<LiveNotice />);
    respond({ plan_key: 'pro', is_trialing: false }, 0);
    await act(() => refreshUsage());
    expect(screen.queryByText(/Pro trial/)).not.toBeInTheDocument();
    expect(
      screen.getByText('You’ve used today’s trial credits.')
    ).toBeVisible();
    expect(mocks.error.mock.calls.at(-1)?.[0]).toBe(
      'You’ve used today’s trial credits.'
    );
    expect(useUsageNoticeStore.getState().incidents).toEqual([
      { reason: 'trial-daily' },
    ]);
    respond({ plan_key: 'pro', is_trialing: false }, 10000);
    await act(() => refreshUsage());
    expect(document.querySelector('[data-usage-notice]')).toBeNull();
  });

  it('uses neutral copy after a failed refresh and keeps the Refresh action accessible', async () => {
    await refreshUsage();
    render(<LiveNotice />);
    mocks.get.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.queryByText(/Pro trial/)).not.toBeInTheDocument();
    expect(
      screen.getByText('You’ve used today’s trial credits.')
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
  });

  it.each(['account-b', 'account-a'])(
    'ignores late trial snapshots after switching to %s',
    async (account) => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      mocks.get.mockImplementation(async (url: string) => {
        await gate;
        return url.endsWith('subscription')
          ? trial
          : url.endsWith('current_credits')
            ? { credits: 472 }
            : { value: 'old-key' };
      });
      const pending = refreshUsage();
      await vi.waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(3));
      setUsageAccount(null);
      setUsageAccount(account);
      respond({ plan_key: 'pro', is_trialing: false }, 10000);
      await refreshUsage();
      release();
      await pending;
      render(<LiveNotice />);
      expect(useUsageNoticeStore.getState().subscription).toEqual({
        plan_key: 'pro',
        is_trialing: false,
      });
      expect(document.querySelector('[data-usage-notice]')).toBeNull();
      expect(mocks.error).not.toHaveBeenCalled();
    }
  );

  it('retains the account blocker during refresh and hides it for non-cloud models', async () => {
    await refreshUsage();
    useUsageNoticeStore.setState({ refreshing: true });
    const view = render(<LiveNotice />);
    expect(screen.getByRole('button', { name: 'Refreshing…' })).toBeDisabled();
    for (const modelType of ['custom', 'local', 'codex_subscription']) {
      view.rerender(<LiveNotice modelType={modelType} />);
      expect(document.querySelector('[data-usage-notice]')).toBeNull();
    }
  });
});
