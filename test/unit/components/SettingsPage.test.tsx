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
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

function renderSettingsPage() {
  return render(
    <MemoryRouter initialEntries={['/settings']}>
      <SettingsPage />
    </MemoryRouter>
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
      name: 'Settings',
    });
    const contentShell = document.querySelector('.scrollbar-always-visible');
    expect(contentShell).toHaveClass(
      'overflow-y-scroll',
      '[scrollbar-gutter:stable]'
    );
    expect(contentShell?.firstElementChild).toHaveClass('px-8');
    expect(
      within(sidebar).getByRole('navigation', { name: 'Settings' })
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
    const globalSettingLabel = within(sidebar).getByText('Global Setting');
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
    expect(screen.getByText('General')).toBeInTheDocument();
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
