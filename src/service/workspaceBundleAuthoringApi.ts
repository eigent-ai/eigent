import {
  proxyFetchGet,
  proxyFetchPatch,
  proxyFetchPost,
  uploadFile,
} from '@/api/http';
import type { WorkspaceConfigurationDocument } from './workspaceConfigurationApi';

export type WorkspaceBundleVisibility = 'private' | 'team' | 'public';

export interface CloudWorkspaceBundle {
  id: string;
  workspace_id: string;
  name: string;
  visibility: 'private' | 'team' | 'public';
  latest_published_revision_id: string | null;
}

export interface CloudWorkspaceBundleRevision {
  id: string;
  bundle_id: string;
  revision: number;
  manifest: WorkspaceConfigurationDocument;
  manifest_digest: string;
  status: 'validated' | 'published';
  assets: Array<{
    id: string;
    logical_path: string;
    content_digest: string;
    size_bytes: number;
  }>;
}

export interface WorkspaceBundleSelectedAsset {
  logical_path: string;
  content_digest: string;
}

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
};

export const buildWorkspaceBundleAuthorReview = async (input: {
  presentedReviewDigest: string;
  manifestDigest: string;
  visibility: WorkspaceBundleVisibility;
  selectedAssets: WorkspaceBundleSelectedAsset[];
}) => {
  const selectedAssets = [...input.selectedAssets].sort((left, right) =>
    left.logical_path < right.logical_path
      ? -1
      : left.logical_path > right.logical_path
        ? 1
        : 0
  );
  const attestable = {
    presented_review_digest: input.presentedReviewDigest,
    manifest_digest: input.manifestDigest,
    visibility: input.visibility,
    selected_assets: selectedAssets,
  };
  return {
    ...attestable,
    review_digest: await sha256(canonicalJson(attestable)),
  };
};

export const findWorkspaceBundle = async (
  bundleId: string
): Promise<CloudWorkspaceBundle | null> => {
  try {
    return await proxyFetchGet(
      `/api/v1/workspace-bundles/${encodeURIComponent(bundleId)}`
    );
  } catch (error) {
    if (
      error instanceof Error &&
      (error as Error & { status?: number }).status === 404
    ) {
      return null;
    }
    throw error;
  }
};

export const ensureWorkspaceBundle = async (input: {
  bundleId: string;
  workspaceId: string;
  name: string;
  visibility: WorkspaceBundleVisibility;
  existing?: CloudWorkspaceBundle | null;
}): Promise<CloudWorkspaceBundle> => {
  const existing =
    input.existing === undefined
      ? await findWorkspaceBundle(input.bundleId)
      : input.existing;
  if (existing) {
    if (existing.workspace_id !== input.workspaceId) {
      throw new Error(
        'This Bundle id already belongs to a different Workspace.'
      );
    }
    if (
      existing.name !== input.name ||
      existing.visibility !== input.visibility
    ) {
      if (existing.visibility === 'team') {
        throw new Error(
          'Team sharing for this Bundle must be managed by a team administrator.'
        );
      }
      return proxyFetchPatch(
        `/api/v1/workspace-bundles/${encodeURIComponent(input.bundleId)}`,
        {
          expected_name: existing.name,
          expected_visibility: existing.visibility,
          name: input.name,
          visibility: input.visibility,
        }
      );
    }
    return existing;
  }
  return proxyFetchPost('/api/v1/workspace-bundles', {
    bundle_id: input.bundleId,
    workspace_id: input.workspaceId,
    client_request_id: `workspace-config-create:${input.bundleId}`,
    name: input.name,
    visibility: input.visibility,
  });
};

export const validateWorkspaceBundleRevision = async (
  bundleId: string,
  manifest: WorkspaceConfigurationDocument
): Promise<CloudWorkspaceBundleRevision> =>
  proxyFetchPost(
    `/api/v1/workspace-bundles/${encodeURIComponent(bundleId)}/revisions:validate`,
    { manifest }
  );

export const getWorkspaceBundleRevision = async (
  bundleId: string,
  revisionId: string
): Promise<CloudWorkspaceBundleRevision> =>
  proxyFetchGet(
    `/api/v1/workspace-bundles/${encodeURIComponent(bundleId)}/revisions/${encodeURIComponent(revisionId)}`
  );

export const uploadWorkspaceBundleAsset = async (input: {
  bundleId: string;
  revisionId: string;
  logicalPath: string;
  file: File;
  expectedOldDigest?: string;
}): Promise<CloudWorkspaceBundleRevision['assets'][number]> => {
  const form = new FormData();
  form.set('logical_path', input.logicalPath.replace(/^bundle:\/\//, ''));
  form.set('provenance', 'bundle_author');
  if (input.expectedOldDigest) {
    form.set('expected_old_digest', input.expectedOldDigest);
  }
  form.set('file', input.file, input.file.name);
  return uploadFile(
    `/api/v1/workspace-bundles/${encodeURIComponent(input.bundleId)}/revisions/${encodeURIComponent(input.revisionId)}/assets`,
    form
  );
};

export const publishWorkspaceBundleRevision = async (input: {
  bundleId: string;
  revisionId: string;
  manifestDigest: string;
  authorReview: Awaited<ReturnType<typeof buildWorkspaceBundleAuthorReview>>;
}): Promise<CloudWorkspaceBundleRevision> =>
  proxyFetchPost(
    `/api/v1/workspace-bundles/${encodeURIComponent(input.bundleId)}/revisions:publish`,
    {
      revision_id: input.revisionId,
      expected_manifest_digest: input.manifestDigest,
      author_review: input.authorReview,
    }
  );
