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
  SessionReviewIdentity,
  SessionReviewTab,
  SessionReviewTarget,
} from '@/store/pageTabStore';
import { getSessionPreviewSlice, usePageTabStore } from '@/store/pageTabStore';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseReviewChanges =
  vi.fn<
    (
      target: SessionReviewTarget,
      pinnedIdentity?: SessionReviewIdentity
    ) => ReviewChangesState
  >();
const mockUseLatestReviewRunId = vi.fn<() => string | undefined>();

const reviewTab: SessionReviewTab = {
  id: 'review-1',
  type: 'review',
  title: 'Review',
  reviewTarget: { scope: 'project', focusRequestId: 0 },
};

/** Store-connected rendering matches how PreviewPanel keeps tab updates live. */
function ConnectedReviewTab({ tabId = reviewTab.id }: { tabId?: string }) {
  const tab = usePageTabStore(
    (state) =>
      state.sessionPreviewByProject[
        state.sessionPreviewProjectId ?? ''
      ]?.tabs.find((candidate) => candidate.id === tabId) as
        SessionReviewTab | undefined
  );
  return tab ? <ReviewTab tab={tab} /> : null;
}

function openMoreActions(button?: HTMLElement) {
  fireEvent.keyDown(
    button ?? screen.getByRole('button', { name: 'More actions' }),
    { key: 'Enter', code: 'Enter' }
  );
}

vi.mock(
  '@/components/Session/PreviewPanel/tabs/review/useReviewChanges',
  () => ({
    useReviewChanges: (
      target: SessionReviewTarget,
      pinnedIdentity?: SessionReviewIdentity
    ) => mockUseReviewChanges(target, pinnedIdentity),
  })
);

