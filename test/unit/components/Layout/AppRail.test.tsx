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

import { useHomeVisitStore } from '@/components/Home/homeVisit';
import {
  AppRail,
  getAppRailPlace,
  shouldShowAppRail,
  usePinnedSpacesChooser,
} from '@/components/Layout/AppRail';
import { spaceInitial } from '@/components/SpaceSidebar/SpaceGlyph';
import { APP_COMMAND } from '@/shared/appCommands';
import { usePageTabStore } from '@/store/pageTabStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useSpaceStore, type Space } from '@/store/spaceStore';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeAppCommand: vi.fn(),
  openSpaceView: vi.fn(),
  openSpaceHomeTab: vi.fn(),
  attention: {} as Record<string, { running: number; waiting: number }>,
}));

vi.mock('@/hooks/useSpaceSwitch', () => ({
  useSpaceSwitch: () => ({ openSpaceView: mocks.openSpaceView }),
  useOpenSpaceHomeTab: () => mocks.openSpaceHomeTab,
}));

vi.mock('@/hooks/useSpaceAttention', () => ({
  useSpaceAttention: () => mocks.attention,
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
    mocks.openSpaceView.mockClear();
    mocks.openSpaceHomeTab.mockClear();
    mocks.attention = {};
    usePinnedSpacesChooser.setState({ open: false });
    useSettingsStore.setState({
      isOpen: false,
      activeSection: 'models',
      modelProvider: null,
    });
    useSpaceStore.setState({
      activeSpaceId: 'space-research',
      spaces: { 'space-research': space('space-research', 'Research') },
      pinnedSpaceIdsByUser: {},
    });
    usePageTabStore.setState({ shellPlace: 'space' });
  });

  it('selects Home on the workspace route while Home is the place', () => {
    usePageTabStore.setState({ shellPlace: 'home' });
    renderRail('/');

    expect(
      within(rail()).getByRole('button', { name: 'Home' })
    ).toHaveAttribute('aria-current', 'page');
    // The Session's Space still has its (dashed) tile, unselected.
    const tile = within(rail()).getByRole('button', { name: 'Research' });
    expect(tile).not.toHaveAttribute('aria-current');
    expect(tile).toHaveAttribute('data-space-rail-tile', 'unpinned');
  });

  it('starts a new Home visit each time Home becomes the place', () => {
    const visit = useHomeVisitStore.getState().visit;
    const { unmount } = renderRail('/home?section=spaces');
    expect(useHomeVisitStore.getState().visit).toBe(visit + 1);

    act(() => usePageTabStore.setState({ shellPlace: 'home' }));
    expect(useHomeVisitStore.getState().visit).toBe(visit + 1);
    unmount();

    usePageTabStore.setState({ shellPlace: 'space' });
    renderRail('/');
    expect(useHomeVisitStore.getState().visit).toBe(visit + 1);
    act(() => usePageTabStore.setState({ shellPlace: 'home' }));
    expect(useHomeVisitStore.getState().visit).toBe(visit + 2);
  });

  it('lists Home, the active Space, Settings and the account menu in order', () => {
    renderRail('/');
    const buttons = within(rail()).getAllByRole('button');

    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Home',
      'Research',
      'Choose pinned Spaces',
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
    ).toEqual(['Home', 'Choose pinned Spaces', 'Settings', 'Profile']);
  });

  it('opens each place', async () => {
    const user = userEvent.setup();
    renderRail('/settings?tab=models');

    await user.click(within(rail()).getByRole('button', { name: 'Home' }));
    expect(mocks.executeAppCommand).toHaveBeenCalledWith(
      APP_COMMAND.navigateHome
    );

    await user.click(within(rail()).getByRole('button', { name: 'Research' }));
    expect(mocks.openSpaceView).toHaveBeenCalledWith('space-research');

    await user.click(within(rail()).getByRole('button', { name: 'Settings' }));
    // The route bridge turns the request into `/settings?tab=models`.
    expect(useSettingsStore.getState()).toMatchObject({
      isOpen: true,
      activeSection: 'models',
    });
  });
});

