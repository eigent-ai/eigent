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

// Load the HTTP client first, as the app does at boot, so the auth store
// and i18n settle their import cycle in the same order.
import '@/api/http';

import {
  SHELL_HISTORY_SETTLE_MS,
  useShellHistory,
} from '@/hooks/useShellHistory';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useShellHistoryStore } from '@/store/shellHistoryStore';
import { useSpaceStore, type Space } from '@/store/spaceStore';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  switchToSpace: vi.fn(),
  openSessionInShell: vi.fn(),
  setActiveProject: vi.fn(),
}));

vi.mock('@/hooks/useSpaceSwitch', () => ({
  useSpaceSwitch: () => ({ switchToSpace: mocks.switchToSpace }),
}));
vi.mock('@/lib/sessionOpen', () => ({
  openSessionInShell: mocks.openSessionInShell,
}));
vi.mock('@/lib/workspaceConfigurationNavigationGuard', () => ({
  runAfterWorkspaceConfigurationSave: async (
    action: () => void | Promise<void>
  ) => {
    await action();
    return true;
  },
}));

const space = (id: string): Space => ({
  id,
  name: id,
  sourceType: 'folder',
  rootPath: `/work/${id}`,
  status: 'active',
  schemaVersion: 1,
  createdAt: 0,
  updatedAt: 0,
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter initialEntries={['/']}>{children}</MemoryRouter>
);

function renderHistory() {
  return renderHook(
    () => ({ history: useShellHistory(), location: useLocation() }),
    { wrapper }
  );
}

const settle = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(SHELL_HISTORY_SETTLE_MS);
  });

const finishRestore = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(SHELL_HISTORY_SETTLE_MS * 3);
  });

describe('useShellHistory', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.switchToSpace.mockResolvedValue(true);
    mocks.openSessionInShell.mockResolvedValue(undefined);
    useShellHistoryStore.setState({ entries: [], index: -1 });
    useSpaceStore.setState({
      activeSpaceId: 'space-a',
      spaces: { 'space-a': space('space-a'), 'space-b': space('space-b') },
      projectIdIndex: { 'session-1': 'space-a' },
    });
    useProjectRuntimeStore.setState({
      activeProjectId: null,
      setActiveProject: mocks.setActiveProject,
    });
    usePageTabStore.setState({
      shellPlace: 'space',
      activeWorkspaceTab: 'new-project',
    });
  });

  afterEach(() => vi.useRealTimers());

  it('collapses a burst of changes into one place and goes back to the last', async () => {
    const { result } = renderHistory();
    await settle();
    expect(result.current.history.canGoBack).toBe(false);

    act(() => {
      usePageTabStore.getState().setActiveWorkspaceTab('dispatch');
      usePageTabStore.getState().setActiveWorkspaceTab('triggers');
      usePageTabStore.getState().setActiveWorkspaceTab('files');
    });
    await settle();
    expect(useShellHistoryStore.getState().entries).toHaveLength(2);
    expect(result.current.history.canGoBack).toBe(true);

    await act(async () => result.current.history.goBack());
    await finishRestore();

    expect(usePageTabStore.getState().activeWorkspaceTab).toBe('new-project');
    expect(result.current.history.canGoForward).toBe(true);

    await act(async () => result.current.history.goForward());
    await finishRestore();
    expect(usePageTabStore.getState().activeWorkspaceTab).toBe('files');
  });

  it('keeps Forward after restoring, and reopens a Session through the shell', async () => {
    useProjectRuntimeStore.setState({ activeProjectId: 'session-1' });
    usePageTabStore.setState({ activeWorkspaceTab: 'project' });
    const { result } = renderHistory();
    await settle();

    act(() => usePageTabStore.getState().setActiveWorkspaceTab('dispatch'));
    await settle();
    await act(async () => result.current.history.goBack());
    await finishRestore();

    expect(mocks.openSessionInShell).toHaveBeenCalledWith('session-1');
    expect(useShellHistoryStore.getState().entries).toHaveLength(2);
    expect(result.current.history.canGoForward).toBe(true);
  });

  it('switches back to the Space a place belonged to', async () => {
    const { result } = renderHistory();
    await settle();

    act(() => useSpaceStore.setState({ activeSpaceId: 'space-b' }));
    await settle();
    await act(async () => result.current.history.goBack());
    await finishRestore();

    expect(mocks.switchToSpace).toHaveBeenCalledWith('space-a', {
      project: null,
      tab: null,
    });
  });

  it('skips a place whose Session was deleted', async () => {
    usePageTabStore.setState({ activeWorkspaceTab: 'dispatch' });
    const { result } = renderHistory();
    await settle();
    useProjectRuntimeStore.setState({ activeProjectId: 'session-1' });
    act(() => usePageTabStore.getState().setActiveWorkspaceTab('project'));
    await settle();
    act(() => usePageTabStore.getState().setActiveWorkspaceTab('triggers'));
    useProjectRuntimeStore.setState({ activeProjectId: null });
    act(() => usePageTabStore.getState().setActiveWorkspaceTab('files'));
    await settle();

    useSpaceStore.setState({ projectIdIndex: {} });
    await act(async () => result.current.history.goBack());
    await finishRestore();

    expect(mocks.openSessionInShell).not.toHaveBeenCalled();
    expect(usePageTabStore.getState().activeWorkspaceTab).toBe('dispatch');
  });
});
