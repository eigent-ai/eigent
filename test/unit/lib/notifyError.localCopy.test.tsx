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

import { Toaster } from '@/components/ui/sonner';
import { notifyError } from '@/lib/notifyError';
import { spaceModelError } from '@/lib/spaceModelBinding';
import { errorCopy } from '@/lib/usageErrors';
import { setUsageAccount, useUsageNoticeStore } from '@/store/usageNoticeStore';
import { cleanup, render, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { toast } from 'sonner';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/store/authStore', () => ({
  getAuthStore: () => ({}),
  useAuthStore: (selector: any) => selector({ appearance: 'light' }),
}));
vi.mock('@/host/createHost', () => ({ createHost: () => ({}) }));
beforeEach(() => setUsageAccount(null));
afterEach(async () => {
  toast.dismiss();
  await waitFor(() =>
    expect(document.querySelector('[data-sonner-toast]')).toBeNull()
  );
  cleanup();
  vi.restoreAllMocks();
});
it.each(['unavailable', 'changed', 'ambiguous', 'unconfirmed'] as const)(
  'preserves local Space model guidance in real Sonner: %s',
  async (reason) => {
    const error = spaceModelError(reason);
    render(<Toaster />);
    notifyError(error);
    await waitFor(() =>
      expect(document.querySelector('[data-sonner-toast]')?.textContent).toBe(
        i18next.t(`chat.space-model-${reason}`)
      )
    );
    expect(useUsageNoticeStore.getState().incidents).toEqual([]);
  }
);

it.each([
  'plain remote',
  'forged marker',
  'matching copy',
  'inherited local',
  'proxied local',
])('keeps an unregistered Error safe without response: %s', async (kind) => {
  const local = spaceModelError('unavailable');
  const error =
    kind === 'inherited local'
      ? Object.create(local)
      : kind === 'proxied local'
        ? new Proxy(local, {})
        : new Error(
            kind === 'matching copy' ? local.message : 'SYNTHETIC_PRIVATE'
          );
  if (kind === 'forged marker')
    Object.assign(error, {
      name: 'LocalError',
      isLocal: true,
      localMessage: local.message,
    });
  render(<Toaster />);
  notifyError(error);
  await waitFor(() =>
    expect(document.querySelector('[data-sonner-toast]')?.textContent).toBe(
      errorCopy('task')
    )
  );
  expect(document.body.textContent).not.toContain('SYNTHETIC_PRIVATE');
  expect(useUsageNoticeStore.getState().incidents).toEqual([]);
});

it.each(['mutated message', 'message accessor'])(
  'reads registered local copy without using a %s',
  async (kind) => {
    const error = spaceModelError('changed');
    const getter = vi.fn(() => {
      throw new Error('getter executed');
    });
    if (kind === 'message accessor')
      Object.defineProperty(error, 'message', { get: getter });
    else error.message = 'SYNTHETIC_PRIVATE';
    render(<Toaster />);
    notifyError(error);
    await waitFor(() =>
      expect(document.querySelector('[data-sonner-toast]')?.textContent).toBe(
        i18next.t('chat.space-model-changed')
      )
    );
    expect(getter).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('SYNTHETIC_PRIVATE');
    expect(useUsageNoticeStore.getState().incidents).toEqual([]);
  }
);