describe('AppRail pinned Spaces', () => {
  const spaces = {
    'space-research': space('space-research', 'Research'),
    'space-marketing': space('space-marketing', 'Marketing'),
    'space-ops': space('space-ops', 'Ops'),
  };

  beforeEach(() => {
    mocks.openSpaceView.mockClear();
    mocks.attention = {};
    usePinnedSpacesChooser.setState({ open: false });
    useSpaceStore.setState({
      activeSpaceId: 'space-ops',
      spaces,
      projectsBySpaceId: {},
      pinnedSpaceIdsByUser: { local: ['space-marketing', 'space-research'] },
    });
  });

  it('shows pins in their order, then the unpinned active Space', () => {
    renderRail('/');
    const tiles = rail().querySelectorAll('[data-space-rail-tile]');

    expect(
      [...tiles].map((tile) => [
        tile.getAttribute('aria-label'),
        tile.getAttribute('data-space-rail-tile'),
      ])
    ).toEqual([
      ['Marketing', 'pinned'],
      ['Research', 'pinned'],
      ['Ops', 'unpinned'],
    ]);
    expect(within(rail()).getByRole('button', { name: 'Ops' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('gives the active Space no second tile once it is pinned', () => {
    useSpaceStore.setState({ activeSpaceId: 'space-research' });
    renderRail('/');

    expect(
      within(rail()).getAllByRole('button', { name: /^Research/ })
    ).toHaveLength(1);
  });

  it('opens a pinned Space from its tile', async () => {
    const user = userEvent.setup();
    renderRail('/home');

    await user.click(within(rail()).getByRole('button', { name: 'Marketing' }));
    expect(mocks.openSpaceView).toHaveBeenCalledWith('space-marketing');
  });

  it('marks running and waiting Spaces and names the status', () => {
    mocks.attention = {
      'space-marketing': { running: 2, waiting: 1 },
      'space-research': { running: 1, waiting: 0 },
    };
    renderRail('/');

    const marketing = within(rail()).getByRole('button', {
      name: 'Marketing, 1 waiting for your reply, 2 running',
    });
    const research = within(rail()).getByRole('button', {
      name: 'Research, 1 running',
    });
    // Waiting outranks running.
    expect(marketing.querySelector('[data-space-rail-status]')).toHaveAttribute(
      'data-space-rail-status',
      'waiting'
    );
    expect(research.querySelector('[data-space-rail-status]')).toHaveAttribute(
      'data-space-rail-status',
      'running'
    );
    expect(
      within(rail())
        .getByRole('button', { name: 'Ops' })
        .querySelector('[data-space-rail-status]')
    ).toBeNull();
  });

  it('reorders and unpins from the tile menu', async () => {
    const user = userEvent.setup();
    renderRail('/');

    await user.pointer({
      keys: '[MouseRight]',
      target: within(rail()).getByRole('button', { name: 'Marketing' }),
    });
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent?.trim())
    ).toEqual([
      'Open',
      'Unpin Space',
      'Rename Space',
      'Space settings',
      'Move up',
      'Move down',
    ]);
    expect(
      within(menu).getByRole('menuitem', { name: 'Move up' })
    ).toHaveAttribute('aria-disabled', 'true');

    await user.click(within(menu).getByRole('menuitem', { name: 'Move down' }));
    expect(useSpaceStore.getState().pinnedSpaceIdsByUser.local).toEqual([
      'space-research',
      'space-marketing',
    ]);

    await user.pointer({
      keys: '[MouseRight]',
      target: within(rail()).getByRole('button', { name: 'Research' }),
    });
    await user.click(
      within(await screen.findByRole('menu')).getByRole('menuitem', {
        name: 'Unpin Space',
      })
    );
    expect(useSpaceStore.getState().pinnedSpaceIdsByUser.local).toEqual([
      'space-marketing',
    ]);
  });

  it('pins the active Space from its menu', async () => {
    const user = userEvent.setup();
    renderRail('/');

    within(rail()).getByRole('button', { name: 'Ops' }).focus();
    await user.keyboard('{Shift>}{F10}{/Shift}');
    const menu = await screen.findByRole('menu');
    expect(
      within(menu).queryByRole('menuitem', { name: 'Move up' })
    ).toBeNull();
    await user.click(within(menu).getByRole('menuitem', { name: 'Pin Space' }));

    expect(useSpaceStore.getState().pinnedSpaceIdsByUser.local).toEqual([
      'space-marketing',
      'space-research',
      'space-ops',
    ]);
  });

  it('opens the chooser instead of pinning an eleventh Space', async () => {
    const user = userEvent.setup();
    const letters = 'abcdefghijk'.split('');
    const many = Object.fromEntries(
      letters.map((id) => [
        `space-${id}`,
        space(`space-${id}`, `Space ${id.toUpperCase()}`),
      ])
    );
    useSpaceStore.setState({
      activeSpaceId: 'space-k',
      spaces: many,
      pinnedSpaceIdsByUser: {
        local: letters.slice(0, 10).map((id) => `space-${id}`),
      },
    });
    renderRail('/');

    await user.pointer({
      keys: '[MouseRight]',
      target: within(rail()).getByRole('button', { name: 'Space K' }),
    });
    await user.click(
      within(await screen.findByRole('menu')).getByRole('menuitem', {
        name: 'Pin Space',
      })
    );

    expect(useSpaceStore.getState().pinnedSpaceIdsByUser.local).toHaveLength(
      10
    );
    const chooser = await screen.findByRole('dialog', {
      name: 'Choose pinned Spaces',
    });
    expect(within(chooser).getByText('10 of 10')).toBeInTheDocument();
    expect(
      within(chooser).getByRole('checkbox', { name: /Space K/ })
    ).toBeDisabled();
    expect(
      within(chooser).getByRole('checkbox', { name: /Space A/ })
    ).toBeChecked();
  });

  it('pins and unpins from the chooser', async () => {
    const user = userEvent.setup();
    renderRail('/');

    await user.click(
      within(rail()).getByRole('button', { name: 'Choose pinned Spaces' })
    );
    const chooser = await screen.findByRole('dialog', {
      name: 'Choose pinned Spaces',
    });
    expect(within(chooser).getByText('2 of 10')).toBeInTheDocument();

    await user.click(within(chooser).getByRole('checkbox', { name: /Ops/ }));
    expect(useSpaceStore.getState().pinnedSpaceIdsByUser.local).toEqual([
      'space-marketing',
      'space-research',
      'space-ops',
    ]);

    await user.click(
      within(chooser).getByRole('checkbox', { name: /Marketing/ })
    );
    expect(useSpaceStore.getState().pinnedSpaceIdsByUser.local).toEqual([
      'space-research',
      'space-ops',
    ]);
  });

  it('moves a pin with the arrow keys on its handle', async () => {
    const user = userEvent.setup();
    usePinnedSpacesChooser.setState({ open: true });
    renderRail('/');

    const chooser = await screen.findByRole('dialog', {
      name: 'Choose pinned Spaces',
    });
    within(chooser)
      .getByRole('button', { name: 'Move Research, position 2 of 2' })
      .focus();
    await user.keyboard('{ArrowUp}');

    expect(useSpaceStore.getState().pinnedSpaceIdsByUser.local).toEqual([
      'space-research',
      'space-marketing',
    ]);
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
    ['/', 'space', 'space'],
    ['/', 'home', 'home'],
    ['/home', 'space', 'home'],
    ['/settings', 'home', 'settings'],
    ['/history', 'space', null],
  ] as const)('maps %s with %s to the %s place', (path, shellPlace, place) => {
    expect(getAppRailPlace(path, shellPlace)).toBe(place);
  });

  it.each([
    ['Research', 'R'],
    ['  marketing', 'M'],
    ['研究', '研'],
    ['🚀 Launch', '🚀'],
    ['', '?'],
  ])('uses %j -> %j as the tile initial', (name, initial) => {
    expect(spaceInitial(name)).toBe(initial);
  });
});
