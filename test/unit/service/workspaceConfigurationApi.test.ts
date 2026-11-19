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

const { fetchGetMock, fetchPostFormMock, fetchPostMock, fetchPutMock } =
  vi.hoisted(() => ({
    fetchGetMock: vi.fn(),
    fetchPostFormMock: vi.fn(),
    fetchPostMock: vi.fn(),
    fetchPutMock: vi.fn(),
  }));

vi.mock('@/api/http', () => ({
  fetchGet: fetchGetMock,
  fetchPostForm: fetchPostFormMock,
  fetchPost: fetchPostMock,
  fetchPut: fetchPutMock,
}));

import {
  fetchWorkspaceConfiguration,
  preflightPreparedWorkspaceConfigurationAssets,
  preflightWorkspaceConfigurationAsset,
  saveWorkspaceConfiguration,
  uploadPreparedWorkspaceConfigurationAsset,
  workspaceEnvironmentVariables,
  type WorkspaceConfigurationDocument,
} from '@/service/workspaceConfigurationApi';

const document: WorkspaceConfigurationDocument = {
  apiVersion: 'eigent.ai/v1alpha1',
  kind: 'WorkspaceBundle',
  metadata: { id: 'bundle-1', name: 'Bundle', revision: 1 },
  spec: {
    instructions: {},
    context: [],
    skills: [],
    connectors: [],
    mcpServers: [],
    agents: [],
    environment: { variables: [] },
    models: {
      default: {
        modelRef: 'provider://default',
        thinkingEffort: 'medium',
      },
    },
    permissions: { profile: 'request_approval', rules: [] },
    git: {
      enabled: true,
      checkpointPolicy: 'user_and_run_terminal',
      agentIsolation: 'worktree',
      remotePolicy: 'prompt',
    },
  },
};

