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

import { SpaceSwitchDropdown } from '@/components/SpaceSidebar/SpaceSwitchDropdown';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const savePointMenu = {
  loading: false,
  saving: false,
  enabled: true,
  needsAttention: false,
  pendingCount: 1,
  pendingTruncated: false,
  onEnable: vi.fn(),
  onSave: vi.fn(),
  onOpenHistory: vi.fn(),
};

function renderMenu(pinned: boolean) {
  const onToggle = vi.fn();
  const onOpenSpaceSettings = vi.fn();
  const onOpenMemorySettings = vi.fn();
  render(
    <MemoryRouter>
      <SpaceSwitchDropdown
        trigger={<button type="button">Current Space</button>}
        activeSpaceId="space-1"
        canRenameActiveSpace
        onRenameSpace={vi.fn()}
        onOpenSpaceSettings={onOpenSpaceSettings}
        onOpenMemorySettings={onOpenMemorySettings}
        pinMenu={{ pinned, onToggle }}
        savePointMenu={savePointMenu}
      />
    </MemoryRouter>
  );
  return { onToggle, onOpenSpaceSettings, onOpenMemorySettings };
}

describe('SpaceSwitchDropdown', () => {
  it('lists the Space actions in order, without other Spaces', async () => {
    const user = userEvent.setup();
    const { onOpenSpaceSettings, onOpenMemorySettings } = renderMenu(false);

    await user.click(screen.getByRole('button', { name: 'Current Space' }));
    const menu = await screen.findByRole('menu');

    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent?.trim())
    ).toEqual([
      'Rename Space',
      'Pin Space',
      'Space settings',
      'Memory settings',
      expect.stringMatching(/^Save changes/),
      'Version history',
    ]);
    expect(within(menu).queryByRole('textbox')).toBeNull();
    expect(
      within(menu).queryByRole('menuitem', { name: 'Create new Space' })
    ).toBeNull();
    expect(menu.querySelector('[data-space-settings-separator]')).toHaveClass(
      'mx-2'
    );

    await user.click(
      within(menu).getByRole('menuitem', { name: 'Space settings' })
    );
    expect(onOpenSpaceSettings).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'Current Space' }));
    await user.click(
      within(await screen.findByRole('menu')).getByRole('menuitem', {
        name: 'Memory settings',
      })
    );
    expect(onOpenMemorySettings).toHaveBeenCalledOnce();
  });

  it.each([
    [false, 'Pin Space'],
    [true, 'Unpin Space'],
  ])('offers %s pin state as "%s"', async (pinned, label) => {
    const user = userEvent.setup();
    const { onToggle } = renderMenu(pinned);

    await user.click(screen.getByRole('button', { name: 'Current Space' }));
    await user.click(
      within(await screen.findByRole('menu')).getByRole('menuitem', {
        name: label,
      })
    );

    expect(onToggle).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
