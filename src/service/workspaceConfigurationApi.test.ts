import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchGetMock, fetchPutMock } = vi.hoisted(() => ({
  fetchGetMock: vi.fn(),
  fetchPutMock: vi.fn(),
}));

vi.mock('@/api/http', () => ({
  fetchGet: fetchGetMock,
  fetchPut: fetchPutMock,
}));

import {
  fetchWorkspaceConfiguration,
  saveWorkspaceConfiguration,
  type WorkspaceConfigurationDocument,
} from './workspaceConfigurationApi';

const document: WorkspaceConfigurationDocument = {
  apiVersion: 'eigent.ai/v1alpha1',
  kind: 'WorkforceBundle',
  metadata: { id: 'bundle-1', name: 'Bundle', revision: 1 },
  spec: {
    instructions: {},
    context: [],
    skills: [],
    connectors: [],
    mcpServers: [],
    agents: [],
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
    fetchPutMock.mockReset();
  });

  it('loads a Space-scoped working copy without sending a local path', async () => {
    fetchGetMock.mockResolvedValue({ version: 0, document });

    await fetchWorkspaceConfiguration(
      'space/1',
      { email: 'user@example.com', userId: 42 },
      'Research Space'
    );

    expect(fetchGetMock).toHaveBeenCalledWith(
      '/api/v1/spaces/space%2F1/workspace-configuration',
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
      '/api/v1/spaces/space-1/workspace-configuration',
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
