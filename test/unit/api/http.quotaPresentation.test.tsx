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

import { fetchPost } from '@/api/http';
import { Toaster } from '@/components/ui/sonner';
import { notifyError } from '@/lib/notifyError';
import { classifyError, errorCopy } from '@/lib/usageErrors';
import { setConnectionConfig } from '@/store/connectionStore';
import { setUsageAccount, useUsageNoticeStore } from '@/store/usageNoticeStore';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/store/authStore', () => ({
  getAuthStore: () => ({ token: 'synthetic', user_id: 1 }),
  useAuthStore: (selector: (state: { appearance: string }) => unknown) =>
    selector({ appearance: 'light' }),
}));
vi.mock('@/host/createHost', () => ({ createHost: () => ({}) }));
beforeEach(() => {
  setUsageAccount(null);
  setConnectionConfig({
    brainEndpoint: 'http://brain.invalid',
    channel: 'web',
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  toast.dismiss();
  await waitFor(() =>
    expect(document.querySelector('[data-sonner-toast]')).toBeNull()
  );
  cleanup();
  vi.restoreAllMocks();
});
describe('quota HTTP to toast presentation', () => {
  it.each([
    { detail: { diagnostic: 'synthetic-secret', request_id: 'request-1' } },
    {
      detail: {
        code: 'future_quota_policy',
        message: '<img src=x onerror=alert(1)> synthetic-secret',
      },
    },
    {
      detail:
        "{'reason': 'trial_daily_exhausted', 'secret': 'synthetic-secret'}",
    },
  ])('never renders backend details: %j', async (payload) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 402,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'request-1',
        },
      })
    );
    const error = await fetchPost('/chat', {}).catch((error) => error);
    render(<Toaster />);
    notifyError(error);
    await waitFor(() =>
      expect(document.querySelector('[data-sonner-toast]')).not.toBeNull()
    );
    expect(document.body.textContent).not.toContain('synthetic-secret');
    expect(document.body.textContent).not.toContain('future_quota_policy');
    expect(document.body.textContent).not.toContain("{'reason'");
    expect(error.response.data).toEqual(payload);
    expect(error.response.headers.get('x-request-id')).toBe('request-1');
    expect(error.status).toBe(402);
    expect(error.usageReason).toBe('task');
    expect(useUsageNoticeStore.getState().incidents).toEqual([]);
  });
});

it.each([402, 403, 429])(
  'formats trial detail through HTTP %s with preserved diagnostics',
  async (status) => {
    const payload = {
      detail: { code: 'trial_daily_exhausted', request_id: 'request-2' },
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify(payload), {
          status,
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'request-2',
          },
        })
    );
    render(<Toaster />);
    for (let retry = 0; retry < 2; retry++) {
      const error = await fetchPost('/chat', {}).catch((error) => error);
      notifyError(error);
      await waitFor(() =>
        expect(
          screen.getAllByText(errorCopy('trial-daily')).length
        ).toBeGreaterThan(0)
      );
      expect(error.response.data).toEqual(payload);
      expect(error.usageReason).toBe(
        classifyError({ status, response: { data: payload } })
      );
      expect(useUsageNoticeStore.getState().incidents).toEqual([]);
    }
  }
);
it.each([
  '<html>synthetic-secret</html>',
  'x'.repeat(10000),
  "{'unknown': 'synthetic-secret'}",
])('sanitizes non-JSON HTTP failures', async (payload) => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(payload, {
      status: 402,
      headers: { 'content-type': 'text/plain', 'x-request-id': 'request-3' },
    })
  );
  const error = await fetchPost('/chat', {}).catch((error) => error);
  expect(error.message).toBe(errorCopy('task'));
  expect(error.cause).toBe(payload);
  expect(error.response.headers.get('x-request-id')).toBe('request-3');
  render(<Toaster />);
  notifyError(error.message);
  await screen.findByText(errorCopy('task'));
  expect(
    document.querySelector('[data-sonner-toast]')?.textContent
  ).not.toContain(payload);
});
