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

const mocks = vi.hoisted(() => ({
  fetchGet: vi.fn(),
  fetchPost: vi.fn(),
  fetchPut: vi.fn(),
  getPublicRevision: vi.fn(),
}));

vi.mock('@/api/http', () => ({
  fetchGet: mocks.fetchGet,
  fetchPost: mocks.fetchPost,
  fetchPut: mocks.fetchPut,
}));

vi.mock('@/service/workspaceBundleAuthoringApi', () => ({
  getPublicWorkspaceBundleRevision: mocks.getPublicRevision,
}));

import {
  bindWorkspaceBundleLocalValues,
  createWorkspaceBundleInstallProposal,
  fetchWorkspaceBundleInstallForSpace,
  fetchWorkspaceBundleInstallReview,
  parseWorkspaceBundleHandle,
} from '@/service/workspaceBundleInstallApi';

describe('workspace Bundle install API', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
  });

  it('accepts only a canonical immutable share handle', () => {
    expect(
      parseWorkspaceBundleHandle('@verified/research-workspace@12')
    ).toEqual({
      publisherNamespace: 'verified',
      slug: 'research-workspace',
      version: 12,
      coordinate: '@verified/research-workspace@12',
    });
    expect(parseWorkspaceBundleHandle('research-workspace@12')).toBeNull();
    expect(parseWorkspaceBundleHandle('research-workspace')).toBeNull();
    expect(
      parseWorkspaceBundleHandle('@verified/research-workspace@0')
    ).toBeNull();
  });

  it('loads the published revision before creating a local proposal', async () => {
    mocks.getPublicRevision.mockResolvedValue({
      id: 'wbr_11111111111111111111111111111111',
      bundle_id: 'wb_11111111111111111111111111111111',
      status: 'published',
      publisher_namespace: 'verified',
      slug: 'research-workspace',
      version: 1,
      coordinate: '@verified/research-workspace@1',
    });

    await fetchWorkspaceBundleInstallReview({
      publisherNamespace: 'verified',
      slug: 'research-workspace',
      version: 1,
      coordinate: '@verified/research-workspace@1',
    });

    expect(mocks.getPublicRevision).toHaveBeenCalledWith({
      publisherNamespace: 'verified',
      slug: 'research-workspace',
      version: 1,
      coordinate: '@verified/research-workspace@1',
    });
    expect(mocks.fetchPost).not.toHaveBeenCalled();
  });

  it('rejects a draft revision during the review-first read', async () => {
    mocks.getPublicRevision.mockResolvedValue({
      id: 'wbr_11111111111111111111111111111111',
      bundle_id: 'wb_11111111111111111111111111111111',
      status: 'validated',
      publisher_namespace: 'verified',
      slug: 'research-workspace',
      version: 1,
      coordinate: '@verified/research-workspace@1',
    });

    await expect(
      fetchWorkspaceBundleInstallReview({
        publisherNamespace: 'verified',
        slug: 'research-workspace',
        version: 1,
        coordinate: '@verified/research-workspace@1',
      })
    ).rejects.toThrow('Only published');
  });

  it('creates the durable proposal with sidecar placement', async () => {
    mocks.fetchPost.mockResolvedValue({ proposal: { proposal_id: 'p-1' } });

    await createWorkspaceBundleInstallProposal({
      proposalId: 'p-1',
      requestId: 'r-1',
      spaceId: 'space-1',
      publisherNamespace: 'verified',
      slug: 'research-workspace',
      version: 1,
    });

    expect(mocks.fetchPost).toHaveBeenCalledWith(
      '/workspace-bundles/install-proposals',
      expect.objectContaining({
        proposal_id: 'p-1',
        publisher_namespace: 'verified',
        slug: 'research-workspace',
        version: 1,
        config_placement: 'sidecar',
      })
    );
  });

  it('loads the durable installation attached to a Space', async () => {
    mocks.fetchGet.mockResolvedValue({
      proposal: { proposal_id: 'proposal-1' },
    });

    await fetchWorkspaceBundleInstallForSpace('space / one');

    expect(mocks.fetchGet).toHaveBeenCalledWith(
      '/spaces/space%20%2F%20one/workspace-bundle-installation'
    );
  });

  it('preserves the successful empty state for a locally-authored Space', async () => {
    mocks.fetchGet.mockResolvedValue({ proposal: null });

    await expect(
      fetchWorkspaceBundleInstallForSpace('space-local')
    ).resolves.toEqual({ proposal: null });
    expect(mocks.fetchGet).toHaveBeenCalledTimes(1);
  });

  it('sends only opaque vault references to Brain, never plaintext', async () => {
    mocks.fetchPut.mockResolvedValue({ proposal: { proposal_id: 'p-1' } });
    const plaintext = 'secret-value-that-must-not-cross-ipc';

    await bindWorkspaceBundleLocalValues({
      proposalId: 'p-1',
      clientRequestId: 'bind-1',
      expectedVersion: 3,
      actorId: 'user-1',
      bindings: [
        {
          requirement_key: 'environment:API_TOKEN',
          requirement_kind: 'environment',
          secret_ref: 'wsvault_opaque-reference',
          account_scope_digest: 'a'.repeat(64),
          expected_binding_version: null,
        },
      ],
    });

    const serializedPayload = JSON.stringify(mocks.fetchPut.mock.calls[0][1]);
    expect(serializedPayload).not.toContain(plaintext);
    expect(serializedPayload).toContain('wsvault_opaque-reference');
    expect(mocks.fetchPut.mock.calls[0][1].bindings[0]).not.toHaveProperty(
      'value'
    );
    expect(mocks.fetchPut).toHaveBeenCalledWith(
      '/workspace-bundles/install-proposals/p-1/local-values',
      expect.objectContaining({
        bindings: [expect.objectContaining({ expected_binding_version: null })],
      })
    );
  });
});
