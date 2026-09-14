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

import { createHost } from '@/host/createHost';
import { errorCopy, type UsageReason } from '@/lib/usageErrors';
import i18n from 'i18next';
import { toast } from 'sonner';
import { create } from 'zustand';

export interface SubscriptionUsage {
  plan_key?: string;
  is_trialing?: boolean;
  monthly_credits?: number;
  trial_daily_credits_limit?: number;
  trial_daily_credits_used?: number;
  trial_daily_credits_remaining?: number;
  trial_total_credits_limit?: number;
  trial_total_credits_used?: number;
  trial_total_credits_remaining?: number;
}
export interface UsageIncident {
  reason: UsageReason;
  modelId?: string;
}
interface UsageNoticeState {
  account: string | null;
  modelType: string;
  incidents: UsageIncident[];
  acknowledged: string[];
  presented: string | null;
  credits: number | null;
  subscription: SubscriptionUsage | null;
  refreshing: boolean;
  refreshError: string | null;
}
const initial = {
  incidents: [],
  acknowledged: [],
  presented: null,
  credits: null,
  subscription: null,
  refreshing: false,
  refreshError: null,
};
export const useUsageNoticeStore = create<UsageNoticeState>(() => ({
  account: null,
  modelType: 'cloud',
  ...initial,
}));
const isCreditIncident = (incident: UsageIncident) =>
  !['service', 'model-access'].includes(incident.reason);
const key = (incident: UsageIncident) =>
  isCreditIncident(incident)
    ? 'credits'
    : `${incident.reason}:${incident.reason === 'model-access' ? (incident.modelId ?? '') : ''}`;
let accountEpoch = 0;
let incidentVersion = 0;
const slot = (account: string) => `usage-availability:${account}`;
const priority = (incident: UsageIncident) =>
  incident.reason === 'service'
    ? 3
    : incident.reason === 'model-access'
      ? 1
      : 2;
export const activeUsageIncident = (state: UsageNoticeState) =>
  [...state.incidents].sort((a, b) => priority(b) - priority(a))[0] ?? null;

export function setUsageAccount(account: string | null) {
  const previous = useUsageNoticeStore.getState().account;
  if (previous === account) return;
  accountEpoch += 1;
  inFlight = null;
  if (previous) toast.dismiss(slot(previous));
  useUsageNoticeStore.setState({ ...initial, account });
}

export function contactSupport() {
  const url = 'mailto:support@eigent.ai';
  const openMailto = createHost().electronAPI?.openMailto;
  if (openMailto)
    void openMailto(url).catch(() => {
      window.location.href = url;
    });
  else window.location.href = url;
}

export function acknowledgeUsageNotice() {
  const state = useUsageNoticeStore.getState();
  useUsageNoticeStore.setState({
    acknowledged: [
      ...new Set([...state.acknowledged, ...state.incidents.map(key)]),
    ],
    presented: null,
  });
  if (state.account) toast.dismiss(slot(state.account));
}

function syncReminder() {
  const state = useUsageNoticeStore.getState();
  const incident = activeUsageIncident(state);
  if (!state.account || state.modelType !== 'cloud') return;
  if (!incident) {
    if (state.presented) toast.dismiss(slot(state.account));
    useUsageNoticeStore.setState({ presented: null });
    return;
  }
  const identity = key(incident);
  // No Sonner call on repeats: even updating an identical toast restarts its timer.
  if (state.acknowledged.includes(identity)) {
    if (state.presented) toast.dismiss(slot(state.account));
    useUsageNoticeStore.setState({ presented: null });
    return;
  }
  if (state.presented === identity) return;
  useUsageNoticeStore.setState({ presented: identity });
  const account = state.account;
  const acknowledge = () => {
    if (useUsageNoticeStore.getState().account === account)
      acknowledgeUsageNotice();
  };
  toast.error(errorCopy(incident.reason), {
    id: slot(account),
    duration: Infinity,
    closeButton: true,
    icon: null,
    description: i18n.t(
      incident.reason === 'service'
        ? 'chat.notice-contact-description'
        : 'chat.notice-refresh-description'
    ),
    action: {
      label: i18n.t(
        incident.reason === 'service'
          ? 'chat.notice-contact-support'
          : 'chat.notice-refresh'
      ),
      onClick: (event) => {
        event.preventDefault();
        if (incident.reason === 'service') contactSupport();
        else void refreshUsage();
      },
    },
    onDismiss: acknowledge,
    onAutoClose: acknowledge,
  });
}

export function reportUsageIncident(
  incident: UsageIncident,
  account = useUsageNoticeStore.getState().account
) {
  const state = useUsageNoticeStore.getState();
  if (!account || state.account !== account) return;
  incidentVersion += 1;
  const previous = state.incidents.find((item) => key(item) === key(incident));
  if (
    previous?.reason === 'credits' &&
    isCreditIncident(incident) &&
    incident.reason !== 'credits'
  ) {
    useUsageNoticeStore.setState({
      incidents: state.incidents.map((item) =>
        item === previous ? incident : item
      ),
    });
  }
  if (!previous) {
    useUsageNoticeStore.setState({
      incidents: [...state.incidents, incident],
      refreshError: null,
    });
  }
  syncReminder();
}

