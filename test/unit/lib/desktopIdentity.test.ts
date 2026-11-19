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

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  electronAPI: null as null | {
    getDesktopInstanceId: ReturnType<typeof vi.fn>;
  },
}));

vi.mock('@/host/createHost', () => ({
  createHost: () => ({ electronAPI: mocked.electronAPI }),
}));

import {
  __desktopIdentityTestHooks,
  getDesktopInstanceId,
} from '@/lib/desktopIdentity';

describe('desktop identity ownership', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocked.electronAPI = null;
    __desktopIdentityTestHooks.reset();
  });

  it('does not mint a device identity in an ordinary browser', async () => {
    await expect(getDesktopInstanceId()).resolves.toBe('');
    expect(
      window.localStorage.getItem('eigent_desktop_instance_id')
    ).toBeNull();
  });

  it('coalesces concurrent renderer reads through the main process', async () => {
    window.localStorage.setItem(
      'eigent_desktop_instance_id',
      'desk_legacyrendereridentity1234'
    );
    const getIdentity = vi.fn(async () => {
      await Promise.resolve();
      return 'desk_mainprocessidentity123456';
    });
    mocked.electronAPI = { getDesktopInstanceId: getIdentity };

    const identities = await Promise.all([
      getDesktopInstanceId(),
      getDesktopInstanceId(),
      getDesktopInstanceId(),
    ]);

    expect(identities).toEqual([
      'desk_mainprocessidentity123456',
      'desk_mainprocessidentity123456',
      'desk_mainprocessidentity123456',
    ]);
    expect(getIdentity).toHaveBeenCalledOnce();
    expect(getIdentity).toHaveBeenCalledWith('desk_legacyrendereridentity1234');
  });
});
