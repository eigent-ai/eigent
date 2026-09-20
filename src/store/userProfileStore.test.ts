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

import { fetchUserProfile, updateUserWorkRole } from '@/service/userProfileApi';
import { useUserProfileStore } from '@/store/userProfileStore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/service/userProfileApi', () => ({
  fetchUserProfile: vi.fn(),
  updateUserWorkRole: vi.fn(),
  UnsupportedUserProfilePreferenceError: class extends Error {},
}));

const profile = (role: 'engineering' | 'design') => ({
  fullname: '',
  nickname: '',
  workDescription: '',
  workRoleKey: role,
});

describe('userProfileStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUserProfileStore.getState().reset();
  });

  it('ignores a profile response from a previous account context', async () => {
    let resolveFirst!: (value: ReturnType<typeof profile>) => void;
    let resolveSecond!: (value: ReturnType<typeof profile>) => void;
    vi.mocked(fetchUserProfile)
      .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
      .mockReturnValueOnce(new Promise((resolve) => (resolveSecond = resolve)));

    const first = useUserProfileStore.getState().hydrate('account-1');
    const second = useUserProfileStore.getState().hydrate('account-2');
    resolveSecond(profile('design'));
    await second;
    resolveFirst(profile('engineering'));
    await first;

    expect(useUserProfileStore.getState().accountKey).toBe('account-2');
    expect(useUserProfileStore.getState().profile?.workRoleKey).toBe('design');
  });

  it('classifies preference writes rejected by an older server as unsupported', async () => {
    const error = Object.assign(new Error('Unknown field'), { status: 422 });
    vi.mocked(updateUserWorkRole).mockRejectedValueOnce(error);

    const result = await useUserProfileStore
      .getState()
      .saveWorkRole('account-1', 'engineering');

    expect(result).toEqual({ saved: false, reason: 'unsupported', error });
  });
});
