// Local-only service boundary for the real Save Bundle dialog browser probe.
import type {
  WorkspaceConfigurationDraft,
  WorkspaceConfigurationSaveReview,
} from '@/service/workspaceConfigurationApi';

export const draft: WorkspaceConfigurationDraft = {
  space_id: 'contrast-probe',
  version: 1,
  base_revision_id: null,
  document_digest: 'a'.repeat(64),
  persisted: true,
  updated_at: 1,
  document: {
    apiVersion: 'eigent.ai/v1alpha1',
    kind: 'WorkspaceBundle',
    metadata: { id: 'contrast-probe', name: 'Research', revision: 1 },
    spec: {
      instructions: {},
      context: [],
      skills: [],
      connectors: [],
      mcpServers: [],
      environment: { variables: [] },
      agents: [],
      models: {
        default: { modelRef: 'provider://default', thinkingEffort: 'medium' },
      },
      permissions: { profile: 'request_approval', rules: [] },
      git: {
        enabled: true,
        checkpointPolicy: 'user_and_run_terminal',
        agentIsolation: 'worktree',
        remotePolicy: 'prompt',
      },
    },
  },
};

const review: WorkspaceConfigurationSaveReview = {
  slug: 'contrast-probe',
  version: 1,
  manifest_digest: draft.document_digest,
  name: 'Research',
  review_digest: 'b'.repeat(64),
  summary: {
    instructions: 0,
    context_sources: 0,
    skills: 0,
    connectors: 0,
    mcp_servers: 0,
    agents: 0,
  },
  requirements: {
    environment_variables: [],
    suggested_environment_variables: [],
    suggested_mcp_secret_slots: [],
    secret_slots: [],
    connector_slots: [],
    local_path_slots: [],
  },
  assets: [],
  prepared_assets: [],
  warnings: [],
  local_values_excluded: 0,
};

let finishReview: () => void;
let finishPublish: () => void;
export const releaseReview = () => finishReview();
export const releasePublish = () => finishPublish();
export async function reviewWorkspaceConfiguration() {
  await new Promise<void>((resolve) => {
    finishReview = resolve;
  });
  return { draft_version: 1, review };
}
export const findWorkspaceBundleBySlug = async () => null;
export const buildWorkspaceBundleAuthorReview = async () => ({
  ...review,
  presented_review_digest: review.review_digest,
  selected_assets: [],
});
export const ensureWorkspaceBundle = async () => ({
  id: 'wb_probe',
  package_name: '@probe/contrast-probe',
  latest_published_revision_id: null,
});
export const validateWorkspaceBundleRevision = async () => ({
  id: 'wbr_probe',
  revision: 1,
  status: 'validated',
  manifest_digest: draft.document_digest,
  assets: [],
});
export async function publishWorkspaceBundleRevision() {
  await new Promise<void>((resolve) => {
    finishPublish = resolve;
  });
  return {
    id: 'wbr_probe',
    revision: 1,
    status: 'published',
    manifest_digest: draft.document_digest,
  };
}
export const recordPublishedWorkspaceConfiguration = async () => ({});
const unexpected = async () => {
  throw new Error('Unexpected asset/recovery request in contrast probe');
};
export const getWorkspaceBundleRevision = unexpected;
export const uploadWorkspaceBundleAsset = unexpected;
export const preflightPreparedWorkspaceConfigurationAssets = unexpected;
export const preflightWorkspaceConfigurationAsset = unexpected;
export const uploadPreparedWorkspaceConfigurationAsset = unexpected;
