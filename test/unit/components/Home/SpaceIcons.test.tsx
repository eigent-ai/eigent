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

import { SpaceIconPicker } from '@/components/Home/SpaceIconPicker';
import { SpaceGlyph } from '@/components/SpaceSidebar/SpaceGlyph';
import { SPACE_ICON_IDS, spaceIconId } from '@/lib/spaceIcons';
import { useSpaceStore, type Space } from '@/store/spaceStore';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }));

const space = (metadata?: Space['metadata']): Space => ({
  id: 'space-research',
  name: 'Research',
  sourceType: 'folder',
  rootPath: '/work/research',
  status: 'active',
  schemaVersion: 1,
  createdAt: 0,
  updatedAt: 0,
  metadata,
});

const currentIcon = () =>
  spaceIconId(useSpaceStore.getState().spaces['space-research']);

function Picker() {
  const current = useSpaceStore((state) => state.spaces['space-research']);
  return <SpaceIconPicker space={current} name="Research" />;
}

async function openPicker() {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole('button', { name: 'Change icon for Research' })
  );
  return { user, menu: await screen.findByRole('menu') };
}

describe('Space icons', () => {
  const updateSpaceOnServer = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    updateSpaceOnServer.mockResolvedValue(undefined);
    useSpaceStore.setState({
      spaces: { 'space-research': space({ keep: 'me' }) },
      updateSpaceOnServer,
    });
  });

  it('reads only icons this version knows', () => {
    expect(spaceIconId(space({ icon: 'rocket' }))).toBe('rocket');
    expect(spaceIconId(space({ icon: 'made-up' }))).toBeNull();
    expect(spaceIconId(space())).toBeNull();
  });

  it('draws the chosen icon, or the first letter without one', () => {
    const { container, rerender } = render(
      <SpaceGlyph name="Research" iconId={null} />
    );
    expect(container).toHaveTextContent('R');
    expect(container.querySelector('svg')).toBeNull();

    rerender(<SpaceGlyph name="Research" iconId="rocket" />);
    expect(container).not.toHaveTextContent('R');
    expect(container.querySelector('svg')).toHaveClass('lucide-rocket');
  });

  it('offers every icon and saves the choice with the Space', async () => {
    render(<Picker />);
    const { user, menu } = await openPicker();

    expect(menu.querySelectorAll('[data-space-icon-option]')).toHaveLength(
      SPACE_ICON_IDS.length
    );
    await user.click(
      menu.querySelector('[data-space-icon-option="rocket"]') as HTMLElement
    );

    expect(currentIcon()).toBe('rocket');
    expect(updateSpaceOnServer).toHaveBeenCalledWith('space-research', {
      metadata: { keep: 'me', icon: 'rocket' },
    });
  });

  it('goes back to the first letter', async () => {
    useSpaceStore.setState({
      spaces: { 'space-research': space({ icon: 'rocket' }) },
    });
    render(<Picker />);
    const { user, menu } = await openPicker();

    await user.click(
      within(menu).getByRole('menuitem', { name: 'Use first letter' })
    );

    expect(currentIcon()).toBeNull();
    expect(updateSpaceOnServer).toHaveBeenCalledWith('space-research', {
      metadata: { icon: null },
    });
  });

  it('restores the old icon and says so when saving fails', async () => {
    updateSpaceOnServer.mockRejectedValue(new Error('offline'));
    useSpaceStore.setState({
      spaces: { 'space-research': space({ icon: 'star' }) },
    });
    render(<Picker />);
    const { user, menu } = await openPicker();

    await user.click(
      menu.querySelector('[data-space-icon-option="rocket"]') as HTMLElement
    );
    await vi.waitFor(() => expect(mocks.toastError).toHaveBeenCalled());

    expect(currentIcon()).toBe('star');
  });

  it('keeps a signed-out local Space on this device', async () => {
    useSpaceStore.setState({
      spaces: { 'space-research': space({ legacy: true }) },
    });

    await useSpaceStore.getState().setSpaceIcon('space-research', 'rocket');

    expect(currentIcon()).toBe('rocket');
    expect(updateSpaceOnServer).not.toHaveBeenCalled();
  });
});
