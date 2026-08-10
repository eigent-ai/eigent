import { fetchGet, fetchPut } from '@/api/http';

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

export interface WorkspaceAgentProfile {
  id: string;
  role: string;
  modelProfile: string;
}

export interface WorkspaceConfigurationDocument {
  apiVersion: 'eigent.ai/v1alpha1';
  kind: 'WorkforceBundle';
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
    agents: WorkspaceAgentProfile[];
    models: Record<
      string,
      { modelRef: string; thinkingEffort: ThinkingEffort }
    >;
    permissions: {
      profile:
        | 'request_approval'
        | 'auto_review'
        | 'workspace_write'
        | 'full_access';
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
  fetchGet(
    `/api/v1/spaces/${encodeURIComponent(spaceId)}/workspace-configuration`,
    {
      ...identityParams(identity),
      ...(name ? { name } : {}),
    }
  );

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
  fetchPut(
    `/api/v1/spaces/${encodeURIComponent(spaceId)}/workspace-configuration`,
    {
      ...identityParams(identity),
      expected_version: input.expectedVersion,
      base_revision_id: input.baseRevisionId,
      document: input.document,
      updated_by: input.updatedBy,
    }
  );
