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
import { useSettingsStore } from '@/store/settingsStore';
import { useSpaceStore } from '@/store/spaceStore';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/queries/useTriggerQueries', () => ({
  useUserTriggerCountQuery: () => ({ data: 0 }),
}));

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

vi.mock('@/store/authStore', () => {
  const authState = {
    appearance: 'light',
    language: 'en',
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

function renderSettingsPage(
  initialEntry = '/home?section=settings&tab=models'
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function getSettingsHeader() {
  const header = document.querySelector('header');
  expect(header).not.toBeNull();
  return header as HTMLElement;
}

describe('SettingsPage', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      activeSection: 'models',
    });
  });

  it('renders scoped navigation in the shared app shell', () => {
    renderSettingsPage();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const main = screen.getByRole('main');
    const sidebar = screen.getByRole('complementary', {
      name: 'Home',
    });
    const contentShell = document.querySelector('.scrollbar-always-visible');
    expect(contentShell).toHaveClass(
      'overflow-y-scroll',
      '[scrollbar-gutter:stable]'
    );
    expect(contentShell?.firstElementChild).toHaveClass('px-8');
    expect(
      within(sidebar).getByRole('navigation', { name: 'Home' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Workspace Bundle' })
    ).not.toBeInTheDocument();
    const selectedTab = screen.getByRole('button', { name: 'Models' });
    const header = getSettingsHeader();
    const heading = within(header).getByRole('heading', {
      name: 'Models',
      level: 1,
    });
    expect(main).toContainElement(header);
    expect(heading).toHaveFocus();
    expect(header).toHaveClass('h-[44px]');
    expect(within(header).getByText('Models')).toHaveClass(
      'text-body-md',
      'font-bold'
    );
    expect(
      within(header).queryByRole('button', {
        name: 'Back',
      })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', {
        name: 'layout.workspace-active-scope',
        level: 3,
      })
    ).not.toBeInTheDocument();
    expect(selectedTab).toHaveAttribute('aria-current', 'page');
    expect(selectedTab).toHaveClass(
      'bg-ds-bg-neutral-subtle-default',
      'h-8',
      'w-full'
    );
    const homeLabel = within(sidebar).getByText('Home');
    const globalSettingLabel = within(sidebar).getByText('Global Setting');
    expect(
      homeLabel.compareDocumentPosition(globalSettingLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      within(sidebar).getByRole('button', { name: 'Spaces' })
    ).toBeInTheDocument();
    expect(
      within(sidebar).queryByRole('button', { name: 'Projects' })
    ).not.toBeInTheDocument();
    expect(
      within(sidebar).queryByRole('button', { name: 'Tasks' })
    ).not.toBeInTheDocument();
    expect(
      within(sidebar).queryByRole('button', { name: 'Triggers' })
    ).not.toBeInTheDocument();
    expect(globalSettingLabel).toBeInTheDocument();
    expect(
      globalSettingLabel.compareDocumentPosition(selectedTab) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.getByText('Browser')).toBeInTheDocument();
    expect(screen.getByText('Extension')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Skills' }).querySelector('svg')
    ).toHaveClass('lucide-wand-sparkles');
    expect(
      screen.getByRole('button', { name: 'Browser' }).querySelector('svg')
    ).toHaveClass('lucide-globe');
    expect(
      screen.getByRole('button', { name: 'Extension' }).querySelector('svg')
    ).toHaveClass('lucide-puzzle');
    expect(
      within(sidebar).getByRole('button', { name: 'Settings' })
    ).toBeInTheDocument();
    expect(
      within(sidebar).queryByRole('button', { name: 'General' })
    ).not.toBeInTheDocument();
    expect(
      within(sidebar).queryByRole('button', { name: 'Appearance' })
    ).not.toBeInTheDocument();
    expect(
      within(sidebar).queryByRole('button', { name: 'Privacy' })
    ).not.toBeInTheDocument();
  });

  it('switches between Home and Settings sections in the same shell', async () => {
    const user = userEvent.setup();

    renderSettingsPage();

    const spacesTab = screen.getByRole('button', { name: 'Spaces' });
    const modelsTab = screen.getByRole('button', { name: 'Models' });
    await user.click(spacesTab);

    await waitFor(() => {
      expect(spacesTab).toHaveAttribute('aria-current', 'page');
      expect(modelsTab).not.toHaveAttribute('aria-current');
    });

    await user.click(modelsTab);

    await waitFor(() => {
      expect(modelsTab).toHaveAttribute('aria-current', 'page');
      expect(spacesTab).not.toHaveAttribute('aria-current');
    });
  });

  it('combines the app settings categories into one vertical page', async () => {
    const user = userEvent.setup();

    renderSettingsPage();

    const sidebar = screen.getByRole('complementary', { name: 'Home' });
    await user.click(within(sidebar).getByRole('button', { name: 'Settings' }));

    const general = await screen.findByTestId('general-settings');
    const appearance = screen.getByTestId('appearance-settings');
    const privacy = screen.getByTestId('privacy-settings');
    const about = screen.getByRole('img', { name: 'Eigent' });

    expect(
      general.compareDocumentPosition(appearance) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      appearance.compareDocumentPosition(privacy) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      privacy.compareDocumentPosition(about) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      screen.queryByRole('heading', {
        name: /general|appearance|privacy|about/i,
      })
    ).not.toBeInTheDocument();
  });

  it('updates the content header for a settings sub-tab', async () => {
    const user = userEvent.setup();

    renderSettingsPage();

    await user.click(screen.getByRole('button', { name: 'Skills' }));
    const exampleSkillsTab = await screen.findByRole('tab', {
      name: 'Example skills',
    });
    const yourSkillsTab = screen.getByRole('tab', {
      name: 'Your skills',
    });
    const header = getSettingsHeader();
    const heading = await within(header).findByRole('heading', {
      name: 'Your skills',
      level: 1,
    });
    expect(heading).toHaveClass('sr-only');
    expect(header).toContainElement(exampleSkillsTab);
    expect(within(header).getByRole('tablist')).toHaveClass(
      'rounded-xl',
      'bg-ds-bg-neutral-strong-default',
      'ring-1'
    );
    expect(exampleSkillsTab).toHaveAttribute('data-tabs-appearance', 'default');
    expect(exampleSkillsTab).toHaveClass(
      'rounded-xl',
      'bg-ds-bg-neutral-strong-default'
    );
    expect(
      within(header).getByRole('button', { name: 'Search' })
    ).toBeInTheDocument();
    expect(
      within(header).getByRole('button', { name: 'Add Skill' })
    ).toBeInTheDocument();

    expect(yourSkillsTab).toHaveAttribute('aria-selected', 'true');
    expect(
      within(header).getByText('Your skills', { selector: 'span' })
    ).toBeInTheDocument();

    await user.click(exampleSkillsTab);

    await waitFor(() => {
      expect(exampleSkillsTab).toHaveAttribute('aria-selected', 'true');
    });
    expect(
      screen.queryByRole('heading', {
        name: 'Example skills',
        level: 3,
      })
    ).not.toBeInTheDocument();
  });

  it('clears section-owned header controls during a page switch', async () => {
    const user = userEvent.setup();

    renderSettingsPage();

    await user.click(screen.getByRole('button', { name: 'Skills' }));
    const header = getSettingsHeader();

    expect(await within(header).findByRole('tablist')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Channels' }));

    await waitFor(() => {
      expect(within(header).queryByRole('tablist')).not.toBeInTheDocument();
      expect(within(header).getByText('Channels')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(
        document.querySelector('[data-settings-section="channels"]')
      ).toBeInTheDocument();
    });
  });

  it('switches to the Space detail layout without changing the shared shell', async () => {
    const user = userEvent.setup();
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
      },
      projectsBySpaceId: {
        ...state.projectsBySpaceId,
        'space-1': {},
      },
      projectsSyncedAt: {
        ...state.projectsSyncedAt,
        'space-1': now,
      },
    }));

    renderSettingsPage(
      '/home?section=spaces&spaceId=space-1&spaceTab=projects'
    );

    const detailSidebar = screen.getByRole('complementary', { name: 'Spaces' });
    expect(
      within(detailSidebar).getByRole('button', { name: 'Design Space' })
    ).toHaveAttribute('aria-current', 'page');
    expect(
      within(detailSidebar).getByRole('button', { name: 'Back to Home' })
    ).toBeInTheDocument();
    expect(
      within(detailSidebar).getByRole('button', { name: 'New Space' })
    ).toBeInTheDocument();
    const detailHeader = document.querySelector('main header');
    expect(detailHeader).toBeEmptyDOMElement();
    expect(detailHeader).not.toHaveClass('border-b');
    expect(
      within(screen.getByRole('main')).getByText('Design Space')
    ).toHaveClass('!text-body-lg');
    expect(screen.getByText('Product design work')).toBeInTheDocument();
    expect(screen.getByText('Local')).toBeInTheDocument();

    for (const tabName of [
      'Projects',
      'Tasks',
      'Triggers',
      'Context',
      'Memory',
      'Workspace Profile',
    ]) {
      expect(screen.getByRole('radio', { name: tabName })).toBeInTheDocument();
    }
    expect(
      screen.getByRole('radiogroup', { name: 'Space content' })
    ).toHaveClass('rounded-full', 'bg-ds-bg-neutral-strong-default');
    expect(
      within(screen.getByRole('radio', { name: 'Projects' })).getByText(
        'Projects'
      )
    ).toHaveClass('!text-body-sm');
    const stickyTabs = document.querySelector('[data-space-tabs-sticky]');
    expect(stickyTabs).toHaveClass('sticky', 'top-0');
    expect(stickyTabs).not.toHaveClass('border-b');
    expect(document.querySelector('[data-space-stat="Status"]')).toHaveClass(
      'items-center'
    );

    await user.click(
      within(detailSidebar).getByRole('button', { name: 'Back to Home' })
    );

    await waitFor(() => {
      expect(
        screen.getByRole('complementary', { name: 'Home' })
      ).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Models' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Spaces' })).toHaveAttribute(
      'aria-current',
      'page'
    );
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
      'bg-ds-bg-neutral-default-default',
      'p-4'
    );
  });
});
