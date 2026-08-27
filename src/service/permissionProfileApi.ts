import { fetchGet, fetchPut } from '@/api/http';

export type PermissionProfileName =
  | 'read_only'
  | 'request_approval'
  | 'auto_reviewer'
  | 'full_access';

export interface SpacePermissionProfile {
  space_id: string;
  profile_name: PermissionProfileName;
  sandbox_mode: string;
  approval_mode: string;
  reviewer_mode: string;
  revision: number;
  updated_by: string;
  created_at: number | null;
  updated_at: number | null;
}

const profileCache = new Map<string, SpacePermissionProfile>();
const profileRequests = new Map<string, Promise<SpacePermissionProfile>>();

export const getSpacePermissionProfile = (
  spaceId: string,
  options: { refresh?: boolean } = {}
): Promise<SpacePermissionProfile> => {
  if (!options.refresh) {
    const cached = profileCache.get(spaceId);
    if (cached) return Promise.resolve(cached);
    const pending = profileRequests.get(spaceId);
    if (pending) return pending;
  }
  const request = fetchGet(
    `/api/v1/spaces/${encodeURIComponent(spaceId)}/permission-profile`
  ).then((profile: SpacePermissionProfile) => {
    profileCache.set(spaceId, profile);
    profileRequests.delete(spaceId);
    return profile;
  });
  profileRequests.set(spaceId, request);
  void request.catch(() => profileRequests.delete(spaceId));
  return request;
};

export const putSpacePermissionProfile = (
  spaceId: string,
  input: {
    profileName: PermissionProfileName;
    requestId: string;
    updatedBy: string;
    expectedRevision: number;
  }
): Promise<SpacePermissionProfile> =>
  fetchPut(`/api/v1/spaces/${encodeURIComponent(spaceId)}/permission-profile`, {
    profile_name: input.profileName,
    request_id: input.requestId,
    updated_by: input.updatedBy,
    expected_revision: input.expectedRevision,
  }).then((profile: SpacePermissionProfile) => {
    profileCache.set(spaceId, profile);
    return profile;
  });

export const __permissionProfileApiTestHooks = {
  reset() {
    profileCache.clear();
    profileRequests.clear();
  },
};