describe('workspace configuration API', () => {
  beforeEach(() => {
    fetchGetMock.mockReset();
    fetchPostFormMock.mockReset();
    fetchPostMock.mockReset();
    fetchPutMock.mockReset();
  });

  it('treats a legacy Bundle without environment requirements as empty', () => {
    const legacy = structuredClone(document);
    delete legacy.spec.environment;

    expect(workspaceEnvironmentVariables(legacy)).toEqual([]);
  });

  it('preflights an explicitly selected asset with the local Brain', async () => {
    fetchPostFormMock.mockResolvedValue({
      logical_path: 'instructions/coordinator.md',
      content_digest: 'a'.repeat(64),
      size_bytes: 4,
    });
    const file = new File(['safe'], 'coordinator.md');

    await preflightWorkspaceConfigurationAsset(
      'space/1',
      { email: 'user@example.com', userId: 42 },
      'bundle://instructions/coordinator.md',
      file
    );

    const [path, form] = fetchPostFormMock.mock.calls[0];
    expect(path).toContain(
      '/spaces/space%2F1/workspace-configuration/asset-preflight?'
    );
    expect(path).toContain('email=user%40example.com');
    expect(path).toContain('user_id=42');
    expect(form.get('logical_path')).toBe(
      'bundle://instructions/coordinator.md'
    );
    expect((form.get('file') as File).name).toBe(file.name);
    expect((form.get('file') as File).size).toBe(file.size);
  });

  it('preflights and uploads prepared assets using descriptors only', async () => {
    fetchPostMock.mockResolvedValue({ assets: [] });
    const pin = {
      expectedVersion: 4,
      expectedManifestDigest: 'a'.repeat(64),
      expectedReviewDigest: 'b'.repeat(64),
    };

    await preflightPreparedWorkspaceConfigurationAssets(
      'space/1',
      { email: 'user@example.com', userId: 42 },
      pin
    );
    await uploadPreparedWorkspaceConfigurationAsset(
      'space/1',
      { email: 'user@example.com', userId: 42 },
      {
        ...pin,
        logicalPath: 'bundle://agent-plugins/demo/bin/server',
        contentDigest: 'c'.repeat(64),
        expectedOldDigest: 'd'.repeat(64),
      }
    );

    expect(fetchPostMock.mock.calls).toEqual([
      [
        '/spaces/space%2F1/workspace-configuration/prepared-assets:preflight',
        {
          email: 'user@example.com',
          user_id: 42,
          expected_version: 4,
          expected_manifest_digest: 'a'.repeat(64),
          expected_review_digest: 'b'.repeat(64),
        },
      ],
      [
        '/spaces/space%2F1/workspace-configuration/prepared-assets:upload',
        {
          email: 'user@example.com',
          user_id: 42,
          expected_version: 4,
          expected_manifest_digest: 'a'.repeat(64),
          expected_review_digest: 'b'.repeat(64),
          logical_path: 'bundle://agent-plugins/demo/bin/server',
          content_digest: 'c'.repeat(64),
          expected_old_digest: 'd'.repeat(64),
        },
      ],
    ]);
    expect(fetchPostMock.mock.calls[0][1]).not.toHaveProperty('content');
    expect(fetchPostMock.mock.calls[1][1]).not.toHaveProperty('content');
    expect(fetchPostMock.mock.calls[1][1]).not.toHaveProperty('file');
    expect(JSON.stringify(fetchPostMock.mock.calls)).not.toContain('File');
  });

  it('reviews and records a publish through capability-protected local APIs', async () => {
    const {
      recordPublishedWorkspaceConfiguration,
      reviewWorkspaceConfiguration,
    } = await import('@/service/workspaceConfigurationApi');
    fetchGetMock.mockResolvedValue({ draft_version: 4, review: {} });
    fetchPostMock.mockResolvedValue({ revision: {}, draft: {} });

    await reviewWorkspaceConfiguration('space/1', {
      email: 'user@example.com',
      userId: 42,
    });
    await recordPublishedWorkspaceConfiguration(
      'space/1',
      { email: 'user@example.com', userId: 42 },
      {
        expectedVersion: 4,
        revisionId: 'bundle-1@1',
        manifestDigest: 'a'.repeat(64),
        actorId: '42',
      }
    );

    expect(fetchGetMock).toHaveBeenCalledWith(
      '/spaces/space%2F1/workspace-configuration/review',
      { email: 'user@example.com', user_id: 42 }
    );
    expect(fetchPostMock).toHaveBeenCalledWith(
      '/spaces/space%2F1/workspace-configuration/published',
      {
        email: 'user@example.com',
        user_id: 42,
        expected_version: 4,
        revision_id: 'bundle-1@1',
        manifest_digest: 'a'.repeat(64),
        actor_id: '42',
      }
    );
  });

  it('loads a Space-scoped working copy without sending a local path', async () => {
    fetchGetMock.mockResolvedValue({ version: 0, document });

    await fetchWorkspaceConfiguration(
      'space/1',
      { email: 'user@example.com', userId: 42 },
      'Research Space'
    );

    expect(fetchGetMock).toHaveBeenCalledWith(
      '/spaces/space%2F1/workspace-configuration',
      {
        email: 'user@example.com',
        user_id: 42,
        name: 'Research Space',
      }
    );
    expect(JSON.stringify(fetchGetMock.mock.calls[0])).not.toContain('/Users/');
  });

  it('binds every autosave to the durable draft version', async () => {
    fetchPutMock.mockResolvedValue({ version: 4, document });

    await saveWorkspaceConfiguration(
      'space-1',
      { email: 'user@example.com' },
      {
        expectedVersion: 3,
        baseRevisionId: 'bundle-1@2',
        document,
        updatedBy: 'user-1',
      }
    );

    expect(fetchPutMock).toHaveBeenCalledWith(
      '/spaces/space-1/workspace-configuration',
      {
        email: 'user@example.com',
        expected_version: 3,
        base_revision_id: 'bundle-1@2',
        document,
        updated_by: 'user-1',
      }
    );
  });
});
