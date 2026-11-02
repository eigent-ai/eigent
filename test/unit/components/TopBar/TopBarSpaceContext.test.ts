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

// Load the HTTP client first, as the app does at boot, so the auth store
// and i18n settle their import cycle in the same order.
import '@/api/http';

import { getTopBarSpaceContext } from '@/components/TopBar';
import { describe, expect, it } from 'vitest';

const base = {
  search: '',
  shellPlace: 'space' as const,
  activeWorkspaceTab: 'files' as const,
  activeSpaceId: 'space-a',
};

describe('getTopBarSpaceContext', () => {
  it('names the active Space in the Space view', () => {
    expect(getTopBarSpaceContext({ ...base, pathname: '/' })).toEqual({
      spaceId: 'space-a',
      inHome: false,
    });
  });

  it('names the Space of a Session open in Home, and none on New session', () => {
    expect(
      getTopBarSpaceContext({
        ...base,
        pathname: '/',
        shellPlace: 'home',
        activeWorkspaceTab: 'project',
      })
    ).toEqual({ spaceId: 'space-a', inHome: true });
    expect(
      getTopBarSpaceContext({
        ...base,
        pathname: '/',
        shellPlace: 'home',
        activeWorkspaceTab: 'new-project',
      })
    ).toBeNull();
  });

  it("names the Space whose Workspace page Home shows, even when it isn't active", () => {
    expect(
      getTopBarSpaceContext({
        ...base,
        pathname: '/home',
        search: '?section=spaces&spaceId=space-b',
      })
    ).toEqual({ spaceId: 'space-b', inHome: true });
    expect(
      getTopBarSpaceContext({
        ...base,
        pathname: '/home',
        search: '?section=spaces',
      })
    ).toBeNull();
  });

  it('names no Space in Settings', () => {
    expect(
      getTopBarSpaceContext({ ...base, pathname: '/settings' })
    ).toBeNull();
  });
});
