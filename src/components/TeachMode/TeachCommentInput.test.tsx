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

import type { TeachFileReference } from '@/store/teachModeStore';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TeachCommentInput } from './TeachCommentInput';

vi.mock('./useAnnotationReferenceFiles', () => ({
  useAnnotationReferenceFiles: (
    _spaceId: string,
    _projectId: string,
    scope: 'session' | 'space'
  ) => ({
    files:
      scope === 'session'
        ? [
            {
              projectId: 'session-1',
              projectName: 'London poem',
              name: 'london_poem.md',
              relativePath: 'london_poem.md',
            },
          ]
        : [
            {
              projectId: 'session-2',
              projectName: 'Audit report',
              name: 'summary.pdf',
              relativePath: 'summary.pdf',
            },
          ],
    loading: false,
    error: false,
    refresh: vi.fn(),
  }),
}));

function ControlledInput({ scope }: { scope: 'session' | 'space' }) {
  const [value, setValue] = useState('Please check ');
  const [references, setReferences] = useState<TeachFileReference[]>([]);
  return (
    <>
      <TeachCommentInput
        value={value}
        onChange={setValue}
        references={references}
        onReferencesChange={setReferences}
        spaceId="space-1"
        projectId="session-1"
        scope={scope}
      />
      <output data-testid="references">{JSON.stringify(references)}</output>
    </>
  );
}

describe('TeachCommentInput', () => {
  it('inserts a selected session file at the caret and records its identity', async () => {
    render(<ControlledInput scope="session" />);
    fireEvent.click(screen.getByRole('button', { name: /file references/i }));

    expect(
      await screen.findByRole('option', { name: /london_poem.md/i })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: /london_poem.md/i }));

    expect(screen.getByRole('textbox')).toHaveValue(
      'Please check @[london_poem.md] '
    );
    expect(screen.getByTestId('references')).toHaveTextContent(
      '"projectId":"session-1"'
    );
  });
});
