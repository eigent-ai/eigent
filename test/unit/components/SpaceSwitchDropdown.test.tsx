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

describe('SpaceSwitchDropdown', () => {
  it('groups Space switching, creation, and current Space actions', async () => {
    const user = userEvent.setup();
    const onOpenCreateSpace = vi.fn();
    const onOpenSpaceSettings = vi.fn();
    const onOpenMemorySettings = vi.fn();

    render(
      <MemoryRouter>
        <SpaceSwitchDropdown
          trigger={<button type="button">Current Space</button>}
          spaces={[
            {
              id: 'space-1',
              name: 'Design Space',
              sourceType: 'blank',
              status: 'active',
              schemaVersion: 2,
              createdAt: 1,
              updatedAt: 1,
            },
          ]}
          activeSpaceId="space-1"
          switchingSpaceId={null}
          canRenameActiveSpace
          onOpenCreateSpace={onOpenCreateSpace}
          onRenameSpace={vi.fn()}
          onOpenSpaceSettings={onOpenSpaceSettings}
          onOpenMemorySettings={onOpenMemorySettings}
          onSpaceSelect={vi.fn()}
          savePointMenu={{
            loading: false,
            saving: false,
            enabled: true,
            needsAttention: false,
            pendingCount: 1,
            pendingTruncated: false,
            onEnable: vi.fn(),
            onSave: vi.fn(),
            onOpenHistory: vi.fn(),
          }}
        />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: 'Current Space' }));

    const menu = await screen.findByRole('menu');
    const designSpaceItem = within(menu).getByRole('menuitem', {
      name: 'Design Space',
    });
    const createSpaceItem = within(menu).getByRole('menuitem', {
      name: 'Create new Space',
    });
    const currentSpaceLabel = within(menu).getByText('Current Space');
    const versionHistoryItem = within(menu).getByRole('menuitem', {
      name: 'Version history',
    });
    const renameItem = within(menu).getByRole('menuitem', {
      name: 'Rename Space',
    });
    const spaceSettingsItem = within(menu).getByRole('menuitem', {
      name: 'Space settings',
    });
    const memorySettingsItem = within(menu).getByRole('menuitem', {
      name: 'Memory settings',
    });

    expect(within(menu).queryByText('Spaces', { exact: true })).toBeNull();
    expect(
      designSpaceItem.compareDocumentPosition(createSpaceItem) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      createSpaceItem.compareDocumentPosition(currentSpaceLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      currentSpaceLabel.compareDocumentPosition(renameItem) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      renameItem.compareDocumentPosition(spaceSettingsItem) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      spaceSettingsItem.compareDocumentPosition(memorySettingsItem) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(currentSpaceLabel).toHaveClass('text-ds-text-meta', 'font-medium');
    const settingsSeparator = menu.querySelector(
      '[data-space-settings-separator]'
    ) as HTMLElement;
    expect(settingsSeparator).toBeInTheDocument();
    expect(settingsSeparator).toHaveClass('mx-2');
    expect(
      versionHistoryItem.compareDocumentPosition(settingsSeparator) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      settingsSeparator.compareDocumentPosition(renameItem) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(designSpaceItem.lastElementChild).toHaveClass(
      'text-ds-accent-default-default'
    );
    expect(
      within(menu).queryByRole('menuitem', { name: 'Start from scratch' })
    ).not.toBeInTheDocument();

    await user.click(createSpaceItem);
    expect(onOpenCreateSpace).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'Current Space' }));
    await user.click(
      within(await screen.findByRole('menu')).getByRole('menuitem', {
        name: 'Space settings',
      })
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
});
