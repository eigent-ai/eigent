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
import { WORK_ROLE_KEYS, type WorkRoleKey } from '@/types/exampleContent';

export interface UserProfile {
  fullname: string;
  nickname: string;
  workDescription: string;
  workRoleKey: WorkRoleKey | null;
}

export class UnsupportedUserProfilePreferenceError extends Error {
  readonly code = 'unsupported-user-profile-preference';
}

const isWorkRoleKey = (value: unknown): value is WorkRoleKey =>
  typeof value === 'string' &&
  (WORK_ROLE_KEYS as readonly string[]).includes(value);

const parseProfile = (value: unknown): UserProfile => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid user profile response');
  }
  const profile = value as Record<string, unknown>;
  const role = profile.work_role_key;
  if (role !== null && role !== undefined && !isWorkRoleKey(role)) {
    throw new Error('User profile contains an unsupported work role');
  }
  return {
    fullname: typeof profile.fullname === 'string' ? profile.fullname : '',
    nickname: typeof profile.nickname === 'string' ? profile.nickname : '',
    workDescription:
      typeof profile.work_desc === 'string' ? profile.work_desc : '',
    workRoleKey: role ?? null,
  };
};

export async function fetchUserProfile(
  signal?: AbortSignal
): Promise<UserProfile> {
  return parseProfile(
    await proxyFetchGet('/api/v1/user', undefined, undefined, { signal })
  );
}

export async function updateUserWorkRole(
  workRoleKey: WorkRoleKey | null
): Promise<UserProfile> {
  const response = await proxyFetchPut('/api/v1/user/profile', {
    work_role_key: workRoleKey,
  });
  if (
    typeof response !== 'object' ||
    response === null ||
    !Object.prototype.hasOwnProperty.call(response, 'work_role_key')
  ) {
    throw new UnsupportedUserProfilePreferenceError(
      'The connected server did not confirm the work-role preference.'
    );
  }
  return parseProfile(response);
}
