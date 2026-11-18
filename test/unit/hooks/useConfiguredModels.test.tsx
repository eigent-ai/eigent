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

import { useConfiguredModels } from '@/hooks/useConfiguredModels';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  fetchCloudModels: vi.fn().mockResolvedValue([]),
  auth: { user_id: 1, email: '', token: 'first' },
}));
vi.mock('@/api/http', () => ({ proxyFetchGet: mocks.get }));
vi.mock('@/store/authStore', () => ({
  useAuthStore: () => mocks.auth,
  getAuthStore: () => mocks.auth,
}));
vi.mock('@/store/cloudModelStore', () => ({
  useCloudModelStore: (selector: (state: unknown) => unknown) =>
    selector({ models: [], fetchCloudModels: mocks.fetchCloudModels }),
}));
vi.mock('@/host/createHost', () => ({ createHost: () => ({}) }));

function Reader({ id }: { id: string }) {
  const inventory = useConfiguredModels();
  return (
    <div data-testid={id}>
      {inventory.loading
        ? 'loading'
        : inventory.records.map((r) => r.id).join(',')}
      {inventory.error ? ' error' : ''}
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.user_id = 1;
  mocks.get.mockResolvedValue({ items: [{ id: 11 }] });
});

describe('configured model inventory', () => {
  it('shares a request across screens and keeps records during focus refresh failure', async () => {
    render(
      <>
        <Reader id="settings" />
        <Reader id="picker" />
      </>
    );
    await waitFor(() =>
      expect(screen.getByTestId('settings')).toHaveTextContent('11')
    );
    expect(screen.getByTestId('picker')).toHaveTextContent('11');
    expect(mocks.get).toHaveBeenCalledTimes(1);

    mocks.get.mockRejectedValueOnce(new Error('offline'));
    fireEvent.focus(window);
    expect(screen.getByTestId('settings')).toHaveTextContent('11');
    await waitFor(() =>
      expect(screen.getByTestId('settings')).toHaveTextContent('11 error')
    );
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });
  it("does not show one account's records while another account loads", async () => {
    const view = render(<Reader id="settings" />);
    await waitFor(() =>
      expect(screen.getByTestId('settings')).toHaveTextContent('11')
    );
    mocks.auth.user_id = 2;
    mocks.get.mockReturnValue(new Promise(() => undefined));
    view.rerender(<Reader id="settings" />);
    expect(screen.getByTestId('settings')).toHaveTextContent('loading');
    expect(screen.getByTestId('settings')).not.toHaveTextContent('11');
  });
});
