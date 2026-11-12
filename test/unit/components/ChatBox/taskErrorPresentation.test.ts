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

import { taskErrorReason } from '@/components/ChatBox/taskErrorPresentation';
import {
  usePresentedUsageReason,
  useUsageNoticeStore,
} from '@/store/usageNoticeStore';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

// Production shape of a gateway spend-limit failure in a task error notice.
const budgetExceeded = {
  severity: 'error' as const,
  content:
    "Error code: 400 - {'error': {'message': 'Budget has been exceeded! Current cost: 0.51, Max budget: 0.5', 'type': 'budget_exceeded', 'param': None, 'code': '400'}}",
};
const legacyStep = {
  severity: 'error' as const,
  content: '',
  legacyStep: 'budget_not_enough',
};
const trial = {
  plan_key: 'pro',
  is_trialing: true,
  trial_total_credits_remaining: 859,
};

describe('task error summaries during a trial', () => {
  afterEach(() => {
    useUsageNoticeStore.setState({ subscription: null });
  });

  it('keeps the reason that was recorded with the failure', () => {
    useUsageNoticeStore.setState({ subscription: trial });

    // The account is applied where the reason is shown, so it can change later.
    expect(taskErrorReason(budgetExceeded)).toBe('credits');
    expect(taskErrorReason(legacyStep)).toBe('credits');
  });

  it('describes a spend limit as the trial allowance while trialing', () => {
    useUsageNoticeStore.setState({ subscription: trial });
    const { result } = renderHook(() => usePresentedUsageReason());

    expect(result.current(taskErrorReason(budgetExceeded)!)).toBe(
      'trial-daily'
    );
    expect(result.current(taskErrorReason(legacyStep)!)).toBe('trial-daily');
  });

  it('follows the account when the whole trial turns out to be used up', () => {
    useUsageNoticeStore.setState({ subscription: trial });
    const { result } = renderHook(() => usePresentedUsageReason());

    act(() =>
      useUsageNoticeStore.setState({
        subscription: { ...trial, trial_total_credits_remaining: 0 },
      })
    );

    expect(result.current(taskErrorReason(budgetExceeded)!)).toBe(
      'trial-total'
    );
  });

  it('keeps out of credits for an account that is not trialing', () => {
    useUsageNoticeStore.setState({
      subscription: { plan_key: 'pro', is_trialing: false },
    });
    const { result } = renderHook(() => usePresentedUsageReason());

    expect(result.current(taskErrorReason(budgetExceeded)!)).toBe('credits');
  });
});
