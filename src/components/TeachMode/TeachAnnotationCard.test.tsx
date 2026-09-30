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

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TeachAnnotationCard } from './TeachAnnotationCard';

vi.mock('./useAnnotationReferenceFiles', () => ({
  useAnnotationReferenceFiles: () => ({
    files: [],
    loading: false,
    error: false,
    refresh: vi.fn(),
  }),
}));

describe('TeachAnnotationCard', () => {
  it('keeps the comment field and save action without helper chrome', () => {
    render(
      <TeachAnnotationCard
        target={{
          spaceId: 'space-1',
          projectId: 'session-1',
          sourceType: 'run',
          sourceId: 'run-1',
          contextLabel: 'Final answer',
          selectedText: 'The finished poem.',
        }}
        comment=""
        onCommentChange={vi.fn()}
        references={[]}
        onReferencesChange={vi.fn()}
        onSave={vi.fn()}
      />
    );

    expect(
      screen.getByRole('textbox', { name: 'Comment' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Save comment' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /file references/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Enter/)).not.toBeInTheDocument();
    expect(screen.queryByText('Comment')).not.toBeInTheDocument();
  });
});
