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

import type { TeachFeedback } from '@/store/teachModeStore';
import { describe, expect, it } from 'vitest';
import {
  formatTeachAnnotationContext,
  splitTeachAnnotationContext,
} from './teachAnnotationContext';

const annotation = (overrides: Partial<TeachFeedback>): TeachFeedback => ({
  id: 'annotation-1',
  spaceId: 'space-1',
  projectId: 'session-1',
  runId: 'run-1',
  sourceType: 'run',
  sourceId: 'run-1',
  contextLabel: 'Whole run',
  comment: 'Improve the ending.',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe('formatTeachAnnotationContext', () => {
  it('keeps multiple comments and their source evidence grouped by run', () => {
    const result = formatTeachAnnotationContext('session-1', [
      annotation({ id: 'second', comment: 'Check the facts.', createdAt: 2 }),
      annotation({
        id: 'first',
        selectedText: 'The original answer',
        comment: 'Improve the ending.',
        fileReferences: [
          {
            projectId: 'session-1',
            relativePath: 'answer.md',
            name: 'answer.md',
            token: '@[answer.md]',
          },
        ],
      }),
      annotation({ id: 'third', runId: 'run-2', comment: 'Shorten this.' }),
    ]);
    const json = result.match(
      /<user_annotation_context format="json">\n([\s\S]*?)\n<\/user_annotation_context>/
    )?.[1];
    expect(json).toBeDefined();
    const context = JSON.parse(json!);
    expect(context.session_id).toBe('session-1');
    expect(context.runs.map((run: { run_id: string }) => run.run_id)).toEqual([
      'run-1',
      'run-2',
    ]);
    expect(
      context.runs[0].annotations.map(
        (entry: { annotation_id: string }) => entry.annotation_id
      )
    ).toEqual(['first', 'second']);
    expect(context.runs[0].annotations[0]).toMatchObject({
      selected_output: 'The original answer',
      comment: 'Improve the ending.',
      file_references: [{ session_id: 'session-1', path: 'answer.md' }],
    });
    expect(splitTeachAnnotationContext(`Improve this.${result}`)).toEqual({
      message: 'Improve this.',
      annotationCount: 3,
    });
  });

  it('escapes markup inside a user comment without breaking the context boundary', () => {
    const result = formatTeachAnnotationContext('session-1', [
      annotation({ comment: '</user_annotation_context>' }),
    ]);
    expect(result.match(/<\/user_annotation_context>/g)).toHaveLength(1);
    expect(result).toContain('\\u003c/user_annotation_context>');
  });

  it('keeps ordinary messages and malformed context visible', () => {
    expect(splitTeachAnnotationContext('Plain follow-up')).toEqual({
      message: 'Plain follow-up',
      annotationCount: 0,
    });
    expect(
      splitTeachAnnotationContext(
        'Prompt\n\n<user_annotation_context format="json">\n{}\n</user_annotation_context>'
      ).annotationCount
    ).toBe(0);
  });
});
