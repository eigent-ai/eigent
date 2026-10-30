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

import {
  DEFAULT_SPACE_OVERVIEW_LAYOUT,
  normalizeSpaceOverviewOrder,
  selectSpaceOverviewLayout,
  SPACE_OVERVIEW_BOXES,
  useSpaceOverviewStore,
} from '@/store/spaceOverviewStore';
import { describe, expect, it } from 'vitest';

describe('Space overview box order', () => {
  it('saves a layout per Space, ignoring unknown ids', () => {
    useSpaceOverviewStore.setState({ layouts: {} });
    useSpaceOverviewStore.getState().saveLayout('space-1', {
      order: ['dispatch', 'files'],
      hiddenBoxes: ['sessions', 'retired-box' as never],
    });
    const state = useSpaceOverviewStore.getState();

    expect(selectSpaceOverviewLayout('space-1')(state)).toEqual({
      order: [
        'dispatch',
        'files',
        ...SPACE_OVERVIEW_BOXES.filter(
          (box) => box !== 'dispatch' && box !== 'files'
        ),
      ],
      hiddenBoxes: ['sessions'],
    });
    expect(selectSpaceOverviewLayout('space-2')(state)).toBe(
      DEFAULT_SPACE_OVERVIEW_LAYOUT
    );
  });

  it('includes every box once, adding new boxes after a saved order', () => {
    expect(
      normalizeSpaceOverviewOrder(['dispatch', 'retired-box', 'dispatch'])
    ).toEqual([
      'dispatch',
      ...SPACE_OVERVIEW_BOXES.filter((box) => box !== 'dispatch'),
    ]);
  });

  it('starts every Space with Version history hidden', () => {
    expect(DEFAULT_SPACE_OVERVIEW_LAYOUT).toEqual({
      order: [...SPACE_OVERVIEW_BOXES],
      hiddenBoxes: ['versionHistory'],
    });
  });
});
