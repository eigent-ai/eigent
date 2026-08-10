import { fetchGet, fetchPost, fetchPut } from '@/api/http';
import {
  findWorkspaceBundle,
  getWorkspaceBundleRevision,
  type CloudWorkspaceBundle,
  type CloudWorkspaceBundleRevision,
} from './workspaceBundleAuthoringApi';
import type { WorkspaceConfigurationDocument } from './workspaceConfigurationApi';

export type WorkspaceBundleInstallState =
  | 'proposed'
  | 'approved'
  | 'rejected'
  | 'materializing'
  | 'materialized'
  | 'needs_attention';

export interface WorkspaceBundleValueRequirement {
  requirement_key: string;
  requirement_kind: 'environment' | 'mcp_secret';
  configured: boolean;
  available: boolean;
  binding_version: number | null;
  required: boolean;
  name?: string;
  mcp_id?: string;
  slot_id?: string;
  sensitive?: boolean;
  description?: string | null;
  example?: string | null;
}

export interface WorkspaceBundleInstallPlan {
  connector_slots: Array<{
    slot_id: string;
    connector_id: string;
    required_grants: string[];
  }>;
  local_path_slots: string[];
  script_actions: string[];
  environment_requirements: Array<Record<string, unknown>>;
  mcp_secret_requirements: Array<Record<string, unknown>>;
  permission_profile: string;
  git_policy: Record<string, unknown>;
  asset_count: number;
  asset_bytes: number;
}

export interface WorkspaceBundleInstallProposal {
  proposal_id: string;
  request_id: string;
  space_id: string;
  bundle_id: string;
  revision_id: string;
  config_placement: 'in_repo' | 'sidecar';
  state: WorkspaceBundleInstallState;
  version: number;
  manifest: WorkspaceConfigurationDocument;
  manifest_digest: string;
  assets: Array<{
    id: string;
    logical_path: string;
    content_digest: string;
    media_type: string;
    size_bytes: number;
  }>;
  install_plan: WorkspaceBundleInstallPlan;
  error_code?: string | null;
}

export interface WorkspaceBundleInstallBinding {
  slot_id: string;
  binding_kind: 'connector' | 'local_path' | 'script_approval';
  connector_id?: string | null;
  opaque_connection_id?: string | null;
  local_path?: string | null;
  required_grants: string[];
}

export interface WorkspaceBundleInstallSnapshot {
  proposal: WorkspaceBundleInstallProposal;
  bindings: WorkspaceBundleInstallBinding[];
  value_requirements: WorkspaceBundleValueRequirement[];
  readiness: {
    ready: boolean;
    missing_requirements: string[];
  };
  /** Exact prior refs replaced by this CAS; present only on local-value PUT. */
  cleanup_secret_refs?: string[];
}

export interface WorkspaceBundleInstallReview {
  bundle: CloudWorkspaceBundle | null;
  revision: CloudWorkspaceBundleRevision;
}

export interface ParsedWorkspaceBundleHandle {
  bundleId: string;
  revisionId: string;
}

export function parseWorkspaceBundleHandle(
  input: string
): ParsedWorkspaceBundleHandle | null {
  const value = input.trim();
  const match = /^([A-Za-z0-9][A-Za-z0-9._-]{0,79})@([1-9][0-9]*)$/.exec(value);
  if (!match) return null;
  return { bundleId: match[1], revisionId: value };
}

export async function fetchWorkspaceBundleInstallReview(
  handle: ParsedWorkspaceBundleHandle
): Promise<WorkspaceBundleInstallReview> {
  const revision = await getWorkspaceBundleRevision(
    handle.bundleId,
    handle.revisionId
  );
  if (revision.status !== 'published') {
    throw new Error(
      'Only published Workforce Bundle versions can be installed.'
    );
  }
  if (
    revision.bundle_id !== handle.bundleId ||
    revision.id !== handle.revisionId
  ) {
    throw new Error('The Workforce Bundle version identity does not match.');
  }
  // Public install remains usable even if mutable owner metadata is not
  // readable by this account. The immutable revision is the authority.
  const bundle = await findWorkspaceBundle(handle.bundleId).catch(() => null);
  return { bundle, revision };
}

export const createWorkspaceBundleInstallProposal = async (input: {
  proposalId: string;
  requestId: string;
  spaceId: string;
  bundleId: string;
  revisionId: string;
}): Promise<WorkspaceBundleInstallSnapshot> =>
  fetchPost('/api/v1/workspace-bundles/install-proposals', {
    proposal_id: input.proposalId,
    request_id: input.requestId,
    space_id: input.spaceId,
    bundle_id: input.bundleId,
    revision_id: input.revisionId,
    config_placement: 'sidecar',
  });

