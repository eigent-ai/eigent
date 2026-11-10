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
  const chip = screen.getByRole('combobox', { name: 'Space for this session' });
  chip.focus();
  await user.keyboard('[ArrowDown]');
  return { user, listbox: await screen.findByRole('listbox') };
}

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

  it('starts on the Space worked in last', () => {
    render(<NewSessionSpaceChip />);
    expect(
      screen.getByRole('combobox', { name: 'Space for this session' })
    ).toHaveTextContent('in Research');
  });

  it('lists every Space and New Space, and switches Space on choice', async () => {
    render(<NewSessionSpaceChip />);
    const { user, listbox } = await openChip();

    expect(
      within(listbox)
        .getAllByRole('option')
        .map((option) => option.textContent)
    ).toEqual(['Research', 'Ops', 'New Space']);

    await user.click(within(listbox).getByRole('option', { name: 'Ops' }));
    expect(mocks.switchToSpace).toHaveBeenCalledWith('space-ops', {
      project: null,
      tab: 'new-project',
    });
  });

  it('opens New Space without switching', async () => {
    render(<NewSessionSpaceChip />);
    const { user, listbox } = await openChip();

    await user.click(
      within(listbox).getByRole('option', { name: 'New Space' })
    );
    expect(
      screen.getByRole('dialog', { name: 'Create a new Space' })
    ).toBeInTheDocument();
    expect(mocks.switchToSpace).not.toHaveBeenCalled();
  });
});
