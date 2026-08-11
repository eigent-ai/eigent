import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  proxyFetchGetMock,
  proxyFetchPatchMock,
  proxyFetchPostMock,
  uploadFileMock,
} = vi.hoisted(() => ({
  proxyFetchGetMock: vi.fn(),
  proxyFetchPatchMock: vi.fn(),
  proxyFetchPostMock: vi.fn(),
  uploadFileMock: vi.fn(),
}));

vi.mock('@/api/http', () => ({
  proxyFetchGet: proxyFetchGetMock,
  proxyFetchPatch: proxyFetchPatchMock,
  proxyFetchPost: proxyFetchPostMock,
  uploadFile: uploadFileMock,
}));

import {
  buildWorkspaceBundleAuthorReview,
  ensureWorkspaceBundle,
  findWorkspaceBundle,
  publishWorkspaceBundleRevision,
  uploadWorkspaceBundleAsset,
} from './workspaceBundleAuthoringApi';

describe('workspace bundle authoring API', () => {
  beforeEach(() => {
    proxyFetchGetMock.mockReset();
    proxyFetchPatchMock.mockReset();
    proxyFetchPostMock.mockReset();
    uploadFileMock.mockReset();
  });

  it('updates mutable Bundle metadata with an optimistic preimage', async () => {
    proxyFetchGetMock.mockResolvedValue({
      id: 'bundle-1',
      workspace_id: 'space-1',
      name: 'Old name',
      visibility: 'private',
    });
    proxyFetchPatchMock.mockResolvedValue({
      id: 'bundle-1',
      workspace_id: 'space-1',
      name: 'Research',
      visibility: 'public',
    });

    await ensureWorkspaceBundle({
      bundleId: 'bundle-1',
      workspaceId: 'space-1',
      name: 'Research',
      visibility: 'public',
    });

    expect(proxyFetchPatchMock).toHaveBeenCalledWith(
      '/api/v1/workspace-bundles/bundle-1',
      {
        expected_name: 'Old name',
        expected_visibility: 'private',
        name: 'Research',
        visibility: 'public',
      }
    );
  });

  it('uses the owner-scoped direct lookup and treats 404 as missing', async () => {
    const notFound = Object.assign(new Error('not found'), { status: 404 });
    proxyFetchGetMock.mockRejectedValue(notFound);

    await expect(findWorkspaceBundle('bundle-1')).resolves.toBeNull();

    expect(proxyFetchGetMock).toHaveBeenCalledWith(
      '/api/v1/workspace-bundles/bundle-1'
    );
  });

  it('reuses an exact Bundle instead of creating a duplicate', async () => {
    proxyFetchGetMock.mockResolvedValue({
      id: 'bundle-1',
      workspace_id: 'space-1',
      name: 'Research',
      visibility: 'private',
    });

    const result = await ensureWorkspaceBundle({
      bundleId: 'bundle-1',
      workspaceId: 'space-1',
      name: 'Research',
      visibility: 'private',
    });

    expect(result.id).toBe('bundle-1');
    expect(proxyFetchPostMock).not.toHaveBeenCalled();
  });

  it('uploads only the explicitly supplied file under its logical path', async () => {
    const file = new File(['safe instructions'], 'chosen.md', {
      type: 'text/markdown',
    });

    await uploadWorkspaceBundleAsset({
      bundleId: 'bundle-1',
      revisionId: 'bundle-1@1',
      logicalPath: 'bundle://instructions/coordinator.md',
      file,
      expectedOldDigest: 'b'.repeat(64),
    });

    expect(uploadFileMock).toHaveBeenCalledTimes(1);
    const [path, form] = uploadFileMock.mock.calls[0];
    expect(path).toContain('/workspace-bundles/bundle-1/revisions/');
    expect(form.get('logical_path')).toBe('instructions/coordinator.md');
    expect(form.get('provenance')).toBe('bundle_author');
    expect(form.get('executable')).toBe('false');
    expect(form.get('expected_old_digest')).toBe('b'.repeat(64));
    expect((form.get('file') as File).name).toBe('chosen.md');
    expect((form.get('file') as File).size).toBe(file.size);
  });

  it('binds publish to the presented review and sorted selected asset digests', async () => {
    proxyFetchPostMock.mockResolvedValue({ id: 'bundle-1@1' });
    const authorReview = await buildWorkspaceBundleAuthorReview({
      presentedReviewDigest: 'c'.repeat(64),
      manifestDigest: 'a'.repeat(64),
      visibility: 'public',
      selectedAssets: [
        {
          logical_path: 'z.md',
          content_digest: '2'.repeat(64),
          media_type: 'text/markdown',
          size_bytes: 20,
          provenance: 'bundle_author',
          executable: false,
        },
        {
          logical_path: 'a.md',
          content_digest: '1'.repeat(64),
          media_type: 'text/markdown',
          size_bytes: 10,
          provenance: 'agent_plugin_import',
          executable: true,
        },
      ],
    });

    await publishWorkspaceBundleRevision({
      bundleId: 'bundle-1',
      revisionId: 'bundle-1@1',
      manifestDigest: 'a'.repeat(64),
      authorReview,
    });

    expect(
      authorReview.selected_assets.map((item) => item.logical_path)
    ).toEqual(['a.md', 'z.md']);
    expect(authorReview.review_digest).toBe(
      '2593f077663509db844d19096b8b92f5bbda1c6a44f33a83afcce2dbc708c951'
    );
    expect(authorReview.selected_assets[0]).toEqual({
      logical_path: 'a.md',
      content_digest: '1'.repeat(64),
      media_type: 'text/markdown',
      size_bytes: 10,
      provenance: 'agent_plugin_import',
      executable: true,
    });
    expect(proxyFetchPostMock).toHaveBeenCalledWith(
      '/api/v1/workspace-bundles/bundle-1/revisions:publish',
      expect.objectContaining({ author_review: authorReview })
    );
  });
});
