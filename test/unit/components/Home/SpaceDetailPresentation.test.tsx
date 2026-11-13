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

import '@/api/http';

import SpaceDetail from '@/components/Home/SpaceDetail';
import { useSpaceStore, type Space } from '@/store/spaceStore';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pinned: [] as string[],
  pinSpaceOrChoose: vi.fn(),
  unpinSpace: vi.fn(),
}));

const research: Space = {
  id: 'space-research',
  name: 'Research',
  description: 'Market notes',
  sourceType: 'folder',
  rootPath: '/work/research',
  status: 'active',
  schemaVersion: 1,
  createdAt: 0,
  updatedAt: 0,
};

vi.mock('@/components/Home/hooks/useSpaceDetailData', () => ({
  useSpaceDetailData: () => ({
    space: research,
    projects: [],
    triggers: [],
    projectsLoading: false,
    triggersLoading: false,
    projectCount: 2,
    taskCount: 1,
    triggerCount: 0,
  }),
}));
vi.mock('@/components/Layout/AppRail/pinnedSpaces', () => ({
  usePinnedSpaceIds: () => mocks.pinned,
  pinSpaceOrChoose: mocks.pinSpaceOrChoose,
}));
vi.mock('@/components/Home/SpaceHeaderMenu', () => ({
  SpaceHeaderMenu: () => <span>Research menu</span>,
}));
vi.mock('@/components/Home/SpaceEmojiPicker', () => ({
  SpaceEmojiPicker: () => <span data-testid="space-icon" />,
}));
vi.mock('@/components/Home/SpaceQuickComposer', () => ({
  SpaceQuickComposer: ({ spaceId }: { spaceId: string }) => (
    <div data-testid="space-quick-composer">{spaceId}</div>
  ),
}));
vi.mock('@/components/Home/SpaceDetailTabsNav', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/components/Home/SpaceDetailTabsNav')
  >()),
  SpaceDetailTabsNav: ({ className }: { className?: string }) => (
    <div role="tablist" aria-label="Space tabs" className={className} />
  ),
}));
vi.mock('@/components/Home/Projects', async () => {
  const { useHomeHubListRowInsetClass } =
    await import('@/components/Home/components/HomeHubListTable');
  return {
    default: function ProjectsInset() {
      return (
        <div data-testid="list-row-inset">{useHomeHubListRowInsetClass()}</div>
      );
    },
  };
});
vi.mock('@/components/Home/Tasks', () => ({ default: () => null }));
vi.mock('@/components/Home/Triggers', () => ({ default: () => null }));

const renderDetail = (presentation: 'home' | 'space-view') =>
  render(
    <MemoryRouter>
      <SpaceDetail
        spaceId={research.id}
        activeTab="projects"
        onTabChange={vi.fn()}
        onBack={vi.fn()}
        presentation={presentation}
      />
    </MemoryRouter>
  );

describe('SpaceDetail presentations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pinned = [];
    useSpaceStore.setState({ unpinSpace: mocks.unpinSpace });
  });

  it('leads Home with the Space, a box to start a Session, and facts stacked beside them', () => {
    renderDetail('home');

    const summary = document.querySelector(
      '[data-space-detail-summary="home"]'
    ) as HTMLElement;
    expect(summary).not.toBeNull();
    expect(within(summary).getByText('Research')).toHaveClass(
      '!text-ds-text-page'
    );
    expect(within(summary).getByText('Market notes')).toBeInTheDocument();
    expect(
      within(summary).getByTestId('space-quick-composer')
    ).toHaveTextContent(research.id);

    const stats = summary.querySelector(
      '[data-space-stats-list]'
    ) as HTMLElement;
    expect(stats).toHaveClass('flex-col');
    expect(stats.querySelectorAll('[data-space-stat]')).toHaveLength(6);

    // The tabs follow the summary and stay pinned while the page scrolls.
    const tabs = document.querySelector('[data-space-tabs-sticky]');
    expect(tabs).toHaveClass('sticky');
    expect(
      summary.compareDocumentPosition(tabs as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      document.querySelector('[data-space-detail-summary="space-view"]')
    ).toBeNull();
  });

  it('pins from a ghost icon button beside Open workspace', async () => {
    const user = userEvent.setup();
    renderDetail('home');

    const pin = screen.getByRole('button', { name: 'Pin Space' });
    expect(pin).toHaveAttribute('data-space-pin-toggle');
    expect(pin).not.toHaveTextContent('Pin Space');
    expect(
      screen.getByRole('button', { name: 'Open workspace' })
    ).toBeInTheDocument();
    await user.click(pin);
    expect(mocks.pinSpaceOrChoose).toHaveBeenCalledWith(research.id);
  });

  it('unpins a pinned Space from the same icon button', async () => {
    const user = userEvent.setup();
    mocks.pinned = [research.id];
    renderDetail('home');

    await user.click(screen.getByRole('button', { name: 'Unpin Space' }));
    expect(mocks.unpinSpace).toHaveBeenCalledWith(research.id);
  });

  it('keeps the compact summary without a composer in the Space view', () => {
    renderDetail('space-view');

    const summary = document.querySelector(
      '[data-space-detail-summary="space-view"]'
    ) as HTMLElement;
    expect(summary).not.toBeNull();
    expect(
      within(summary).getByRole('heading', { name: 'Research' })
    ).toBeInTheDocument();
    expect(summary.querySelectorAll('[data-space-stat]')).toHaveLength(6);
    expect(screen.queryByTestId('space-quick-composer')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pin Space' })).toBeNull();
    expect(
      document.querySelector('[data-space-detail-summary="home"]')
    ).toBeNull();
  });

  it("lines Home's content up with the header: the Space menu's icon on the left, Open workspace on the right", () => {
    renderDetail('home');

    const homeInset = [
      'pl-[calc(var(--ds-ref-space-16)_-_var(--ds-ref-space-8)_+_var(--ds-button-sm-padding-inline))]',
      'pr-[calc(var(--ds-ref-space-16)_-_var(--scrollbar-size))]',
    ];
    const summaryInset = document.querySelector(
      '[data-space-detail-summary-inset]'
    );
    const tabs = document.querySelector('[data-space-tabs-sticky]');
    const content = document.querySelector(
      '[data-space-detail-content-rail]'
    )?.parentElement;
    for (const band of [summaryInset, tabs, content]) {
      expect(band).toHaveClass(...homeInset);
      expect(band).not.toHaveClass('px-8');
    }
    // The first tab's button edge, not its icon, sits on the content edge.
    expect(screen.getByRole('tablist')).not.toHaveClass('-ml-ds-8');
    // List rows put their icons, names and last column on the same edges.
    expect(screen.getByTestId('list-row-inset')).toHaveTextContent('px-ds-8');
  });

  it('keeps the Space view on its own inset', () => {
    renderDetail('space-view');

    expect(document.querySelector('[data-space-tabs-sticky]')).toHaveClass(
      'px-8'
    );
    expect(screen.getByRole('tablist')).not.toHaveClass('-ml-ds-8');
    expect(screen.getByTestId('list-row-inset')).toHaveTextContent('px-3');
  });
});
