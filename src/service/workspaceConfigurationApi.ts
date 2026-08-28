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

import { fetchGet, fetchPost, fetchPostForm, fetchPut } from '@/api/http';

export type ThinkingEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface WorkspaceConfigurationIdentity {
  email: string;
  userId?: string | number | null;
}

export interface WorkspaceContextSource {
  id: string;
  kind:
    | 'bundle_asset'
    | 'inline'
    | 'connection_query'
    | 'local_path_slot'
    | 'artifact_ref'
    | 'memory_scope';
  slot?: string;
  path?: string;
  content?: string;
  query?: Record<string, unknown>;
  sharing?: 'bundled' | 'reference_only' | 'authorized_artifact';
}

export interface WorkspaceSkillAssignment {
  ref: string;
  assignTo: string[];
}

export interface WorkspaceConnectorRequirement {
  id: string;
  connector: string;
  connectionSlot: string;
  requiredGrants: string[];
}

export interface WorkspaceMcpRequirement {
  id: string;
  definition: string;
  secretSlots: string[];
  assignTo: string[];
}

export interface WorkspaceEnvironmentVariableRequirement {
  name: string;
  required: boolean;
  sensitive: boolean;
  description?: string;
  example?: string;
}

export interface WorkspaceAgentProfile {
  id: string;
  role: string;
  modelProfile: string;
}

export interface WorkspaceConfigurationDocument {
  apiVersion: 'eigent.ai/v1alpha1';
  kind: 'WorkspaceBundle';
  metadata: {
    id: string;
    name: string;
    revision: number;
  };
  spec: {
    instructions: Record<string, string>;
    context: WorkspaceContextSource[];
    skills: WorkspaceSkillAssignment[];
    connectors: WorkspaceConnectorRequirement[];
    mcpServers: WorkspaceMcpRequirement[];
    environment?: {
      variables: WorkspaceEnvironmentVariableRequirement[];
    };
    agents: WorkspaceAgentProfile[];
    models: Record<
      string,
      { modelRef: string; thinkingEffort: ThinkingEffort }
    >;
    permissions: {
      profile:
        'request_approval' | 'auto_review' | 'workspace_write' | 'full_access';
      rules: Array<{ action: string; effect: 'allow' | 'prompt' | 'deny' }>;
    };
    git: {
      enabled: boolean;
      checkpointPolicy: string;
      agentIsolation: 'worktree';
      remotePolicy: 'deny' | 'prompt' | 'allow';
    };
  };
}

export interface WorkspaceConfigurationDraft {
  space_id: string;
  version: number;
  base_revision_id: string | null;
  document: WorkspaceConfigurationDocument;
  document_digest: string;
  persisted: boolean;
  updated_at: number | null;
}

export const workspaceEnvironmentVariables = (
  document: WorkspaceConfigurationDocument
): WorkspaceEnvironmentVariableRequirement[] =>
  document.spec.environment?.variables ?? [];

export interface WorkspaceConfigurationSaveReview {
  slug: string;
  version: number;
  manifest_digest: string;
  name: string;
  review_digest: string;
  summary: {
    instructions: number;
    context_sources: number;
    skills: number;
    connectors: number;
    mcp_servers: number;
    agents: number;
  };
  requirements: {
    environment_variables: WorkspaceEnvironmentVariableRequirement[];
    suggested_environment_variables: WorkspaceEnvironmentVariableRequirement[];
    suggested_mcp_secret_slots: Array<{
      mcp_id: string;
      secret_slots: string[];
    }>;
    secret_slots: string[];
    connector_slots: Array<{
      slot_id: string;
      connector_id: string;
      required_grants: string[];
    }>;
    local_path_slots: string[];
  };
  assets: string[];
  prepared_assets: WorkspaceConfigurationPreparedAsset[];
  warnings: Array<{ code: string; message: string }>;
  local_values_excluded: number;
}

export interface WorkspaceConfigurationReviewResponse {
  space_id: string;
  draft_version: number;
  review: WorkspaceConfigurationSaveReview;
}

export interface WorkspaceConfigurationAssetPreflight {
  logical_path: string;
  content_digest: string;
  size_bytes: number;
}

export interface WorkspaceConfigurationPreparedAsset {
  logical_path: string;
  content_digest: string;
  media_type: string;
  size_bytes: number;
  executable: boolean;
  provenance: 'agent_plugin_import';
}

export interface WorkspaceConfigurationPreparedAssetPreflight {
  space_id: string;
  draft_version: number;
  manifest_digest: string;
  review_digest: string;
  assets: WorkspaceConfigurationPreparedAsset[];
}

