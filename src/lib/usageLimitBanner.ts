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

import { trialQuotaCopy } from '@/lib/trialQuotaCopy';

const USAGE_WARNING_RATIO = 0.75;
const FREE_STARTING_CREDITS = 500;

interface SubscriptionLimitInfo {
  plan_key?: string | null;
  is_trialing?: boolean | null;
  monthly_credits?: number | null;
  trial_daily_credits_limit?: number | null;
  trial_daily_credits_used?: number | null;
  trial_daily_credits_remaining?: number | null;
  trial_total_credits_limit?: number | null;
  trial_total_credits_used?: number | null;
  trial_total_credits_remaining?: number | null;
}

interface UsageLimitBannerState {
  id: string;
  message: string;
  actionLabel: string;
  severity: 'warning' | 'danger';
}

const toFiniteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const usagePercent = (used: number, limit: number) =>
  Math.min(100, Math.max(0, Math.round((used / limit) * 100)));

export const buildUsageLimitBannerState = (
  subscription: SubscriptionLimitInfo | null,
  currentCredits: number | null,
  t: (key: string, options?: Record<string, unknown>) => string
): UsageLimitBannerState | null => {
  const actionLabel = t('chat.usage-limit-action');

  if (subscription?.is_trialing === true) {
    const trialCandidates = [
      {
        id: 'trial-daily',
        period: 'daily' as const,
        limit: toFiniteNumber(subscription.trial_daily_credits_limit),
        used: toFiniteNumber(subscription.trial_daily_credits_used),
        remaining: toFiniteNumber(subscription.trial_daily_credits_remaining),
      },
      {
        id: 'trial-total',
        period: 'total' as const,
        limit: toFiniteNumber(subscription.trial_total_credits_limit),
        used: toFiniteNumber(subscription.trial_total_credits_used),
        remaining: toFiniteNumber(subscription.trial_total_credits_remaining),
      },
    ]
      .map((candidate) => {
        if (!candidate.limit || candidate.limit <= 0 || candidate.used === null)
          return null;

        const remaining =
          candidate.remaining ?? Math.max(candidate.limit - candidate.used, 0);
        const ratio = candidate.used / candidate.limit;
        const exhausted = remaining <= 0 || candidate.used >= candidate.limit;

        if (!exhausted && ratio < USAGE_WARNING_RATIO) return null;

        const percent = usagePercent(candidate.used, candidate.limit);
        return {
          id: `${candidate.id}:${exhausted ? 'exhausted' : 'warning'}`,
          message: trialQuotaCopy(
            subscription,
            candidate.period,
            exhausted,
            t,
            percent
          ),
          actionLabel,
          severity: exhausted ? ('danger' as const) : ('warning' as const),
          ratio,
          exhausted,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a!.exhausted !== b!.exhausted) {
          return a!.exhausted ? -1 : 1;
        }
        return b!.ratio - a!.ratio;
      });

    if (trialCandidates[0]) {
      const {
        ratio: _ratio,
        exhausted: _exhausted,
        ...banner
      } = trialCandidates[0];
      return banner;
    }
  }

  if (currentCredits === null) return null;

  if (currentCredits <= 0) {
    const planKey = subscription?.plan_key?.toLowerCase() || 'unknown';
    return {
      id: `credits-exhausted:${planKey}`,
      message: t(
        planKey === 'free' ? 'chat.notice-free-credits' : 'chat.notice-credits'
      ),
      actionLabel,
      severity: 'danger',
    };
  }

  if (!subscription?.plan_key) return null;
  const planKey = subscription.plan_key.toLowerCase();
  const limit =
    planKey === 'free'
      ? FREE_STARTING_CREDITS
      : toFiniteNumber(subscription?.monthly_credits);

  if (!limit || limit <= 0) return null;

  const remainingRatio = currentCredits / limit;
  if (remainingRatio > 1 - USAGE_WARNING_RATIO) return null;

  const percent = usagePercent(limit - currentCredits, limit);
  return {
    id: `${planKey === 'free' ? 'free' : 'monthly'}-credits:warning`,
    message: t(
      planKey === 'free'
        ? 'chat.usage-limit-free-warning'
        : 'chat.usage-limit-monthly-warning',
      { percent }
    ),
    actionLabel,
    severity: 'warning',
  };
};
