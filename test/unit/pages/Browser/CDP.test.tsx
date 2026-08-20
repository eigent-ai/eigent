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

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchDelete, fetchGet, fetchPost } from '@/api/http';
import CDP from '@/components/Settings/Browser';
import { useHost } from '@/host';
import { toast } from 'sonner';

vi.mock('@/api/http', () => ({
  fetchDelete: vi.fn(),
  fetchGet: vi.fn(),
  fetchPost: vi.fn(),
}));

vi.mock('@/host', () => ({
  useHost: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    loading: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string | number>) => {
      const translations: Record<string, string> = {
        'layout.cdp-browser-connection': 'CDP Browser Connection',
        'layout.cdp-browser-pool': 'CDP Browser Pool',
        'layout.cdp-browser-pool-description':
          'Manage multiple browsers for task execution',
        'layout.browser': 'Browser',
        'layout.browser-pool': 'Browser Pool',
        'layout.browser-pool-description':
          'Browsers available for task execution.',
        'layout.open-new-browser': 'Open Blank Browser',
        'layout.connect-existing-browser': 'Connect Existing Browser',
        'layout.close-all': 'Close all',
        'layout.no-browsers-in-pool': 'No browsers in pool',
        'layout.add-browsers-hint': 'Add a browser to get started',
      };

      if (key === 'layout.launching-browser') {
        return `Launching browser on port ${options?.port ?? '...'}`;
      }

      if (key === 'layout.browser-launched') {
        return `Browser launched on port ${options?.port ?? ''}`.trim();
      }

      return translations[key] || key;
    },
  }),
}));

vi.mock('@/components/ui/alertDialog', () => ({
  default: () => null,
}));

describe('CDP Browser Page', () => {
  const mockFetchDelete = vi.mocked(fetchDelete);
  const mockFetchGet = vi.mocked(fetchGet);
  const mockFetchPost = vi.mocked(fetchPost);
  const mockUseHost = vi.mocked(useHost);
  const mockToast = vi.mocked(toast);

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseHost.mockReturnValue(null);
    mockFetchDelete.mockResolvedValue({ success: true });
    mockFetchGet.mockResolvedValue([]);
    mockFetchPost.mockResolvedValue({
      success: true,
      port: 9222,
      browser: {
        id: 'web-cdp-9222',
        port: 9222,
        isExternal: false,
        name: 'Managed Browser (9222)',
        addedAt: 123,
      },
    });
  });

  it('launches a browser through the backend in web mode', async () => {
    render(
      <MemoryRouter>
        <CDP />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockFetchGet).toHaveBeenCalledWith('/browser/cdp/list');
    });

    await userEvent.click(
      screen.getByRole('button', { name: /open blank browser/i })
    );

    await waitFor(() => {
      expect(mockFetchPost).toHaveBeenCalledWith('/browser/cdp/launch');
    });

    await waitFor(() => {
      expect(mockFetchGet).toHaveBeenCalledTimes(2);
    });

    expect(mockToast.loading).toHaveBeenCalledWith(
      'Launching browser on port ...',
      { id: 'launch-browser' }
    );
    expect(mockToast.success).toHaveBeenCalledWith(
      'Browser launched on port 9222',
      { id: 'launch-browser' }
    );
  });

  it('uses two divided rows and closes every browser in the pool', async () => {
    mockFetchGet
      .mockResolvedValueOnce([
        {
          id: 'web-cdp-9222',
          port: 9222,
          isExternal: false,
          name: 'Managed Browser',
          addedAt: 123,
        },
      ])
      .mockResolvedValue([]);

    const { container } = render(
      <MemoryRouter>
        <CDP />
      </MemoryRouter>
    );

    await screen.findByText('Managed Browser');
    const group = container.querySelector('[data-settings-row-group]');
    const rows = group?.querySelectorAll('[data-settings-row]') ?? [];
    const dividers =
      group?.querySelectorAll('[data-settings-row-divider]') ?? [];

    expect(rows).toHaveLength(2);
    expect(dividers).toHaveLength(1);
    expect(within(rows[0] as HTMLElement).getByText('Browser')).toBeVisible();
    expect(
      within(rows[0] as HTMLElement).getByRole('button', {
        name: 'Open Blank Browser',
      })
    ).toBeVisible();
    expect(
      within(rows[0] as HTMLElement).getByRole('button', {
        name: 'Connect Existing Browser',
      })
    ).toBeVisible();
    expect(
      within(rows[1] as HTMLElement).getByText('Browser Pool')
    ).toBeVisible();

    await userEvent.click(
      within(rows[1] as HTMLElement).getByRole('button', {
        name: 'Close all',
      })
    );

    await waitFor(() => {
      expect(mockFetchDelete).toHaveBeenCalledWith('/browser/cdp/9222');
    });
  });
});
