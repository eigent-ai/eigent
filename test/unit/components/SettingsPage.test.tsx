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

import SettingsSection from '@/components/Settings/SettingsSection';
import SettingsPage from '@/pages/Settings';
import { useSettingsResourceCountsStore } from '@/store/settingsResourceCountsStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useSpaceStore } from '@/store/spaceStore';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/brain', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/brain')>()),
  skillRead: vi
    .fn()
    .mockResolvedValue({ success: true, content: '# Research' }),
}));

// Navigation-guard persistence has focused tests; layout tests execute the
// approved navigation callback synchronously to avoid timer-dependent waits.
vi.mock(
  '@/lib/workspaceConfigurationNavigationGuard',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@/lib/workspaceConfigurationNavigationGuard')
      >();
    return {
      ...actual,
      runAfterWorkspaceConfigurationSave: async (
        action: () => void | Promise<void>
      ) => {
        await action();
        return true;
      },
    };
  }
);

const homeOverviewMocks = vi.hoisted(() => ({
  fetchConnectedProviders: vi.fn(),
  fetchConnectorProviders: vi.fn(),
  fetchConnectorProvider: vi.fn(),
  prefetchConnectorProviders: vi.fn(),
  fetchGet: vi.fn(),
  proxyFetchGet: vi.fn(),
  listMemoryEntries: vi.fn(),
}));

const pageMotionMocks = vi.hoisted(() => ({
  reduced: false,
}));

const platformMocks = vi.hoisted(() => ({
  desktop: true,
}));

vi.mock('@/client/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/client/platform')>()),
  isDesktop: () => platformMocks.desktop,
}));

// Navigation semantics are asserted below; animation timing has focused tests.
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  const React = await import('react');
  const motionProps = new Set([
    'animate',
    'custom',
    'exit',
    'initial',
    'onAnimationComplete',
    'transition',
    'variants',
  ]);
  const createMotionComponent = (tag: 'div' | 'main') => {
    const MotionComponent = React.forwardRef<
      HTMLElement,
      Record<string, unknown>
    >((props, ref) => {
      const domProps = Object.fromEntries(
        Object.entries(props).filter(([key]) => !motionProps.has(key))
      );
      return React.createElement(tag, { ...domProps, ref });
    });
    MotionComponent.displayName = `MockMotion.${tag}`;
    return MotionComponent;
  };

  return {
    ...actual,
    AnimatePresence: ({ children }: { children?: ReactNode }) => children,
    motion: {
      div: createMotionComponent('div'),
      main: createMotionComponent('main'),
    },
    useReducedMotion: () => pageMotionMocks.reduced,
  };
});

vi.mock('@/api/connectors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/connectors')>()),
  fetchConnectedProviders: homeOverviewMocks.fetchConnectedProviders,
  fetchConnectorProviders: homeOverviewMocks.fetchConnectorProviders,
  fetchConnectorProvider: homeOverviewMocks.fetchConnectorProvider,
  prefetchConnectorProviders: homeOverviewMocks.prefetchConnectorProviders,
}));

vi.mock('@/api/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/http')>()),
  fetchGet: homeOverviewMocks.fetchGet,
  proxyFetchGet: homeOverviewMocks.proxyFetchGet,
}));

vi.mock('@/service/memoryApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/memoryApi')>()),
  listMemoryEntries: homeOverviewMocks.listMemoryEntries,
}));

vi.mock('@/hooks/queries/useTriggerQueries', () => ({
  useUserTriggerCountQuery: () => ({ data: 0 }),
}));

function openDropdown(trigger: HTMLElement) {
  const event = new MouseEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    button: 0,
    ctrlKey: false,
  });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  fireEvent(trigger, event);
}

vi.mock('@/service/historyApi', () => ({
  fetchGroupedHistoryTasks: vi.fn(() => new Promise(() => undefined)),
}));

vi.mock('@/service/triggerApi', () => ({
  proxyFetchTriggers: vi.fn(() => new Promise(() => undefined)),
}));

vi.mock('@/components/Settings/General', () => ({
  default: () => <div data-testid="general-settings" />,
}));

vi.mock('@/components/Settings/Appearance', () => ({
  default: () => <div data-testid="appearance-settings" />,
}));

vi.mock('@/components/Settings/Privacy', () => ({
  default: () => <div data-testid="privacy-settings" />,
}));

