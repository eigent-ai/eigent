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
import { presentationForKind } from '@/lib/sessionNavLead';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSessionControlsStore } from '@/store/sessionControlsStore';
import {
  pinnedSpaceOwnerKey,
  useSpaceStore,
  type Space,
  type SpaceProjectMeta,
} from '@/store/spaceStore';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeAppCommand: vi.fn(),
  switchToSpace: vi.fn(),
  openSessionInShell: vi.fn(),
  openSessionWindow: vi.fn(),
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

vi.mock('@/lib/sessionWindows', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sessionWindows')>()),
  openSessionWindow: mocks.openSessionWindow,
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
    mocks.openSessionWindow.mockResolvedValue(undefined);
    useSessionControlsStore.setState({
      pinnedProjectIds: [],
      unreadProjectIds: [],
      seenOutcomes: {},
    });
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
      homeSidebarGrouping: 'spaces',
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

  it('starts with the Eigent row, which is not a control', () => {
    renderSidebar();

    const brand = document.querySelector(
      '[data-home-sidebar-brand]'
    ) as HTMLElement;
    expect(brand).toHaveTextContent('Eigent');
    expect(within(brand).getByText('Eigent')).toHaveClass('font-display');
    expect(brand).toHaveClass('h-8');
    expect(brand.querySelector('img')).not.toBeNull();
    expect(within(brand).queryByRole('button')).toBeNull();
    // First in the sidebar, so New session lines up with the Space sidebar.
    expect(
      brand.compareDocumentPosition(
        within(sidebar()).getByRole('button', { name: 'New session' })
      ) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
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
      within(sidebar()).getByRole('button', { name: 'View options' })
    );
    (await screen.findByRole('menuitem', { name: 'Sort by' })).focus();
    await user.keyboard('{ArrowRight}');
    const updated = await screen.findByRole('menuitemradio', {
      name: 'Updated time',
    });
    expect(updated).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowDown}{Enter}');

    expect(usePageTabStore.getState().homeSpaceSort).toBe('created');
    expect(spaceNames()).toEqual(['space-ops', 'space-research']);
  });

  it('lists every Session in one list, each with its Space', async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(
      within(sidebar()).getByRole('button', { name: 'View options' })
    );
    (await screen.findByRole('menuitem', { name: 'Organize by' })).focus();
    await user.keyboard('{ArrowRight}');
    await screen.findByRole('menuitemradio', { name: 'One list' });
    await user.keyboard('{ArrowDown}{Enter}');

    expect(usePageTabStore.getState().homeSidebarGrouping).toBe('list');
    expect(spaceNames()).toEqual([]);
    expect(
      within(sidebar()).getByRole('button', { name: 'Sessions' })
    ).toBeInTheDocument();
    // All five Research Sessions (no four-row cap) and Ops' one, newest first.
    const rows = within(sidebar())
      .getAllByRole('button', {
        name: /Weekly report|Competitor scan|Pricing notes|Hiring plan|Old notes|Vendor invoices/,
      })
      .map((row) => row.textContent);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toContain('Weekly report');
    expect(rows[0]).toContain('Research');
    expect(rows[5]).toContain('Vendor invoices');
    expect(rows[5]).toContain('Ops');
  });

  const sessionRow = (name: string | RegExp) =>
    within(sidebar())
      .getByRole('button', { name })
      .closest('.group\\/session-item') as HTMLElement;

  it('shows only End session on a Session row, and ends the Session', async () => {
    const user = userEvent.setup();
    const requestAction = vi.fn();
    useSessionControlsStore.setState({ requestAction });
    renderSidebar();

    const row = sessionRow('Weekly report');
    const buttons = within(row)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent);
    expect(buttons).toEqual(['Weekly report', 'End session']);

    await user.click(within(row).getByRole('button', { name: 'End session' }));
    expect(requestAction).toHaveBeenCalledWith('end', 'r-1');
  });

  it('shows a status as a dot, which End session covers on hover', () => {
    mocks.sessionAttention = { 'r-1': 'waiting', 'r-2': 'running' };
    renderSidebar();

    const dot = (name: string) =>
      sessionRow(name).querySelector('[data-session-status-dot]');
    expect(dot('Weekly report')).toHaveAttribute(
      'data-session-status-dot',
      'hitl'
    );
    expect(dot('Weekly report')).toHaveClass(
      '!text-ds-icon-warning-default-default',
      'group-hover/session-item:hidden'
    );
    expect(dot('Competitor scan')).toHaveClass(
      '!text-ds-icon-information-default-default'
    );
    // No status, no dot.
    expect(dot('Pricing notes')).toBeNull();
  });

  it('drops a result dot once it is read, but keeps open questions', async () => {
    const user = userEvent.setup();
    mocks.sessionAttention = { 'r-1': 'waiting' };
    useProjectRuntimeStore.setState({
      navLeadByProjectId: {
        'r-2': presentationForKind('finished'),
        'r-3': presentationForKind('error'),
      },
    });
    useSessionControlsStore.setState({ seenOutcomes: { 'r-3': 'error' } });
    renderSidebar();

    const dot = (name: string) =>
      sessionRow(name).querySelector('[data-session-status-dot]');
    expect(dot('Competitor scan')).toHaveAttribute(
      'data-session-status-dot',
      'finished'
    );
    expect(dot('Pricing notes')).toBeNull();
    expect(dot('Weekly report')).toHaveAttribute(
      'data-session-status-dot',
      'hitl'
    );

    // An unread result offers Mark as read, which clears its dot.
    fireEvent.contextMenu(sessionRow('Competitor scan'));
    await user.click(
      await screen.findByRole('menuitem', { name: 'Mark as read' })
    );
    expect(dot('Competitor scan')).toBeNull();
  });

  it('moves pinned Sessions out of their Space into Pinned, above Spaces', () => {
    useSessionControlsStore.setState({ pinnedProjectIds: ['o-1', 'r-2'] });
    renderSidebar();

    const pinnedHeader = within(sidebar()).getByRole('button', {
      name: 'Pinned',
    });
    const spacesHeader = within(sidebar()).getByRole('button', {
      name: 'Spaces',
    });
    expect(
      pinnedHeader.compareDocumentPosition(spacesHeader) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    // Pin order, each naming its Space.
    const scan = sessionRow(/^Competitor scan/);
    const invoices = sessionRow(/^Vendor invoices/);
    expect(
      invoices.compareDocumentPosition(scan) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(scan).toHaveTextContent('Research');
    expect(scan.closest('[data-home-space]')).toBeNull();

    // The Space lists the rest, so four unpinned Sessions need no Show all.
    const research = sidebar().querySelector(
      '[data-home-space="space-research"]'
    ) as HTMLElement;
    expect(
      within(research).getByRole('button', { name: 'Old notes' })
    ).toBeInTheDocument();
    expect(
      within(research).queryByRole('button', { name: /^Show all/ })
    ).not.toBeInTheDocument();
  });

  it('has no Pinned section without a pinned Session', () => {
    renderSidebar();

    expect(
      within(sidebar()).queryByRole('button', { name: 'Pinned' })
    ).not.toBeInTheDocument();
  });

  it('keeps a pinned Session out of One list', () => {
    usePageTabStore.setState({ homeSidebarGrouping: 'list' });
    useSessionControlsStore.setState({ pinnedProjectIds: ['r-2'] });
    renderSidebar();

    // One row, in Pinned, rather than a second one under Sessions.
    expect(sessionRow(/^Competitor scan/)).toBeInTheDocument();
    expect(
      within(sidebar()).getByRole('button', { name: 'Pinned' })
    ).toBeInTheDocument();
  });

  it('marks a Session unread and read from its menu', async () => {
    const user = userEvent.setup();
    renderSidebar();

    fireEvent.contextMenu(sessionRow('Pricing notes'));
    await user.click(
      await screen.findByRole('menuitem', { name: 'Mark as unread' })
    );
    expect(useSessionControlsStore.getState().unreadProjectIds).toContain(
      'r-3'
    );
    expect(
      sessionRow('Pricing notes').querySelector('[data-session-status-dot]')
    ).toHaveAttribute('data-session-status-dot', 'unread');
    expect(
      within(sessionRow('Pricing notes')).getByText('Pricing notes')
    ).toHaveClass('font-semibold');

    fireEvent.contextMenu(sessionRow('Pricing notes'));
    await user.click(
      await screen.findByRole('menuitem', { name: 'Mark as read' })
    );
    expect(useSessionControlsStore.getState().unreadProjectIds).not.toContain(
      'r-3'
    );
  });

  it('opens the Session menu on right-click', async () => {
    const user = userEvent.setup();
    const requestAction = vi.fn();
    const togglePinned = vi.fn();
    useSessionControlsStore.setState({ requestAction, togglePinned });
    renderSidebar();

    const openMenu = async () => {
      fireEvent.contextMenu(sessionRow('Weekly report'), {
        clientX: 40,
        clientY: 60,
      });
      return screen.findByRole('menu');
    };

    const menu = await openMenu();
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent?.trim())
    ).toEqual([
      'Pin',
      'Rename session',
      'Open in new window',
      'Mark as unread',
      'End session',
      'Delete session',
    ]);
    // Delete stands apart, as in the Session page's menu.
    expect(within(menu).getByRole('separator')).toBeInTheDocument();

    await user.click(
      within(menu).getByRole('menuitem', { name: 'Rename session' })
    );
    expect(requestAction).toHaveBeenCalledWith('rename', 'r-1');

    await user.click(
      within(await openMenu()).getByRole('menuitem', { name: 'Pin' })
    );
    expect(togglePinned).toHaveBeenCalledWith('r-1');

    await user.click(
      within(await openMenu()).getByRole('menuitem', {
        name: 'Open in new window',
      })
    );
    expect(mocks.openSessionWindow).toHaveBeenCalledWith({
      spaceId: 'space-research',
      projectId: 'r-1',
    });
  });

  it('pins a Space and deletes it from its row menu', async () => {
    const user = userEvent.setup();
    const deleteSpaceOnServer = vi.fn().mockResolvedValue(undefined);
    useSpaceStore.setState({ deleteSpaceOnServer });
    renderSidebar();

    await user.click(
      within(sidebar()).getByRole('button', { name: 'More actions for Ops' })
    );
    await user.click(
      await screen.findByRole('menuitem', { name: 'Pin Space' })
    );
    expect(
      useSpaceStore.getState().pinnedSpaceIdsByUser[pinnedSpaceOwnerKey(null)]
    ).toEqual(['space-research', 'space-ops']);

    await user.click(
      within(sidebar()).getByRole('button', { name: 'More actions for Ops' })
    );
    expect(
      await screen.findByRole('menuitem', { name: 'Unpin Space' })
    ).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Delete Space' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));

    expect(deleteSpaceOnServer).toHaveBeenCalledWith('space-ops');
  });

  it('lists every Space with four recent Sessions and Show all, without a pin mark', async () => {
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
    // Pinned Spaces already show on the rail, so the row has no pin mark.
    expect(
      within(research).getByRole('button', { name: 'Research' })
    ).toBeInTheDocument();
    expect(research.querySelector('.lucide-pin')).toBeNull();
    // Nested rows keep their indent inside, so hover fills span full width,
    // and every row sits 2px apart.
    const sessionRow = within(research)
      .getByRole('button', { name: 'Weekly report' })
      .closest('.group\\/session-item') as HTMLElement;
    expect(sessionRow).toHaveClass('pl-ds-40');
    // The name lines up with the Space's, so the row has no leading icon.
    expect(
      within(sessionRow)
        .getByRole('button', { name: 'Weekly report' })
        .querySelector('svg')
    ).toBeNull();
    const showAll = within(research).getByRole('button', {
      name: 'Show all 5 sessions in Research',
    });
    expect(within(showAll).getByText('Show all 5')).toHaveClass(
      'text-ds-text-base',
      'text-ds-ink-subtle-default'
    );
    const nestedRows = research.lastElementChild as HTMLElement;
    expect(nestedRows).toContainElement(sessionRow);
    expect(nestedRows).not.toHaveClass('pl-ds-12');
    expect(nestedRows).toHaveClass('gap-0.5');
    expect(research).toHaveClass('gap-0.5');
    expect(
      within(sidebar()).getByRole('button', { name: 'Ops, 1 running' })
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-home-space-status="running"]')
    ).not.toBeNull();

    // Show all lists the rest in place, without leaving Home.
    const locationBefore = screen.getByTestId('location').textContent;
    await user.click(showAll);
    expect(
      within(research).getByRole('button', { name: 'Old notes' })
    ).toBeInTheDocument();
    expect(screen.getByTestId('location').textContent).toBe(locationBefore);

    await user.click(
      within(research).getByRole('button', {
        name: 'Show fewer sessions in Research',
      })
    );
    expect(
      within(research).queryByRole('button', { name: 'Old notes' })
    ).not.toBeInTheDocument();
    expect(
      within(research).getByRole('button', {
        name: 'Show all 5 sessions in Research',
      })
    ).toBeInTheDocument();
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
    renderSidebar();
    expect(screen.queryByText('Needs you')).not.toBeInTheDocument();

    mocks.sessionAttention = { 'o-1': 'waiting', 'r-2': 'running' };
    // The mocked hook can't notify, so any store update redraws the sidebar.
    act(() => useSessionControlsStore.setState({ seenOutcomes: {} }));
    const needsYou = screen
      .getByText('Needs you')
      .closest('div.flex-col') as HTMLElement;
    expect(
      within(needsYou).getByRole('button', { name: 'Vendor invoices Ops' })
    ).toBeInTheDocument();

    mocks.sessionAttention = { 'r-1': 'waiting', 'o-1': 'waiting' };
    // The mocked hook can't notify, so any store update redraws the sidebar.
    act(() => useSessionControlsStore.setState({ seenOutcomes: {} }));
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
      hydrate: false,
    });
    expect(usePageTabStore.getState().shellPlace).toBe('home');
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
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
      within(sidebar()).getByRole('button', { name: 'Research' })
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
