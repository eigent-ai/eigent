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
import { useSettingsStore } from '@/store/settingsStore';
import {
  acknowledgeUsageNotice,
  refreshUsage,
  setUsageAccount,
  setUsageModelType,
  USAGE_REFRESH_TIMEOUT_MS,
} from '@/store/usageNoticeStore';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
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

// Shapes the subscription endpoint returns for each account state.
const newAccount = {
  plan_key: 'Free',
  trial_used: false,
  trial_available: true,
  trial_unavailable_reason: null,
};
const trialUsed = {
  plan_key: 'Free',
  trial_used: true,
  trial_available: false,
  trial_unavailable_reason: 'trial_already_used',
};
const paidPlan = {
  plan_key: 'plus',
  is_trialing: false,
  trial_available: false,
  trial_unavailable_reason: 'paid_subscription_history',
};

function respond(subscription: object | null, credits = 0) {
  mocks.get.mockImplementation(async (url: string) => {
    if (url.endsWith('subscription')) {
      if (!subscription) throw new Error('offline');
      return subscription;
    }
    return url.endsWith('current_credits')
      ? { credits }
      : { value: 'fixture-key' };
  });
}
function LiveNotice() {
  const props = useUsageIncidentBanner('cloud');
  return props ? <UsageLimitBanner {...props} /> : null;
}
const lastToast = () => {
  const [message, options] = mocks.error.mock.calls.at(-1) ?? [];
  return { message, description: options?.description as ReactElement };
};

