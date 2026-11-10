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
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ deleteSpaceAndSessions: vi.fn() }));
vi.mock('@/lib/spaceDeletion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/spaceDeletion')>()),
  deleteSpaceAndSessions: mocks.deleteSpaceAndSessions,
}));
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
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteSpaceAndSessions.mockResolvedValue(undefined);
    useSpaceStore.setState({
      activeSpaceId: space.id,
      spaces: { [space.id]: space },
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
    expect(mocks.deleteSpaceAndSessions).not.toHaveBeenCalled();
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent(
      'Are you sure you want to delete this space and all its sessions?'
    );
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    expect(mocks.deleteSpaceAndSessions).toHaveBeenCalledWith(
      space.id,
      expect.objectContaining({ identity: expect.any(Object) })
    );
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    );
  });

  it('keeps the dialog open and explains why the server refused the Space', async () => {
    mocks.deleteSpaceAndSessions.mockRejectedValue(
      Object.assign(new Error('Space has 1 project(s)'), {
        status: 409,
        response: { data: { detail: { code: 'space_has_projects' } } },
      })
    );
    render(<SpaceHeaderMenu spaceId={space.id} appearance="sidebar" />);
    const { user, menu } = await openMenu();
    await user.click(
      within(menu).getByRole('menuitem', { name: 'Delete Space' })
    );
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));

    expect(
      await within(confirm).findByText(
        /your account still lists sessions in it/
      )
    ).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Retry' }));
    expect(mocks.deleteSpaceAndSessions).toHaveBeenCalledTimes(2);
  });

  it('explains that a Workspace Bundle source Space has to stay, without offering Retry', async () => {
    const { SpaceHasBundlesError } = await import('@/lib/spaceDeletion');
    mocks.deleteSpaceAndSessions.mockRejectedValue(new SpaceHasBundlesError());
    render(<SpaceHeaderMenu spaceId={space.id} appearance="sidebar" />);
    const { user, menu } = await openMenu();
    await user.click(
      within(menu).getByRole('menuitem', { name: 'Delete Space' })
    );
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));

    expect(
      await within(confirm).findByText(/source of a Workspace Bundle/)
    ).toBeInTheDocument();
    expect(within(confirm).queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(
      within(confirm).getByRole('button', { name: 'Delete' })
    ).toBeDisabled();
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    );
    expect(mocks.deleteSpaceAndSessions).toHaveBeenCalledTimes(1);
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
