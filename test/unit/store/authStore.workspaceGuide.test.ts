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
  resolveWorkspaceGuideAudience,
  sanitizeDismissedWorkspaceGuideTabs,
} from '@/store/workspaceGuidePreferences';
import { describe, expect, it } from 'vitest';

describe('Workspace guide persistence', () => {
  it('classifies only an unfinished fresh launch as a new user', () => {
    expect(
      resolveWorkspaceGuideAudience({
        isFirstLaunch: true,
        onboardingCompleted: false,
      })
    ).toBe('new');
    expect(
      resolveWorkspaceGuideAudience({
        isFirstLaunch: false,
        onboardingCompleted: true,
      })
    ).toBe('existing');
  });

  it('preserves a previously assigned audience', () => {
    expect(
      resolveWorkspaceGuideAudience({
        workspaceGuideAudience: 'existing',
        isFirstLaunch: true,
        onboardingCompleted: false,
      })
    ).toBe('existing');
  });

  it('keeps only supported, unique dismissed tab identifiers', () => {
    expect(
      sanitizeDismissedWorkspaceGuideTabs([
        'primary',
        'invalid',
        'connect-tools',
        'primary',
      ])
    ).toEqual(['primary', 'connect-tools']);
  });
});