vi.mock(
  '@/components/Session/PreviewPanel/tabs/review/useLatestReviewRunId',
  () => ({
    useLatestReviewRunId: () => mockUseLatestReviewRunId(),
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
          comments,
          headerActions,
          onCommentRequest,
        }: {
          file: { id: string };
          viewMode: string;
          wordWrap: boolean;
          comments?: unknown[];
          headerActions?: ReactNode;
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
          <div data-testid="review-file-header-actions">{headerActions}</div>
          <div
            data-testid={`diff:${file.id}`}
            data-review-id={file.id}
            data-view-mode={viewMode}
            data-word-wrap={String(wordWrap)}
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
    mockUseLatestReviewRunId.mockReset();
    mockUseLatestReviewRunId.mockReturnValue('run-latest');
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
      screen.getByText('Could not load the changes for this task.')
    ).toBeInTheDocument();
    expect(screen.getByText('overlay service down')).toBeInTheDocument();
    expect(
      screen.queryByText('No file changes in this session yet.')
    ).not.toBeInTheDocument();
  });

  it('keeps a generic Review tab focused on the latest task without a scope selector', () => {
    mockUseReviewChanges.mockReturnValue({
      loading: false,
      files: [],
      desktopOnly: false,
      error: null,
      totals: { added: 0, removed: 0 },
      refresh: vi.fn(),
    });

    const { container } = render(<ConnectedReviewTab />);

    expect(mockUseReviewChanges).toHaveBeenLastCalledWith(
      { scope: 'run', runId: 'run-latest', focusRequestId: 0 },
      undefined
    );
    expect(
      screen.queryByRole('button', { name: /^Review change scope:/ })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitemradio')).not.toBeInTheDocument();
    expect(container.querySelector('header')).toBeNull();
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

  it('shows the task-wide added and removed line totals', () => {
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

    const previewHeader = screen
      .getByTestId('review-header-metadata')
      .closest('header');
    expect(previewHeader).not.toBeNull();
    expect(previewHeader).toHaveClass('gap-2', 'bg-ds-neutral-subtle-default');
    expect(screen.getByTestId('review-header-metadata')).toHaveClass(
      'h-full',
      'items-center',
      'gap-2'
    );
    const header = within(previewHeader as HTMLElement);
    const fileNumber = header.getByText('1/1');
    const addedLines = header.getByText('+42');
    const removedLines = header.getByText('−7');
    const reviewedNumber = header.getByText('0 of 1 reviewed');
    const separators = header.getAllByRole('separator');

    expect(removedLines).toBeInTheDocument();
    expect(separators).toHaveLength(2);
    expect(fileNumber.compareDocumentPosition(separators[0])).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(separators[0].compareDocumentPosition(addedLines)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(addedLines.compareDocumentPosition(separators[1])).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(separators[1].compareDocumentPosition(reviewedNumber)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
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

  it('mounts one active diff and navigates files from the More menu', () => {
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

    openMoreActions();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Next file' }));
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

  it('keeps tab actions in the Preview header and file actions in the file header', () => {
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({
        x: 0,
        y: 0,
        top: 0,
        right: 1200,
        bottom: 800,
        left: 0,
        width: 1200,
        height: 800,
        toJSON: () => ({}),
      });
    mockUseReviewChanges.mockReturnValue({
      loading: false,
      desktopOnly: false,
      error: null,
      totals: { added: 3, removed: 1 },
      refresh: vi.fn(),
      files: [
        {
          id: 'first',
          path: 'src/first.ts',
          status: 'modified',
          absPath: '/first.ts',
          bakPath: '/first.ts.bak',
        },
        {
          id: 'second',
          path: 'src/second.ts',
          status: 'added',
          absPath: '/second.ts',
          bakPath: null,
        },
      ],
    });

    render(<ReviewTab tab={reviewTab} />);

    const previewHeader = screen
      .getByTestId('review-header-metadata')
      .closest('header');
    expect(previewHeader).not.toBeNull();
    const headerActions = screen.getByTestId('review-header-actions');
    expect(headerActions).toHaveClass('gap-1');
    const headerButtons = within(headerActions).getAllByRole('button');
    expect(headerButtons).toHaveLength(4);
    expect(headerButtons[0]).toHaveAccessibleName('More actions');
    expect(headerButtons[1]).toHaveAccessibleName('Enable word wrap');
    expect(headerButtons[2]).toHaveAccessibleName('Refresh');
    expect(headerButtons[3]).toHaveAccessibleName('Hide file tree');
    expect(
      within(previewHeader as HTMLElement).getByRole('button', {
        name: 'Refresh',
      })
    ).toBeInTheDocument();
    const previewButtons = within(previewHeader as HTMLElement).getAllByRole(
      'button'
    );
    expect(previewButtons.at(-1)).toHaveAccessibleName('Hide file tree');
    openMoreActions(headerButtons[0]);
    expect(
      screen.getByRole('menuitem', { name: 'Previous file' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Next file' })
    ).toBeInTheDocument();
    expect(
      within(previewHeader as HTMLElement).queryByRole('button', {
        name: 'Mark as reviewed',
      })
    ).not.toBeInTheDocument();

    const fileHeader = screen.getByTestId('review-file-header-actions');
    expect(fileHeader.firstElementChild).toHaveClass('gap-1');
    const fileHeaderButtons = within(fileHeader).getAllByRole('button');
    expect(fileHeaderButtons).toHaveLength(5);
    expect(fileHeaderButtons[0]).toHaveAccessibleName('Mark as reviewed');
    expect(fileHeaderButtons[1]).toHaveAccessibleName(
      'Add comment · Add a file review note'
    );
    expect(fileHeaderButtons[1]).toHaveTextContent('Add comment');
    expect(fileHeaderButtons[2]).toHaveAccessibleName('Split diff');
    expect(fileHeaderButtons[3]).toHaveAccessibleName('Previous change');
    expect(fileHeaderButtons[4]).toHaveAccessibleName('Next change');
    expect(within(fileHeader).getAllByRole('separator')).toHaveLength(1);
    expect(
      within(fileHeader).queryByRole('button', { name: 'Next file' })
    ).not.toBeInTheDocument();
    expect(
      within(fileHeader).queryByRole('button', { name: 'Enable word wrap' })
    ).not.toBeInTheDocument();

    fireEvent.click(headerButtons[1]);
    expect(headerButtons[1]).toHaveAttribute('aria-pressed', 'true');
    expect(headerButtons[1]).toHaveClass(
      'aria-pressed:!bg-ds-neutral-subtle-default'
    );
    expect(screen.getByTestId('diff:first')).toHaveAttribute(
      'data-word-wrap',
      'true'
    );
    fireEvent.click(fileHeaderButtons[2]);
    expect(screen.getByTestId('diff:first')).toHaveAttribute(
      'data-view-mode',
      'split'
    );
    expect(fileHeaderButtons[2]).toHaveAccessibleName('Inline diff');
    rectSpy.mockRestore();
  });

  it('places the file tree after the active diff in reading order', () => {
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
        {
          id: 'second',
          path: 'src/second.ts',
          status: 'added',
          absPath: '/second.ts',
          bakPath: null,
        },
      ],
    });

    render(<ReviewTab tab={reviewTab} />);

    expect(
      screen
        .getByTestId('diff:first')
        .compareDocumentPosition(screen.getByTestId('review-tree'))
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
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

    expect(mockUseReviewChanges).toHaveBeenCalledWith(runTarget, undefined);
    expect(
      screen.getByTestId('diff:run-git:run-1:src/example.ts')
    ).toBeInTheDocument();
    // The project has moved on to `run-latest`, but a tab opened for one Run
    // must keep showing that Run rather than silently retargeting.
    expect(mockUseLatestReviewRunId).toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: /^Review change scope:/ })
    ).not.toBeInTheDocument();
  });

  it('pins the loaded revision per task so the out-of-date guard survives a remount', () => {
    const identity = { baseCommit: 'base-1', targetCommit: 'target-1' };
    const changesWithIdentity = (
      reviewIdentity: SessionReviewIdentity
    ): ReviewChangesState => ({
      loading: false,
      desktopOnly: false,
      error: null,
      totals: { added: 0, removed: 0 },
      truncated: false,
      stale: false,
      refresh: vi.fn(),
      reviewIdentity,
      reviewIdentityTargetKey: 'run:run-latest',
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
    mockUseReviewChanges.mockReturnValue(changesWithIdentity(identity));

    const { unmount } = render(<ConnectedReviewTab />);

    const stored = getSessionPreviewSlice(usePageTabStore.getState())
      .tabs[0] as SessionReviewTab;
    expect(stored.reviewIdentities).toEqual({ 'run:run-latest': identity });

    // A later fetch reports a newer revision; the pin must not follow it, or
    // nothing would ever be reported as out of date.
    unmount();
    mockUseReviewChanges.mockReturnValue(
      changesWithIdentity({ baseCommit: 'base-2', targetCommit: 'target-2' })
    );
    render(<ConnectedReviewTab />);

    expect(mockUseReviewChanges).toHaveBeenLastCalledWith(
      { scope: 'run', runId: 'run-latest', focusRequestId: 0 },
      identity
    );
    expect(
      (
        getSessionPreviewSlice(usePageTabStore.getState())
          .tabs[0] as SessionReviewTab
      ).reviewIdentities
    ).toEqual({ 'run:run-latest': identity });
  });

  it('never pins an old response identity under a newly followed task', () => {
    const runIdentity = { baseCommit: 'run-base', targetCommit: 'run-target' };
    const nextRunIdentity = {
      baseCommit: 'next-run-base',
      targetCommit: 'next-run-target',
    };
    let loadedChanges: ReviewChangesState = {
      loading: false,
      desktopOnly: false,
      error: null,
      totals: { added: 0, removed: 0 },
      truncated: false,
      stale: false,
      refresh: vi.fn(),
      reviewIdentity: runIdentity,
      reviewIdentityTargetKey: 'run:run-latest',
      files: [
        {
          id: 'first',
          path: 'src/first.ts',
          status: 'modified',
          absPath: '/first.ts',
          bakPath: '/first.ts.bak',
        },
      ],
    };
    mockUseReviewChanges.mockImplementation(() => loadedChanges);

    const view = render(<ConnectedReviewTab />);
    expect(
      (
        getSessionPreviewSlice(usePageTabStore.getState())
          .tabs[0] as SessionReviewTab
      ).reviewIdentities
    ).toEqual({ 'run:run-latest': runIdentity });

    mockUseLatestReviewRunId.mockReturnValue('run-next');
    view.rerender(<ConnectedReviewTab />);

    const awaitingNextRun = getSessionPreviewSlice(usePageTabStore.getState())
      .tabs[0] as SessionReviewTab;
    expect(awaitingNextRun.reviewIdentities).toEqual({
      'run:run-latest': runIdentity,
    });
    expect(mockUseReviewChanges).toHaveBeenLastCalledWith(
      { scope: 'run', runId: 'run-next', focusRequestId: 0 },
      undefined
    );

    loadedChanges = {
      ...loadedChanges,
      reviewIdentity: nextRunIdentity,
      reviewIdentityTargetKey: 'run:run-next',
    };
    view.rerender(<ConnectedReviewTab />);

    expect(
      (
        getSessionPreviewSlice(usePageTabStore.getState())
          .tabs[0] as SessionReviewTab
      ).reviewIdentities
    ).toEqual({
      'run:run-latest': runIdentity,
      'run:run-next': nextRunIdentity,
    });
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

    openMoreActions();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Previous file' }));
    const reviewedButton = screen.getByRole('button', {
      name: 'Mark as unreviewed',
    });
    expect(reviewedButton).toHaveAttribute('data-tone', 'success');
    expect(
      reviewedButton.querySelector('.lucide-check-check')
    ).toBeInTheDocument();
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
    const fileHeader = screen.getByTestId('review-file-header-actions');
    const addCommentButton = within(fileHeader).getByRole('button', {
      name: 'Add comment · Add a file review note',
    });
    fireEvent.click(addCommentButton);
    expect(addCommentButton).toHaveTextContent('Add comment');
    expect(addCommentButton).toHaveAttribute('aria-pressed', 'true');
    expect(addCommentButton).toHaveClass(
      'aria-pressed:!bg-ds-neutral-subtle-default'
    );

    fireEvent.click(addCommentButton);
    expect(
      screen.queryByRole('textbox', { name: 'Describe what should change…' })
    ).not.toBeInTheDocument();
    expect(addCommentButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(addCommentButton);
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Describe what should change…' }),
      { target: { value: 'Keep this API backward compatible.' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));
    expect(
      within(fileHeader).getByRole('button', {
        name: 'Add comment · Add a file review note',
      })
    ).toHaveTextContent('Add comment');
    expect(addCommentButton).toHaveAttribute('aria-pressed', 'false');

    expect(
      screen.getByText('Keep this API backward compatible.')
    ).toBeVisible();
    openMoreActions();
    expect(
      screen.getByRole('menuitem', { name: 'Copy review comments' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Add 1 comments to chat' })
    ).toBeInTheDocument();
  });

  it('binds a new comment to the active task instead of the tab origin', () => {
    const projectIdentity = {
      baseCommit: 'project-base',
      targetCommit: 'project-target',
    };
    const runIdentity = { baseCommit: 'run-base', targetCommit: 'run-target' };
    const scopedTab: SessionReviewTab = {
      ...reviewTab,
      reviewIdentity: projectIdentity,
      reviewIdentities: {
        project: projectIdentity,
        'run:run-latest': runIdentity,
      },
    };
    usePageTabStore.setState({
      sessionPreviewByProject: {
        'project-1': {
          open: true,
          tabs: [scopedTab],
          activeTabId: scopedTab.id,
        },
      },
    });
    mockUseReviewChanges.mockReturnValue({
      loading: false,
      desktopOnly: false,
      error: null,
      totals: { added: 0, removed: 0 },
      reviewIdentity: runIdentity,
      reviewIdentityTargetKey: 'run:run-latest',
      stale: false,
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

    render(<ConnectedReviewTab />);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Add comment · Add a file review note',
      })
    );
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Describe what should change…' }),
      { target: { value: 'Keep the task-scoped behavior.' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));

    const stored = getSessionPreviewSlice(usePageTabStore.getState())
      .tabs[0] as SessionReviewTab;
    expect(stored.reviewComments).toEqual([
      expect.objectContaining({
        body: 'Keep the task-scoped behavior.',
        reviewIdentity: runIdentity,
      }),
    ]);
    openMoreActions();
    expect(
      screen.getByRole('menuitem', { name: 'Add 1 comments to chat' })
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
    openMoreActions();
    expect(
      screen.queryByRole('menuitem', { name: 'Add 1 comments to chat' })
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

    openMoreActions();
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Add 1 comments to chat' })
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

  it('requires explicit rebasing before handing off an unbound old comment', () => {
    const identity = {
      baseCommit: 'a'.repeat(40),
      targetCommit: 'b'.repeat(40),
    };
    mockUseReviewChanges.mockReturnValue({
      loading: false,
      desktopOnly: false,
      error: null,
      totals: { added: 0, removed: 0 },
      reviewIdentity: identity,
      reviewIdentityTargetKey: 'run:run-latest',
      stale: false,
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
    const pinnedTab: SessionReviewTab = {
      ...reviewTab,
      reviewIdentity: identity,
      reviewComments: [
        {
          id: 'legacy-comment',
          fileId: 'first',
          path: 'src/first.ts',
          selection: null,
          body: 'Confirm this still applies.',
          createdAt: 1,
        },
      ],
    };

    render(<ReviewTab tab={pinnedTab} />);

    openMoreActions();
    expect(
      screen.queryByRole('menuitem', { name: 'Add 1 comments to chat' })
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('menuitem', {
        name: 'Rebase 1 comments onto this revision',
      })
    );

    openMoreActions();
    expect(
      screen.getByRole('menuitem', { name: 'Add 1 comments to chat' })
    ).toBeInTheDocument();
    const storedTab = usePageTabStore
      .getState()
      .sessionPreviewByProject['project-1'].tabs.find(
        (tab) => tab.id === pinnedTab.id
      );
    expect(storedTab).toMatchObject({
      reviewComments: [
        expect.objectContaining({
          id: 'legacy-comment',
          reviewIdentity: identity,
        }),
      ],
    });
  });
});
