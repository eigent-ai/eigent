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

import { TimelineModeRenderer } from '@/components/ChatBox/TimelineModes';
import {
  ModelChangeDivider,
  previousRecordedRunModel,
  type ResolvedRunModel,
} from '@/components/ChatBox/TimelineModes/ModelChangeDivider';
import { composeTimelineRuns } from '@/lib/projector/chat/presentation';
import type { ChatMessageNode } from '@/lib/projector/chat/types';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const gpt: ResolvedRunModel = { platform: 'openai', type: 'gpt-4.1' };
const claude: ResolvedRunModel = {
  platform: 'anthropic',
  type: 'claude-sonnet-4',
};

function userQuery(runId: string, index: number): ChatMessageNode {
  return {
    id: `user-${runId}`,
    eventId: `user-${runId}`,
    projectId: 'project-1',
    runId,
    createdAt: `2026-08-19T00:00:0${index}Z`,
    runSequence: 1,
    cloudCursor: null,
    eventType: 'user.message',
    legacyStep: null,
    kind: 'message',
    role: 'user',
    purpose: 'query',
    status: 'complete',
    content: `Query ${runId}`,
  };
}

describe('ModelChangeDivider', () => {
  it('names the new model when two Tasks ran on different models', () => {
    render(<ModelChangeDivider previous={gpt} current={claude} />);
    expect(screen.getByRole('note')).toHaveTextContent(
      'Model changed to claude-sonnet-4'
    );
  });

  it('treats the same type on another platform as a change', () => {
    render(
      <ModelChangeDivider
        previous={gpt}
        current={{ platform: 'azure', type: 'gpt-4.1' }}
      />
    );
    expect(screen.getByRole('note')).toHaveTextContent(
      'Model changed to gpt-4.1'
    );
  });

  it.each([
    ['the same model', gpt, { ...gpt }],
    ['an unknown previous model', null, claude],
    ['an unknown current model', gpt, null],
    ['no earlier Task', undefined, claude],
  ])('renders nothing for %s', (_case, previous, current) => {
    const { container } = render(
      <ModelChangeDivider previous={previous} current={current} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('compares against the last known model, skipping unknown Tasks', () => {
    const models = { a: gpt, b: null, c: claude };
    expect(previousRecordedRunModel(['a', 'b', 'c'], 0, models)).toBe(
      undefined
    );
    expect(previousRecordedRunModel(['a', 'b', 'c'], 2, models)).toBe(gpt);
    expect(previousRecordedRunModel(['b', 'c'], 1, models)).toBe(undefined);
  });
});

describe.each(['narrative', 'trajectory'] as const)(
  'event-native %s timeline',
  (detailLevel) => {
    const runs = composeTimelineRuns(
      ['run-1', 'run-2', 'run-3', 'run-4', 'run-5'].map(userQuery)
    );

    it('places a divider only where the model changes', () => {
      const { container } = render(
        <TimelineModeRenderer
          detailLevel={detailLevel}
          runs={runs}
          resolvedModelsByRun={{
            'run-1': gpt,
            'run-2': claude,
            'run-3': null,
            'run-4': claude,
            'run-5': gpt,
          }}
        />
      );
      const dividers = container.querySelectorAll(
        '[data-model-change-divider]'
      );
      expect(Array.from(dividers, (divider) => divider.textContent)).toEqual([
        'Model changed to claude-sonnet-4',
        'Model changed to gpt-4.1',
      ]);
      // Each divider sits directly above the Task that ran on the new model.
      const text = container.textContent ?? '';
      expect(text.indexOf('Query run-1')).toBeLessThan(
        text.indexOf('Model changed to claude-sonnet-4')
      );
      expect(text.indexOf('Model changed to claude-sonnet-4')).toBeLessThan(
        text.indexOf('Query run-2')
      );
      expect(text.indexOf('Query run-4')).toBeLessThan(
        text.indexOf('Model changed to gpt-4.1')
      );
      expect(text.indexOf('Model changed to gpt-4.1')).toBeLessThan(
        text.indexOf('Query run-5')
      );
    });

    it('shows no divider without recorded models', () => {
      const { container } = render(
        <TimelineModeRenderer detailLevel={detailLevel} runs={runs} />
      );
      expect(container.querySelector('[data-model-change-divider]')).toBeNull();
    });
  }
);
