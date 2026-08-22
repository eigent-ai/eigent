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

import { ReviewTab } from '@/components/Session/PreviewPanel/tabs/ReviewTab';
import type { ReviewChangesState } from '@/components/Session/PreviewPanel/tabs/review/useReviewChanges';
import type {
  SessionReviewTab,
  SessionReviewTarget,
} from '@/store/pageTabStore';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseReviewChanges =
  vi.fn<(target: SessionReviewTarget) => ReviewChangesState>();

const reviewTab: SessionReviewTab = {
  id: 'review-1',
  type: 'review',
  title: 'Review',
  reviewTarget: { scope: 'project', focusRequestId: 0 },
};

vi.mock(
  '@/components/Session/PreviewPanel/tabs/review/useReviewChanges',
  () => ({
    useReviewChanges: (target: SessionReviewTarget) =>
      mockUseReviewChanges(target),
  })
);

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (state: { appearance: string }) => unknown) =>
    selector({ appearance: 'light' }),
}));

vi.mock('@/components/Session/PreviewPanel/tabs/review/DiffFileCard', () => ({
  DiffFileCard: ({
    file,
    selected,
    foldAll,
    foldNonce,
    maxEditorHeight,
  }: {
    file: { id: string };
    selected?: boolean;
    foldAll?: boolean;
    foldNonce?: number;
    maxEditorHeight?: number;
  }) => (
    <div
      data-testid={`diff:${file.id}`}
      data-review-id={file.id}
      data-selected={String(selected)}
      data-fold-all={String(foldAll)}
      data-fold-nonce={String(foldNonce)}
      data-max-editor-height={maxEditorHeight}
    />
  ),
}));

vi.mock('@/components/Session/PreviewPanel/tabs/review/ReviewFileTree', () => ({
  ReviewFileTree: () => <div data-testid="review-tree" />,
}));

