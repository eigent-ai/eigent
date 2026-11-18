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

import HomePageRoute from '@/pages/Home';
import { useSpaceStore, type Space } from '@/store/spaceStore';
import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/Home', () => ({
  default: ({ children }: { children?: ReactNode }) => <>{children}</>,
  HomeGreeting: () => null,
  HomeHeader: () => <div>All Spaces</div>,
  HomeSections: () => null,
}));
vi.mock('@/components/Home/HomeSidebar', () => ({ default: () => null }));
vi.mock('@/components/Home/HomeSidebarHost', () => ({
  HomeSidebarSlot: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/Home/SpaceDetail', () => ({
  default: ({ spaceId }: { spaceId: string }) => <div>Detail {spaceId}</div>,
  isSpaceDetailTab: () => false,
}));
vi.mock('@/components/Layout/AppShellLayout', () => ({
  default: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/Layout/ContentHeader', () => ({
  ContentHeaderFrame: ({ children }: { children?: ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock('@/components/Layout/ShellPaneTransition', () => ({
  AnimatedContentPane: ({ children }: { children?: ReactNode }) => (
    <>{children}</>
  ),
  useShellPaneMotion: () => ({}),
}));
vi.mock('@/routers/LegacyRouteCompatibility', () => ({
  LegacyRouteWorkflowDialog: () => null,
}));
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

const research: Space = {
  id: 'space-research',
  name: 'Research',
  sourceType: 'folder',
  rootPath: '/work/research',
  status: 'active',
  schemaVersion: 1,
  createdAt: 0,
  updatedAt: 0,
};

function Location() {
  const { search } = useLocation();
  return <span data-testid="search">{search}</span>;
}

function renderHome() {
  render(
    <MemoryRouter
      initialEntries={['/home?section=spaces&spaceId=space-research']}
    >
      <HomePageRoute />
      <Location />
    </MemoryRouter>
  );
}

describe('Home with a Space that goes away', () => {
  beforeEach(() => {
    useSpaceStore.setState({
      spaces: { [research.id]: research },
      projectsBySpaceId: { [research.id]: {} },
    });
  });

  it('goes back to all Spaces when the Space on screen is deleted', () => {
    renderHome();
    expect(screen.getByText('Detail space-research')).toBeInTheDocument();

    act(() => useSpaceStore.setState({ spaces: {}, projectsBySpaceId: {} }));

    expect(screen.getByTestId('search')).toHaveTextContent(
      /^\?section=spaces$/
    );
    expect(screen.getByText('All Spaces')).toBeInTheDocument();
  });

  it('keeps a link to a Space that has not arrived on its own page', () => {
    useSpaceStore.setState({ spaces: {}, projectsBySpaceId: {} });
    renderHome();

    expect(screen.getByTestId('search')).toHaveTextContent(
      'spaceId=space-research'
    );
    expect(screen.getByText('Detail space-research')).toBeInTheDocument();
  });
});
