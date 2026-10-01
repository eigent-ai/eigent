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

import { formatTeachAnnotationContext } from '@/lib/teachAnnotationContext';
import type { TeachFeedback } from '@/store/teachModeStore';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UserMessageCard } from './UserMessageCard';

describe('UserMessageCard annotation context', () => {
  it('shows a compact sent-context label while preserving the user prompt', () => {
    const annotation: TeachFeedback = {
      id: 'note-1',
      spaceId: 'space-1',
      projectId: 'session-1',
      runId: 'run-1',
      sourceType: 'run',
      sourceId: 'run-1',
      contextLabel: 'Whole run',
      comment: 'Improve the ending.',
      createdAt: 1,
      updatedAt: 1,
    };
    render(
      <UserMessageCard
        id="message-1"
        content={`Please revise the poem.${formatTeachAnnotationContext('session-1', [annotation])}`}
      />
    );

    expect(screen.getByText('1 annotation')).toBeInTheDocument();
    expect(screen.getByText('Please revise the poem.')).toBeInTheDocument();
    expect(
      screen.queryByText(/user_annotation_context/)
    ).not.toBeInTheDocument();
  });
});