const identityParams = (identity: WorkspaceConfigurationIdentity) => ({
  email: identity.email,
  ...(identity.userId === undefined || identity.userId === null
    ? {}
    : { user_id: identity.userId }),
});

export const fetchWorkspaceConfiguration = async (
  spaceId: string,
  identity: WorkspaceConfigurationIdentity,
  name?: string
): Promise<WorkspaceConfigurationDraft> =>
  fetchGet(`/spaces/${encodeURIComponent(spaceId)}/workspace-configuration`, {
    ...identityParams(identity),
    ...(name ? { name } : {}),
  });

export const saveWorkspaceConfiguration = async (
  spaceId: string,
  identity: WorkspaceConfigurationIdentity,
  input: {
    expectedVersion: number;
    baseRevisionId: string | null;
    document: WorkspaceConfigurationDocument;
    updatedBy: string;
  }
): Promise<WorkspaceConfigurationDraft> =>
  fetchPut(`/spaces/${encodeURIComponent(spaceId)}/workspace-configuration`, {
    ...identityParams(identity),
    expected_version: input.expectedVersion,
    base_revision_id: input.baseRevisionId,
    document: input.document,
    updated_by: input.updatedBy,
  });

export const reviewWorkspaceConfiguration = async (
  spaceId: string,
  identity: WorkspaceConfigurationIdentity
): Promise<WorkspaceConfigurationReviewResponse> =>
  fetchGet(
    `/spaces/${encodeURIComponent(spaceId)}/workspace-configuration/review`,
    identityParams(identity)
  );

export const preflightWorkspaceConfigurationAsset = async (
  spaceId: string,
  identity: WorkspaceConfigurationIdentity,
  logicalPath: string,
  file: File
): Promise<WorkspaceConfigurationAssetPreflight> => {
  const query = new URLSearchParams({
    email: identity.email,
    ...(identity.userId === undefined || identity.userId === null
      ? {}
      : { user_id: String(identity.userId) }),
  });
  const form = new FormData();
  form.set('logical_path', logicalPath);
  form.set('file', file, file.name);
  return fetchPostForm(
    `/spaces/${encodeURIComponent(spaceId)}/workspace-configuration/asset-preflight?${query.toString()}`,
    form
  );
};

const preparedAssetsPayload = (
  identity: WorkspaceConfigurationIdentity,
  input: {
    expectedVersion: number;
    expectedManifestDigest: string;
    expectedReviewDigest: string;
  }
) => ({
  ...identityParams(identity),
  expected_version: input.expectedVersion,
  expected_manifest_digest: input.expectedManifestDigest,
  expected_review_digest: input.expectedReviewDigest,
});

export const preflightPreparedWorkspaceConfigurationAssets = async (
  spaceId: string,
  identity: WorkspaceConfigurationIdentity,
  input: {
    expectedVersion: number;
    expectedManifestDigest: string;
    expectedReviewDigest: string;
  }
): Promise<WorkspaceConfigurationPreparedAssetPreflight> =>
  fetchPost(
    `/spaces/${encodeURIComponent(spaceId)}/workspace-configuration/prepared-assets:preflight`,
    preparedAssetsPayload(identity, input)
  );

export const uploadPreparedWorkspaceConfigurationAsset = async (
  spaceId: string,
  identity: WorkspaceConfigurationIdentity,
  input: {
    expectedVersion: number;
    expectedManifestDigest: string;
    expectedReviewDigest: string;
    logicalPath: string;
    contentDigest: string;
    expectedOldDigest?: string;
  }
): Promise<{ asset: WorkspaceConfigurationPreparedAsset & { id: string } }> =>
  fetchPost(
    `/spaces/${encodeURIComponent(spaceId)}/workspace-configuration/prepared-assets:upload`,
    {
      ...preparedAssetsPayload(identity, input),
      logical_path: input.logicalPath,
      content_digest: input.contentDigest,
      ...(input.expectedOldDigest
        ? { expected_old_digest: input.expectedOldDigest }
        : {}),
    }
  );

export const recordPublishedWorkspaceConfiguration = async (
  spaceId: string,
  identity: WorkspaceConfigurationIdentity,
  input: {
    expectedVersion: number;
    revisionId: string;
    manifestDigest: string;
    actorId: string;
  }
): Promise<{
  revision: { revision_id: string; status: string };
  draft: WorkspaceConfigurationDraft;
}> =>
  fetchPost(
    `/spaces/${encodeURIComponent(spaceId)}/workspace-configuration/published`,
    {
      ...identityParams(identity),
      expected_version: input.expectedVersion,
      revision_id: input.revisionId,
      manifest_digest: input.manifestDigest,
      actor_id: input.actorId,
    }
  );
