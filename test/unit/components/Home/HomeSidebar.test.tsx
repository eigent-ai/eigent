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

// Load the HTTP client first, as the app does at boot, so the auth store
// and i18n settle their import cycle in the same order.
import '@/api/http';

import HomeSidebar from '@/components/Home/HomeSidebar';
import { useHomeVisitStore } from '@/components/Home/homeVisit';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import {
  pinnedSpaceOwnerKey,
  useSpaceStore,
  type Space,
  type SpaceProjectMeta,
} from '@/store/spaceStore';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeAppCommand: vi.fn(),
  switchToSpace: vi.fn(),
  openSessionInShell: vi.fn(),
  sessionAttention: {} as Record<string, 'running' | 'waiting'>,
  spaceAttention: {} as Record<string, { running: number; waiting: number }>,
}));

vi.mock('@/components/Layout/AppCommandProvider', () => ({
  useAppCommand: () => mocks.executeAppCommand,
}));

vi.mock('@/hooks/useSpaceSwitch', () => ({
  useSpaceSwitch: () => ({ switchToSpace: mocks.switchToSpace }),
}));

vi.mock('@/lib/sessionOpen', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sessionOpen')>()),
  openSessionInShell: mocks.openSessionInShell,
}));

vi.mock('@/hooks/useSpaceAttention', () => ({
  useSpaceAttention: () => mocks.spaceAttention,
  useSessionAttention: () => mocks.sessionAttention,
}));

vi.mock('@/hooks/useSessionNavStatuses', () => ({
  useSessionNavStatuses: () => {},
}));

// The dialogs and Space creation have their own tests.
vi.mock('@/components/SpaceSidebar/SessionControlDialogs', () => ({
  SessionControlDialogs: () => null,
}));
vi.mock('@/components/Home/NewSpaceDialog', () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="Create a new Space" /> : null,
}));
vi.mock('@/components/Home/hooks/useNewSpaceCreation', () => ({
  useNewSpaceCreation: () => ({
    createBlankSpace: vi.fn(),
    createSpaceFromFolder: vi.fn(),
  }),
}));

vi.mock(
  '@/lib/workspaceConfigurationNavigationGuard',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/lib/workspaceConfigurationNavigationGuard')
    >()),
    runAfterWorkspaceConfigurationSave: async (
      action: () => void | Promise<void>
    ) => {
      await action();
      return true;
    },
  })
);

function space(id: string, name: string, updatedAt: number): Space {
  return {
    id,
    name,
    sourceType: 'folder',
    rootPath: `/work/${id}`,
    status: 'active',
    schemaVersion: 1,
    createdAt: 0,
    updatedAt,
  };
}

function session(
  id: string,
  spaceId: string,
  name: string,
  updatedAt: number
): SpaceProjectMeta {
  return {
    id,
    spaceId,
    name,
    status: 'active',
    createdAt: updatedAt,
    updatedAt,
  };
}

const researchSessions = [
  session('r-1', 'space-research', 'Weekly report', 50),
  session('r-2', 'space-research', 'Competitor scan', 40),
  session('r-3', 'space-research', 'Pricing notes', 30),
  session('r-4', 'space-research', 'Hiring plan', 20),
  session('r-5', 'space-research', 'Old notes', 10),
];
const opsSessions = [session('o-1', 'space-ops', 'Vendor invoices', 5)];

function seedSpaces() {
  const projectsBySpaceId = {
    'space-research': Object.fromEntries(
      researchSessions.map((meta) => [meta.id, meta])
    ),
    'space-ops': Object.fromEntries(opsSessions.map((meta) => [meta.id, meta])),
  };
  useSpaceStore.setState({
    activeSpaceId: 'space-research',
    spaces: {
      'space-research': space('space-research', 'Research', 1),
      'space-ops': space('space-ops', 'Ops', 1),
    },
    projectsBySpaceId,
    projectIdIndex: Object.fromEntries(
      [...researchSessions, ...opsSessions].map((meta) => [
        meta.id,
        meta.spaceId,
      ])
    ),
    pinnedSpaceIdsByUser: { [pinnedSpaceOwnerKey(null)]: ['space-research'] },
  });
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

function renderSidebar(entry = '/') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <HomeSidebar />
      <LocationProbe />
    </MemoryRouter>
  );
}

