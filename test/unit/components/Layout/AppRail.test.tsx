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
  AppRail,
  getAppRailPlace,
  shouldShowAppRail,
  spaceRailTileInitial,
} from '@/components/Layout/AppRail';
import { APP_COMMAND } from '@/shared/appCommands';
import { useSettingsStore } from '@/store/settingsStore';
import { useSpaceStore, type Space } from '@/store/spaceStore';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeAppCommand: vi.fn(),
}));

vi.mock('@/components/Layout/AppCommandProvider', () => ({
  useAppCommand: () => mocks.executeAppCommand,
}));

// The account menu has its own tests; the rail only places it.
vi.mock('@/components/TopBar/UserMenu', () => ({
  UserMenu: () => (
    <button type="button" aria-label="Profile">
      D
    </button>
  ),
}));

vi.mock(
  '@/lib/workspaceConfigurationNavigationGuard',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/lib/workspaceConfigurationNavigationGuard')
    >()),
    runAfterWorkspaceConfigurationSave: async (action: () => void) => {
      action();
      return true;
    },
  })
);

function space(id: string, name: string): Space {
  return {
    id,
    name,
    sourceType: 'blank',
    status: 'active',
    schemaVersion: 1,
    createdAt: 0,
    updatedAt: 0,
  };
}

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  );
}

function renderRail(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AppRail />
      <LocationProbe />
    </MemoryRouter>
  );
}

function rail() {
  return screen.getByRole('navigation', { name: 'App navigation' });
}

describe('AppRail', () => {
  beforeEach(() => {
    mocks.executeAppCommand.mockClear();
    useSettingsStore.setState({
      isOpen: false,
      activeSection: 'models',
      modelProvider: null,
    });
    useSpaceStore.setState({
      activeSpaceId: 'space-research',
      spaces: { 'space-research': space('space-research', 'Research') },
    });
  });

  it('lists Home, the active Space, Settings and the account menu in order', () => {
    renderRail('/');
    const buttons = within(rail()).getAllByRole('button');

    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Home',
      'Research',
      'Settings',
      'Profile',
    ]);
    expect(rail()).toHaveStyle({ width: '48px' });
  });

  it.each([
    ['/', 'Research'],
    ['/home?section=spaces', 'Home'],
    ['/home?section=spaces&spaceId=space-research', 'Home'],
    ['/settings?tab=models', 'Settings'],
  ])('marks the selected place on %s', (entry, selectedName) => {
    renderRail(entry);

    for (const name of ['Home', 'Research', 'Settings']) {
      const button = within(rail()).getByRole('button', { name });
      const row = button.closest('div');
      if (name === selectedName) {
        expect(button).toHaveAttribute('aria-current', 'page');
        expect(row?.querySelector('[data-app-rail-selection]')).not.toBeNull();
      } else {
        expect(button).not.toHaveAttribute('aria-current');
        expect(row?.querySelector('[data-app-rail-selection]')).toBeNull();
      }
    }
  });

  it('shows the active Space as a dashed, unpinned tile with its initial', () => {
    renderRail('/');
    const tile = within(rail()).getByRole('button', { name: 'Research' });

    expect(tile).toHaveAttribute('data-space-rail-tile', 'unpinned');
    expect(tile).toHaveTextContent('R');
    expect(tile.querySelector('.border-dashed')).not.toBeNull();
  });

  it('names an unnamed Space for assistive technology', () => {
    useSpaceStore.setState({
      spaces: { 'space-research': space('space-research', '  ') },
    });
    renderRail('/');

    expect(
      within(rail()).getByRole('button', { name: 'Untitled Space' })
    ).toBeInTheDocument();
  });

  it('omits the Space tile when no Space is active', () => {
    useSpaceStore.setState({ activeSpaceId: null });
    renderRail('/home');

    expect(
      within(rail())
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label'))
    ).toEqual(['Home', 'Settings', 'Profile']);
  });

  it('opens each place', async () => {
    const user = userEvent.setup();
    renderRail('/settings?tab=models');

    await user.click(within(rail()).getByRole('button', { name: 'Home' }));
    expect(mocks.executeAppCommand).toHaveBeenCalledWith(
      APP_COMMAND.navigateHome
    );

    await user.click(within(rail()).getByRole('button', { name: 'Research' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
    );

    await user.click(within(rail()).getByRole('button', { name: 'Settings' }));
    // The route bridge turns the request into `/settings?tab=models`.
    expect(useSettingsStore.getState()).toMatchObject({
      isOpen: true,
      activeSection: 'models',
    });
  });
});

describe('rail helpers', () => {
  it.each([
    ['/', false, true],
    ['/home', false, true],
    ['/settings', false, true],
    ['/', true, false],
    ['/login', false, false],
    ['/signup', false, false],
    ['/session-window/space-1/project-1', false, false],
  ])('shows the rail on %s with install=%s: %s', (path, install, expected) => {
    expect(shouldShowAppRail(path, install)).toBe(expected);
  });

  it.each([
    ['/', 'space'],
    ['/home', 'home'],
    ['/settings', 'settings'],
    ['/history', null],
  ])('maps %s to the %s place', (path, place) => {
    expect(getAppRailPlace(path)).toBe(place);
  });

  it.each([
    ['Research', 'R'],
    ['  marketing', 'M'],
    ['研究', '研'],
    ['🚀 Launch', '🚀'],
    ['', '?'],
  ])('uses %j -> %j as the tile initial', (name, initial) => {
    expect(spaceRailTileInitial(name)).toBe(initial);
  });
});
