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

import { fetchGet, fetchGetBlob, fetchPost } from '@/api/http';
import i18next from 'i18next';

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

export interface WorkspaceGitBranch {
  ref: string;
  oid: string;
  committed_at: number;
  subject: string;
  archived: boolean;
  project_id?: string | null;
  run_id?: string | null;
  agent_id?: string | null;
}

export interface WorkspaceGitCommit {
  oid: string;
  parent_oids: string[];
  author: string;
  committed_at: number;
  subject: string;
  kind: 'save_point' | 'merge' | 'checkpoint' | 'commit';
  initiated_by: 'user' | 'agent';
  actor_id?: string | null;
  trigger?: string | null;
}

export interface WorkspaceGitOperation {
  operation_id: string;
  kind: 'push';
  initiated_by: 'user';
  occurred_at: number;
  head_oid?: string | null;
  remote_name?: string | null;
}

export interface WorkspaceGitHistory {
  repository_id: string;
  repo_state_digest: string;
  branches: WorkspaceGitBranch[];
  commits: WorkspaceGitCommit[];
  operations: WorkspaceGitOperation[];
  remotes: string[];
  large_repository: {
    estimated_object_bytes: number;
    warning: boolean;
    lfs_recommended_for_blob_bytes: number;
    object_stats: Record<string, number>;
  };
  retention_policy: {
    undo_window_ms: number;
    archive_ref_retention_ms: number;
    project_archive_ref_retention_ms: number;
    automatic_archive_ref_deletion: boolean;
    automatic_object_gc: boolean;
  };
  backup: { configured: boolean; message: string };
}

export interface ProjectGitChangeFile {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  before_size: number | null;
  after_size: number | null;
  binary: boolean;
  added_lines: number | null;
  removed_lines: number | null;
}

export interface ProjectGitChanges {
  repository_id: string;
  project_id: string;
  base_commit: string | null;
  target_commit: string | null;
  files: ProjectGitChangeFile[];
  totals: { added: number; removed: number };
  truncated: boolean;
}

export interface ProjectGitChangeSide {
  content: string | null;
  size: number | null;
  binary: boolean;
  too_large: boolean;
}

export interface ProjectGitChangeContent {
  path: string;
  base_commit: string;
  target_commit: string;
  before: ProjectGitChangeSide;
  after: ProjectGitChangeSide;
}

export interface RunGitChanges extends ProjectGitChanges {
  run_id: string;
}

export interface RunGitChangesUnavailable {
  available: false;
  reason: 'run_git_not_materialized';
  run_id: string;
  project_id: string;
}

export interface RunGitChangeContent extends ProjectGitChangeContent {
  run_id: string;
  project_id: string;
}

export interface AdvancedGitPreview {
  classification: string;
  subcommand: string;
  safety_class: string;
  external_side_effect: boolean;
  risk_tags: string[];
  action_digest: string;
  effect: 'allow' | 'prompt' | 'deny';
  reason: string;
  requires_confirmation: boolean;
  display_argv: string[];
}

export interface AdvancedGitResult {
  classification: string;
  subcommand: string;
  action_digest: string;
  stdout: string;
  stderr: string;
  returncode: number;
  stdout_truncated: boolean;
  stderr_truncated: boolean;
  repo_state_digest: string;
  head_oid?: string | null;
  replayed: boolean;
  publish_scan?: {
    head_oid: string;
    remote_name: string;
    outgoing_object_count: number;
    outgoing_blob_count: number;
    largest_blob_bytes: number;
    scan_digest: string;
  };
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
    `/spaces/${encodeURIComponent(spaceId)}/git/status`,
    identityParams(identity)
  );

