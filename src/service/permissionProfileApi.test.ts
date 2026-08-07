import { beforeEach, describe, expect, it, vi } from 'vitest';

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
} from './permissionProfileApi';

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

    await expect(getSpacePermissionProfile('space-1')).resolves.toEqual(
      updated
    );
    expect(fetchGetMock).not.toHaveBeenCalled();
  });
});