describe('ReviewTab', () => {
  beforeEach(() => {
    mockUseReviewChanges.mockReset();
  });

  it('shows the desktop requirement instead of an empty review on web', () => {
    mockUseReviewChanges.mockReturnValue({
      loading: false,
      files: [],
      desktopOnly: true,
      error: null,
      totals: { added: 0, removed: 0 },
      refresh: vi.fn(),
    });

    render(<ReviewTab tab={reviewTab} />);

    expect(
      screen.getByText('Change review is available in the desktop app.')
    ).toBeInTheDocument();
    expect(
      screen.queryByText('No file changes in this session yet.')
    ).not.toBeInTheDocument();
  });

  it('reports a failed scan instead of claiming there are no changes', () => {
    mockUseReviewChanges.mockReturnValue({
      loading: false,
      files: [],
      desktopOnly: false,
      error: 'overlay service down',
      totals: { added: 0, removed: 0 },
      refresh: vi.fn(),
    });

    render(<ReviewTab tab={reviewTab} />);

    expect(
      screen.getByText('Could not load the changes for this session.')
    ).toBeInTheDocument();
    expect(screen.getByText('overlay service down')).toBeInTheDocument();
    expect(
      screen.queryByText('No file changes in this session yet.')
    ).not.toBeInTheDocument();
  });

  it('renders review files by their stable identity', () => {
    mockUseReviewChanges.mockReturnValue({
      loading: false,
      desktopOnly: false,
      error: null,
      totals: { added: 0, removed: 0 },
      refresh: vi.fn(),
      files: [
        {
          id: 'file:/outside/src/example.ts',
          path: '/outside/src/example.ts',
          status: 'added',
          absPath: '/outside/src/example.ts',
          bakPath: null,
        },
      ],
    });

    render(<ReviewTab tab={reviewTab} />);

    expect(
      screen.getByTestId('diff:file:/outside/src/example.ts')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('diff:file:/outside/src/example.ts')
    ).toHaveAttribute('data-max-editor-height', '120');
    expect(screen.queryByTestId('review-tree')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Show file tree' })
    ).toBeInTheDocument();
  });

  it('shows the session-wide added and removed line totals', () => {
    mockUseReviewChanges.mockReturnValue({
      loading: false,
      desktopOnly: false,
      error: null,
      totals: { added: 42, removed: 7 },
      refresh: vi.fn(),
      files: [
        {
          id: 'file:/outside/src/example.ts',
          path: '/outside/src/example.ts',
          status: 'modified',
          absPath: '/outside/src/example.ts',
          bakPath: '/outside/src/example.ts.20260722_120000.bak',
        },
      ],
    });

    render(<ReviewTab tab={reviewTab} />);

    expect(screen.getByText('+42')).toBeInTheDocument();
    expect(screen.getByText('−7')).toBeInTheDocument();
  });

  it('omits the totals until they have been computed', () => {
    mockUseReviewChanges.mockReturnValue({
      loading: false,
      desktopOnly: false,
      error: null,
      totals: null,
      refresh: vi.fn(),
      files: [
        {
          id: 'file:/outside/src/example.ts',
          path: '/outside/src/example.ts',
          status: 'modified',
          absPath: '/outside/src/example.ts',
          bakPath: '/outside/src/example.ts.20260722_120000.bak',
        },
      ],
    });

    render(<ReviewTab tab={reviewTab} />);

    expect(screen.queryByText(/^\+\d/)).not.toBeInTheDocument();
  });

  it('drives collapse and expand all from the toolbar', () => {
    mockUseReviewChanges.mockReturnValue({
      loading: false,
      desktopOnly: false,
      error: null,
      totals: { added: 0, removed: 0 },
      refresh: vi.fn(),
      files: [
        {
          id: 'file:/outside/src/example.ts',
          path: '/outside/src/example.ts',
          status: 'modified',
          absPath: '/outside/src/example.ts',
          bakPath: '/outside/src/example.ts.20260722_120000.bak',
        },
      ],
    });

    render(<ReviewTab tab={reviewTab} />);
    const card = () => screen.getByTestId('diff:file:/outside/src/example.ts');

    // Nonce starts at zero so cards keep their own state until asked.
    expect(card()).toHaveAttribute('data-fold-all', 'false');
    expect(card()).toHaveAttribute('data-fold-nonce', '0');

    fireEvent.click(screen.getByRole('button', { name: 'Collapse all files' }));
    expect(card()).toHaveAttribute('data-fold-all', 'true');
    expect(card()).toHaveAttribute('data-fold-nonce', '1');

    fireEvent.click(screen.getByRole('button', { name: 'Expand all files' }));
    expect(card()).toHaveAttribute('data-fold-all', 'false');
    expect(card()).toHaveAttribute('data-fold-nonce', '2');
  });

  it('toggles the file tree so the diffs can use the full width', () => {
    mockUseReviewChanges.mockReturnValue({
      loading: false,
      desktopOnly: false,
      error: null,
      totals: { added: 0, removed: 0 },
      refresh: vi.fn(),
      files: [
        {
          id: 'file:/outside/src/example.ts',
          path: '/outside/src/example.ts',
          status: 'added',
          absPath: '/outside/src/example.ts',
          bakPath: null,
        },
        {
          id: 'file:/outside/src/second.ts',
          path: '/outside/src/second.ts',
          status: 'modified',
          absPath: '/outside/src/second.ts',
          bakPath: '/outside/src/second.ts.20260722_120000.bak',
        },
      ],
    });

    render(<ReviewTab tab={reviewTab} />);

    const hide = screen.getByRole('button', {
      name: 'Hide file tree',
    });
    expect(hide).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(hide);
    expect(screen.queryByTestId('review-tree')).not.toBeInTheDocument();

    const show = screen.getByRole('button', {
      name: 'Show file tree',
    });
    expect(show).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(show);
    expect(screen.getByTestId('review-tree')).toBeInTheDocument();
  });

  it('loads a Run-scoped review and focuses its requested path', () => {
    mockUseReviewChanges.mockReturnValue({
      loading: false,
      desktopOnly: false,
      error: null,
      totals: { added: 1, removed: 0 },
      refresh: vi.fn(),
      files: [
        {
          id: 'run-git:run-1:src/example.ts',
          path: 'src/example.ts',
          status: 'modified',
          absPath: '',
          bakPath: null,
        },
      ],
    });
    const runTarget: SessionReviewTarget = {
      scope: 'run',
      runId: 'run-1',
      focusPath: './src/example.ts',
      focusRequestId: 1,
    };

    render(
      <ReviewTab
        tab={{
          ...reviewTab,
          title: 'Run review',
          reviewTarget: runTarget,
        }}
      />
    );

    expect(mockUseReviewChanges).toHaveBeenCalledWith(runTarget);
    expect(
      screen.getByTestId('diff:run-git:run-1:src/example.ts')
    ).toHaveAttribute('data-selected', 'true');
  });
});
