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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchGetMock, fetchPutMock } = vi.hoisted(() => ({
  fetchGetMock: vi.fn(),
  fetchPutMock: vi.fn(),
}));

vi.mock('@/api/http', () => ({
  fetchGet: fetchGetMock,
  fetchPut: fetchPutMock,
}));

import {
  __permissionProfileApiTestHooks,
  getSpacePermissionProfile,
  putSpacePermissionProfile,
} from '@/service/permissionProfileApi';

const profile = {
  space_id: 'space-1',
  profile_name: 'request_approval' as const,
  sandbox_mode: 'workspace-write',
  approval_mode: 'on-request',
  reviewer_mode: 'user',
  revision: 1,
  updated_by: 'user-1',
  created_at: 1,
  updated_at: 1,
};

describe('permission profile API cache', () => {
  beforeEach(() => {
    __permissionProfileApiTestHooks.reset();
    fetchGetMock.mockReset();
    fetchPutMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('deduplicates concurrent and repeated Space reads', async () => {
    fetchGetMock.mockResolvedValue(profile);

    const first = getSpacePermissionProfile('space-1');
    const second = getSpacePermissionProfile('space-1');

    await expect(first).resolves.toEqual(profile);
    await expect(second).resolves.toEqual(profile);
    await expect(getSpacePermissionProfile('space-1')).resolves.toEqual(
      profile
    );
    expect(fetchGetMock).toHaveBeenCalledTimes(1);
    expect(fetchGetMock).toHaveBeenCalledWith(
      '/spaces/space-1/permission-profile'
    );
  });

  it('updates the cache after a durable profile mutation', async () => {
    const updated = {
      ...profile,
      profile_name: 'read_only' as const,
      revision: 2,
    };
    fetchPutMock.mockResolvedValue(updated);

    await putSpacePermissionProfile('space-1', {
      profileName: 'read_only',
      requestId: 'request-1',
      updatedBy: 'user-1',
      expectedRevision: 1,
    });

    expect(fetchPutMock).toHaveBeenCalledWith(
      '/spaces/space-1/permission-profile',
      {
        profile_name: 'read_only',
        request_id: 'request-1',
        updated_by: 'user-1',
        expected_revision: 1,
      }
    );

    await expect(getSpacePermissionProfile('space-1')).resolves.toEqual(
      updated
    );
    expect(fetchGetMock).not.toHaveBeenCalled();
  });

  it('backs off a failed Space read across remount-style retries', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T00:00:00Z'));
    const unavailable = new Error('Brain unavailable');
    fetchGetMock.mockRejectedValueOnce(unavailable);

    await expect(getSpacePermissionProfile('space-1')).rejects.toBe(
      unavailable
    );
    await expect(getSpacePermissionProfile('space-1')).rejects.toBe(
      unavailable
    );
    await expect(
      getSpacePermissionProfile('space-1', { refresh: true })
    ).rejects.toBe(unavailable);
    expect(fetchGetMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(
      __permissionProfileApiTestHooks.failureBackoffMs + 1
    );
    fetchGetMock.mockResolvedValueOnce(profile);
    await expect(getSpacePermissionProfile('space-1')).resolves.toEqual(
      profile
    );
    expect(fetchGetMock).toHaveBeenCalledTimes(2);
  });
});
