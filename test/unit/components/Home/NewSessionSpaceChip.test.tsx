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

import { FooterCompactContext } from '@/components/ChatBox/BottomBox/footerCompact';
import { NewSessionSpaceChip } from '@/components/Home/NewSessionSpaceChip';
import { useSpaceStore, type Space } from '@/store/spaceStore';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ switchToSpace: vi.fn() }));

vi.mock('@/hooks/useSpaceSwitch', () => ({
  useSpaceSwitch: () => ({
    switchToSpace: mocks.switchToSpace,
    switchingSpaceId: null,
  }),
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

async function openChip() {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole('button', { name: /^Space for this session/ })
  );
  return { user, menu: await screen.findByRole('menu') };
}

const spaceRows = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent?.trim());

describe('NewSessionSpaceChip', () => {
  beforeAll(() => {
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useSpaceStore.setState({
      activeSpaceId: 'space-research',
      spaces: {
        'space-research': space('space-research', 'Research', 2),
        'space-ops': space('space-ops', 'Ops', 1),
      },
      projectsBySpaceId: { 'space-research': {}, 'space-ops': {} },
    });
  });

  it('starts on the Space worked in last, styled like the footer menus', () => {
    render(<NewSessionSpaceChip />);
    const chip = screen.getByRole('button', {
      name: 'Space for this session, Research',
    });
    expect(chip).toHaveTextContent('Research');
    expect(chip).toHaveClass('rounded-xl', 'bg-ds-neutral-subtle-default');
  });

  it('collapses to a named folder icon button in a narrow footer', () => {
    render(
      <FooterCompactContext.Provider value>
        <NewSessionSpaceChip />
      </FooterCompactContext.Provider>
    );
    const chip = screen.getByRole('button', {
      name: 'Space for this session, Research',
    });
    expect(chip).toHaveTextContent('');
    expect(chip).toHaveAttribute('title', 'Research');
    expect(chip.querySelectorAll('svg')).toHaveLength(1);
  });

  it('lists every Space under a search field, then New Space, and switches on choice', async () => {
    render(<NewSessionSpaceChip />);
    const { user, menu } = await openChip();

    expect(
      within(menu).getByRole('textbox', { name: 'Search spaces...' })
    ).toBeInTheDocument();
    expect(menu.querySelector('[data-new-session-space-list]')).toHaveClass(
      'max-h-60',
      'overflow-y-auto'
    );
    expect(spaceRows(menu)).toEqual(['Research', 'Ops', 'Create new Space']);

    await user.click(within(menu).getByRole('menuitem', { name: 'Ops' }));
    expect(mocks.switchToSpace).toHaveBeenCalledWith('space-ops', {
      project: null,
      tab: 'new-project',
    });
  });

  it('moves from the search field into the list with ArrowDown and switches with Enter', async () => {
    render(<NewSessionSpaceChip />);
    const { user, menu } = await openChip();
    const search = within(menu).getByRole('textbox', {
      name: 'Search spaces...',
    });

    await user.type(search, 'op');
    expect(search).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(within(menu).getByRole('menuitem', { name: 'Ops' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(mocks.switchToSpace).toHaveBeenCalledWith('space-ops', {
      project: null,
      tab: 'new-project',
    });
  });

  it('filters the list by name', async () => {
    render(<NewSessionSpaceChip />);
    const { user, menu } = await openChip();

    await user.type(
      within(menu).getByRole('textbox', { name: 'Search spaces...' }),
      'op'
    );
    expect(spaceRows(menu)).toEqual(['Ops', 'Create new Space']);

    await user.type(
      within(menu).getByRole('textbox', { name: 'Search spaces...' }),
      'zzz'
    );
    expect(
      within(menu).getByText('No results match your search.')
    ).toBeVisible();
  });

  it('opens New Space without switching', async () => {
    render(<NewSessionSpaceChip />);
    const { user, menu } = await openChip();

    await user.click(
      within(menu).getByRole('menuitem', { name: 'Create new Space' })
    );
    expect(
      screen.getByRole('dialog', { name: 'Create a new Space' })
    ).toBeInTheDocument();
    expect(mocks.switchToSpace).not.toHaveBeenCalled();
  });
});
