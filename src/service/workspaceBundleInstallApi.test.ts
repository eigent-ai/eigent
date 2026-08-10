import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchGet: vi.fn(),
  fetchPost: vi.fn(),
  fetchPut: vi.fn(),
  findBundle: vi.fn(),
  getRevision: vi.fn(),
}));

vi.mock('@/api/http', () => ({
  fetchGet: mocks.fetchGet,
  fetchPost: mocks.fetchPost,
  fetchPut: mocks.fetchPut,
}));

vi.mock('./workspaceBundleAuthoringApi', () => ({
  findWorkspaceBundle: mocks.findBundle,
  getWorkspaceBundleRevision: mocks.getRevision,
}));

import {
  bindWorkspaceBundleLocalValues,
  createWorkspaceBundleInstallProposal,
  fetchWorkspaceBundleInstallForSpace,
  fetchWorkspaceBundleInstallReview,
  parseWorkspaceBundleHandle,
} from './workspaceBundleInstallApi';

describe('workspace Bundle install API', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
  });

  it('accepts only a canonical immutable share handle', () => {
    expect(parseWorkspaceBundleHandle('research-workforce@12')).toEqual({
      bundleId: 'research-workforce',
      revisionId: 'research-workforce@12',
    });
    expect(parseWorkspaceBundleHandle('research-workforce')).toBeNull();
    expect(parseWorkspaceBundleHandle('research-workforce@0')).toBeNull();
  });

  it('loads the published revision before creating a local proposal', async () => {
    mocks.findBundle.mockResolvedValue({ id: 'research-workforce' });
    mocks.getRevision.mockResolvedValue({
      id: 'research-workforce@1',
      bundle_id: 'research-workforce',
      status: 'published',
    });

    await fetchWorkspaceBundleInstallReview({
      bundleId: 'research-workforce',
      revisionId: 'research-workforce@1',
    });

    expect(mocks.getRevision).toHaveBeenCalledWith(
      'research-workforce',
      'research-workforce@1'
    );
    expect(mocks.fetchPost).not.toHaveBeenCalled();
  });

  it('rejects a draft revision during the review-first read', async () => {
    mocks.findBundle.mockResolvedValue({ id: 'research-workforce' });
    mocks.getRevision.mockResolvedValue({
      id: 'research-workforce@1',
      bundle_id: 'research-workforce',
      status: 'validated',
    });

    await expect(
      fetchWorkspaceBundleInstallReview({
        bundleId: 'research-workforce',
        revisionId: 'research-workforce@1',
      })
    ).rejects.toThrow('Only published');
  });

  it('creates the durable proposal with sidecar placement', async () => {
    mocks.fetchPost.mockResolvedValue({ proposal: { proposal_id: 'p-1' } });

    await createWorkspaceBundleInstallProposal({
      proposalId: 'p-1',
      requestId: 'r-1',
      spaceId: 'space-1',
      bundleId: 'research-workforce',
      revisionId: 'research-workforce@1',
    });

    expect(mocks.fetchPost).toHaveBeenCalledWith(
      '/api/v1/workspace-bundles/install-proposals',
      expect.objectContaining({
        proposal_id: 'p-1',
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
      '/api/v1/spaces/space%20%2F%20one/workspace-bundle-installation'
    );
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
      '/api/v1/workspace-bundles/install-proposals/p-1/local-values',
      expect.objectContaining({
        bindings: [expect.objectContaining({ expected_binding_version: null })],
      })
    );
  });
});
