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

import { ReviewFileTree } from '@/components/Session/PreviewPanel/tabs/review/ReviewFileTree';
import type { ReviewFile } from '@/components/Session/PreviewPanel/tabs/review/useReviewChanges';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const files: ReviewFile[] = [
  {
    id: 'overlay:run-1:src/added.ts',
    path: 'src/added.ts',
    status: 'added',
    absPath: '/project/src/added.ts',
    bakPath: null,
  },
  {
    id: 'overlay:run-1:src/modified.ts',
    path: 'src/modified.ts',
    status: 'modified',
    absPath: '/project/src/modified.ts',
    bakPath: '/project/src/modified.ts.bak',
  },
];

describe('ReviewFileTree', () => {
  it('adapts only the supplied changed files into the shared review tree', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <ReviewFileTree
        files={files}
        selectedId={files[1].id}
        onSelect={onSelect}
      />
    );

    expect(screen.getByRole('treeitem', { name: /added\.ts/i })).toBeVisible();
    expect(screen.getByRole('treeitem', { name: /modified\.ts/i })).toHaveClass(
      'bg-ds-neutral-default-default'
    );
    expect(
      within(
        screen.getByRole('treeitem', { name: /added\.ts/i })
      ).getByLabelText('added')
    ).toHaveTextContent('A');
    expect(
      within(
        screen.getByRole('treeitem', { name: /modified\.ts/i })
      ).getByLabelText('modified')
    ).toHaveTextContent('M');

    await user.click(screen.getByRole('treeitem', { name: /added\.ts/i }));
    expect(onSelect).toHaveBeenCalledWith(files[0].id);
  });

  it('filters changed files by their project-relative path', async () => {
    const user = userEvent.setup();
    render(
      <ReviewFileTree files={files} selectedId={null} onSelect={vi.fn()} />
    );

    await user.type(screen.getByRole('textbox'), 'added');

    expect(screen.getByRole('treeitem', { name: /added\.ts/i })).toBeVisible();
    expect(
      screen.queryByRole('treeitem', { name: /modified\.ts/i })
    ).not.toBeInTheDocument();
  });

  it('uses one 40px row for search and the filter menu', async () => {
    const user = userEvent.setup();
    render(
      <ReviewFileTree files={files} selectedId={null} onSelect={vi.fn()} />
    );

    expect(screen.getByTestId('review-file-tree-header')).toHaveClass(
      'h-10',
      'items-center'
    );
    const searchInput = screen.getByRole('textbox', { name: 'Filter files…' });
    expect(searchInput).toBeVisible();
    await user.type(searchInput, 'added');
    expect(searchInput).toHaveValue('added');
    await user.keyboard('{Escape}');
    expect(searchInput).toHaveValue('');
    expect(searchInput.parentElement).toHaveClass(
      'h-ds-control-sm',
      'min-h-ds-control-sm'
    );

    await user.click(
      screen.getByRole('button', { name: 'Filter by change status' })
    );
    const addedOption = screen.getByRole('menuitemcheckbox', {
      name: 'Added files',
    });
    expect(addedOption).toHaveClass(
      '!text-ds-text-success-default-default',
      'cursor-pointer',
      'hover:bg-ds-neutral-default-hover'
    );
    expect(addedOption.firstElementChild).toHaveClass(
      'inset-y-0',
      'my-auto',
      'size-4'
    );
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Modified files' })
    ).toHaveClass('!text-ds-text-warning-default-default');
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Deleted files' })
    ).toHaveClass('!text-ds-text-error-default-default');
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Unreviewed' })
    ).toHaveClass('!text-ds-ink-default-default');
  });

  it('filters by review progress and change status', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ReviewFileTree
        files={files}
        selectedId={null}
        reviewedIds={new Set([files[0].id])}
        onSelect={vi.fn()}
      />
    );

    const filterButton = screen.getByRole('button', {
      name: 'Filter by change status',
    });
    await user.click(filterButton);
    await user.click(
      screen.getByRole('menuitemcheckbox', { name: 'Unreviewed' })
    );
    expect(filterButton).toHaveAttribute('aria-pressed', 'true');
    expect(filterButton).toHaveAttribute('data-variant', 'secondary');
    expect(filterButton).toHaveClass(
      'bg-ds-neutral-muted-default',
      'data-[state=open]:!bg-ds-neutral-muted-default'
    );
    await user.keyboard('{Escape}');
    expect(
      screen.queryByRole('treeitem', { name: /added\.ts/i })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('treeitem', { name: /modified\.ts/i })
    ).toBeVisible();

    rerender(
      <ReviewFileTree
        files={files}
        selectedId={null}
        reviewedIds={new Set()}
        onSelect={vi.fn()}
      />
    );
    await user.click(
      screen.getByRole('button', { name: 'Filter by change status' })
    );
    await user.click(
      screen.getByRole('menuitemcheckbox', { name: 'Added files' })
    );
    await user.keyboard('{Escape}');
    expect(screen.getByRole('treeitem', { name: /added\.ts/i })).toBeVisible();
    expect(
      screen.queryByRole('treeitem', { name: /modified\.ts/i })
    ).not.toBeInTheDocument();
  });

  it('shows pending review comment counts next to changed files', () => {
    render(
      <ReviewFileTree
        files={files}
        selectedId={null}
        commentCounts={new Map([[files[1].id, 2]])}
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByLabelText('2 review comments')).toHaveTextContent('2');
  });
});
