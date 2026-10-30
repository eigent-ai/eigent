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

const account = vi.hoisted(() => ({
  current: {
    user_id: 7,
    email: 'fixture@example.test',
    token: 'synthetic-token',
  },
}));
vi.mock('@/store/authStore', () => ({ getAuthStore: () => account.current }));

vi.mock('@/api/http', () => ({
  fetchGet: mocks.fetchGet,
  fetchPost: mocks.fetchPost,
  fetchPut: mocks.fetchPut,
}));

vi.mock('@/service/workspaceBundleAuthoringApi', () => ({
  getPublicWorkspaceBundleRevision: mocks.getPublicRevision,
}));

import {
  approveWorkspaceBundleScript,
  bindWorkspaceBundleConnector,
  bindWorkspaceBundleLocalPath,
  bindWorkspaceBundleLocalValues,
  createWorkspaceBundleInstallProposal,
  decideWorkspaceBundleInstall,
  fetchWorkspaceBundleInstallForSpace,
  fetchWorkspaceBundleInstallProposal,
  fetchWorkspaceBundleInstallReview,
  materializeWorkspaceBundle,
  parseWorkspaceBundleHandle,
} from '@/service/workspaceBundleInstallApi';

describe('workspace Bundle install API', () => {
  beforeEach(() => {
    account.current = {
      user_id: 7,
      email: 'fixture@example.test',
      token: 'synthetic-token',
    };
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
      '/workspace-bundles/install-proposals?email=fixture%40example.test&user_id=7',
      expect.objectContaining({
        proposal_id: 'p-1',
        publisher_namespace: 'verified',
        slug: 'research-workspace',
        version: 1,
        config_placement: 'sidecar',
      }),
      undefined,
      expect.objectContaining({ beforeRequest: expect.any(Function) })
    );
  });

  it('loads the durable installation attached to a Space', async () => {
    mocks.fetchGet.mockResolvedValue({
      proposal: { proposal_id: 'proposal-1' },
    });

    await fetchWorkspaceBundleInstallForSpace('space / one');

    expect(mocks.fetchGet).toHaveBeenCalledWith(
      '/spaces/space%20%2F%20one/workspace-bundle-installation?email=fixture%40example.test&user_id=7',
      undefined,
      undefined,
      expect.objectContaining({ beforeRequest: expect.any(Function) })
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
      '/workspace-bundles/install-proposals/p-1/local-values?email=fixture%40example.test&user_id=7',
      expect.objectContaining({
        bindings: [expect.objectContaining({ expected_binding_version: null })],
      }),
      undefined,
      expect.objectContaining({ beforeRequest: expect.any(Function) })
    );
  });

  const proposal = { proposalId: 'p / 1', expectedVersion: 3, actorId: '7' };
  const requests = [
    [
      'proposal',
      () => fetchWorkspaceBundleInstallProposal(proposal.proposalId),
      mocks.fetchGet,
    ],
    [
      'space',
      () => fetchWorkspaceBundleInstallForSpace('space-1'),
      mocks.fetchGet,
    ],
    [
      'decision',
      () => decideWorkspaceBundleInstall({ ...proposal, approved: true }),
      mocks.fetchPost,
    ],
    [
      'connector',
      () =>
        bindWorkspaceBundleConnector({
          ...proposal,
          slotId: 'github',
          connectorId: 'github',
          connectionId: 'opaque',
        }),
      mocks.fetchPost,
    ],
    [
      'local path',
      () =>
        bindWorkspaceBundleLocalPath({
          ...proposal,
          slotId: 'files',
          localPath: '/synthetic',
        }),
      mocks.fetchPost,
    ],
    [
      'approval',
      () =>
        approveWorkspaceBundleScript({
          ...proposal,
          actionId: 'skill.script.execute:registry://global/skills/hash',
        }),
      mocks.fetchPost,
    ],
    [
      'values',
      () =>
        bindWorkspaceBundleLocalValues({
          ...proposal,
          clientRequestId: 'values-1',
          bindings: [],
        }),
      mocks.fetchPut,
    ],
    [
      'materialize',
      () =>
        materializeWorkspaceBundle({
          ...proposal,
          email: 'fixture@example.test',
          userId: 7,
        }),
      mocks.fetchPost,
    ],
  ] as const;

  it.each(requests)(
    'carries current identity and guards %s delivery',
    async (_name, invoke, transport) => {
      transport.mockResolvedValue({ proposal: null });
      await invoke();
      const [url, , , options] = transport.mock.calls[0];
      const parsed = new URL(url, 'http://fixture.test');
      expect(Object.fromEntries(parsed.searchParams)).toEqual({
        email: 'fixture@example.test',
        user_id: '7',
      });
      expect(url).not.toContain(account.current.token);
      expect(options.expectedAccountKey).toContain('id:7');
      expect(() => options.beforeRequest()).not.toThrow();
      account.current = { ...account.current, token: 'replacement-token' };
      expect(() => options.beforeRequest()).toThrow(
        'workspace_bundle_account_changed'
      );
    }
  );

  it.each(requests)(
    'discards an old %s result after account switch',
    async (_name, invoke, transport) => {
      let resolve!: (value: unknown) => void;
      transport.mockImplementation(
        () =>
          new Promise((done) => {
            resolve = done;
          })
      );
      const pending = invoke();
      account.current = {
        user_id: 8,
        email: 'another@example.test',
        token: 'other-token',
      };
      resolve({ runtime_readiness: 'ready' });
      await expect(pending).rejects.toThrow('workspace_bundle_account_changed');
    }
  );

  it('rejects a legacy email change even when canonical user ID stays the same', async () => {
    mocks.fetchGet.mockImplementation(async () => {
      account.current = { ...account.current, email: 'changed@example.test' };
      return { runtime_readiness: 'ready' };
    });
    await expect(
      fetchWorkspaceBundleInstallForSpace('space-1')
    ).rejects.toThrow('workspace_bundle_account_changed');
  });

  it('rejects materialization whose explicit identity belongs to a previous account', async () => {
    await expect(
      materializeWorkspaceBundle({
        ...proposal,
        email: 'other@example.test',
        userId: 8,
      })
    ).rejects.toThrow('workspace_bundle_account_changed');
    expect(mocks.fetchPost).not.toHaveBeenCalled();
  });
});
