import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  WorkspaceConfigurationDocument,
  WorkspaceConfigurationDraft,
} from '@/service/workspaceConfigurationApi';

const { fetchMock, saveMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  saveMock: vi.fn(),
}));

vi.mock('@/service/workspaceConfigurationApi', async () => {
  const actual = await vi.importActual<
    typeof import('@/service/workspaceConfigurationApi')
  >('@/service/workspaceConfigurationApi');
  return {
    ...actual,
    fetchWorkspaceConfiguration: fetchMock,
    saveWorkspaceConfiguration: saveMock,
  };
});

import { useWorkspaceConfiguration } from '@/hooks/useWorkspaceConfiguration';

const makeDocument = (name = 'Research'): WorkspaceConfigurationDocument => ({
  apiVersion: 'eigent.ai/v1alpha1',
  kind: 'WorkforceBundle',
  metadata: { id: 'bundle-1', name, revision: 1 },
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
});

const draft = (
  version: number,
  document: WorkspaceConfigurationDocument
): WorkspaceConfigurationDraft => ({
  space_id: 'space-1',
  version,
  base_revision_id: null,
  document,
  document_digest: 'a'.repeat(64),
  persisted: version > 0,
  updated_at: version > 0 ? 10 : null,
});

describe('useWorkspaceConfiguration', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    saveMock.mockReset();
  });

  it('does not write the unchanged document after loading', async () => {
    fetchMock.mockResolvedValue(draft(0, makeDocument()));
    const { result } = renderHook(() =>
      useWorkspaceConfiguration({
        spaceId: 'space-1',
        spaceName: 'Research',
        identity: { email: 'user@example.com', userId: 7 },
        autosaveDelayMs: 1,
      })
    );

    await waitFor(() => expect(result.current.document).not.toBeNull());
    await new Promise((resolve) => window.setTimeout(resolve, 10));

    expect(saveMock).not.toHaveBeenCalled();
  });

  it('serializes autosaves and advances the CAS version', async () => {
    fetchMock.mockResolvedValue(draft(0, makeDocument()));
    let resolveFirst!: (value: WorkspaceConfigurationDraft) => void;
    saveMock
      .mockImplementationOnce(
        () =>
          new Promise<WorkspaceConfigurationDraft>((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockImplementationOnce((_spaceId, _identity, input) =>
        Promise.resolve(draft(2, input.document))
      );
    const { result } = renderHook(() =>
      useWorkspaceConfiguration({
        spaceId: 'space-1',
        spaceName: 'Research',
        identity: { email: 'user@example.com', userId: 7 },
        autosaveDelayMs: 1,
      })
    );
    await waitFor(() => expect(result.current.document).not.toBeNull());

    act(() => {
      result.current.setDocument(makeDocument('First'));
    });
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    act(() => {
      result.current.setDocument(makeDocument('Second'));
    });
    await new Promise((resolve) => window.setTimeout(resolve, 10));
    expect(saveMock).toHaveBeenCalledTimes(1);

    act(() => resolveFirst(draft(1, makeDocument('First'))));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(2));

    expect(saveMock.mock.calls[0][2].expectedVersion).toBe(0);
    expect(saveMock.mock.calls[1][2].expectedVersion).toBe(1);
    await waitFor(() => expect(result.current.saveState).toBe('saved'));
  });
});
