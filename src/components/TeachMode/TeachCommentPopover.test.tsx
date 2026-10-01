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

import { useSpaceStore } from '@/store/spaceStore';
import { useTeachModeStore } from '@/store/teachModeStore';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { TeachCommentPopover } from './TeachCommentPopover';

describe('TeachCommentPopover', () => {
  beforeEach(() => {
    useSpaceStore.setState({ activeSpaceId: 'space-1' });
    useTeachModeStore.setState({
      enabled: true,
      feedbackById: {},
      draftAnnotationIdsByProjectId: {},
      pendingAnnotation: null,
    });
  });

  it('adds multiple annotations to the same Run and queues both as context', () => {
    render(
      <TeachCommentPopover
        projectId="session-1"
        runId="run-1"
        sourceType="run"
        sourceId="run-1"
        contextLabel="Whole run"
      />
    );

    for (const comment of ['Improve the ending.', 'Check the facts.']) {
      fireEvent.click(screen.getByRole('button', { name: 'Add annotation' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Comment' }), {
        target: { value: comment },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save annotation' }));
    }

    const state = useTeachModeStore.getState();
    const entries = Object.values(state.feedbackById);
    expect(entries.map((entry) => entry.comment)).toEqual([
      'Improve the ending.',
      'Check the facts.',
    ]);
    expect(entries.map((entry) => entry.runId)).toEqual(['run-1', 'run-1']);
    expect(state.draftAnnotationIdsByProjectId['session-1']).toEqual(
      entries.map((entry) => entry.id)
    );
  });
});
