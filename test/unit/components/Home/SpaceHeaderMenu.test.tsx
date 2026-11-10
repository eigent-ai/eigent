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

import { SpaceHeaderMenu } from '@/components/Home/SpaceHeaderMenu';
import { useSpaceStore, type Space } from '@/store/spaceStore';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useWorkspaceSavePoint', () => ({
  useWorkspaceSavePoint: () => ({
    supported: false,
    enableConfirmOpen: false,
    setEnableConfirmOpen: vi.fn(),
  }),
}));
vi.mock('@/hooks/useSpaceSwitch', () => ({
  useOpenSpaceHomeTab: () => vi.fn(),
}));
vi.mock('@/components/Workspace/WorkspaceVersionHistoryDialog', () => ({
  WorkspaceVersionHistoryDialog: () => null,
}));
vi.mock('@/components/Home/hooks/useNewSpaceCreation', () => ({
  useNewSpaceCreation: () => ({
    createBlankSpace: vi.fn(),
    createSpaceFromFolder: vi.fn(),
  }),
}));
vi.mock('@/components/Home/NewSpaceDialog', () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="new-space-dialog" /> : null,
}));

const space: Space = {
  id: 'space-research',
  name: 'Research',
  sourceType: 'folder',
  rootPath: '/work/research',
  status: 'active',
  schemaVersion: 1,
  createdAt: 0,
  updatedAt: 0,
};

async function openMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Research' }));
  const menu = await screen.findByRole('menu');
  return {
    user,
    menu,
    items: within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent?.trim()),
  };
}

describe('SpaceHeaderMenu', () => {
  const deleteSpaceOnServer = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    useSpaceStore.setState({
      activeSpaceId: space.id,
      spaces: { [space.id]: space },
      deleteSpaceOnServer,
    });
  });

  it('lists Rename, Pin and Delete in the sidebar, and deletes after confirming', async () => {
    render(<SpaceHeaderMenu spaceId={space.id} appearance="sidebar" />);
    const { user, menu, items } = await openMenu();

    expect(items).toEqual([
      'Rename Space',
      'Pin Space',
      'Create new Space',
      'Delete Space',
    ]);

    await user.click(
      within(menu).getByRole('menuitem', { name: 'Delete Space' })
    );
    expect(deleteSpaceOnServer).not.toHaveBeenCalled();
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    expect(deleteSpaceOnServer).toHaveBeenCalledWith(space.id);
  });

  it('starts a new Space from the sidebar menu', async () => {
    render(<SpaceHeaderMenu spaceId={space.id} appearance="sidebar" />);
    const { user, menu } = await openMenu();

    expect(screen.queryByTestId('new-space-dialog')).toBeNull();
    await user.click(
      within(menu).getByRole('menuitem', { name: 'Create new Space' })
    );
    expect(await screen.findByTestId('new-space-dialog')).toBeInTheDocument();
  });

  it('keeps Space and Memory settings, without Delete, on the Workspace page', async () => {
    render(<SpaceHeaderMenu spaceId={space.id} />);
    const { items } = await openMenu();

    expect(items).toEqual([
      'Rename Space',
      'Pin Space',
      'Space settings',
      'Memory settings',
    ]);
  });
});
