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
import { render, screen } from '@testing-library/react';
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
      'bg-ds-bg-neutral-default-default'
    );
    expect(screen.getByLabelText('added')).toHaveTextContent('A');
    expect(screen.getByLabelText('modified')).toHaveTextContent('M');

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
});
