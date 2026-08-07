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

import { fetchGet, fetchPost } from '@/api/http';

export interface WorkspaceGitRepoState {
  head_oid: string | null;
  branch_or_detached_head: string;
  index_digest: string;
  operation_state: string;
  digest: string;
}

export interface WorkspaceGitStatus {
  space_id: string;
  enabled: boolean;
  enablement?: string;
  consent_required?: boolean;
  existing_repository?: boolean;
  repository_id?: string;
  state?: string;
  ownership?: string;
  version_coverage?: string;
  managed_paths?: string[];
  pending_managed_paths?: string[];
  pending_managed_paths_truncated?: boolean;
  diagnostics?: {
    healthy: boolean;
    issues: string[];
    repo_state: WorkspaceGitRepoState;
  } | null;
}

export interface WorkspaceGitIdentity {
  email: string;
  userId?: string | number | null;
}

export interface WorkspaceSavePointResult {
  checkpoint_id: string;
  repository_id: string;
  commit_oid: string;
  parent_oid: string | null;
  paths: string[];
  remaining_managed_changes: boolean;
  created_at: number;
}

const identityParams = (identity: WorkspaceGitIdentity) => ({
  email: identity.email,
  ...(identity.userId === undefined || identity.userId === null
    ? {}
    : { user_id: identity.userId }),
});

export const fetchWorkspaceGitStatus = async (
  spaceId: string,
  identity: WorkspaceGitIdentity
): Promise<WorkspaceGitStatus> =>
  fetchGet(
    `/api/v1/spaces/${encodeURIComponent(spaceId)}/git/status`,
    identityParams(identity)
  );

export const bootstrapWorkspaceGit = async (
  spaceId: string,
  identity: WorkspaceGitIdentity,
  allowInit: boolean
): Promise<WorkspaceGitStatus> =>
  fetchPost(`/api/v1/spaces/${encodeURIComponent(spaceId)}/git/bootstrap`, {
    ...identityParams(identity),
    allow_init: allowInit,
    eigent_owned_space: false,
  });

export const createWorkspaceSavePoint = async (
  spaceId: string,
  identity: WorkspaceGitIdentity,
  input: {
    operationRequestId: string;
    expectedRepoStateDigest: string;
    actorId: string;
    message?: string;
  }
): Promise<WorkspaceSavePointResult> =>
  fetchPost(`/api/v1/spaces/${encodeURIComponent(spaceId)}/git/save-point`, {
    ...identityParams(identity),
    operation_request_id: input.operationRequestId,
    expected_repo_state_digest: input.expectedRepoStateDigest,
    actor_id: input.actorId,
    message: input.message || 'Save progress',
  });
