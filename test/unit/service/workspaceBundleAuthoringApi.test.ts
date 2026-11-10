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
  getPublicWorkspaceBundleRevision,
  publishWorkspaceBundleRevision,
  uploadWorkspaceBundleAsset,
} from '@/service/workspaceBundleAuthoringApi';

describe('workspace bundle authoring API', () => {
  beforeEach(() => {
    proxyFetchGetMock.mockReset();
    proxyFetchPatchMock.mockReset();
    proxyFetchPostMock.mockReset();
    uploadFileMock.mockReset();
  });

  it('updates mutable Bundle metadata with an optimistic preimage', async () => {
    proxyFetchGetMock.mockResolvedValue({
      id: 'wb_11111111111111111111111111111111',
      workspace_id: 'space-1',
      publisher_type: 'user',
      publisher_id: 'user-1',
      publisher_namespace: 'user-1',
      slug: 'bundle-1',
      package_name: '@user-1/bundle-1',
      name: 'Old name',
      visibility: 'private',
      latest_published_revision_id: null,
    });
    proxyFetchPatchMock.mockResolvedValue({
      id: 'wb_11111111111111111111111111111111',
      workspace_id: 'space-1',
      name: 'Research',
      visibility: 'public',
    });

    await ensureWorkspaceBundle({
      slug: 'bundle-1',
      workspaceId: 'space-1',
      name: 'Research',
      visibility: 'public',
    });

    expect(proxyFetchPatchMock).toHaveBeenCalledWith(
      '/api/v1/workspace-bundles/wb_11111111111111111111111111111111',
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
      id: 'wb_11111111111111111111111111111111',
      workspace_id: 'space-1',
      publisher_type: 'user',
      publisher_id: 'user-1',
      publisher_namespace: 'user-1',
      slug: 'bundle-1',
      package_name: '@user-1/bundle-1',
      name: 'Research',
      visibility: 'private',
      latest_published_revision_id: null,
    });

    const result = await ensureWorkspaceBundle({
      slug: 'bundle-1',
      workspaceId: 'space-1',
      name: 'Research',
      visibility: 'private',
    });

    expect(result.id).toBe('wb_11111111111111111111111111111111');
    expect(proxyFetchPostMock).not.toHaveBeenCalled();
    expect(proxyFetchGetMock).toHaveBeenCalledWith(
      '/api/v1/workspace-bundles:resolve?slug=bundle-1'
    );
  });

  it('uploads only the explicitly supplied file under its logical path', async () => {
    const file = new File(['safe instructions'], 'chosen.md', {
      type: 'text/markdown',
    });

    await uploadWorkspaceBundleAsset({
      bundleId: 'wb_11111111111111111111111111111111',
      revisionId: 'wbr_11111111111111111111111111111111',
      logicalPath: 'bundle://instructions/coordinator.md',
      file,
      expectedOldDigest: 'b'.repeat(64),
    });

    expect(uploadFileMock).toHaveBeenCalledTimes(1);
    const [path, form] = uploadFileMock.mock.calls[0];
    expect(path).toContain(
      '/workspace-bundles/wb_11111111111111111111111111111111/revisions/wbr_11111111111111111111111111111111/'
    );
    expect(form.get('logical_path')).toBe('instructions/coordinator.md');
    expect(form.get('provenance')).toBe('bundle_author');
    expect(form.get('executable')).toBe('false');
    expect(form.get('expected_old_digest')).toBe('b'.repeat(64));
    expect((form.get('file') as File).name).toBe('chosen.md');
    expect((form.get('file') as File).size).toBe(file.size);
  });

  it('normalizes the public revision id without confusing it with the market coordinate', async () => {
    proxyFetchGetMock.mockResolvedValue({
      bundle_id: 'wb_11111111111111111111111111111111',
      revision_id: 'wbr_11111111111111111111111111111111',
      publisher_namespace: 'verified-publisher',
      slug: 'bundle-1',
      package_name: '@verified-publisher/bundle-1',
      version: 3,
      revision: 3,
      coordinate: '@verified-publisher/bundle-1@3',
      status: 'published',
      manifest: {},
      manifest_digest: 'a'.repeat(64),
      assets: [],
    });

    const revision = await getPublicWorkspaceBundleRevision({
      publisherNamespace: 'verified-publisher',
      slug: 'bundle-1',
      version: 3,
    });

    expect(revision.id).toBe('wbr_11111111111111111111111111111111');
    expect(revision.coordinate).toBe('@verified-publisher/bundle-1@3');
    expect(proxyFetchGetMock).toHaveBeenCalledWith(
      '/api/v1/workspace-bundles/catalog/verified-publisher/bundle-1/revisions/3'
    );
  });

  it('binds publish to the presented review and sorted selected asset digests', async () => {
    proxyFetchPostMock.mockResolvedValue({
      id: 'wbr_11111111111111111111111111111111',
    });
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
      bundleId: 'wb_11111111111111111111111111111111',
      revisionId: 'wbr_11111111111111111111111111111111',
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
      '/api/v1/workspace-bundles/wb_11111111111111111111111111111111/revisions:publish',
      expect.objectContaining({ author_review: authorReview })
    );
  });
});
