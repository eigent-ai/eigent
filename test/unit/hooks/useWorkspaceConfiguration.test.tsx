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
  kind: 'WorkspaceBundle',
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
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });
    expect(saveMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst(draft(1, makeDocument('First')));
      await Promise.resolve();
    });
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(2));

    expect(saveMock.mock.calls[0][2].expectedVersion).toBe(0);
    expect(saveMock.mock.calls[1][2].expectedVersion).toBe(1);
    await waitFor(() => expect(result.current.saveState).toBe('saved'));
  });

  it('flushes the latest document without waiting for the autosave delay', async () => {
    fetchMock.mockResolvedValue(draft(0, makeDocument()));
    saveMock.mockImplementation((_spaceId, _identity, input) =>
      Promise.resolve(draft(1, input.document))
    );
    const { result } = renderHook(() =>
      useWorkspaceConfiguration({
        spaceId: 'space-1',
        spaceName: 'Research',
        identity: { email: 'user@example.com', userId: 7 },
        autosaveDelayMs: 60_000,
      })
    );
    await waitFor(() => expect(result.current.document).not.toBeNull());

    act(() => {
      result.current.setDocument(makeDocument('Close safely'));
    });
    expect(result.current.hasPendingChanges).toBe(true);

    let didFlush = false;
    await act(async () => {
      didFlush = await result.current.flushSave();
    });

    expect(didFlush).toBe(true);
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock.mock.calls[0][2].document.metadata.name).toBe(
      'Close safely'
    );
    expect(result.current.hasPendingChanges).toBe(false);
    expect(result.current.saveState).toBe('saved');
  });

  it('waits for queued saves before flushing the newest document', async () => {
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
      result.current.setDocument(makeDocument('Newest'));
    });

    let flushPromise!: Promise<boolean>;
    act(() => {
      flushPromise = result.current.flushSave();
    });
    expect(result.current.hasPendingChanges).toBe(true);
    expect(saveMock).toHaveBeenCalledTimes(1);

    act(() => resolveFirst(draft(1, makeDocument('First'))));
    let didFlush = false;
    await act(async () => {
      didFlush = await flushPromise;
    });

    expect(didFlush).toBe(true);
    expect(saveMock).toHaveBeenCalledTimes(2);
    expect(saveMock.mock.calls[1][2].expectedVersion).toBe(1);
    expect(saveMock.mock.calls[1][2].document.metadata.name).toBe('Newest');
    expect(result.current.hasPendingChanges).toBe(false);
  });

  it('reports a failed flush and keeps the document pending', async () => {
    fetchMock.mockResolvedValue(draft(0, makeDocument()));
    saveMock.mockRejectedValue(new Error('save unavailable'));
    const { result } = renderHook(() =>
      useWorkspaceConfiguration({
        spaceId: 'space-1',
        spaceName: 'Research',
        identity: { email: 'user@example.com', userId: 7 },
        autosaveDelayMs: 60_000,
      })
    );
    await waitFor(() => expect(result.current.document).not.toBeNull());

    act(() => {
      result.current.setDocument(makeDocument('Still pending'));
    });

    let didFlush = true;
    await act(async () => {
      didFlush = await result.current.flushSave();
    });

    expect(didFlush).toBe(false);
    expect(result.current.hasPendingChanges).toBe(true);
    expect(result.current.saveState).toBe('needs_attention');
    expect(result.current.error).toBe('save unavailable');
  });
});
