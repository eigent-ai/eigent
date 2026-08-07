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

import { describe, expect, it } from 'vitest';
import {
  canonicalRunEventToLegacyMessage,
  normalizeTaskArtifactFileList,
} from './chatStore';

describe('canonical Run replay projection', () => {
  it('unwraps legacy UI events and ignores typed-only/control events', () => {
    expect(
      canonicalRunEventToLegacyMessage({
        event_type: 'legacy.end',
        legacy_step: 'end',
        payload: { message: 'finished' },
        created_at: 1_786_026_414.75,
      })
    ).toEqual({
      step: 'end',
      data: { message: 'finished' },
      timestamp: 1_786_026_414.75,
    });
    expect(
      canonicalRunEventToLegacyMessage({
        event_type: 'tool.completed',
        legacy_step: null,
        payload: { outcome: 'completed' },
      })
    ).toBeNull();
    expect(
      canonicalRunEventToLegacyMessage({
        run_id: 'run-1',
        after_sequence: 3,
      })
    ).toBeNull();
  });

  it('keeps same-named files when their workspace-relative paths differ', () => {
    const artifacts = Array.from({ length: 21 }, (_, index) => ({
      filename: 'index.html',
      path: `/workspace/chapter-2/lesson-${index + 1}/index.html`,
      relativePath: `chapter-2/lesson-${index + 1}/index.html`,
      changeType: 'generated',
    }));

    const files = normalizeTaskArtifactFileList(artifacts);

    expect(files).toHaveLength(21);
    expect(files[0]).toEqual(
      expect.objectContaining({
        relativePath: 'chapter-2/lesson-1/index.html',
        artifactChange: 'generated',
      })
    );
    expect(files[20]).toEqual(
      expect.objectContaining({
        relativePath: 'chapter-2/lesson-21/index.html',
        artifactChange: 'generated',
      })
    );
  });
});
