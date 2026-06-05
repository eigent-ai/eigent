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

import { fetchDelete, fetchGet, fetchPost } from '@/api/http';

export interface WorkspaceCapabilities {
  binding_enabled?: boolean;
  binding_owner?: 'space';
  binding_persistence?: 'brain_local' | 'none';
  deployment?: string;
  filesystem?: string;
  label?: string;
  mode?: string;
  workspace_root?: string;
  [key: string]: unknown;
}

export interface WorkspaceBinding {
  space_id: string;
  workspace_root: string;
  source: string;
  created_at: string;
  updated_at: string;
  root_fingerprint?: Record<string, unknown> | null;
  version: number;
}

export interface WorkspaceCurrent {
  space_id: string;
  email: string;
  user_id?: string | number | null;
  bound: boolean;
  workspace_root?: string | null;
  binding?: WorkspaceBinding | null;
}

export interface WorkspaceBindPayload {
  space_id: string;
  email: string;
  user_id?: string | number | null;
  path: string;
}

export interface WorkspaceScratchPayload {
  space_id: string;
  email: string;
  user_id?: string | number | null;
}

export interface WorkspaceReconcileResult {
  email: string;
  user_id?: string | number | null;
  active_space_ids: string[];
  removed_space_ids: string[];
  removed_count: number;
}

export interface WorkspaceProjectRefreshResult {
  space_id: string;
  project_id: string;
  base_snapshot_id: string;
}

export interface WorkspaceProjectRefreshPayload {
  email: string;
  userId?: string | number | null;
  force?: boolean;
  serverRefreshConfirmed: true;
}

export const fetchWorkspaceCapabilities =
  async (): Promise<WorkspaceCapabilities> =>
    fetchGet('/workspace/capabilities');

export const fetchWorkspaceCurrent = async (
  spaceId: string,
  email: string,
  userId?: string | number | null
): Promise<WorkspaceCurrent> =>
  fetchGet('/workspace/current', {
    space_id: spaceId,
    email,
    ...(userId === undefined || userId === null ? {} : { user_id: userId }),
  });

export const bindWorkspaceToSpace = async (
  payload: WorkspaceBindPayload
): Promise<WorkspaceCurrent> => fetchPost('/workspace/bind', payload);

export const createScratchWorkspaceForSpace = async (
  payload: WorkspaceScratchPayload
): Promise<WorkspaceCurrent> => fetchPost('/workspace/scratch', payload);

export const unbindWorkspaceFromBrain = async (
  spaceId: string,
  email: string,
  userId?: string | number | null
): Promise<WorkspaceCurrent> =>
  fetchDelete(
    `/workspace/${encodeURIComponent(spaceId)}?email=${encodeURIComponent(email)}${
      userId === undefined || userId === null
        ? ''
        : `&user_id=${encodeURIComponent(String(userId))}`
    }`
  );

export const reconcileWorkspaceBindings = async (
  email: string,
  activeSpaceIds: string[],
  userId?: string | number | null
): Promise<WorkspaceReconcileResult> =>
  fetchPost('/workspace/reconcile', {
    email,
    ...(userId === undefined || userId === null ? {} : { user_id: userId }),
    active_space_ids: activeSpaceIds,
  });

export const refreshWorkspaceProject = async (
  spaceId: string,
  projectId: string,
  payload: WorkspaceProjectRefreshPayload
): Promise<WorkspaceProjectRefreshResult> =>
  fetchPost(
    `/workspace/${encodeURIComponent(spaceId)}/projects/${encodeURIComponent(projectId)}/refresh`,
    {
      email: payload.email,
      ...(payload.userId === undefined || payload.userId === null
        ? {}
        : { user_id: payload.userId }),
      force: payload.force ?? false,
      server_refresh_confirmed: payload.serverRefreshConfirmed,
    }
  );
