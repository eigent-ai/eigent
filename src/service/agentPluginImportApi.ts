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

import { fetchPost } from '@/api/http';

export type AgentPluginSourceKind = 'directory' | 'archive';

export interface AgentPluginSelectedSource {
  source_path: string;
  display_name: string;
  source_kind: AgentPluginSourceKind;
}

export interface AgentPluginSkillReview {
  id: string;
  name: string;
  description?: string | null;
  logical_path?: string | null;
}

export interface AgentPluginSkippedItem {
  id?: string | null;
  name?: string | null;
  logical_path?: string | null;
  reason_code: string;
  reason: string;
}

export interface AgentPluginMcpServerReview {
  id: string;
  name?: string | null;
  transport?: string | null;
  command?: string | null;
  args?: string[];
  command_summary?: string | null;
  cwd?: string | null;
  url?: string | null;
  env_names: string[];
  header_names: string[];
  public_environment?: AgentPluginPublicValueReview[];
  public_headers?: AgentPluginPublicValueReview[];
  credential_requirement_keys: string[];
}

export interface AgentPluginPublicValueReview {
  name: string;
  value: string;
  value_digest: string;
  truncated: boolean;
}

export interface AgentPluginFileReview {
  logical_path: string;
  content_digest: string;
  size_bytes: number;
  media_type?: string | null;
}

export interface AgentPluginCredentialRequirement {
  requirement_key: string;
  label?: string | null;
  description?: string | null;
  requirement_kind: 'environment' | 'mcp_secret';
  required: boolean;
  sensitive: true;
}

export interface AgentPluginWarning {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
}

export interface AgentPluginInspection {
  standard: 'agent-plugins';
  schema_version: string;
  source_tree_digest: string;
  converted_tree_digest: string;
  metadata: {
    name: string;
    version?: string | null;
    description?: string | null;
    author?: {
      name?: string | null;
      url?: string | null;
      email?: string | null;
    } | null;
  };
  source: {
    display_name: string;
    source_kind: AgentPluginSourceKind;
  };
  skills: AgentPluginSkillReview[];
  skipped_skills: AgentPluginSkippedItem[];
  mcp_servers: AgentPluginMcpServerReview[];
  skipped_mcp_servers: AgentPluginSkippedItem[];
  files: AgentPluginFileReview[];
  credential_requirements: AgentPluginCredentialRequirement[];
  warnings: AgentPluginWarning[];
  diagnostics: Array<
    AgentPluginWarning & {
      logical_path?: string | null;
    }
  >;
  review_digest: string;
  convertible: boolean;
}

export interface AgentPluginConversionResult {
  slug: string;
  version: number;
  target_space_id: string;
  status: 'draft';
}

export const inspectAgentPluginSource = async (input: {
  sourcePath: string;
  email: string;
  userId?: string | number | null;
}): Promise<AgentPluginInspection> =>
  fetchPost('/workspace-bundles/agent-plugins:inspect', {
    source_path: input.sourcePath,
    email: input.email,
    user_id: input.userId,
  });

export const convertAgentPluginToWorkspaceBundleDraft = async (input: {
  sourcePath: string;
  expectedReviewDigest: string;
  targetSpaceId: string;
  expectedTargetDraftVersion: number;
  clientRequestId: string;
  updatedBy: string;
  email: string;
  userId?: string | number | null;
}): Promise<AgentPluginConversionResult> =>
  fetchPost('/workspace-bundles/agent-plugins:convert', {
    source_path: input.sourcePath,
    expected_review_digest: input.expectedReviewDigest,
    target_space_id: input.targetSpaceId,
    expected_target_draft_version: input.expectedTargetDraftVersion,
    client_request_id: input.clientRequestId,
    updated_by: input.updatedBy,
    email: input.email,
    user_id: input.userId,
  });
