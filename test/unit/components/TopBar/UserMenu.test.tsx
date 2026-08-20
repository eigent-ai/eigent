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

import { proxyFetchGet } from '@/api/http';
import { UserMenu } from '@/components/TopBar/UserMenu';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/http', () => ({
  proxyFetchGet: vi.fn(),
}));

vi.mock('@/components/Dialog/InviteCodeDialog', () => ({
  default: () => null,
}));

vi.mock('@/components/ui/icon-pill-toggle', () => ({
  IconPillToggle: () => null,
}));

vi.mock('@/hooks/useChatStoreAdapter', () => ({
  default: () => ({
    chatStore: { clearTasks: vi.fn() },
  }),
}));

vi.mock('@/store/authStore', () => {
  const authState = {
    email: 'person@example.com',
    username: 'Person',
    language: 'en',
    appearanceMode: 'system',
    setAppearanceMode: vi.fn(),
    setLanguage: vi.fn(),
    logout: vi.fn(),
  };
  const useAuthStore = Object.assign(
    (selector: (state: typeof authState) => unknown) => selector(authState),
    { getState: () => authState }
  );

  return {
    getAuthStore: () => authState,
    useAuthStore,
  };
});

vi.mock('@/store/installationStore', () => {
  const installationState = {
    reset: vi.fn(),
    setNeedsBackendRestart: vi.fn(),
  };

  return {
    useInstallationStore: (
      selector: (state: typeof installationState) => unknown
    ) => selector(installationState),
  };
});

function LocationProbe() {
  const location = useLocation();
  return (
    <span data-testid="location">
      {location.pathname}
      {location.search}
    </span>
  );
}

function renderUserMenu(initialEntry = '/') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <UserMenu />
      <LocationProbe />
    </MemoryRouter>
  );
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole('button', {
      name: 'Profile',
    })
  );
}

async function closeMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard('{Escape}');
  await waitFor(() => {
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
}

describe('UserMenu subscription summary', () => {
  beforeEach(() => {
    vi.mocked(proxyFetchGet).mockReset();
  });

  it('refreshes on each open and retains successful values on a partial failure', async () => {
    const user = userEvent.setup();
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    vi.mocked(proxyFetchGet)
      .mockResolvedValueOnce({ plan_key: 'pro' })
      .mockResolvedValueOnce({ credits: 10 });

    renderUserMenu();
    await openMenu(user);

    await waitFor(() => {
      expect(proxyFetchGet).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText('Pro')).toBeInTheDocument();
    expect(screen.getByText('Pro').parentElement).toHaveTextContent('Pro · 10');

    await closeMenu(user);
    vi.mocked(proxyFetchGet)
      .mockResolvedValueOnce({ plan_key: 'team' })
      .mockResolvedValueOnce({ credits: 20 });
    await openMenu(user);

    await waitFor(() => {
      expect(proxyFetchGet).toHaveBeenCalledTimes(4);
      expect(screen.getByText('Team').parentElement).toHaveTextContent(
        'Team · 20'
      );
    });

    await closeMenu(user);
    vi.mocked(proxyFetchGet)
      .mockRejectedValueOnce(new Error('subscription unavailable'))
      .mockResolvedValueOnce({ credits: 25 });
    await openMenu(user);

    await waitFor(() => {
      expect(proxyFetchGet).toHaveBeenCalledTimes(6);
      expect(screen.getByText('Team').parentElement).toHaveTextContent(
        'Team · 25'
      );
    });
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to load subscription:',
      expect.any(Error)
    );

    consoleError.mockRestore();
  });

  it('groups account details before preferences and opens Settings inside Home', async () => {
    const user = userEvent.setup();
    vi.mocked(proxyFetchGet)
      .mockResolvedValueOnce({ plan_key: 'pro' })
      .mockResolvedValueOnce({ credits: 10 });

    renderUserMenu('/?tab=project');
    await openMenu(user);

    const menu = screen.getByRole('menu');
    const email = within(menu).getByText('person@example.com');
    const plan = within(menu).getByText('Pro').parentElement;
    const referFriends = within(menu).getByRole('menuitem', {
      name: 'Refer friends',
    });
    const [accountDivider, logoutDivider] =
      within(menu).getAllByRole('separator');
    const appearance = within(menu).getByText('Appearance');
    const language = within(menu).getByRole('menuitem', { name: 'Language' });
    const settings = within(menu).getByRole('menuitem', { name: 'Settings' });
    const logout = within(menu).getByRole('menuitem', { name: 'Log out' });

    expect(plan).toHaveTextContent('Pro · 10');
    expect(settings.querySelector('svg')).toHaveClass('lucide-settings');
    for (const [current, next] of [
      [email, plan],
      [plan, referFriends],
      [referFriends, accountDivider],
      [accountDivider, appearance],
      [appearance, language],
      [language, settings],
      [settings, logoutDivider],
      [logoutDivider, logout],
    ] as const) {
      expect(
        current?.compareDocumentPosition(next) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }
    await user.click(settings);

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/home?section=settings&tab=settings'
    );
  });
});
