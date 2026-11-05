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

import { openSessionInShell } from '@/lib/sessionOpen';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSessionWindowsStore } from '@/store/sessionWindowsStore';
import { useSpaceStore, type SpaceProjectMeta } from '@/store/spaceStore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureProjectRuntimeLoaded: vi.fn(),
  routeState: { route: null as { route: string } | null },
}));

vi.mock('@/lib/projectRuntimeHydration', () => ({
  ensureProjectRuntimeLoaded: mocks.ensureProjectRuntimeLoaded,
}));
vi.mock('@/store/sessionExecutionStore', () => ({
  getSessionExecutionState: () => mocks.routeState,
}));

const meta = {
  id: 'session-1',
  spaceId: 'space-a',
  name: 'Weekly report',
  status: 'active',
  createdAt: 1,
  updatedAt: 1,
  metadata: { historyId: 'history-1' },
} as unknown as SpaceProjectMeta;

const tab = () => usePageTabStore.getState().activeWorkspaceTab;

describe('openSessionInShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.routeState.route = null;
    usePageTabStore.setState({ activeWorkspaceTab: 'new-project' });
    useSessionWindowsStore.setState({ openProjectIds: [] });
    useSpaceStore.setState({
      activeSpaceId: 'space-a',
      projectsBySpaceId: { 'space-a': { 'session-1': meta } },
      projectIdIndex: { 'session-1': 'space-a' },
    });
  });

  function seedRuntime(loaded: boolean) {
    useProjectRuntimeStore.setState({
      activeProjectId: null,
      setActiveProject: (projectId: string | null) =>
        useProjectRuntimeStore.setState({ activeProjectId: projectId }),
      getProjectById: () => undefined,
      peekActiveChatStore: () => (loaded ? ({} as never) : undefined),
      historyLoadIncompleteProjectIds: {},
    } as never);
  }

  it('shows a loaded Session at once, with no Brain or history read', async () => {
    seedRuntime(true);

    await openSessionInShell('session-1');

    expect(tab()).toBe('project');
    expect(mocks.ensureProjectRuntimeLoaded).not.toHaveBeenCalled();
  });

  it('shows a listed Session before its history has loaded', async () => {
    seedRuntime(false);
    let finishLoad!: () => void;
    mocks.ensureProjectRuntimeLoaded.mockReturnValue(
      new Promise<void>((resolve) => {
        finishLoad = resolve;
      })
    );

    const opening = openSessionInShell('session-1');

    expect(tab()).toBe('project');
    mocks.routeState.route = { route: 'managed' };
    finishLoad();
    await opening;
    expect(tab()).toBe('project');
  });

  it('stays on the Session tab when the route read fails', async () => {
    seedRuntime(false);
    mocks.ensureProjectRuntimeLoaded.mockRejectedValue(new Error('offline'));

    await openSessionInShell('session-1');

    expect(tab()).toBe('project');
  });
});
