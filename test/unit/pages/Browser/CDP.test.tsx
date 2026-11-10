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
        'layout.cancel': 'Cancel',
        'layout.check-and-connect': 'Check & Connect',
        'layout.enter-port-number': 'Enter Port Number',
        'layout.invalid-port': 'Please enter a valid port number (1-65535)',
      };

      if (key === 'layout.no-browser-on-port') {
        return `No browser found on port ${options?.port}`;
      }

      if (key === 'layout.external-browser-name') {
        return `External Browser (${options?.port})`;
      }

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

  describe('Connect Existing Browser dialog', () => {
    const invalidPortMessage = 'Please enter a valid port number (1-65535)';

    const renderPage = async () => {
      render(
        <MemoryRouter>
          <CDP />
        </MemoryRouter>
      );
      await screen.findByText('No browsers in pool');
      return screen.getByRole('button', { name: 'Connect Existing Browser' });
    };

    const submitPort = async (
      user: ReturnType<typeof userEvent.setup>,
      value: string
    ) => {
      await user.click(
        screen.getByRole('button', { name: 'Connect Existing Browser' })
      );
      const dialog = await screen.findByRole('dialog', {
        name: 'Connect Existing Browser',
      });
      const input = within(dialog).getByPlaceholderText('Enter Port Number');
      if (value) await user.type(input, value);
      await user.click(
        within(dialog).getByRole('button', { name: 'Check & Connect' })
      );
      return input;
    };

    const mockDesktopHost = () => {
      const electronAPI = {
        getCdpBrowsers: vi.fn().mockResolvedValue([]),
        addCdpBrowser: vi.fn().mockResolvedValue({ success: true }),
        onCdpPoolChanged: vi.fn(() => () => {}),
      };
      mockUseHost.mockReturnValue({ electronAPI } as unknown as ReturnType<
        typeof useHost
      >);
      return electronAPI;
    };

    it.each([
      '65535abc',
      '1.5',
      '1e3',
      '+9222',
      '-1',
      '0x50',
      '9222 9223',
      '',
      '0',
      '65536',
      'abc',
    ])(
      'rejects port "%s" with a field error and makes no connection attempt',
      async (value) => {
        const user = userEvent.setup();
        await renderPage();

        const input = await submitPort(user, value);

        expect(await screen.findByText(invalidPortMessage)).toBeInTheDocument();
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(input).toHaveAccessibleDescription(invalidPortMessage);
        expect(mockFetchPost).not.toHaveBeenCalled();
      }
    );

    it.each(['65535abc', '1.5'])(
      'does not probe a truncated port for "%s" in the desktop app',
      async (value) => {
        const electronAPI = mockDesktopHost();
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        try {
          const user = userEvent.setup();
          await renderPage();

          await submitPort(user, value);

          expect(
            await screen.findByText(invalidPortMessage)
          ).toBeInTheDocument();
          expect(
            screen.queryByText(/No browser found on port/)
          ).not.toBeInTheDocument();
          expect(fetchSpy).not.toHaveBeenCalled();
          expect(electronAPI.addCdpBrowser).not.toHaveBeenCalled();
        } finally {
          fetchSpy.mockRestore();
        }
      }
    );

    it('connects to a port typed with surrounding spaces', async () => {
      const user = userEvent.setup();
      await renderPage();

      await submitPort(user, ' 9222 ');

      await waitFor(() => {
        expect(mockFetchPost).toHaveBeenCalledWith('/browser/cdp/connect', {
          port: 9222,
          name: 'External Browser (9222)',
        });
      });
    });

    it('probes the exact port typed in the desktop app', async () => {
      const electronAPI = mockDesktopHost();
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{}', { status: 200 }));
      try {
        const user = userEvent.setup();
        await renderPage();

        await submitPort(user, '9222');

        await waitFor(() => {
          expect(electronAPI.addCdpBrowser).toHaveBeenCalledWith(
            9222,
            true,
            'External Browser (9222)'
          );
        });
        expect(fetchSpy).toHaveBeenCalledWith(
          'http://localhost:9222/json/version',
          expect.anything()
        );
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it.each(['Cancel', 'Escape'])(
      'returns focus to the Connect Existing Browser button after %s',
      async (closeWith) => {
        const user = userEvent.setup();
        const trigger = await renderPage();

        await user.click(trigger);
        const dialog = await screen.findByRole('dialog', {
          name: 'Connect Existing Browser',
        });
        await waitFor(() => {
          expect(
            within(dialog).getByPlaceholderText('Enter Port Number')
          ).toHaveFocus();
        });

        if (closeWith === 'Cancel') {
          await user.click(
            within(dialog).getByRole('button', { name: 'Cancel' })
          );
        } else {
          await user.keyboard('{Escape}');
        }

        await waitFor(() => {
          expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });
        await waitFor(() => {
          expect(trigger).toHaveFocus();
        });
      }
    );
  });
});
