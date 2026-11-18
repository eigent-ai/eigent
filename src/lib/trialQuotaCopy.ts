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

import { errorCopy, type ErrorReason } from '@/lib/usageErrors';
import i18n from 'i18next';

interface TrialSubscription {
  plan_key?: string | null;
  is_trialing?: boolean | null;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** A plan name alone never establishes a trial (nor does a positive balance). */
export function trialQuotaCopy(
  subscription: TrialSubscription | null | undefined,
  period: 'daily' | 'total',
  exhausted: boolean,
  t: Translate,
  percent?: number
): string {
  const planKey = subscription?.plan_key?.toLowerCase();
  const plan =
    subscription?.is_trialing === true
      ? planKey === 'pro'
        ? 'Pro'
        : planKey === 'plus'
          ? 'Plus'
          : null
      : null;
  if (plan) {
    return t(
      period === 'daily'
        ? exhausted
          ? 'chat.usage-limit-plan-trial-daily-exhausted'
          : 'chat.usage-limit-plan-trial-daily-warning'
        : exhausted
          ? 'chat.usage-limit-plan-trial-total-exhausted'
          : 'chat.usage-limit-plan-trial-total-warning',
      { plan, percent }
    );
  }
  return t(
    period === 'daily'
      ? exhausted
        ? 'chat.notice-trial-daily'
        : 'chat.usage-limit-trial-daily-warning'
      : exhausted
        ? 'chat.notice-trial-total'
        : 'chat.usage-limit-trial-total-warning',
    { percent }
  );
}

interface TrialAllowance extends TrialSubscription {
  trial_daily_credits_remaining?: number | null;
  trial_total_credits_remaining?: number | null;
}

/**
 * While an account is trialing, purchased credits cannot be spent beyond the
 * trial's allowance, so a spend-limit failure means that allowance is used up
 * rather than that the account is out of credits.
 */
export function trialAwareUsageReason<Reason extends ErrorReason>(
  reason: Reason,
  subscription: TrialAllowance | null | undefined,
  credits?: number | null
): Reason | 'trial-daily' | 'trial-total' {
  if (reason !== 'credits' || subscription?.is_trialing !== true) return reason;
  const totalRemaining = subscription.trial_total_credits_remaining;
  if (totalRemaining != null && totalRemaining <= 0) return 'trial-total';
  const dailyRemaining = subscription.trial_daily_credits_remaining;
  // An empty balance with allowance left is out of credits, trial or not.
  if (
    credits != null &&
    credits <= 0 &&
    !(dailyRemaining != null && dailyRemaining <= 0)
  )
    return reason;
  return 'trial-daily';
}

/** Current account notices only. Historical errors have no subscription snapshot. */
export function usageNoticeCopy(
  reason: ErrorReason,
  subscription: TrialSubscription | null | undefined
): string {
  if (reason === 'trial-daily' || reason === 'trial-total') {
    return trialQuotaCopy(
      subscription,
      reason === 'trial-daily' ? 'daily' : 'total',
      true,
      (key, options) => i18n.t(key, options)
    );
  }
  return errorCopy(reason);
}
