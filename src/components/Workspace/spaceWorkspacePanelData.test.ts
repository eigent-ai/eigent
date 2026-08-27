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

import type { Space } from '@/store/spaceStore';
import { describe, expect, it } from 'vitest';
import {
  buildSevenDayActivity,
  buildThirtyDayActivity,
  categorizeSpaceFile,
  getSpaceAgeInDays,
  getSpaceSummaryVariantIndex,
  hasUserBoundLocalFolder,
} from './spaceWorkspacePanelData';

const makeSpace = (overrides: Partial<Space> = {}): Space => ({
  id: 'space-1',
  name: 'Space',
  sourceType: 'blank',
  status: 'active',
  schemaVersion: 2,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe('Space Workspace panel state', () => {
  it('does not treat the generated scratch workspace as a user folder', () => {
    const space = makeSpace({
      rootPath: '/tmp/eigent/space-1',
      metadata: { localWorkspaceSource: 'scratch_space' },
    });

    expect(hasUserBoundLocalFolder(space)).toBe(false);
  });

  it('recognizes an explicitly bound local folder', () => {
    expect(
      hasUserBoundLocalFolder(
        makeSpace({
          metadata: { bindingSource: 'space_local_brain' },
        })
      )
    ).toBe(true);
  });
});

describe('Space Workspace panel summaries', () => {
  it('categorizes universal content types', () => {
    expect(categorizeSpaceFile('brief.pdf')).toBe('Documents');
    expect(categorizeSpaceFile('index.tsx')).toBe('Code');
    expect(categorizeSpaceFile('results.csv')).toBe('Data');
    expect(categorizeSpaceFile('cover.png')).toBe('Media');
    expect(categorizeSpaceFile('archive.zip')).toBe('Other');
  });

  it('reports at least one day since Space creation', () => {
    const now = new Date('2026-08-27T12:00:00.000Z').getTime();
    expect(getSpaceAgeInDays(now, now)).toBe(1);
    expect(getSpaceAgeInDays(now - 8 * 24 * 60 * 60 * 1000, now)).toBe(8);
  });

  it('selects one stable summary variant for each Space', () => {
    const variant = getSpaceSummaryVariantIndex('space-1');
    expect(variant).toBeGreaterThanOrEqual(0);
    expect(variant).toBeLessThan(3);
    expect(getSpaceSummaryVariantIndex('space-1')).toBe(variant);
  });

  it('groups Task activity into the latest seven days', () => {
    const now = new Date('2026-08-27T12:00:00.000Z').getTime();
    const activity = buildSevenDayActivity(
      [
        { created_at: '2026-08-27T08:00:00.000Z' },
        { created_at: '2026-08-25T08:00:00.000Z' },
      ],
      now
    );

    expect(activity.map((day) => day.count)).toEqual([0, 0, 0, 0, 1, 0, 1]);
  });

  it('groups Task activity into the latest thirty days', () => {
    const now = new Date('2026-08-27T12:00:00.000Z').getTime();
    const activity = buildThirtyDayActivity(
      [
        { created_at: '2026-08-27T08:00:00.000Z' },
        { created_at: '2026-08-01T08:00:00.000Z' },
        { created_at: '2026-07-27T08:00:00.000Z' },
      ],
      now
    );

    expect(activity).toHaveLength(30);
    expect(activity.reduce((total, day) => total + day.count, 0)).toBe(2);
  });
});
