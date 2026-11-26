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
import { getAppMenuPopupPosition } from '../../../../electron/main/windowChrome';

describe('application menu popup position', () => {
  it('opens at the anchor when the page is not zoomed', () => {
    expect(getAppMenuPopupPosition({ x: 8, y: 36 }, 1)).toEqual({
      x: 8,
      y: 36,
    });
  });

  it('converts CSS pixels to window DIPs when the page is zoomed', () => {
    expect(getAppMenuPopupPosition({ x: 8, y: 36 }, 1.25)).toEqual({
      x: 10,
      y: 45,
    });
    expect(getAppMenuPopupPosition({ x: 9.6, y: 36.4 }, 0.9)).toEqual({
      x: 9,
      y: 33,
    });
  });

  it('ignores an unusable zoom factor', () => {
    expect(getAppMenuPopupPosition({ x: 8, y: 36 }, 0)).toEqual({
      x: 8,
      y: 36,
    });
    expect(getAppMenuPopupPosition({ x: 8, y: 36 }, Number.NaN)).toEqual({
      x: 8,
      y: 36,
    });
  });
});
