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

import { proxyFetchGet, proxyFetchPut } from '@/api/http';
import {
  fetchUserProfile,
  UnsupportedUserProfilePreferenceError,
  updateUserWorkRole,
} from '@/service/userProfileApi';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/http', () => ({
  proxyFetchGet: vi.fn(),
  proxyFetchPut: vi.fn(),
}));

const legacyProfile = {
  fullname: 'Existing user',
  nickname: '',
  work_desc: '',
};

describe('userProfileApi compatibility', () => {
  beforeEach(() => vi.clearAllMocks());

  it('treats a role omitted by an older server as unset while reading', async () => {
    vi.mocked(proxyFetchGet).mockResolvedValueOnce(legacyProfile);

    await expect(fetchUserProfile()).resolves.toMatchObject({
      workRoleKey: null,
    });
  });

  it('does not claim a preference write succeeded when an older server omits the field', async () => {
    vi.mocked(proxyFetchPut).mockResolvedValueOnce(legacyProfile);

    await expect(updateUserWorkRole('engineering')).rejects.toBeInstanceOf(
      UnsupportedUserProfilePreferenceError
    );
  });
});
