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
  getWindowsTitleBarOverlay,
  isWindowChromeTheme,
} from '@/shared/windowChrome';
import { describe, expect, it } from 'vitest';

describe('Windows title bar overlay', () => {
  it('uses the app header as its surface and keeps symbols theme-aware', () => {
    expect(getWindowsTitleBarOverlay('light')).toEqual({
      color: '#00000000',
      symbolColor: '#1e1e1e',
      height: 40,
    });
    expect(getWindowsTitleBarOverlay('dark')).toEqual({
      color: '#00000000',
      symbolColor: '#ffffff',
      height: 40,
    });
  });

  it('accepts only supported theme messages', () => {
    expect(isWindowChromeTheme('light')).toBe(true);
    expect(isWindowChromeTheme('dark')).toBe(true);
    expect(isWindowChromeTheme('system')).toBe(false);
    expect(isWindowChromeTheme(null)).toBe(false);
  });
});
