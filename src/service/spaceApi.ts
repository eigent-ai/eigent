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
  proxyFetchDelete,
  proxyFetchGet,
  proxyFetchPatch,
  proxyFetchPost,
} from '@/api/http';
import type {
  ProjectMode,
  ProjectWorkdirMode,
} from '@/store/projectRuntimeStore';
import type { Space, SpaceSourceType, SpaceStatus } from '@/store/spaceStore';

export interface SpacePayload {
  id?: string;
  name: string;
  description?: string;
  source_type?: SpaceSourceType;
  status?: SpaceStatus;
  root_path?: string | null;
  root_fingerprint?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

export interface SpaceRelocatePayload {
  root_path: string;
  force?: boolean;
}

export interface ApplyResolutionPayload {
  path: string;
  action?: 'apply_mine' | 'keep_theirs' | 'write_chosen';
  content_ref?: string | null;
  hash?: string | null;
}

export interface SpaceProjectApplyPayload {
  run_id: string;
  paths?: string[] | null;
  force_resolutions?: ApplyResolutionPayload[] | null;
}

export interface SpaceOverlay {
  id: number;
  space_id: string;
  project_id: string;
  run_id: string;
  path: string;
  status: 'added' | 'modified' | 'deleted';
  hash?: string | null;
  base_hash?: string | null;
  base_snapshot_id?: string | null;
  size?: number | null;
  mode?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface SpaceOverlayListResponse {
  space_id: string;
  project_id: string;
  overlays: SpaceOverlay[];
}

export interface SpaceOverlayDiscardPayload {
  run_id?: string | null;
  paths?: string[] | null;
}

export interface SpaceOverlayDiscardResponse {
  space_id: string;
  project_id: string;
  discarded: number;
  run_ids: string[];
}

export interface SpaceProjectRefreshPayload {
  force?: boolean;
}

export interface SpaceProjectRefreshResponse {
  kind: 'refreshed';
  space_id: string;
  project_id: string;
  base_snapshot_id: string;
}

export interface SpaceProjectApplyResponse {
  kind: 'success' | 'partial' | 'conflict';
  space_id: string;
  project_id: string;
  run_id: string;
  applied: Array<{ path: string; status: string; hash?: string | null }>;
  failed: Array<{ path: string; reason: string; message: string }>;
  conflicts: Array<{
    path: string;
    status: string;
    base_hash?: string | null;
    current_hash?: string | null;
    mine_hash?: string | null;
    message: string;
  }>;
  warnings: Array<{ code: string; message: string; path?: string | null }>;
}

export interface ServerSpace {
  id: string;
  user_id: string;
  name: string;
  description?: string | null;
  source_type: SpaceSourceType;
  root_path?: string | null;
  root_fingerprint?: Record<string, unknown> | null;
  status: 'active' | 'disconnected' | 'archived';
  schema_version: number;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ProjectPayload {
  id?: string;
  name: string;
  description?: string;
  mode?: ProjectMode | null;
  status?: 'active' | 'archived';
  workdir_mode?: ProjectWorkdirMode | null;
  metadata?: Record<string, unknown> | null;
}

export interface ServerProject {
  id: string;
  user_id: string;
  space_id: string;
  name: string;
  description?: string | null;
  mode?: ProjectMode | null;
  status: 'active' | 'archived';
  workdir_mode?: ProjectWorkdirMode | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
}

const timestampFromServer = (value?: string | null) =>
  value ? new Date(value).getTime() : Date.now();

export const toLocalSpace = (space: ServerSpace): Space => ({
  id: space.id,
  name: space.name,
  description: space.description ?? undefined,
  userId: space.user_id,
  sourceType: space.source_type,
  rootPath: space.root_path ?? null,
  rootFingerprint: space.root_fingerprint ?? null,
  status: space.status,
  schemaVersion: space.schema_version,
  createdAt: timestampFromServer(space.created_at),
  updatedAt: timestampFromServer(space.updated_at),
  metadata: space.metadata ?? undefined,
});

export const proxyFetchSpaces = async (): Promise<Space[]> => {
  const spaces = await proxyFetchGet('/api/v1/spaces');
  return (spaces as ServerSpace[]).map(toLocalSpace);
};

export const proxyEnsureLegacySpace = async (): Promise<Space> => {
  const space = await proxyFetchPost('/api/v1/spaces/legacy', {});
  return toLocalSpace(space as ServerSpace);
};

export const proxyCreateSpace = async (
  payload: SpacePayload
): Promise<Space> => {
  const space = await proxyFetchPost('/api/v1/spaces', payload);
  return toLocalSpace(space as ServerSpace);
};

export const proxyUpdateSpace = async (
  spaceId: string,
  payload: Partial<SpacePayload>
): Promise<Space> => {
  const space = await proxyFetchPatch(`/api/v1/spaces/${spaceId}`, payload);
  return toLocalSpace(space as ServerSpace);
};

export const proxyFetchSpaceProjects = async (
  spaceId: string
): Promise<ServerProject[]> => {
  const projects = await proxyFetchGet(`/api/v1/spaces/${spaceId}/projects`);
  return projects;
};

export const proxyCreateSpaceProject = async (
  spaceId: string,
  payload: ProjectPayload
): Promise<ServerProject> => {
  const project = await proxyFetchPost(
    `/api/v1/spaces/${spaceId}/projects`,
    payload
  );
  return project;
};

export const proxyUpdateSpaceProject = async (
  spaceId: string,
  projectId: string,
  payload: Partial<ProjectPayload>
): Promise<ServerProject> => {
  const project = await proxyFetchPatch(
    `/api/v1/spaces/${spaceId}/projects/${projectId}`,
    payload
  );
  return project;
};

export const proxyFetchSpace = async (spaceId: string): Promise<Space> => {
  const space = await proxyFetchGet(`/api/v1/spaces/${spaceId}`);
  return toLocalSpace(space as ServerSpace);
};

export const proxyDeleteSpace = async (spaceId: string): Promise<void> => {
  await proxyFetchDelete(`/api/v1/spaces/${spaceId}`);
};

export const proxyArchiveSpace = async (spaceId: string): Promise<Space> =>
  toLocalSpace(
    (await proxyFetchPost(
      `/api/v1/spaces/${spaceId}/archive`,
      {}
    )) as ServerSpace
  );

export const proxyUnarchiveSpace = async (spaceId: string): Promise<Space> =>
  toLocalSpace(
    (await proxyFetchPost(
      `/api/v1/spaces/${spaceId}/unarchive`,
      {}
    )) as ServerSpace
  );

export const proxyRelocateSpace = async (
  spaceId: string,
  payload: SpaceRelocatePayload
): Promise<Space> =>
  toLocalSpace(
    (await proxyFetchPost(
      `/api/v1/spaces/${spaceId}/relocate`,
      payload
    )) as ServerSpace
  );

export const proxyPromoteSpaceProject = async (
  spaceId: string,
  projectId: string
): Promise<ServerProject> =>
  (await proxyFetchPost(
    `/api/v1/spaces/${spaceId}/projects/${projectId}/promote`,
    {}
  )) as ServerProject;

export const proxyApplySpaceProjectRun = async (
  spaceId: string,
  projectId: string,
  payload: SpaceProjectApplyPayload
): Promise<SpaceProjectApplyResponse> =>
  (await proxyFetchPost(
    `/api/v1/spaces/${spaceId}/projects/${projectId}/apply`,
    payload
  )) as SpaceProjectApplyResponse;

export const proxyFetchSpaceProjectOverlays = async (
  spaceId: string,
  projectId: string,
  runId?: string | null
): Promise<SpaceOverlayListResponse> =>
  (await proxyFetchGet(
    `/api/v1/spaces/${spaceId}/projects/${projectId}/overlays`,
    runId ? { run_id: runId } : undefined
  )) as SpaceOverlayListResponse;

export const proxyDiscardSpaceProjectOverlays = async (
  spaceId: string,
  projectId: string,
  payload: SpaceOverlayDiscardPayload
): Promise<SpaceOverlayDiscardResponse> =>
  (await proxyFetchPost(
    `/api/v1/spaces/${spaceId}/projects/${projectId}/discard`,
    payload
  )) as SpaceOverlayDiscardResponse;

export const proxyRefreshSpaceProject = async (
  spaceId: string,
  projectId: string,
  payload: SpaceProjectRefreshPayload = {}
): Promise<SpaceProjectRefreshResponse> =>
  (await proxyFetchPost(
    `/api/v1/spaces/${spaceId}/projects/${projectId}/refresh`,
    payload
  )) as SpaceProjectRefreshResponse;
