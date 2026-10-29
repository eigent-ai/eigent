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

import type { ErrorReason } from '@/lib/usageErrors';
import { openSettings } from '@/store/settingsStore';

interface RecoverySubscription {
  plan_key?: string | null;
  is_trialing?: boolean | null;
  trial_used?: boolean | null;
  trial_available?: boolean | null;
}

/** Balance blockers a purchase can clear. The daily trial cap resets on its own. */
export const isCreditRecoveryReason = (reason: ErrorReason) =>
  ['credits', 'free-credits', 'trial-total'].includes(reason);

/**
 * A zero balance on an account with no plan, trial, or paid history is a
 * starting point rather than a balance that ran out.
 */
export const isAccountWithoutCredits = (
  reason: ErrorReason,
  subscription: RecoverySubscription | null | undefined,
  credits: number | null
) =>
  (reason === 'credits' || reason === 'free-credits') &&
  credits !== null &&
  credits <= 0 &&
  subscription?.plan_key?.toLowerCase() === 'free' &&
  subscription.is_trialing !== true &&
  subscription.trial_used !== true &&
  subscription.trial_available === true;

/** Plans, trials, and billing are all managed on the website's pricing page. */
export function openPricing() {
  // Loaded on use: the usage store reaches this module and must stay light.
  void import('@/lib').then(({ SITE_URL }) => {
    window.location.href = `${SITE_URL}/pricing`;
  });
}

export function openModelSettings() {
  openSettings('models');
}
