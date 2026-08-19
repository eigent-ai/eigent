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

import { isSettingsRoutePath } from '@/lib/shellRoutes';
import { describe, expect, it } from 'vitest';

describe('isSettingsRoutePath', () => {
  it.each(['/home', '/home/', '/Home', '/settings', '/settings/', '/Settings'])(
    'matches the Home management route for %s',
    (pathname) => {
      expect(isSettingsRoutePath(pathname)).toBe(true);
    }
  );

  it.each(['/', '/home/spaces', '/settings/models'])(
    'rejects %s',
    (pathname) => {
      expect(isSettingsRoutePath(pathname)).toBe(false);
    }
  );
});