let inFlight: { account: string; promise: Promise<void> } | null = null;
/** Read-only and shared by all surfaces; never retries a task or changes billing. */
export function refreshUsage(): Promise<void> {
  const account = useUsageNoticeStore.getState().account;
  const epoch = accountEpoch;
  const version = incidentVersion;
  if (!account) return Promise.resolve();
  if (inFlight?.account === account) return inFlight.promise;
  useUsageNoticeStore.setState({ refreshing: true, refreshError: null });
  const promise = (async () => {
    const { proxyFetchGet } = await import('@/api/http');
    const results = await Promise.allSettled([
      proxyFetchGet('/api/v1/subscription'),
      proxyFetchGet('/api/v1/user/current_credits'),
      proxyFetchGet('/api/v1/user/key'),
    ]);
    if (
      useUsageNoticeStore.getState().account !== account ||
      accountEpoch !== epoch
    )
      return;
    const [subscriptionResult, creditsResult, keyResult] = results;
    const subscription =
      subscriptionResult.status === 'fulfilled' &&
      typeof subscriptionResult.value?.plan_key === 'string'
        ? (subscriptionResult.value as SubscriptionUsage)
        : null;
    const credits =
      creditsResult.status === 'fulfilled' &&
      typeof creditsResult.value?.credits === 'number' &&
      Number.isFinite(creditsResult.value.credits)
        ? creditsResult.value.credits
        : null;
    const access =
      keyResult.status === 'fulfilled' && Boolean(keyResult.value?.value);
    const state = useUsageNoticeStore.getState();
    // A usable key alone does not establish per-model entitlement or upstream availability.
    const recoveredCredits =
      version === incidentVersion &&
      credits !== null &&
      credits > 0 &&
      access &&
      subscription !== null &&
      (!subscription.is_trialing ||
        (subscription.trial_daily_credits_remaining != null &&
          subscription.trial_daily_credits_remaining > 0 &&
          subscription.trial_total_credits_remaining != null &&
          subscription.trial_total_credits_remaining > 0));
    const recoveredAccess =
      version === incidentVersion &&
      access &&
      !subscription?.is_trialing &&
      ['plus', 'pro'].includes(subscription?.plan_key?.toLowerCase() ?? '');
    const incidents = state.incidents.filter(
      (item) =>
        item.reason === 'service' ||
        (item.reason === 'model-access' ? !recoveredAccess : !recoveredCredits)
    );
    useUsageNoticeStore.setState({
      subscription,
      credits,
      incidents,
      acknowledged: state.acknowledged.filter((identity) =>
        incidents.some((item) => key(item) === identity)
      ),
      refreshError: state.incidents.some((item) => item.reason === 'service')
        ? null
        : subscription === null ||
            credits === null ||
            keyResult.status === 'rejected'
          ? 'chat.notice-refresh-failed'
          : incidents.some((item) => item.reason === 'model-access')
            ? 'chat.notice-access-unverified'
            : null,
    });
    if (
      subscription?.is_trialing &&
      subscription.trial_total_credits_remaining != null &&
      subscription.trial_total_credits_remaining <= 0
    )
      reportUsageIncident({ reason: 'trial-total' }, account);
    else if (
      subscription?.is_trialing &&
      subscription.trial_daily_credits_remaining != null &&
      subscription.trial_daily_credits_remaining <= 0
    )
      reportUsageIncident({ reason: 'trial-daily' }, account);
    else if (credits !== null && credits <= 0)
      reportUsageIncident(
        {
          reason:
            subscription?.plan_key === 'free' ? 'free-credits' : 'credits',
        },
        account
      );
    syncReminder();
  })().finally(() => {
    if (inFlight?.promise === promise) {
      inFlight = null;
      if (
        useUsageNoticeStore.getState().account === account &&
        accountEpoch === epoch
      )
        useUsageNoticeStore.setState({ refreshing: false });
    }
  });
  inFlight = { account, promise };
  return promise;
}

/** Actual successful cloud work is evidence of recovery; Refresh never performs work. */
export function confirmCloudRecovery(account: string | null, modelId?: string) {
  const state = useUsageNoticeStore.getState();
  if (!account || state.account !== account) return;
  const incidents = state.incidents.filter(
    (item) =>
      !(
        (item.reason === 'service' || item.reason === 'model-access') &&
        modelId &&
        item.modelId === modelId
      )
  );
  useUsageNoticeStore.setState({
    incidents,
    acknowledged: state.acknowledged.filter((identity) =>
      incidents.some((item) => key(item) === identity)
    ),
    refreshError: null,
  });
  syncReminder();
}

export function setUsageModelType(modelType: string) {
  const state = useUsageNoticeStore.getState();
  if (state.modelType === modelType) return;
  useUsageNoticeStore.setState({ modelType });
  if (modelType !== 'cloud') {
    if (state.account && state.presented) toast.dismiss(slot(state.account));
    useUsageNoticeStore.setState({ presented: null });
  } else syncReminder();
}
