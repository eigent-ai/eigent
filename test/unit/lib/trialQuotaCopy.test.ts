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

import { trialQuotaCopy, usageNoticeCopy } from '@/lib/trialQuotaCopy';
import { errorCopy } from '@/lib/usageErrors';
import { buildUsageLimitBannerState } from '@/lib/usageLimitBanner';
import i18n from 'i18next';
import { describe, expect, it } from 'vitest';

const t = (key: string, options?: Record<string, unknown>) =>
  i18n.t(key, options);
const trial = {
  plan_key: 'pro',
  is_trialing: true,
  monthly_credits: 10000,
  trial_daily_credits_limit: 300,
  trial_daily_credits_used: 288,
  trial_daily_credits_remaining: 12,
  trial_total_credits_limit: 1000,
  trial_total_credits_used: 528,
  trial_total_credits_remaining: 472,
};

describe('trial quota presentation', () => {
  it.each(['pro', 'Pro', 'plus', 'Plus'])(
    'names the confirmed %s trial at the reported 96%% daily usage',
    (plan_key) => {
      const plan = plan_key.toLowerCase() === 'pro' ? 'Pro' : 'Plus';
      expect(
        buildUsageLimitBannerState({ ...trial, plan_key }, 472, t)
      ).toMatchObject({
        id: 'trial-daily:warning',
        severity: 'warning',
        message: `You've used 96% of today's ${plan} trial credit limit`,
      });
    }
  );

  it.each(['daily', 'total'] as const)(
    'distinguishes %s warning and exhaustion',
    (period) => {
      for (const exhausted of [false, true]) {
        const subscription = {
          ...trial,
          trial_daily_credits_used: 0,
          trial_daily_credits_remaining: 300,
          [`trial_${period}_credits_used`]: exhausted
            ? period === 'daily'
              ? 300
              : 1000
            : period === 'daily'
              ? 240
              : 800,
          [`trial_${period}_credits_remaining`]: exhausted
            ? 0
            : period === 'daily'
              ? 60
              : 200,
        };
        expect(buildUsageLimitBannerState(subscription, 472, t)).toMatchObject({
          id: `trial-${period}:${exhausted ? 'exhausted' : 'warning'}`,
          severity: exhausted ? 'danger' : 'warning',
          message: trialQuotaCopy(subscription, period, exhausted, t, 80),
        });
      }
    }
  );

  it('keeps exhaustion above warnings and leaves the existing threshold unchanged', () => {
    expect(
      buildUsageLimitBannerState(
        {
          ...trial,
          trial_total_credits_used: 1000,
          trial_total_credits_remaining: 0,
        },
        472,
        t
      )?.id
    ).toBe('trial-total:exhausted');
    expect(
      buildUsageLimitBannerState(
        { ...trial, trial_daily_credits_used: 224 },
        9000,
        t
      )
    ).toBeNull();
    expect(
      buildUsageLimitBannerState(
        { ...trial, trial_daily_credits_used: 225 },
        9000,
        t
      )?.message
    ).toContain('75%');
  });

  it.each([false, undefined, null])(
    'never calls paid or unconfirmed Pro a trial when is_trialing=%s',
    (is_trialing) => {
      expect(
        buildUsageLimitBannerState({ ...trial, is_trialing }, 2000, t)
      ).toMatchObject({
        id: 'monthly-credits:warning',
        message: t('chat.usage-limit-monthly-warning', { percent: 80 }),
      });
      expect(
        buildUsageLimitBannerState({ ...trial, is_trialing }, 0, t)?.message
      ).toBe(errorCopy('credits'));
    }
  );

  it('uses free-account credit wording for the actual Free/false response', () => {
    const free = { plan_key: 'Free', is_trialing: false, monthly_credits: 0 };
    expect(buildUsageLimitBannerState(free, 100, t)?.message).toBe(
      t('chat.usage-limit-free-warning', { percent: 80 })
    );
    expect(buildUsageLimitBannerState(free, 0, t)?.message).toBe(
      errorCopy('free-credits')
    );
  });

  it.each(['Free', 'enterprise', '', undefined, null])(
    'does not invent a plan trial for %s',
    (plan_key) => {
      const subscription = { ...trial, plan_key };
      expect(buildUsageLimitBannerState(subscription, 472, t)?.message).toBe(
        "You've used 96% of today's trial credit limit"
      );
      expect(usageNoticeCopy('trial-daily', subscription)).toBe(
        errorCopy('trial-daily')
      );
    }
  );

  it('does not label unavailable subscription data as a free account', () => {
    expect(buildUsageLimitBannerState(null, null, t)).toBeNull();
    expect(buildUsageLimitBannerState(null, 472, t)).toBeNull();
    expect(buildUsageLimitBannerState(null, 0, t)?.message).toBe(
      errorCopy('credits')
    );
    expect(
      buildUsageLimitBannerState({ plan_key: 'future' }, 0, t)?.message
    ).toBe(errorCopy('credits'));
  });

  it.each([null, undefined, NaN, Infinity, 0, -1])(
    'does not fabricate a quota for invalid/missing limit %s',
    (limit) => {
      expect(
        buildUsageLimitBannerState(
          { ...trial, trial_daily_credits_limit: limit },
          null,
          t
        )
      ).toBeNull();
    }
  );

  it.each([null, undefined, NaN, Infinity])(
    'does not fabricate usage for invalid/missing used %s',
    (used) => {
      expect(
        buildUsageLimitBannerState(
          { ...trial, trial_daily_credits_used: used },
          null,
          t
        )
      ).toBeNull();
    }
  );

  it('retains the existing calculated-remaining fallback and clamps over-limit percentages', () => {
    expect(
      buildUsageLimitBannerState(
        {
          ...trial,
          trial_daily_credits_used: 400,
          trial_daily_credits_remaining: null,
        },
        null,
        t
      )
    ).toMatchObject({
      severity: 'danger',
      message: "You've reached today's Pro trial credit limit",
    });
  });

  it('names live exhaustion only from a confirmed current trial and leaves history generic', () => {
    expect(usageNoticeCopy('trial-daily', trial)).toBe(
      "You've reached today's Pro trial credit limit"
    );
    expect(usageNoticeCopy('trial-total', trial)).toBe(
      "You've used all your Pro trial credits"
    );
    expect(
      usageNoticeCopy('trial-daily', { ...trial, is_trialing: false })
    ).toBe(errorCopy('trial-daily'));
    expect(errorCopy('trial-daily')).not.toMatch(/Pro|free/i);
    expect(usageNoticeCopy('credits', trial)).toBe(errorCopy('credits'));
    expect(usageNoticeCopy('service', trial)).toBe(errorCopy('service'));
  });
});
