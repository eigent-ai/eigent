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
  RIGHT_RAIL_CONTENT_WIDTH_CLASS,
  RIGHT_RAIL_EXPANDED_OUTER_CLASS,
  RIGHT_RAIL_FOLDED_OUTER_CLASS,
} from '@/components/Layout/rightRail';
import {
  SESSION_SIDE_PANEL_CONTENT_WIDTH_CLASS,
  SESSION_SIDE_PANEL_EXPANDED_OUTER_CLASS,
  SESSION_SIDE_PANEL_FOLDED_OUTER_CLASS,
} from '@/components/Session/SidePanel/layout';
import { describe, expect, it } from 'vitest';

describe('right rail layout', () => {
  it('preserves the Session rail width contract through compatibility aliases', () => {
    expect(RIGHT_RAIL_CONTENT_WIDTH_CLASS).toBe(
      'w-[min(360px,40vw)] max-w-[400px]'
    );
    expect(RIGHT_RAIL_EXPANDED_OUTER_CLASS).toBe(
      RIGHT_RAIL_CONTENT_WIDTH_CLASS
    );
    expect(RIGHT_RAIL_FOLDED_OUTER_CLASS).toBe('w-[40px]');

    expect(SESSION_SIDE_PANEL_CONTENT_WIDTH_CLASS).toBe(
      RIGHT_RAIL_CONTENT_WIDTH_CLASS
    );
    expect(SESSION_SIDE_PANEL_EXPANDED_OUTER_CLASS).toBe(
      RIGHT_RAIL_EXPANDED_OUTER_CLASS
    );
    expect(SESSION_SIDE_PANEL_FOLDED_OUTER_CLASS).toBe(
      RIGHT_RAIL_FOLDED_OUTER_CLASS
    );
  });
});
