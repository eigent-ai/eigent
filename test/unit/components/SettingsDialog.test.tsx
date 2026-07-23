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

import SettingsDialog from '@/components/Settings';
import SettingsSection from '@/components/Settings/SettingsSection';
import { useSettingsDialogStore } from '@/store/settingsDialogStore';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

describe('SettingsDialog', () => {
  beforeEach(() => {
    useSettingsDialogStore.setState({
      isOpen: true,
      activeSection: 'workspace-profile',
    });
  });

  it('renders scoped navigation in a dedicated accessible dialog', () => {
    render(
      <MemoryRouter>
        <SettingsDialog />
      </MemoryRouter>
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    const contentShell = dialog.querySelector('.scrollbar-always-visible');
    expect(contentShell).toHaveClass(
      'overflow-y-scroll',
      '[scrollbar-gutter:stable]'
    );
    expect(contentShell?.firstElementChild).toHaveClass('px-8');
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getByRole('complementary').firstElementChild?.tagName).toBe(
      'NAV'
    );
    const selectedTab = screen.getByRole('button', {
      name: 'layout.workspace-profile',
    });
    const defaultTab = screen.getByRole('button', { name: 'setting.models' });
    const header = screen
      .getByRole('button', { name: /close/i })
      .closest('header');
    expect(header).toHaveClass('h-[44px]');
    expect(
      within(header as HTMLElement).getByText('layout.workspace-profile')
    ).toHaveClass('text-body-md', 'font-bold');
    expect(
      within(header as HTMLElement).queryByRole('button', {
        name: 'layout.back',
      })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', {
        name: 'layout.workspace-active-scope',
        level: 3,
      })
    ).not.toBeInTheDocument();
    const profileSection = contentShell?.querySelector('section > section');
    expect(profileSection?.firstElementChild).toHaveClass(
      'p-4',
      'rounded-2xl',
      'border-ds-border-neutral-muted-default',
      'flex-col'
    );
    expect(profileSection?.parentElement).toHaveClass('py-4', 'gap-4');
    expect(selectedTab).toHaveClass(
      'bg-ds-bg-brand-default-default',
      '!text-ds-text-brand-inverse-default',
      'h-8',
      'w-full',
      'text-sm',
      'font-semibold'
    );
    expect(defaultTab).toHaveClass(
      'bg-transparent',
      'h-8',
      'w-full',
      'text-sm',
      'font-semibold',
      'hover:bg-ds-bg-brand-subtle-default',
      'hover:!text-ds-text-brand-inverse-default'
    );
    expect(selectedTab.querySelector('svg')).toHaveClass(
      '!text-ds-text-brand-inverse-default'
    );
    expect(defaultTab.querySelector('svg')).toHaveClass(
      'group-hover:!text-ds-text-brand-inverse-default'
    );
    expect(screen.getByText('setting.models')).toBeInTheDocument();
    expect(screen.getByText('layout.browser')).toBeInTheDocument();
    expect(screen.getByText('layout.browser-extension')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'agents.skills' }).querySelector('svg')
    ).toHaveClass('lucide-wand-sparkles');
    expect(
      screen
        .getByRole('button', { name: 'layout.browser' })
        .querySelector('svg')
    ).toHaveClass('lucide-globe');
    expect(
      screen
        .getByRole('button', { name: 'layout.browser-extension' })
        .querySelector('svg')
    ).toHaveClass('lucide-puzzle');
    expect(screen.getByText('setting.general')).toBeInTheDocument();
  });

  it('updates the content header for a settings sub-tab', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <SettingsDialog />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: 'agents.skills' }));
    const exampleSkillsTab = await screen.findByRole('tab', {
      name: 'agents.example-skills',
    });
    const yourSkillsTab = screen.getByRole('tab', {
      name: 'agents.your-skills',
    });
    const header = screen
      .getByRole('button', { name: /close/i })
      .closest('header') as HTMLElement;
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
      within(header).getByRole('button', { name: 'agents.search-tooltip' })
    ).toBeInTheDocument();
    expect(
      within(header).getByRole('button', { name: 'agents.add-skill' })
    ).toBeInTheDocument();

    expect(yourSkillsTab).toHaveAttribute('aria-selected', 'true');
    expect(
      within(header).getByText('agents.your-skills', { selector: 'span' })
    ).toBeInTheDocument();

    await user.click(exampleSkillsTab);

    await waitFor(() => {
      expect(exampleSkillsTab).toHaveAttribute('aria-selected', 'true');
    });
    expect(
      screen.queryByRole('heading', {
        name: 'agents.example-skills',
        level: 3,
      })
    ).not.toBeInTheDocument();
  });

  it('clears section-owned header controls during a page switch', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <SettingsDialog />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: 'agents.skills' }));
    const header = screen
      .getByRole('button', { name: /close/i })
      .closest('header') as HTMLElement;

    expect(await within(header).findByRole('tablist')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'layout.channels' }));

    await waitFor(() => {
      expect(within(header).queryByRole('tablist')).not.toBeInTheDocument();
      expect(within(header).getByText('layout.channels')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(
        screen
          .getByRole('dialog')
          .querySelector('[data-settings-section="channels"]')
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
      'border-ds-border-neutral-muted-default',
      'p-4'
    );
  });

  it('closes through the custom header control', () => {
    render(
      <MemoryRouter>
        <SettingsDialog />
      </MemoryRouter>
    );

    const closeButton = screen.getByRole('button', { name: /close/i });
    expect(closeButton.closest('header')).toHaveClass(
      'shrink-0',
      'border-0',
      'bg-ds-bg-neutral-default-default'
    );

    fireEvent.click(closeButton);

    expect(useSettingsDialogStore.getState().isOpen).toBe(false);
  });
});
