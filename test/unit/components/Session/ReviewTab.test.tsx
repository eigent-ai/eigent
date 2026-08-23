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
import { usePageTabStore } from '@/store/pageTabStore';
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

vi.mock(
  '@/components/Session/PreviewPanel/tabs/review/DiffFileCard',
  async () => {
    const { forwardRef } = await import('react');
    const MockDiffFileCard = forwardRef(
      (
        {
          file,
          viewMode,
          wordWrap,
          reviewed,
          comments,
          onCommentRequest,
        }: {
          file: { id: string };
          viewMode: string;
          wordWrap: boolean;
          reviewed: boolean;
          comments?: unknown[];
          onCommentRequest?: (selection: {
            side: 'modified';
            startLine: number;
            endLine: number;
            text: string;
          }) => void;
        },
        _ref
      ) => (
        <div>
          <div
            data-testid={`diff:${file.id}`}
            data-review-id={file.id}
            data-view-mode={viewMode}
            data-word-wrap={String(wordWrap)}
            data-reviewed={String(reviewed)}
            data-comment-count={String(comments?.length ?? 0)}
          />
          <button
            type="button"
            aria-label="Comment on mock lines"
            onClick={() =>
              onCommentRequest?.({
                side: 'modified',
                startLine: 4,
                endLine: 6,
                text: 'const answer = 42;',
              })
            }
          />
        </div>
      )
    );
    MockDiffFileCard.displayName = 'MockDiffFileCard';
    return { DiffFileCard: MockDiffFileCard };
  }
);

vi.mock('@/components/Session/PreviewPanel/tabs/review/ReviewFileTree', () => ({
  ReviewFileTree: () => <div data-testid="review-tree" />,
}));

describe('ReviewTab', () => {
  beforeEach(() => {
    mockUseReviewChanges.mockReset();
    usePageTabStore.setState({
      sessionPreviewProjectId: 'project-1',
      sessionPreviewByProject: {
        'project-1': {
          open: true,
          tabs: [reviewTab],
          activeTabId: reviewTab.id,
        },
      },
      workspaceChatDraftRequest: null,
      workspaceChatDraftRequestSequence: 0,
      workspaceReviewHandoffs: [],
    });
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
      screen.queryByText('No file changes in this project yet.')
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
      screen.getByText('Could not load the changes for this project.')
    ).toBeInTheDocument();
    expect(screen.getByText('overlay service down')).toBeInTheDocument();
    expect(
      screen.queryByText('No file changes in this project yet.')
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
    ).toHaveAttribute('data-view-mode', 'inline');
    expect(screen.queryByTestId('review-tree')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Show file tree' })
    ).toBeInTheDocument();
  });

  it('shows the project-wide added and removed line totals', () => {
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

  it('mounts one active diff and navigates files from the toolbar', () => {
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
        {
          id: 'file:/outside/src/second.ts',
          path: '/outside/src/second.ts',
          status: 'added',
          absPath: '/outside/src/second.ts',
          bakPath: null,
        },
      ],
    });

    render(<ReviewTab tab={reviewTab} />);

    expect(
      screen.getByTestId('diff:file:/outside/src/example.ts')
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('diff:file:/outside/src/second.ts')
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next file' }));
    expect(
      screen.queryByTestId('diff:file:/outside/src/example.ts')
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId('diff:file:/outside/src/second.ts')
    ).toBeInTheDocument();
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
    ).toBeInTheDocument();
  });

  it('marks the current file reviewed and advances to the next file', () => {
    mockUseReviewChanges.mockReturnValue({
      loading: false,
      desktopOnly: false,
      error: null,
      totals: { added: 0, removed: 0 },
      refresh: vi.fn(),
      files: [
        {
          id: 'first',
          path: 'first.ts',
          status: 'modified',
          absPath: '/first.ts',
          bakPath: '/first.ts.bak',
        },
        {
          id: 'second',
          path: 'second.ts',
          status: 'added',
          absPath: '/second.ts',
          bakPath: null,
        },
      ],
    });

    render(<ReviewTab tab={reviewTab} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark as reviewed' }));

    expect(screen.getByTestId('diff:second')).toBeInTheDocument();
    expect(screen.getByText('1 of 2 reviewed')).toBeInTheDocument();
  });

  it('collects a visible file review comment and exposes handoff actions', () => {
    mockUseReviewChanges.mockReturnValue({
      loading: false,
      desktopOnly: false,
      error: null,
      totals: { added: 0, removed: 0 },
      refresh: vi.fn(),
      files: [
        {
          id: 'first',
          path: 'src/first.ts',
          status: 'modified',
          absPath: '/first.ts',
          bakPath: '/first.ts.bak',
        },
      ],
    });

    render(<ReviewTab tab={reviewTab} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Add a file review note' })
    );
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Describe what should change…' }),
      { target: { value: 'Keep this API backward compatible.' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));

    expect(
      screen.getByRole('button', { name: 'Copy review comments' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('Keep this API backward compatible.')
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Add 1 comments to chat' })
    ).toBeInTheDocument();
  });

  it('shows an acknowledged review comment as sent instead of pending', () => {
    mockUseReviewChanges.mockReturnValue({
      loading: false,
      desktopOnly: false,
      error: null,
      totals: { added: 0, removed: 0 },
      refresh: vi.fn(),
      files: [
        {
          id: 'first',
          path: 'src/first.ts',
          status: 'modified',
          absPath: '/first.ts',
          bakPath: '/first.ts.bak',
        },
      ],
    });

    render(
      <ReviewTab
        tab={{
          ...reviewTab,
          reviewComments: [
            {
              id: 'comment-1',
              fileId: 'first',
              path: 'src/first.ts',
              selection: null,
              body: 'Keep this API backward compatible.',
              createdAt: 1,
              status: 'sent',
              sentAt: 2,
            },
          ],
        }}
      />
    );

    expect(screen.getByText('All sent')).toBeVisible();
    expect(screen.getByText('Sent')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Add 1 comments to chat' })
    ).not.toBeInTheDocument();
  });

  it('anchors a multi-line comment and hands it to the matching Chat draft', () => {
    mockUseReviewChanges.mockReturnValue({
      loading: false,
      desktopOnly: false,
      error: null,
      totals: { added: 0, removed: 0 },
      refresh: vi.fn(),
      files: [
        {
          id: 'first',
          path: 'src/first.ts',
          status: 'modified',
          absPath: '/first.ts',
          bakPath: '/first.ts.bak',
        },
      ],
    });

    render(<ReviewTab tab={reviewTab} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Comment on mock lines' })
    );
    expect(screen.getByText('src/first.ts:4-6 (modified)')).toBeVisible();
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Describe what should change…' }),
      { target: { value: 'Avoid a magic number here.' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));

    expect(screen.getByText('Avoid a magic number here.')).toBeVisible();
    expect(screen.getByTestId('diff:first')).toHaveAttribute(
      'data-comment-count',
      '1'
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Add 1 comments to chat' })
    );
    const request = usePageTabStore.getState().workspaceChatDraftRequest;
    expect(request?.projectId).toBe('project-1');
    expect(request?.content).toContain('src/first.ts:4-6 (modified)');
    expect(request?.content).toContain('Avoid a magic number here.');
    expect(request?.content).toContain('const answer = 42;');
    expect(usePageTabStore.getState().workspaceReviewHandoffs).toEqual([
      expect.objectContaining({
        projectId: 'project-1',
        reviewTabId: reviewTab.id,
        commentIds: [expect.any(String)],
      }),
    ]);
  });
});