export const bootstrapWorkspaceGit = async (
  spaceId: string,
  identity: WorkspaceGitIdentity,
  allowInit: boolean,
  eigentOwnedSpace = false
): Promise<WorkspaceGitStatus> =>
  fetchPost(`/spaces/${encodeURIComponent(spaceId)}/git/bootstrap`, {
    ...identityParams(identity),
    allow_init: allowInit,
    eigent_owned_space: eigentOwnedSpace,
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
  fetchPost(`/spaces/${encodeURIComponent(spaceId)}/git/save-point`, {
    ...identityParams(identity),
    operation_request_id: input.operationRequestId,
    expected_repo_state_digest: input.expectedRepoStateDigest,
    actor_id: input.actorId,
    message:
      input.message ||
      i18next.t('layout.workspace-save-progress', {
        defaultValue: 'Save progress',
      }),
  });

export const fetchWorkspaceGitHistory = async (
  spaceId: string,
  identity: WorkspaceGitIdentity,
  limit = 50
): Promise<WorkspaceGitHistory> =>
  fetchGet(`/spaces/${encodeURIComponent(spaceId)}/git/history`, {
    ...identityParams(identity),
    limit,
  });

export const fetchProjectGitChanges = async (
  projectId: string,
  spaceId: string,
  identity: WorkspaceGitIdentity
): Promise<ProjectGitChanges> =>
  fetchGet(`/projects/${encodeURIComponent(projectId)}/git/changes`, {
    ...identityParams(identity),
    space_id: spaceId,
  });

export const fetchProjectGitChangeContent = async (
  projectId: string,
  spaceId: string,
  identity: WorkspaceGitIdentity,
  input: { path: string; baseCommit: string; targetCommit: string }
): Promise<ProjectGitChangeContent> =>
  fetchGet(`/projects/${encodeURIComponent(projectId)}/git/changes/content`, {
    ...identityParams(identity),
    space_id: spaceId,
    path: input.path,
    base_commit: input.baseCommit,
    target_commit: input.targetCommit,
  });

export const fetchProjectGitChangeBlob = async (
  projectId: string,
  spaceId: string,
  identity: WorkspaceGitIdentity,
  input: {
    path: string;
    side: 'before' | 'after';
    baseCommit: string;
    targetCommit: string;
  }
): Promise<Blob> =>
  fetchGetBlob(`/projects/${encodeURIComponent(projectId)}/git/changes/blob`, {
    ...identityParams(identity),
    space_id: spaceId,
    path: input.path,
    side: input.side,
    base_commit: input.baseCommit,
    target_commit: input.targetCommit,
  });

export const fetchRunGitChanges = async (
  runId: string,
  spaceId: string,
  identity: WorkspaceGitIdentity
): Promise<RunGitChanges | RunGitChangesUnavailable> =>
  fetchGet(`/runs/${encodeURIComponent(runId)}/git/changes`, {
    ...identityParams(identity),
    space_id: spaceId,
  });

export const fetchRunGitChangeContent = async (
  runId: string,
  spaceId: string,
  identity: WorkspaceGitIdentity,
  input: { path: string; baseCommit: string; targetCommit: string }
): Promise<RunGitChangeContent> =>
  fetchGet(`/runs/${encodeURIComponent(runId)}/git/changes/content`, {
    ...identityParams(identity),
    space_id: spaceId,
    path: input.path,
    base_commit: input.baseCommit,
    target_commit: input.targetCommit,
  });

export const fetchRunGitChangeBlob = async (
  runId: string,
  spaceId: string,
  identity: WorkspaceGitIdentity,
  input: {
    path: string;
    side: 'before' | 'after';
    baseCommit: string;
    targetCommit: string;
  }
): Promise<Blob> =>
  fetchGetBlob(`/runs/${encodeURIComponent(runId)}/git/changes/blob`, {
    ...identityParams(identity),
    space_id: spaceId,
    path: input.path,
    side: input.side,
    base_commit: input.baseCommit,
    target_commit: input.targetCommit,
  });

export const previewAdvancedGit = async (
  spaceId: string,
  identity: WorkspaceGitIdentity,
  input: { operationRequestId: string; argv: string[] }
): Promise<AdvancedGitPreview> =>
  fetchPost(`/spaces/${encodeURIComponent(spaceId)}/git/operations:preview`, {
    ...identityParams(identity),
    operation_request_id: input.operationRequestId,
    argv: input.argv,
  });

export const executeAdvancedGit = async (
  spaceId: string,
  identity: WorkspaceGitIdentity,
  input: {
    operationRequestId: string;
    argv: string[];
    expectedRepoStateDigest?: string | null;
    confirmedActionDigest?: string | null;
    actorId: string;
  }
): Promise<AdvancedGitResult> =>
  fetchPost(`/spaces/${encodeURIComponent(spaceId)}/git/operations`, {
    ...identityParams(identity),
    operation_request_id: input.operationRequestId,
    argv: input.argv,
    expected_repo_state_digest: input.expectedRepoStateDigest || null,
    confirmed_action_digest: input.confirmedActionDigest || null,
    actor_id: input.actorId,
  });