function sidebar() {
  return screen.getByRole('complementary', { name: 'Home' });
}

function spaceNames() {
  return Array.from(document.querySelectorAll('[data-home-space]')).map(
    (group) => group.getAttribute('data-home-space')
  );
}

describe('HomeSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessionAttention = {};
    mocks.spaceAttention = {};
    mocks.switchToSpace.mockResolvedValue(true);
    mocks.openSessionInShell.mockResolvedValue(undefined);
    seedSpaces();
    useHomeVisitStore.setState({
      visit: 0,
      activity: { spaces: {}, sessions: {} },
    });
    useProjectRuntimeStore.setState({
      activeProjectId: null,
      navLeadByProjectId: {},
      historyLoadingProjectIds: {},
    });
    usePageTabStore.setState({
      shellPlace: 'home',
      activeWorkspaceTab: 'new-project',
      homeFoldedSpaceIds: [],
      homeSpaceSort: 'updated',
    });
  });

  it('starts with New session and All Spaces, with New Space in the Spaces header', async () => {
    const user = userEvent.setup();
    renderSidebar();

    const newSession = within(sidebar()).getByRole('button', {
      name: 'New session',
    });
    expect(newSession).toHaveAttribute('aria-current', 'page');
    await user.click(newSession);
    expect(usePageTabStore.getState().shellPlace).toBe('home');
    expect(mocks.executeAppCommand).toHaveBeenCalledWith('new-project');

    await user.click(
      within(sidebar()).getByRole('button', { name: 'All Spaces' })
    );
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/home?section=spaces'
    );

    const newSpace = within(sidebar()).getByRole('button', {
      name: 'New Space',
    });
    expect(newSpace.closest('[data-section-header-actions]')).not.toBeNull();
    await user.click(newSpace);
    expect(
      screen.getByRole('dialog', { name: 'Create a new Space' })
    ).toBeInTheDocument();
  });

  it('sorts Spaces by creation time from the Spaces header menu', async () => {
    const user = userEvent.setup();
    act(() => {
      useSpaceStore.setState((state) => ({
        spaces: {
          ...state.spaces,
          'space-research': { ...state.spaces['space-research'], createdAt: 1 },
          'space-ops': { ...state.spaces['space-ops'], createdAt: 2 },
        },
      }));
    });
    renderSidebar();
    expect(spaceNames()).toEqual(['space-research', 'space-ops']);

    await user.click(
      within(sidebar()).getByRole('button', { name: 'Sort Spaces' })
    );
    await user.click(
      await screen.findByRole('menuitemradio', { name: 'Created time' })
    );

    expect(usePageTabStore.getState().homeSpaceSort).toBe('created');
    expect(spaceNames()).toEqual(['space-ops', 'space-research']);
  });

  it('lists every Space with four recent Sessions, a pin mark and Show all', async () => {
    const user = userEvent.setup();
    mocks.spaceAttention = { 'space-ops': { running: 1, waiting: 0 } };
    renderSidebar();

    expect(spaceNames()).toEqual(['space-research', 'space-ops']);
    const research = document.querySelector(
      '[data-home-space="space-research"]'
    ) as HTMLElement;
    for (const name of [
      'Weekly report',
      'Competitor scan',
      'Pricing notes',
      'Hiring plan',
    ]) {
      expect(within(research).getByRole('button', { name })).toBeVisible();
    }
    expect(
      within(research).queryByRole('button', { name: 'Old notes' })
    ).not.toBeInTheDocument();
    expect(
      within(research).getByRole('button', { name: 'Research, Pinned' })
    ).toBeInTheDocument();
    expect(
      within(sidebar()).getByRole('button', { name: 'Ops, 1 running' })
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-home-space-status="running"]')
    ).not.toBeNull();

    await user.click(
      within(research).getByRole('button', {
        name: 'Show all 5 sessions in Research',
      })
    );
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/home?section=spaces&spaceId=space-research&spaceTab=projects'
    );
  });

  it('folds a Space from its icon and remembers the fold', async () => {
    const user = userEvent.setup();
    const { unmount } = renderSidebar();

    const fold = within(sidebar()).getByRole('button', {
      name: 'Fold Research',
    });
    expect(fold).toHaveAttribute('aria-expanded', 'true');
    // The icon shows the Space's letter until hover or keyboard focus.
    expect(fold).toHaveTextContent('R');
    expect(fold.querySelector('.lucide-chevron-down')).not.toBeNull();

    await user.click(fold);
    const unfold = within(sidebar()).getByRole('button', {
      name: 'Unfold Research',
    });
    expect(unfold).toHaveAttribute('aria-expanded', 'false');
    expect(unfold.querySelector('.lucide-chevron-right')).not.toBeNull();
    expect(
      within(sidebar()).queryByRole('button', { name: 'Weekly report' })
    ).not.toBeInTheDocument();
    expect(usePageTabStore.getState().homeFoldedSpaceIds).toEqual([
      'space-research',
    ]);

    unmount();
    renderSidebar();
    expect(
      within(sidebar()).getByRole('button', { name: 'Unfold Research' })
    ).toHaveAttribute('aria-expanded', 'false');
  });

  it('collects waiting Sessions in Needs you without moving them', () => {
    const { rerender } = renderSidebar();
    expect(screen.queryByText('Needs you')).not.toBeInTheDocument();

    mocks.sessionAttention = { 'o-1': 'waiting', 'r-2': 'running' };
    rerender(
      <MemoryRouter>
        <HomeSidebar />
      </MemoryRouter>
    );
    const needsYou = screen
      .getByText('Needs you')
      .closest('div.flex-col') as HTMLElement;
    expect(
      within(needsYou).getByRole('button', { name: 'Vendor invoices Ops' })
    ).toBeInTheDocument();

    mocks.sessionAttention = { 'r-1': 'waiting', 'o-1': 'waiting' };
    rerender(
      <MemoryRouter>
        <HomeSidebar />
      </MemoryRouter>
    );
    const rows = within(
      screen.getByText('Needs you').closest('div.flex-col') as HTMLElement
    )
      .getAllByRole('button')
      // Skip the group's own fold header.
      .filter((row) => !row.hasAttribute('aria-expanded'));
    expect(rows.map((row) => row.textContent)).toEqual([
      'Vendor invoicesOps',
      'Weekly reportResearch',
    ]);
  });

  it('opens a Session from another Space in Home, making that Space active', async () => {
    const user = userEvent.setup();
    renderSidebar('/home?section=spaces');

    await user.click(
      within(sidebar()).getByRole('button', { name: 'Vendor invoices' })
    );

    await waitFor(() =>
      expect(mocks.openSessionInShell).toHaveBeenCalledWith('o-1')
    );
    expect(mocks.switchToSpace).toHaveBeenCalledWith('space-ops', {
      project: 'o-1',
      tab: null,
    });
    expect(usePageTabStore.getState().shellPlace).toBe('home');
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
    );
  });

  it('opens a Session of the active Space without switching Spaces', async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(
      within(sidebar()).getByRole('button', { name: 'Weekly report' })
    );

    await waitFor(() =>
      expect(mocks.openSessionInShell).toHaveBeenCalledWith('r-1')
    );
    expect(mocks.switchToSpace).not.toHaveBeenCalled();
  });

  it("opens a Space's Workspace page from its name and marks it selected", async () => {
    const user = userEvent.setup();
    renderSidebar('/home?section=spaces&spaceId=space-ops');

    const ops = within(sidebar()).getByRole('button', { name: 'Ops' });
    expect(ops).toHaveAttribute('aria-current', 'page');

    await user.click(
      within(sidebar()).getByRole('button', { name: 'Research, Pinned' })
    );
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/home?section=spaces&spaceId=space-research'
    );
  });

  it('keeps the order while Home is open and re-sorts on the next visit', () => {
    act(() => useHomeVisitStore.getState().startVisit());
    renderSidebar();
    expect(spaceNames()).toEqual(['space-research', 'space-ops']);

    // Ops becomes the most recent Space while Home is open.
    act(() => {
      useSpaceStore.setState((state) => ({
        spaces: {
          ...state.spaces,
          'space-ops': { ...state.spaces['space-ops'], updatedAt: 1000 },
        },
      }));
    });
    expect(spaceNames()).toEqual(['space-research', 'space-ops']);

    act(() => useHomeVisitStore.getState().startVisit());
    expect(spaceNames()).toEqual(['space-ops', 'space-research']);
  });
});
