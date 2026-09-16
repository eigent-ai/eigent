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
  acknowledgeUsageNotice,
  activeUsageIncident,
  confirmCloudRecovery,
  contactSupport,
  refreshUsage,
  reportUsageIncident,
  setUsageAccount,
  setUsageModelType,
  useUsageNoticeStore,
} from '@/store/usageNoticeStore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  error: vi.fn(),
  dismiss: vi.fn(),
  get: vi.fn(),
  openMailto: vi.fn(async () => ({ success: true })),
}));
vi.mock('sonner', () => ({
  toast: { error: mocks.error, dismiss: mocks.dismiss },
}));
vi.mock('i18next', () => ({ default: { t: (key: string) => key } }));
vi.mock('@/host/createHost', () => ({
  createHost: () => ({ electronAPI: { openMailto: mocks.openMailto } }),
}));
vi.mock('@/api/http', () => ({ proxyFetchGet: mocks.get }));

function healthy() {
  mocks.get.mockImplementation(async (url: string) =>
    url.endsWith('subscription')
      ? { plan_key: 'plus', is_trialing: false }
      : url.endsWith('current_credits')
        ? { credits: 100 }
        : { value: 'redacted-test-key' }
  );
}

describe('account-scoped usage reminders', () => {
  beforeEach(() => {
    setUsageAccount(null);
    vi.clearAllMocks();
    setUsageAccount('account-a');
    setUsageModelType('cloud');
    healthy();
  });
  it('emits once for 20 repeated failures across tasks and once for a meaningful escalation', () => {
    for (let i = 0; i < 20; i++)
      reportUsageIncident({ reason: 'credits', modelId: String(i) });
    expect(mocks.error).toHaveBeenCalledTimes(1);
    reportUsageIncident({ reason: 'service' });
    expect(mocks.error).toHaveBeenCalledTimes(2);
    expect(mocks.error.mock.calls.map((call) => call[1].id)).toEqual([
      'usage-availability:account-a',
      'usage-availability:account-a',
    ]);
  });
  it('does not recreate a dismissed incident during repeats or focus refresh', async () => {
    reportUsageIncident({ reason: 'credits' });
    mocks.error.mock.calls[0][1].onDismiss();
    for (let i = 0; i < 20; i++)
      reportUsageIncident({ reason: 'free-credits' });
    mocks.get.mockImplementation(async (url: string) =>
      url.endsWith('subscription')
        ? { plan_key: 'free' }
        : url.endsWith('current_credits')
          ? { credits: 0 }
          : { code: 20 }
    );
    await refreshUsage();
    expect(mocks.error).toHaveBeenCalledTimes(1);
    expect(activeUsageIncident(useUsageNoticeStore.getState())?.reason).toBe(
      'free-credits'
    );
  });
  it('coalesces Refresh calls and clears a recovered balance without a success popup', async () => {
    reportUsageIncident({ reason: 'credits' });
    const a = refreshUsage();
    const b = refreshUsage();
    expect(a).toBe(b);
    await a;
    expect(mocks.get).toHaveBeenCalledTimes(3);
    expect(useUsageNoticeStore.getState().incidents).toEqual([]);
    expect(mocks.dismiss).toHaveBeenCalledWith('usage-availability:account-a');
    expect(mocks.error).toHaveBeenCalledTimes(1);
  });
  it('never equates positive user credits to managed-service recovery', async () => {
    reportUsageIncident({ reason: 'service' });
    await refreshUsage();
    expect(activeUsageIncident(useUsageNoticeStore.getState())?.reason).toBe(
      'service'
    );
    expect(useUsageNoticeStore.getState().refreshError).toBeNull();
  });
  it('keeps unavailable balances unknown and reports refresh failure inline', async () => {
    reportUsageIncident({ reason: 'credits' });
    mocks.get.mockRejectedValue(new Error('offline'));
    await refreshUsage();
    expect(useUsageNoticeStore.getState()).toMatchObject({
      credits: null,
      refreshing: false,
      refreshError: 'chat.notice-refresh-failed',
    });
    expect(mocks.error).toHaveBeenCalledTimes(1);
  });
  it('ignores stale responses after logout and login to the same account', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.get.mockImplementation(async (url: string) => {
      await gate;
      return url.endsWith('subscription')
        ? { plan_key: 'free' }
        : url.endsWith('current_credits')
          ? { credits: 0 }
          : { value: 'old-key' };
    });
    const request = refreshUsage();
    await vi.waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(3));
    setUsageAccount(null);
    setUsageAccount('account-a');
    setUsageModelType('cloud');
    healthy();
    await refreshUsage();
    release();
    await request;
    expect(useUsageNoticeStore.getState().credits).toBe(100);
    expect(useUsageNoticeStore.getState().incidents).toEqual([]);
  });
  it('keeps a new incident when an older successful refresh arrives', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    mocks.get.mockImplementation(async (url: string) => {
      await gate;
      return url.endsWith('subscription')
        ? { plan_key: 'plus' }
        : url.endsWith('current_credits')
          ? { credits: 100 }
          : { value: 'test-key' };
    });
    const request = refreshUsage();
    reportUsageIncident({ reason: 'credits' });
    release();
    await request;
    expect(activeUsageIncident(useUsageNoticeStore.getState())?.reason).toBe(
      'credits'
    );
  });
  it('removes a recovered service toast when the remaining credit incident was acknowledged', () => {
    reportUsageIncident({ reason: 'credits' });
    acknowledgeUsageNotice();
    reportUsageIncident({ reason: 'service', modelId: 'model-a' });
    confirmCloudRecovery('account-a', 'model-a');
    expect(useUsageNoticeStore.getState().presented).toBeNull();
    expect(mocks.error).toHaveBeenCalledTimes(2);
  });
  it.each(['model-a', 'model-b'])(
    'keeps the shared service reminder until both models recover, starting with %s',
    (recoveredModel) => {
      const remainingModel =
        recoveredModel === 'model-a' ? 'model-b' : 'model-a';
      reportUsageIncident({ reason: 'service', modelId: 'model-a' });
      reportUsageIncident({ reason: 'service', modelId: 'model-b' });
      confirmCloudRecovery('account-a', recoveredModel);

      expect(activeUsageIncident(useUsageNoticeStore.getState())).toMatchObject(
        {
          reason: 'service',
          modelId: remainingModel,
        }
      );
      expect(useUsageNoticeStore.getState().presented).toBe('service:');
      expect(mocks.error).toHaveBeenCalledTimes(1);
      expect(mocks.dismiss).not.toHaveBeenCalled();

      confirmCloudRecovery('account-a', remainingModel);
      expect(useUsageNoticeStore.getState().incidents).toEqual([]);
      expect(mocks.dismiss).toHaveBeenCalledWith(
        'usage-availability:account-a'
      );
    }
  );
  it('preserves dismissal for an unrecovered model, then announces a new incident after full recovery', () => {
    reportUsageIncident({ reason: 'service', modelId: 'model-a' });
    reportUsageIncident({ reason: 'service', modelId: 'model-b' });
    acknowledgeUsageNotice();
    confirmCloudRecovery('account-a', 'model-a');
    reportUsageIncident({ reason: 'service', modelId: 'model-b' });
    setUsageModelType('custom');
    setUsageModelType('cloud');

    expect(activeUsageIncident(useUsageNoticeStore.getState())?.modelId).toBe(
      'model-b'
    );
    expect(useUsageNoticeStore.getState().presented).toBeNull();
    expect(mocks.error).toHaveBeenCalledTimes(1);

    confirmCloudRecovery('account-a', 'model-b');
    reportUsageIncident({ reason: 'service', modelId: 'model-b' });
    expect(mocks.error).toHaveBeenCalledTimes(2);
  });
  it('does not infer recovery for another model or an unknown model from one successful model', () => {
    reportUsageIncident({ reason: 'service', modelId: 'model-a' });
    reportUsageIncident({ reason: 'service' });
    confirmCloudRecovery('account-b', 'model-a');
    confirmCloudRecovery('account-a', 'model-c');
    confirmCloudRecovery('account-a');
    expect(useUsageNoticeStore.getState().incidents).toHaveLength(2);

    confirmCloudRecovery('account-a', 'model-a');
    expect(activeUsageIncident(useUsageNoticeStore.getState())).toEqual({
      reason: 'service',
    });
    expect(mocks.dismiss).not.toHaveBeenCalled();
  });
  it('does not interrupt local-model work with cloud reminders', () => {
    setUsageModelType('local');
    reportUsageIncident({ reason: 'credits' });
    expect(mocks.error).not.toHaveBeenCalled();
    setUsageModelType('cloud');
    expect(mocks.error).toHaveBeenCalledTimes(1);
  });
  it('opens a support email draft using the desktop bridge', () => {
    contactSupport();
    expect(mocks.openMailto).toHaveBeenCalledWith('mailto:support@eigent.ai');
  });
  it('never dismisses unrelated notifications', () => {
    reportUsageIncident({ reason: 'credits' });
    acknowledgeUsageNotice();
    setUsageAccount('account-b');
    for (const call of mocks.dismiss.mock.calls)
      expect(call[0]).toBe('usage-availability:account-a');
  });
});