describe('out of credits recovery', () => {
  beforeEach(() => {
    setUsageAccount(null);
    vi.clearAllMocks();
    useSettingsStore.setState({ isOpen: false, activeSection: 'general' });
    setUsageAccount('account-a');
    setUsageModelType('cloud');
  });
  afterEach(cleanup);

  it('offers Upgrade plan to a new account in one notice at a time', async () => {
    respond(newAccount);
    await refreshUsage();
    const toast = lastToast();
    expect(toast.message).toBe('Add credits to start running tasks.');
    render(
      <>
        <LiveNotice />
        <div data-testid="toast">{toast.description}</div>
      </>
    );
    const toastBody = within(screen.getByTestId('toast'));
    expect(
      toastBody.getByText('Upgrade your plan or use your own model API key.')
    ).toBeVisible();
    expect(
      toastBody.getByRole('button', { name: 'Upgrade plan' })
    ).toBeVisible();
    expect(toastBody.getByRole('button', { name: 'Refresh' })).toBeVisible();
    expect(
      toastBody.getByRole('button', { name: 'Use your own API key' })
    ).toBeVisible();
    // While the toast is open the composer does not repeat it.
    expect(document.querySelector('[data-usage-notice]')).toBeNull();

    act(() => acknowledgeUsageNotice());
    const banner = within(
      document.querySelector('[data-usage-notice]') as HTMLElement
    );
    expect(
      banner.getByText('Add credits to start running tasks.')
    ).toBeVisible();
    expect(banner.getByRole('button', { name: 'Upgrade plan' })).toBeVisible();
    // Plans and trials are chosen on the website; the app never offers one.
    expect(
      banner.queryByRole('button', { name: /trial/i })
    ).not.toBeInTheDocument();
  });

  it.each([
    ['the trial was already used', trialUsed],
    ['a paid plan ran out', paidPlan],
    ['the plan could not be loaded', null],
  ])(
    'keeps the out-of-credits copy and offers Upgrade when %s',
    async (_, subscription) => {
      respond(subscription);
      await refreshUsage();
      acknowledgeUsageNotice();
      render(<LiveNotice />);
      const banner = within(
        document.querySelector('[data-usage-notice]') as HTMLElement
      );
      expect(banner.getByText('You’re out of Eigent credits.')).toBeVisible();
      expect(
        banner.getByText('Refresh to check your latest balance.')
      ).toBeVisible();
      expect(
        banner.getByRole('button', { name: 'Upgrade plan' })
      ).toBeVisible();
      expect(
        banner.queryByRole('button', { name: /trial/i })
      ).not.toBeInTheDocument();
      expect(banner.getByRole('button', { name: 'Refresh' })).toBeVisible();
    }
  );

  it('updates the open toast when the account details arrive', async () => {
    respond(null);
    await refreshUsage();
    expect(lastToast().message).toBe('You’re out of Eigent credits.');
    respond(newAccount);
    await refreshUsage();
    expect(mocks.error).toHaveBeenCalledTimes(2);
    expect(lastToast().message).toBe('Add credits to start running tasks.');
    // Sonner merges updates into the open toast, so no stale action survives.
    expect(mocks.error.mock.calls.at(-1)?.[1]).toHaveProperty(
      'action',
      undefined
    );
    render(lastToast().description);
    expect(screen.getByRole('button', { name: 'Upgrade plan' })).toBeVisible();
  });

  it('opens pricing, model settings, and refreshes from the in-task notice', async () => {
    respond(newAccount);
    await refreshUsage();
    render(<TaskErrorNotice reason="credits" />);
    const notice = within(
      document.querySelector('[data-task-error]') as HTMLElement
    );
    // The record keeps what happened; only the ways forward follow the account.
    expect(notice.getByText('You’re out of Eigent credits.')).toBeVisible();
    const user = userEvent.setup();

    await user.click(
      notice.getByRole('button', { name: 'Use your own API key' })
    );
    expect(useSettingsStore.getState()).toMatchObject({
      isOpen: true,
      activeSection: 'models',
    });

    mocks.get.mockClear();
    await user.click(notice.getByRole('button', { name: 'Refresh' }));
    expect(mocks.get).toHaveBeenCalledWith(
      '/api/v1/subscription',
      undefined,
      undefined,
      { signal: expect.any(AbortSignal) }
    );

    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      value: { href: '' },
      writable: true,
    });
    try {
      await user.click(notice.getByRole('button', { name: 'Upgrade plan' }));
      await vi.waitFor(() =>
        expect(window.location.href).toMatch(/\/pricing$/)
      );
    } finally {
      Object.defineProperty(window, 'location', {
        value: originalLocation,
        writable: true,
      });
    }
  });

  it('gives the daily trial notice Refresh and own key, without Upgrade', async () => {
    respond(newAccount);
    await refreshUsage();
    render(<TaskErrorNotice reason="trial-daily" />);
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Use your own API key' })
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Upgrade plan' })
    ).not.toBeInTheDocument();
  });

  it('records a spend-limit failure during a trial as the trial allowance', async () => {
    respond(
      {
        plan_key: 'pro',
        is_trialing: true,
        trial_daily_credits_remaining: 0,
        trial_total_credits_remaining: 859,
      },
      500
    );
    await refreshUsage();
    render(<TaskErrorNotice reason="credits" />);
    const notice = within(
      document.querySelector('[data-task-error]') as HTMLElement
    );
    expect(
      notice.getByText('You’ve used today’s trial credits.')
    ).toBeVisible();
    expect(
      notice.queryByText('You’re out of Eigent credits.')
    ).not.toBeInTheDocument();
    expect(notice.getByRole('button', { name: 'Refresh' })).toBeVisible();
  });

  it('offers Refresh and own key, but not Upgrade, for the daily trial limit', async () => {
    respond(
      {
        plan_key: 'pro',
        is_trialing: true,
        trial_daily_credits_remaining: 0,
        trial_total_credits_remaining: 859,
      },
      500
    );
    await refreshUsage();
    const toast = lastToast();
    expect(toast.message).toBe('You’ve used today’s Pro trial credits.');
    render(
      <>
        <div data-testid="toast">{toast.description}</div>
        <TaskErrorNotice reason="credits" />
      </>
    );
    act(() => acknowledgeUsageNotice());
    render(<LiveNotice />);

    const surfaces = [
      screen.getByTestId('toast'),
      document.querySelector('[data-usage-notice]') as HTMLElement,
      document.querySelector('[data-task-error]') as HTMLElement,
    ];
    for (const surface of surfaces) {
      const notice = within(surface);
      expect(
        notice.queryByRole('button', { name: 'Upgrade plan' })
      ).not.toBeInTheDocument();
      expect(notice.getByRole('button', { name: 'Refresh' })).toBeVisible();
      expect(
        notice.getByRole('button', { name: 'Use your own API key' })
      ).toBeVisible();
    }

    const user = userEvent.setup();
    await user.click(
      within(surfaces[2]).getByRole('button', { name: 'Use your own API key' })
    );
    expect(useSettingsStore.getState()).toMatchObject({
      isOpen: true,
      activeSection: 'models',
    });
  });

  it('keeps the trial allowance wording after a failed Refresh', async () => {
    respond(
      {
        plan_key: 'pro',
        is_trialing: true,
        trial_daily_credits_remaining: 0,
        trial_total_credits_remaining: 859,
      },
      500
    );
    await refreshUsage();
    render(<TaskErrorNotice reason="credits" />);
    mocks.get.mockRejectedValue(new Error('offline'));

    await act(() => refreshUsage());

    expect(
      screen.getByText('You’ve used today’s trial credits.')
    ).toBeVisible();
    expect(
      screen.queryByText('You’re out of Eigent credits.')
    ).not.toBeInTheDocument();
  });

  it('keeps the toast Refresh in step with the other notices until the read times out', async () => {
    respond(
      {
        plan_key: 'pro',
        is_trialing: true,
        trial_daily_credits_remaining: 0,
        trial_total_credits_remaining: 859,
      },
      500
    );
    await refreshUsage();
    vi.useFakeTimers();
    try {
      // The account reads never answer.
      mocks.get.mockClear();
      mocks.get.mockImplementation(() => new Promise(() => undefined));
      const view = render(
        <>
          <div data-testid="toast">{lastToast().description}</div>
          <TaskErrorNotice reason="credits" />
        </>
      );
      const toastBody = () => within(screen.getByTestId('toast'));
      const taskNotice = () =>
        within(document.querySelector('[data-task-error]') as HTMLElement);

      act(() => {
        toastBody().getByRole('button', { name: 'Refresh' }).click();
      });
      for (const surface of [toastBody(), taskNotice()]) {
        expect(
          surface.getByRole('button', { name: 'Refreshing…' })
        ).toBeDisabled();
      }
      // Another click, or any other Refresh, joins the same read.
      act(() => {
        toastBody().getByRole('button', { name: 'Refreshing…' }).click();
        taskNotice().getByRole('button', { name: 'Refreshing…' }).click();
        void refreshUsage();
      });
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(mocks.get).toHaveBeenCalledTimes(3);

      await act(() =>
        vi.advanceTimersByTimeAsync(USAGE_REFRESH_TIMEOUT_MS - 1)
      );
      expect(
        toastBody().getByRole('button', { name: 'Refreshing…' })
      ).toBeDisabled();

      await act(() => vi.advanceTimersByTimeAsync(1));
      // Sonner shows the latest description it was given.
      view.rerender(
        <>
          <div data-testid="toast">{lastToast().description}</div>
          <TaskErrorNotice reason="credits" />
        </>
      );
      expect(lastToast().message).toBe('You’ve used today’s trial credits.');
      for (const surface of [toastBody(), taskNotice()]) {
        expect(surface.getByRole('button', { name: 'Refresh' })).toBeEnabled();
        expect(
          surface.getByText('Couldn’t refresh your credits. Try again.')
        ).toBeVisible();
      }
      act(() => acknowledgeUsageNotice());
      render(<LiveNotice />);
      expect(
        within(
          document.querySelector('[data-usage-notice]') as HTMLElement
        ).getByText('Couldn’t refresh your credits. Try again.')
      ).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps Upgrade plan and own key for a used-up trial total', async () => {
    respond(
      {
        plan_key: 'pro',
        is_trialing: true,
        trial_daily_credits_remaining: 0,
        trial_total_credits_remaining: 0,
      },
      500
    );
    await refreshUsage();
    render(<TaskErrorNotice reason="credits" />);
    expect(
      screen.getByText('You’ve used all your trial credits.')
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Upgrade plan' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Use your own API key' })
    ).toBeVisible();
  });
});
