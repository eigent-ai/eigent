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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  teachFeedbackId,
  useTeachModeStore,
  type TeachFeedbackTarget,
} from './teachModeStore';

const target: TeachFeedbackTarget = {
  spaceId: 'space-1',
  projectId: 'project-1',
  runId: 'run-1',
  sourceType: 'agent-log',
  sourceId: 'event-1',
  contextLabel: 'Agent log',
};

describe('teachModeStore', () => {
  beforeEach(() => {
    useTeachModeStore.setState({
      enabled: false,
      feedbackById: {},
      draftAnnotationIdsByProjectId: {},
      pendingAnnotation: null,
    });
  });

  it('keeps Teach mode enabled across Space changes until disabled', () => {
    const store = useTeachModeStore.getState();
    store.setEnabled(true);
    expect(useTeachModeStore.getState().enabled).toBe(true);

    useTeachModeStore.getState().setEnabled(false);
    expect(useTeachModeStore.getState().enabled).toBe(false);
  });

  it('updates a comment and removes empty feedback', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(100);
    useTeachModeStore.getState().saveFeedback(target, {
      comment: 'Lead with the result.',
    });

    const id = teachFeedbackId(target);
    expect(useTeachModeStore.getState().feedbackById[id]).toMatchObject({
      comment: 'Lead with the result.',
      createdAt: 100,
      updatedAt: 100,
    });

    now.mockReturnValue(200);
    useTeachModeStore.getState().saveFeedback(target, {
      comment: 'Use a more specific opening.',
    });
    expect(useTeachModeStore.getState().feedbackById[id]).toMatchObject({
      createdAt: 100,
      updatedAt: 200,
    });

    useTeachModeStore.getState().saveFeedback(target, { comment: '' });
    expect(useTeachModeStore.getState().feedbackById[id]).toBeUndefined();
    now.mockRestore();
  });

  it('keeps separate annotations for different selected passages on one source', () => {
    const store = useTeachModeStore.getState();
    store.addAnnotation(
      { ...target, selectedText: 'First passage' },
      'Clarify this.'
    );
    store.addAnnotation(
      { ...target, selectedText: 'Second passage' },
      'Check this.'
    );

    const annotations = Object.values(
      useTeachModeStore.getState().feedbackById
    );
    expect(annotations).toHaveLength(2);
    expect(annotations.map((entry) => entry.selectedText)).toEqual([
      'First passage',
      'Second passage',
    ]);
    expect(
      useTeachModeStore.getState().draftAnnotationIdsByProjectId['project-1']
    ).toEqual(annotations.map((entry) => entry.id));
  });

  it('removes only sent annotations from a Session draft', () => {
    const store = useTeachModeStore.getState();
    store.addAnnotation(target, 'First note');
    store.addAnnotation(target, 'Second note');
    const [first, second] = Object.values(
      useTeachModeStore.getState().feedbackById
    );
    store.clearDraftAnnotations('project-1', [first.id]);
    expect(
      useTeachModeStore.getState().draftAnnotationIdsByProjectId['project-1']
    ).toEqual([second.id]);
    expect(
      Object.values(useTeachModeStore.getState().feedbackById)
    ).toHaveLength(2);
    store.removeDraftAnnotation('project-1', second.id);
    expect(
      useTeachModeStore.getState().draftAnnotationIdsByProjectId['project-1']
    ).toEqual([]);
  });

  it('keeps only file references still present in the saved comment', () => {
    const fileReferences = [
      {
        projectId: 'project-1',
        relativePath: 'london_poem.md',
        name: 'london_poem.md',
        token: '@[london_poem.md]',
      },
      {
        projectId: 'project-1',
        relativePath: 'london_poem.pdf',
        name: 'london_poem.pdf',
        token: '@[london_poem.pdf]',
      },
    ];
    useTeachModeStore
      .getState()
      .addAnnotation(
        target,
        'Check @[london_poem.md] before delivery.',
        fileReferences
      );

    const annotation = Object.values(
      useTeachModeStore.getState().feedbackById
    )[0];
    expect(annotation.fileReferences).toEqual([fileReferences[0]]);
  });

  it('edits and deletes one annotation without changing its source or creation time', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(100);
    useTeachModeStore.getState().addAnnotation(target, 'Original note');
    const entry = Object.values(useTeachModeStore.getState().feedbackById)[0];

    now.mockReturnValue(200);
    useTeachModeStore.getState().updateAnnotation(entry.id, '  Better note  ');
    expect(useTeachModeStore.getState().feedbackById[entry.id]).toMatchObject({
      sourceId: target.sourceId,
      comment: 'Better note',
      createdAt: 100,
      updatedAt: 200,
    });

    useTeachModeStore.getState().updateAnnotation(entry.id, '  ');
    expect(useTeachModeStore.getState().feedbackById[entry.id].comment).toBe(
      'Better note'
    );
    useTeachModeStore.getState().deleteAnnotation(entry.id);
    expect(useTeachModeStore.getState().feedbackById[entry.id]).toBeUndefined();
    now.mockRestore();
  });

  it('uses the saved timestamp as creation time when upgrading existing annotations', () => {
    const migrate = useTeachModeStore.persist.getOptions().migrate;
    const previous = {
      enabled: true,
      feedbackById: {
        existing: {
          ...target,
          id: 'existing',
          comment: 'Check the poem.',
          updatedAt: 123,
        },
      },
    };
    const migrated = migrate?.(previous, 1) as typeof previous & {
      feedbackById: { existing: { createdAt: number } };
    };
    expect(migrated.feedbackById.existing.createdAt).toBe(123);
  });

  it('preserves version-2 annotations while adding an empty composer draft', () => {
    const migrate = useTeachModeStore.persist.getOptions().migrate;
    const existing = {
      ...target,
      id: 'existing',
      comment: 'Keep this.',
      createdAt: 1,
      updatedAt: 1,
    };
    const migrated = migrate?.(
      { enabled: true, feedbackById: { existing } },
      2
    ) as {
      feedbackById: Record<string, unknown>;
      draftAnnotationIdsByProjectId: Record<string, string[]>;
    };
    expect(migrated.feedbackById.existing).toEqual(existing);
    expect(migrated.draftAnnotationIdsByProjectId).toEqual({});
  });
});