// These tests exercise navigation and the real Skills surface, not model APIs.
vi.mock('@/components/Settings/Models', () => ({
  default: () => <div data-testid="models-settings" />,
}));

vi.mock('@/store/authStore', () => {
  const authState = {
    appearance: 'light',
    language: 'en',
    token: 'token',
    username: 'Douglas',
    email: 'douglas@example.com',
    user_id: 7,
  };
  const useAuthStore = (
    selector: (state: typeof authState) => unknown = (state) => state
  ) => selector(authState);

  return {
    getAuthStore: () => authState,
    useAuthStore,
    useWorkerList: () => [],
  };
});

type SettingsInitialEntry =
  | string
  | {
      pathname: string;
      search?: string;
      state?: Record<string, unknown>;
    };

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="settings-location">
      {location.pathname}
      {location.search}
    </output>
  );
}

function renderSettingsPage(
  initialEntry:
    | SettingsInitialEntry
    | SettingsInitialEntry[] = '/home?section=settings&tab=models'
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const initialEntries = Array.isArray(initialEntry)
    ? initialEntry
    : [initialEntry];

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={initialEntries}
        initialIndex={initialEntries.length - 1}
      >
        <SettingsPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('SettingsPage', () => {
  beforeEach(() => {
    pageMotionMocks.reduced = false;
    platformMocks.desktop = true;
    window.localStorage.setItem('eigent-home-hub-view-mode', 'grid');
    useSettingsStore.setState({
      activeSection: 'models',
    });
    useSettingsResourceCountsStore.setState({
      counts: { 'browser-connections': null, cookies: null },
    });
    homeOverviewMocks.fetchConnectedProviders.mockResolvedValue([
      { service: 'github' },
      { service: 'notion' },
    ]);
    homeOverviewMocks.fetchConnectorProviders.mockResolvedValue({
      enabled: true,
      source: 'connector_gateway',
      provider_count: 0,
      filtered_count: 0,
      connected_count: 0,
      page: 1,
      page_size: 60,
      total_pages: 1,
      providers: [],
    });
    homeOverviewMocks.fetchConnectorProvider.mockResolvedValue({
      enabled: true,
      source: 'connector_gateway',
      provider: { service: 'github', displayName: 'GitHub', actions: [] },
    });
    homeOverviewMocks.prefetchConnectorProviders.mockResolvedValue(undefined);
    homeOverviewMocks.fetchGet.mockImplementation(async (path: string) => {
      if (path === '/browser/cdp/list') {
        return [
          { id: 'browser-1', port: 9222 },
          { id: 'browser-2', port: 9223 },
        ];
      }
      if (path === '/browser/cookies') {
        return {
          success: true,
          domains: [
            { domain: 'github.com' },
            { domain: 'notion.so' },
            { domain: 'slack.com' },
          ],
        };
      }
      return {};
    });
    homeOverviewMocks.proxyFetchGet.mockImplementation(async (path: string) => {
      if (path === '/api/v1/server/capabilities') {
        return { features: { connector_gateway: { enabled: true } } };
      }
      if (path === '/api/v1/mcp/users' || path === '/api/v1/configs') return [];
      return {};
    });
    homeOverviewMocks.listMemoryEntries.mockResolvedValue({
      scope_state: {
        token_limit: 5000,
        current_token_count: 1000,
      },
      items: [],
    });
  });

  it('hides Desktop-only Agent Plugin import from the web dialog', async () => {
    platformMocks.desktop = false;
    const user = userEvent.setup();
    renderSettingsPage('/home?section=spaces');

    const spacesToolbar = document.querySelector(
      '[data-home-spaces-toolbar]'
    ) as HTMLElement;
    await user.click(
      await within(spacesToolbar).findByRole('button', { name: 'New Space' })
    );
    await user.click(
      screen.getByRole('button', { name: 'Import from Workspace Bundle' })
    );

    const bundleOptions = screen.getByRole('group', {
      name: 'Bundle import options',
    });
    expect(bundleOptions).toHaveClass('grid-cols-1');
    expect(
      within(bundleOptions).queryByRole('button', {
        name: 'Import Agent Plugin as Bundle',
      })
    ).not.toBeInTheDocument();
  });

  it('redirects legacy Settings URLs into the active Space configuration', async () => {
    const now = Date.now();
    useSpaceStore.setState((state) => ({
      ...state,
      activeSpaceId: 'active-space',
      spaces: {
        ...state.spaces,
        'active-space': {
          id: 'active-space',
          name: 'Active Space',
          sourceType: 'folder',
          rootPath: '/work/active-space',
          status: 'active',
          schemaVersion: 2,
          createdAt: now,
          updatedAt: now,
        },
      },
      projectsBySpaceId: {
        ...state.projectsBySpaceId,
        'active-space': {},
      },
      projectsSyncedAt: {
        ...state.projectsSyncedAt,
        'active-space': now,
      },
    }));

    renderSettingsPage(
      '/home?section=settings&tab=models&provider=local-provider'
    );

    await waitFor(() =>
      expect(screen.getByTestId('settings-location')).toHaveTextContent(
        '/home?section=spaces&spaceId=active-space&spaceTab=workspace-profile&spaceConfig=space-settings-model&provider=local-provider'
      )
    );
    expect(
      screen.queryByRole('button', { name: 'Models' })
    ).not.toBeInTheDocument();
  });

  it('returns from Space detail to its workspace origin', async () => {
    const user = userEvent.setup();
    const now = Date.now();
    useSpaceStore.setState((state) => ({
      ...state,
      spaces: {
        ...state.spaces,
        'origin-space': {
          id: 'origin-space',
          name: 'Origin Space',
          sourceType: 'folder',
          rootPath: '/work/origin-space',
          status: 'active',
          schemaVersion: 1,
          createdAt: now,
          updatedAt: now,
        },
      },
      projectsBySpaceId: {
        ...state.projectsBySpaceId,
        'origin-space': {},
      },
      projectsSyncedAt: {
        ...state.projectsSyncedAt,
        'origin-space': now,
      },
    }));

    renderSettingsPage([
      '/',
      {
        pathname: '/home',
        search: '?section=spaces&spaceId=origin-space&spaceTab=projects',
        state: { from: '/' },
      },
    ]);

    const spaceSidebar = await screen.findByRole('complementary', {
      name: 'Spaces',
    });
    await user.click(
      within(spaceSidebar).getByRole('button', { name: 'Back' })
    );

    await waitFor(() =>
      expect(screen.getByTestId('settings-location')).toHaveTextContent(/^\/$/)
    );
  });

  it('switches to the Space detail layout without changing the shared shell', () => {
    const now = Date.now();
    useSpaceStore.setState((state) => ({
      ...state,
      spaces: {
        ...state.spaces,
        'space-1': {
          id: 'space-1',
          name: 'Design Space',
          description: 'Product design work',
          sourceType: 'folder',
          rootPath: '/work/design-space',
          status: 'active',
          schemaVersion: 1,
          createdAt: now,
          updatedAt: now,
        },
        'legacy-untitled': {
          id: 'legacy-untitled',
          name: 'Untitled Space',
          sourceType: 'blank',
          status: 'active',
          schemaVersion: 1,
          createdAt: now - 1,
          updatedAt: now - 1,
        },
      },
      projectsBySpaceId: {
        ...state.projectsBySpaceId,
        'space-1': {},
        'legacy-untitled': {},
      },
      projectsSyncedAt: {
        ...state.projectsSyncedAt,
        'space-1': now,
      },
    }));

    const { unmount } = renderSettingsPage('/home?section=spaces');

    const cardWorkspaceButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[data-home-space-open-workspace][data-layout="card"]'
      )
    );
    expect(cardWorkspaceButtons.length).toBeGreaterThan(0);
    expect(cardWorkspaceButtons[0]).toHaveAttribute('data-variant', 'ghost');
    expect(cardWorkspaceButtons[0]).toHaveClass(
      'cursor-pointer',
      'rounded-lg',
      'font-medium'
    );
    expect(cardWorkspaceButtons[0].parentElement).not.toHaveTextContent(
      'Last updated:'
    );

    const homeSpaceCard = screen
      .getByText('Design Space')
      .closest('button') as HTMLElement;
    expect(homeSpaceCard).toBeInTheDocument();
    fireEvent.pointerDown(homeSpaceCard, { pointerType: 'mouse' });
    fireEvent.click(homeSpaceCard);

    const detailSidebar = screen.getByRole('complementary', {
      name: 'Spaces',
    });
    expect(
      document.querySelector('[data-home-space-sidebar-pane="detail"]')
    ).toHaveAttribute('data-space-navigation-direction', 'forward');
    expect(
      document.querySelector('[data-home-space-sidebar-pane="detail"]')
    ).toHaveAttribute('data-space-navigation-motion', 'full');
    const detailContent = document.querySelector(
      '[data-home-space-content-pane="detail"]'
    ) as HTMLElement;
    expect(detailContent).toHaveAttribute(
      'data-space-navigation-motion',
      'full'
    );
    expect(
      within(detailSidebar).getByRole('button', { name: 'Design Space' })
    ).toHaveAttribute('aria-current', 'page');
    const detailSidebarHeader = detailSidebar.querySelector(
      'header'
    ) as HTMLElement;
    expect(detailSidebarHeader).not.toHaveClass('border-b');
    expect(
      within(detailSidebarHeader).getByRole('button', { name: 'Back' })
    ).toBeInTheDocument();
    const newSpaceTab = within(detailSidebarHeader).getByRole('button', {
      name: 'New Space',
    });
    expect(newSpaceTab).toHaveAttribute('data-variant', 'primary');
    expect(newSpaceTab).toHaveClass('!rounded-full');
    expect(newSpaceTab.querySelector('svg')).toHaveClass('lucide-plus');
    const spaceSearch = within(detailSidebar).getByRole('searchbox', {
      name: 'Search spaces...',
    });
    expect(spaceSearch.closest('.py-ds-8')).not.toHaveClass('px-ds-8');
    expect(
      newSpaceTab.compareDocumentPosition(spaceSearch) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(detailSidebar.querySelector('.uppercase')).not.toBeInTheDocument();
    expect(
      within(detailSidebar).queryByRole('button', { name: 'Untitled Space' })
    ).not.toBeInTheDocument();
    fireEvent.change(spaceSearch, { target: { value: 'missing' } });
    expect(
      within(detailSidebar).queryByRole('button', { name: 'Design Space' })
    ).not.toBeInTheDocument();
    expect(detailSidebar).toHaveTextContent('No results match your search.');
    fireEvent.change(spaceSearch, { target: { value: '' } });
    fireEvent.click(newSpaceTab);
    expect(
      screen.getByRole('dialog', { name: 'Create a new Space' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(
      detailSidebar.querySelector('.lucide-check')
    ).not.toBeInTheDocument();
    const designSpaceTab = within(detailSidebar).getByRole('button', {
      name: 'Design Space',
    });
    const spaceMoreButton = within(detailSidebar).getByRole('button', {
      name: 'More actions: Design Space',
    });
    expect(spaceMoreButton.closest('.group')).toContainElement(designSpaceTab);

    openDropdown(spaceMoreButton);
    fireEvent.click(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: 'Rename Space',
      })
    );
    const renameDialog = screen.getByRole('alertdialog', {
      name: 'Rename Space',
    });
    expect(within(renameDialog).getByPlaceholderText('Space name')).toHaveValue(
      'Design Space'
    );
    fireEvent.click(
      within(renameDialog).getByRole('button', { name: 'Cancel' })
    );

    openDropdown(spaceMoreButton);
    fireEvent.click(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: 'Delete',
      })
    );
    const deleteDialog = screen.getByRole('alertdialog', { name: 'Delete' });
    expect(deleteDialog).toHaveTextContent(
      'Are you sure you want to delete this space and all its sessions?'
    );
    fireEvent.click(
      within(deleteDialog).getByRole('button', { name: 'Cancel' })
    );
    const detailHeader = document.querySelector(
      '[data-content-header-frame]'
    ) as HTMLElement;
    expect(detailHeader.querySelector('.px-ds-16')).toBeInTheDocument();
    const detailHeading = within(detailHeader).getByRole('heading', {
      name: 'Design Space',
      level: 1,
    });
    expect(detailHeading).toHaveClass('!text-ds-text-base');
    const openWorkspaceButton = within(detailHeader).getByRole('button', {
      name: 'Open workspace',
    });
    expect(openWorkspaceButton).toHaveAttribute('data-variant', 'primary');
    expect(openWorkspaceButton).toHaveClass('!rounded-full');
    expect(
      within(detailContent).getByText('Product design work')
    ).toBeInTheDocument();
    expect(within(detailContent).getByText('Local')).toBeInTheDocument();

    for (const tabName of [
      'Sessions',
      'Tasks',
      'Automations',
      'Context',
      'Memory',
      'Configuration',
    ]) {
      expect(screen.getByRole('tab', { name: tabName })).toBeInTheDocument();
    }
    expect(screen.getByRole('tablist', { name: 'Space content' })).toHaveClass(
      'gap-2',
      'pb-2'
    );
    expect(
      within(screen.getByRole('tab', { name: 'Sessions' })).getByText(
        'Sessions'
      )
    ).toHaveClass('!text-ds-text-base', 'font-bold');
    expect(screen.getByRole('tab', { name: 'Sessions' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(
      screen.getByRole('tab', { name: 'Sessions' }).querySelector('svg')
    ).toHaveClass('lucide-message-circle');
    expect(
      document.querySelector('[data-space-stat="Sessions"] svg')
    ).toHaveClass('lucide-message-circle');
    expect(
      screen.getByRole('tab', { name: 'Context' }).querySelector('svg')
    ).toHaveClass('lucide-library');
    expect(
      screen.getByRole('tab', { name: 'Configuration' }).querySelector('svg')
    ).toHaveClass('lucide-settings');
    fireEvent.pointerEnter(screen.getByRole('tab', { name: 'Memory' }), {
      pointerType: 'mouse',
    });
    expect(document.querySelector('[data-space-detail-tab-hover]')).toHaveClass(
      'rounded-full',
      'bg-ds-neutral-default-default'
    );
    expect(screen.getByRole('tab', { name: 'Memory' })).toHaveClass(
      'rounded-full'
    );
    const stickyTabs = document.querySelector('[data-space-tabs-sticky]');
    expect(stickyTabs).toHaveClass(
      'sticky',
      '-top-px',
      'border-b-1',
      'bg-ds-neutral-subtle-default'
    );
    const detailRails = [
      document.querySelector('[data-space-detail-summary-rail]'),
      document.querySelector('[data-space-detail-tabs-rail]'),
      document.querySelector('[data-space-detail-content-rail]'),
    ];
    for (const rail of detailRails) {
      expect(rail).toHaveClass('mx-auto', 'w-full', 'max-w-[1100px]');
    }
    expect(detailRails[2]?.parentElement).toHaveClass('px-8');
    expect(detailRails[2]).not.toHaveClass('px-8');
    expect(document.querySelector('[data-space-stat="Status"]')).toHaveClass(
      'items-center'
    );
    unmount();
  });

  it('keeps the workspace action last in a Spaces list row', () => {
    const now = Date.now();
    useSpaceStore.setState((state) => ({
      ...state,
      spaces: {
        'list-space': {
          id: 'list-space',
          name: 'List Space',
          sourceType: 'folder',
          rootPath: '/work/list-space',
          status: 'active',
          schemaVersion: 1,
          createdAt: now,
          updatedAt: now,
        },
      },
      projectsBySpaceId: { 'list-space': {} },
      projectsSyncedAt: { 'list-space': now },
    }));
    window.localStorage.setItem('eigent-home-hub-view-mode', 'list');

    const { unmount } = renderSettingsPage('/home?section=spaces');

    const listWorkspaceButton = document.querySelector<HTMLButtonElement>(
      '[data-home-space-open-workspace][data-layout="list"]'
    );
    expect(listWorkspaceButton).toHaveClass(
      'cursor-pointer',
      'rounded-lg',
      'font-medium'
    );
    expect(listWorkspaceButton?.parentElement).toHaveClass('justify-self-end');
    expect(listWorkspaceButton).toHaveAttribute('data-variant', 'ghost');
    expect(listWorkspaceButton?.parentElement?.lastElementChild).toBe(
      listWorkspaceButton
    );
    unmount();
  });

  it('keeps reduced-motion navigation to fades and keyboard navigation instant', () => {
    pageMotionMocks.reduced = true;
    const now = Date.now();
    useSpaceStore.setState((state) => ({
      ...state,
      spaces: {
        ...state.spaces,
        'motion-space': {
          id: 'motion-space',
          name: 'Motion Space',
          description: 'Motion test space',
          sourceType: 'folder',
          rootPath: '/work/motion-space',
          status: 'active',
          schemaVersion: 1,
          createdAt: now,
          updatedAt: now,
        },
      },
      projectsBySpaceId: {
        ...state.projectsBySpaceId,
        'motion-space': {},
      },
      projectsSyncedAt: {
        ...state.projectsSyncedAt,
        'motion-space': now,
      },
    }));

    const { unmount } = renderSettingsPage('/home?section=spaces');

    const spaceCard = screen
      .getByText('Motion Space')
      .closest('button') as HTMLElement;
    fireEvent.pointerDown(spaceCard, { pointerType: 'mouse' });
    fireEvent.click(spaceCard);

    const detailSidebar = screen.getByRole('complementary', {
      name: 'Spaces',
    });
    expect(
      document.querySelector('[data-home-space-sidebar-pane="detail"]')
    ).toHaveAttribute('data-space-navigation-motion', 'fade');
    expect(
      document.querySelector('[data-home-space-content-pane="detail"]')
    ).toHaveAttribute('data-space-navigation-motion', 'fade');

    const backButton = within(detailSidebar).getByRole('button', {
      name: 'Back',
    });
    backButton.focus();
    fireEvent.keyDown(backButton, { key: 'Enter' });
    fireEvent.click(backButton);
    expect(
      screen.getByRole('complementary', { name: 'Home' })
    ).toBeInTheDocument();

    expect(
      document.querySelector('[data-home-space-sidebar-pane="home"]')
    ).toHaveAttribute('data-space-navigation-motion', 'instant');
    expect(
      document.querySelector('[data-home-space-content-pane="home"]')
    ).toHaveAttribute('data-space-navigation-motion', 'instant');
    unmount();
  });

  it('redirects an empty placeholder Space to Home without listing it', async () => {
    const now = Date.now();
    useSpaceStore.setState((state) => ({
      ...state,
      spaces: {
        ...state.spaces,
        'empty-space': {
          id: 'empty-space',
          name: 'Untitled Space',
          sourceType: 'blank',
          status: 'active',
          schemaVersion: 2,
          createdAt: now,
          updatedAt: now,
          metadata: {
            createdFrom: 'space_detail_sidebar',
            autoCreatedPlaceholder: true,
          },
        },
      },
      projectsBySpaceId: {
        ...state.projectsBySpaceId,
        'empty-space': {},
      },
      projectsSyncedAt: {
        ...state.projectsSyncedAt,
        'empty-space': now,
      },
    }));

    renderSettingsPage(
      '/home?section=spaces&spaceId=empty-space&spaceTab=projects'
    );

    await waitFor(() => {
      expect(
        screen.getByRole('complementary', { name: 'Home' })
      ).toBeInTheDocument();
    });
    expect(screen.queryByText('Untitled Space')).not.toBeInTheDocument();
    expect(
      document.querySelector('[data-home-spaces-list]')
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Connect to a local folder' })
    ).not.toBeInTheDocument();
    expect(document.querySelector('[data-space-stat]')).not.toBeInTheDocument();
  });

  it('supports horizontal section content while defaulting to vertical', () => {
    const { rerender } = render(
      <SettingsSection title="Section title">
        <span>Section content</span>
      </SettingsSection>
    );

    const getSectionBox = () =>
      screen.getByText('Section title').parentElement?.nextElementSibling;

    expect(getSectionBox()).toHaveClass('flex-col');

    rerender(
      <SettingsSection title="Section title" variant="horizontal">
        <span>Section content</span>
      </SettingsSection>
    );

    expect(getSectionBox()).toHaveClass('flex-row');

    rerender(
      <SettingsSection titleVariant="hidden">
        <span>Section content</span>
      </SettingsSection>
    );

    expect(screen.queryByText('Section title')).not.toBeInTheDocument();
    expect(screen.getByText('Section content').parentElement).toHaveClass(
      'rounded-2xl',
      'border-0',
      'bg-ds-neutral-default-default',
      'p-4'
    );

    rerender(
      <SettingsSection titleVariant="hidden" surface="plain">
        <span>Section content</span>
      </SettingsSection>
    );

    expect(screen.getByText('Section content').parentElement).toHaveClass(
      'bg-transparent'
    );
    expect(screen.getByText('Section content').parentElement).not.toHaveClass(
      'bg-ds-neutral-default-default'
    );
  });
});
