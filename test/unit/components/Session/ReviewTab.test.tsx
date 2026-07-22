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
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseReviewChanges = vi.fn<() => ReviewChangesState>();

vi.mock(
  '@/components/Session/PreviewPanel/tabs/review/useReviewChanges',
  () => ({
    useReviewChanges: () => mockUseReviewChanges(),
  })
);

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (state: { appearance: string }) => unknown) =>
    selector({ appearance: 'light' }),
}));

vi.mock('@/components/Session/PreviewPanel/tabs/review/DiffFileCard', () => ({
  DiffFileCard: ({ file }: { file: { id: string } }) => (
    <div data-testid={`diff:${file.id}`} />
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
      refresh: vi.fn(),
    });

    render(<ReviewTab />);

    expect(screen.getByText('layout.review-desktop-only')).toBeInTheDocument();
    expect(screen.queryByText('layout.review-empty')).not.toBeInTheDocument();
  });

  it('renders review files by their stable identity', () => {
    mockUseReviewChanges.mockReturnValue({
      loading: false,
      desktopOnly: false,
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

    render(<ReviewTab />);

    expect(
      screen.getByTestId('diff:file:/outside/src/example.ts')
    ).toBeInTheDocument();
    expect(screen.getByTestId('review-tree')).toBeInTheDocument();
  });
});
