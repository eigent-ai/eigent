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

import { SpaceDetailSuspenseContent } from '@/components/Home/SpaceDetail';
import {
  SpaceDetailListSkeleton,
  SpaceDetailTabSkeleton,
} from '@/components/Home/SpaceDetailLoadingSkeleton';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const motionMocks = vi.hoisted(() => ({ reduced: false }));

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return {
    ...actual,
    useReducedMotion: () => motionMocks.reduced,
  };
});

describe('SpaceDetail loading skeletons', () => {
  beforeEach(() => {
    motionMocks.reduced = false;
  });

  it.each(['project', 'task', 'trigger'] as const)(
    'preserves the %s table layout while rows load',
    (kind) => {
      const { container } = render(<SpaceDetailListSkeleton kind={kind} />);
      const loadingLabel = {
        project: 'Loading Sessions list',
        task: 'Loading Tasks list',
        trigger: 'Loading Automations list',
      }[kind];

      expect(
        screen.getByRole('status', { name: loadingLabel })
      ).toBeInTheDocument();
      expect(
        container.querySelectorAll('[data-space-detail-skeleton-row]')
      ).toHaveLength(5);
    }
  );

  it.each([
    ['context', '[data-space-detail-tab-skeleton="context"]'],
    ['memory', '[data-memory-settings-skeleton]'],
    ['workspace-profile', '[data-workspace-settings-skeleton]'],
  ] as const)(
    'shows the %s layout before its content resolves',
    (tab, marker) => {
      const { container } = render(<SpaceDetailTabSkeleton tab={tab} />);
      const loadingLabel = {
        context: 'Loading Context content',
        memory: 'Loading Memory content',
        'workspace-profile': 'Loading Workspace settings content',
      }[tab];

      expect(container.querySelector(marker)).toBeInTheDocument();
      expect(
        screen.getByRole('status', { name: loadingLabel })
      ).toBeInTheDocument();
    }
  );

  it('reveals only content that committed a Suspense fallback', async () => {
    let ready = false;
    let resolveContent: () => void = () => undefined;
    const pendingContent = new Promise<void>((resolve) => {
      resolveContent = resolve;
    });
    const DeferredContent = () => {
      if (!ready) throw pendingContent;
      return <span>Resolved memory content</span>;
    };

    const { rerender } = render(
      <SpaceDetailSuspenseContent activeTab="memory" contextLikeTab={false}>
        <DeferredContent />
      </SpaceDetailSuspenseContent>
    );
    expect(
      screen.getByRole('status', { name: 'Loading Memory content' })
    ).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toHaveAttribute(
      'aria-labelledby',
      'space-detail-tab-memory'
    );

    await act(async () => {
      ready = true;
      resolveContent();
      await pendingContent;
    });

    const resolved = await screen.findByText('Resolved memory content');
    const revealedContent = resolved.closest(
      '[data-space-detail-resolved-content="memory"]'
    );
    expect(revealedContent).toHaveAttribute(
      'data-space-detail-content-reveal',
      'true'
    );
    expect(revealedContent).toHaveAttribute(
      'data-space-detail-reveal-duration',
      '0.2'
    );

    await waitFor(() =>
      expect(revealedContent).toHaveAttribute(
        'data-space-detail-content-reveal',
        'false'
      )
    );

    rerender(
      <SpaceDetailSuspenseContent activeTab="projects" contextLikeTab={false}>
        <span>Resolved project content</span>
      </SpaceDetailSuspenseContent>
    );
    expect(
      screen
        .getByText('Resolved project content')
        .closest('[data-space-detail-resolved-content="projects"]')
    ).toHaveAttribute('data-space-detail-reveal-duration', '0');

    rerender(
      <SpaceDetailSuspenseContent activeTab="memory" contextLikeTab={false}>
        <span>Resolved memory revisit</span>
      </SpaceDetailSuspenseContent>
    );
    expect(
      screen
        .getByText('Resolved memory revisit')
        .closest('[data-space-detail-resolved-content="memory"]')
    ).toHaveAttribute('data-space-detail-reveal-duration', '0');
  });

  it('keeps the fallback reveal opacity-only and shorter for reduced motion', async () => {
    motionMocks.reduced = true;
    let ready = false;
    let resolveContent: () => void = () => undefined;
    const pendingContent = new Promise<void>((resolve) => {
      resolveContent = resolve;
    });
    const DeferredContent = () => {
      if (!ready) throw pendingContent;
      return <span>Resolved reduced-motion content</span>;
    };

    render(
      <SpaceDetailSuspenseContent activeTab="context" contextLikeTab={true}>
        <DeferredContent />
      </SpaceDetailSuspenseContent>
    );
    await act(async () => {
      ready = true;
      resolveContent();
      await pendingContent;
    });

    const content = (
      await screen.findByText('Resolved reduced-motion content')
    ).closest('[data-space-detail-resolved-content="context"]');
    expect(content).toHaveClass('h-full');
    expect(content).toHaveAttribute(
      'data-space-detail-reveal-duration',
      '0.12'
    );
    expect((content as HTMLElement).style.transform).toBe('');
  });
});