export const fetchWorkspaceBundleInstallProposal = async (
  proposalId: string
): Promise<WorkspaceBundleInstallSnapshot> =>
  fetchGet(
    `/api/v1/workspace-bundles/install-proposals/${encodeURIComponent(proposalId)}`
  );

export const fetchWorkspaceBundleInstallForSpace = async (
  spaceId: string
): Promise<WorkspaceBundleInstallSnapshot> =>
  fetchGet(
    `/api/v1/spaces/${encodeURIComponent(spaceId)}/workspace-bundle-installation`
  );

export const decideWorkspaceBundleInstall = async (input: {
  proposalId: string;
  expectedVersion: number;
  approved: boolean;
  actorId: string;
}): Promise<WorkspaceBundleInstallSnapshot> =>
  fetchPost(
    `/api/v1/workspace-bundles/install-proposals/${encodeURIComponent(input.proposalId)}/decision`,
    {
      expected_version: input.expectedVersion,
      approved: input.approved,
      actor_id: input.actorId,
    }
  );

export const bindWorkspaceBundleConnector = async (input: {
  proposalId: string;
  expectedVersion: number;
  slotId: string;
  connectorId: string;
  connectionId: string;
  actorId: string;
}): Promise<WorkspaceBundleInstallSnapshot> =>
  fetchPost(
    `/api/v1/workspace-bundles/install-proposals/${encodeURIComponent(input.proposalId)}/connector-bindings`,
    {
      expected_version: input.expectedVersion,
      slot_id: input.slotId,
      connector_id: input.connectorId,
      connection_id: input.connectionId,
      actor_id: input.actorId,
    }
  );

export const bindWorkspaceBundleLocalPath = async (input: {
  proposalId: string;
  expectedVersion: number;
  slotId: string;
  localPath: string;
  actorId: string;
}): Promise<WorkspaceBundleInstallSnapshot> =>
  fetchPost(
    `/api/v1/workspace-bundles/install-proposals/${encodeURIComponent(input.proposalId)}/local-path-bindings`,
    {
      expected_version: input.expectedVersion,
      slot_id: input.slotId,
      local_path: input.localPath,
      actor_id: input.actorId,
    }
  );

export const approveWorkspaceBundleScript = async (input: {
  proposalId: string;
  expectedVersion: number;
  actionId: string;
  actorId: string;
}): Promise<WorkspaceBundleInstallSnapshot> =>
  fetchPost(
    `/api/v1/workspace-bundles/install-proposals/${encodeURIComponent(input.proposalId)}/script-approvals`,
    {
      expected_version: input.expectedVersion,
      action_id: input.actionId,
      actor_id: input.actorId,
    }
  );

export interface WorkspaceBundleOpaqueValueBinding {
  requirement_key: string;
  requirement_kind: 'environment' | 'mcp_secret';
  secret_ref: string;
  account_scope_digest: string;
  expected_binding_version: number | null;
}

export const bindWorkspaceBundleLocalValues = async (input: {
  proposalId: string;
  clientRequestId: string;
  expectedVersion: number;
  actorId: string;
  bindings: WorkspaceBundleOpaqueValueBinding[];
}): Promise<WorkspaceBundleInstallSnapshot> =>
  fetchPut(
    `/api/v1/workspace-bundles/install-proposals/${encodeURIComponent(input.proposalId)}/local-values`,
    {
      client_request_id: input.clientRequestId,
      expected_version: input.expectedVersion,
      actor_id: input.actorId,
      bindings: input.bindings,
    }
  );

export const materializeWorkspaceBundle = async (input: {
  proposalId: string;
  expectedVersion: number;
  email: string;
  userId?: string | number | null;
  actorId: string;
}): Promise<WorkspaceBundleInstallSnapshot> =>
  fetchPost(
    `/api/v1/workspace-bundles/install-proposals/${encodeURIComponent(input.proposalId)}/materialize`,
    {
      expected_version: input.expectedVersion,
      email: input.email,
      ...(input.userId === undefined || input.userId === null
        ? {}
        : { user_id: input.userId }),
      actor_id: input.actorId,
      allow_content_repository_init: false,
    }
  );

export async function workspaceBundleAccountScopeDigest(
  actorId: string
): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`eigent-account:${actorId.trim().toLowerCase()}`)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}
