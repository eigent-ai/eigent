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

import AppearanceSettings from '@/components/Settings/Appearance';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/store/authStore', () => {
  const state = {
    appearanceMode: 'light',
    appearance: 'light',
    setAppearanceMode: vi.fn(),
    lightColorThemeId: 'eigent',
    darkColorThemeId: 'eigent',
    setColorThemeForMode: vi.fn(),
    customThemeCatalog: { light: {}, dark: {} },
    upsertCustomThemeTemplate: vi.fn(),
    removeCustomThemeTemplate: vi.fn(),
    themeContrast: 50,
    setThemeContrast: vi.fn(),
    workspaceMainBackground: 'empty',
    setWorkspaceMainBackground: vi.fn(),
  };

  return {
    useAuthStore: (selector: (value: typeof state) => unknown) =>
      selector(state),
  };
});

describe('Appearance settings layout', () => {
  it('groups its three settings into divided title-description rows', () => {
    const { container } = render(<AppearanceSettings />);
    const group = container.querySelector('[data-settings-row-group]');

    expect(group).not.toBeNull();

    const rows = group?.querySelectorAll('[data-settings-row]') ?? [];
    const dividers =
      group?.querySelectorAll('[data-settings-row-divider]') ?? [];
    expect(rows).toHaveLength(3);
    expect(dividers).toHaveLength(2);
    expect(dividers[0]).toHaveClass(
      'mx-4',
      'border-x-0',
      'border-t',
      'border-b-0',
      'border-solid',
      'border-ds-hairline-subtle-default'
    );

    const colorMode = screen.getByText('Color mode');
    const theme = screen.getByText('Theme');
    const workspaceBackground = screen.getByText('Workspace background');

    expect(
      within(rows[0] as HTMLElement).getByText(
        'Choose how Eigent looks on this device.'
      )
    ).toBeInTheDocument();
    expect(
      within(rows[1] as HTMLElement).getByText('Choose the app color theme.')
    ).toBeInTheDocument();
    expect(
      within(rows[2] as HTMLElement).getByText(
        /Pattern for the Workforce and Session main panels only/
      )
    ).toBeInTheDocument();
    expect(rows[0]).toContainElement(colorMode);
    expect(rows[1]).toContainElement(theme);
    expect(rows[2]).toContainElement(workspaceBackground);

    expect(rows[0].querySelector('[data-settings-row-action]')).toHaveClass(
      'w-[280px]'
    );
    expect(rows[1].querySelector('[data-settings-row-action]')).not.toHaveClass(
      'w-[280px]'
    );
    expect(rows[1].querySelector('[data-theme-select]')).toHaveClass(
      'justify-end'
    );
    expect(rows[1].querySelector('[data-theme-reset-row]')).toHaveClass(
      'justify-end'
    );
    expect(rows[2].querySelector('[data-settings-row-action]')).toHaveClass(
      'w-[280px]'
    );
  });
});
