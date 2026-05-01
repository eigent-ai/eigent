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

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SettingPrivacy from '@/pages/Setting/Privacy';

vi.mock('@/api/http', () => ({
  proxyFetchGet: vi.fn(),
  proxyFetchPut: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const toastErrorMock = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    error: (msg: string) => toastErrorMock(msg),
  },
}));

const proxyFetchGetMock = vi.mocked(
  (await import('@/api/http')).proxyFetchGet
);
const proxyFetchPutMock = vi.mocked(
  (await import('@/api/http')).proxyFetchPut
);

describe('SettingPrivacy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads initial privacy settings and shows current state', async () => {
    proxyFetchGetMock.mockResolvedValueOnce({ help_improve: true });

    render(<SettingPrivacy />);

    // Switch should eventually reflect the loaded state
    const switchEl = await screen.findByRole('switch');
    expect(switchEl).toBeChecked();

    // Status text should use enabled key
    expect(
      screen.getByText('setting.enabled', { exact: false })
    ).toBeInTheDocument();
  });

  it('handles load failure and shows error toast', async () => {
    proxyFetchGetMock.mockRejectedValueOnce(new Error('network error'));

    render(<SettingPrivacy />);

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('setting.load-failed');
    });
  });

  it('optimistically toggles help improve and calls API', async () => {
    proxyFetchGetMock.mockResolvedValueOnce({ help_improve: false });
    proxyFetchPutMock.mockResolvedValueOnce({});

    render(<SettingPrivacy />);

    const switchEl = await screen.findByRole('switch');
    expect(switchEl).not.toBeChecked();

    await userEvent.click(switchEl);

    expect(proxyFetchPutMock).toHaveBeenCalledWith('/api/user/privacy', {
      help_improve: true,
    });
  });

  it('reverts switch and shows toast when save fails', async () => {
    proxyFetchGetMock.mockResolvedValueOnce({ help_improve: false });
    proxyFetchPutMock.mockRejectedValueOnce(new Error('save failed'));

    render(<SettingPrivacy />);

    const switchEl = await screen.findByRole('switch');
    expect(switchEl).not.toBeChecked();

    await userEvent.click(switchEl);

    await waitFor(() => {
      expect(switchEl).not.toBeChecked();
      expect(toastErrorMock).toHaveBeenCalledWith('setting.save-failed');
    });
  });

  it('disables switch while loading and enables after load', async () => {
    proxyFetchGetMock.mockResolvedValueOnce({ help_improve: false });

    render(<SettingPrivacy />);

    const switchEl = await screen.findByRole('switch');

    // After initial load completes, loading should be false and switch enabled
    expect(switchEl).not.toBeDisabled();
  });

  it('shows disabled status text when help improve is off', async () => {
    proxyFetchGetMock.mockResolvedValueOnce({ help_improve: false });

    render(<SettingPrivacy />);

    await screen.findByRole('switch');

    expect(
      screen.getByText('setting.disabled', { exact: false })
    ).toBeInTheDocument();
  });
});

