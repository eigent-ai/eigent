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

import { SpaceSettings } from '@/components/WorkspaceConfiguration/SpaceSettings';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  activeSpaceId: 'space-1' as string | null,
}));

vi.mock('@/store/spaceStore', () => ({
  useSpaceStore: (selector: (state: object) => unknown) =>
    selector({
      activeSpaceId: mocks.activeSpaceId,
      spaces: mocks.activeSpaceId
        ? {
            [mocks.activeSpaceId]: {
              id: mocks.activeSpaceId,
              name: 'Research Space',
            },
          }
        : {},
    }),
}));

vi.mock('@/pages/WorkspaceConfiguration', () => ({
  WorkspaceConfigurationEditor: ({
    presentation,
    spaceId,
  }: {
    presentation?: string;
    spaceId?: string | null;
  }) => (
    <div
      data-testid="workspace-configuration-editor"
      data-presentation={presentation}
      data-space-id={spaceId}
    />
  ),
}));

function renderSpaceSettings(onBack?: () => void) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <SpaceSettings onBack={onBack} />
    </MemoryRouter>
  );
}

describe('SpaceSettings', () => {
  beforeEach(() => {
    mocks.activeSpaceId = 'space-1';
  });

  it('uses the shared header shell with only the Space Settings title', async () => {
    renderSpaceSettings();

    const header = screen.getByText('Space Settings').closest('header');
    expect(header).not.toBeNull();
    expect(header).toHaveClass('h-[44px]', 'min-h-[44px]');
    expect(within(header!).getByText('Space Settings')).toBeInTheDocument();
    expect(
      within(header!).queryByText('Research Space')
    ).not.toBeInTheDocument();
    expect(within(header!).queryByRole('tab')).not.toBeInTheDocument();
    expect(
      await screen.findByTestId('workspace-configuration-editor')
    ).toHaveAttribute('data-presentation', 'settings');
    expect(
      screen.getByTestId('workspace-configuration-editor')
    ).toHaveAttribute('data-space-id', 'space-1');
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('keeps the page header when no Space is active', () => {
    mocks.activeSpaceId = null;
    renderSpaceSettings();

    expect(screen.getByText('Space Settings')).toBeInTheDocument();
    expect(
      screen.getByText('Select a Space before managing its profile.')
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('workspace-configuration-editor')
    ).not.toBeInTheDocument();
  });

  it('adds a back control only when rendered as a Workspace subpage', () => {
    const onBack = vi.fn();
    renderSpaceSettings(onBack);

    screen.getByRole('button', { name: 'Back to workspace' }).click();

    expect(onBack).toHaveBeenCalledOnce();
  });
});
