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

import Workspace from '@/components/Workspace';
import { createSyncedProjectInSpace } from '@/lib/spaceProject';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const oldSetAttaches = vi.fn();
  const newSetAttaches = vi.fn();
  const newStartTask = vi.fn().mockResolvedValue(undefined);
  const newChatState = {
    activeTaskId: 'new-task',
    tasks: {
      'new-task': {
        attaches: [],
      },
    },
    setHasMessages: vi.fn(),
    setAttaches: newSetAttaches,
    startTask: newStartTask,
    setHasWaitComfirm: vi.fn(),
  };
  const oldChatState = {
    activeTaskId: 'old-task',
    tasks: {
      'old-task': {
        attaches: [{ fileName: 'old.txt', filePath: '/old.txt' }],
        messages: [],
        hasMessages: false,
        status: 'pending',
        taskAssigning: [],
      },
    },
    setAttaches: oldSetAttaches,
  };
  const projectState = {
    activeProjectId: 'old-project',
    projects: {
      'old-project': {
        id: 'old-project',
        metadata: {},
        mode: 'workforce',
      },
    },
    navLeadByProjectId: {},
    isEmptyProject: vi.fn(() => false),
    setActiveProject: vi.fn(),
    getActiveChatStore: vi.fn(() => ({
      getState: () => newChatState,
    })),
  };
  const spaceState = {
    activeSpaceId: 'space-1',
    spaces: {
      'space-1': {
        id: 'space-1',
        sourceType: 'blank',
        status: 'active',
      },
    },
    projectsBySpaceId: {},
    getProjectMeta: vi.fn(() => null),
    setActiveSpace: vi.fn(),
  };
  const pageState = {
    activeWorkspaceTab: 'workforce',
    workspaceChatFocusRequestId: 0,
    customAgentFolderPathByProjectId: {},
    setActiveWorkspaceTab: vi.fn(),
  };

  return {
    newChatState,
    newStartTask,
    newSetAttaches,
    oldChatState,
    oldSetAttaches,
    pageState,
    projectState,
    spaceState,
  };
});

vi.mock('@/hooks/useChatStoreAdapter', () => ({
  default: () => ({
    chatStore: mocks.oldChatState,
    projectStore: mocks.projectState,
  }),
}));

vi.mock('@/hooks/useModelConfigCheck', () => ({
  useModelConfigCheck: () => ({ hasModel: true }),
}));

vi.mock('@/host', () => ({
  useHost: () => ({ electronAPI: {} }),
}));

vi.mock('@/store/authStore', () => ({
  getAuthStore: () => ({
    language: 'en',
    setLanguage: vi.fn(),
  }),
  useAuthStore: () => ({
    modelType: 'local',
    setWorkerList: vi.fn(),
  }),
  useWorkerList: () => [],
}));

vi.mock('@/store/pageTabStore', () => {
  const usePageTabStore = Object.assign(
    (selector: (state: typeof mocks.pageState) => unknown) =>
      selector(mocks.pageState),
    { getState: () => mocks.pageState }
  );
  return { usePageTabStore };
});

vi.mock('@/store/projectRuntimeStore', () => {
  const useProjectRuntimeStore = Object.assign(
    (selector: (state: typeof mocks.projectState) => unknown) =>
      selector(mocks.projectState),
    { getState: () => mocks.projectState }
  );
  return { useProjectRuntimeStore };
});

vi.mock('@/store/spaceStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/spaceStore')>();
  const useSpaceStore = Object.assign(
    (selector: (state: typeof mocks.spaceState) => unknown) =>
      selector(mocks.spaceState),
    { getState: () => mocks.spaceState }
  );
  return {
    ...actual,
    useSpaceStore,
  };
});

vi.mock('@/lib/spaceProject', () => ({
  createSyncedProjectInSpace: vi.fn(),
}));

vi.mock('@/components/ChatBox/BottomBox', () => ({
  default: ({ inputProps }: { inputProps: any }) => (
    <div>
      <input
        aria-label="workspace-message"
        value={inputProps.value}
        onChange={(event) => inputProps.onChange(event.target.value)}
      />
      <button
        type="button"
        onClick={() =>
          inputProps.onFilesChange([
            { fileName: 'draft.txt', filePath: '/draft.txt' },
          ])
        }
      >
        Attach draft
      </button>
      <button type="button" onClick={inputProps.onSend}>
        Send
      </button>
    </div>
  ),
}));

vi.mock('@/components/AddWorker', () => ({
  AddWorker: () => null,
}));
vi.mock('@/components/Workspace/SingleAgentList', () => ({
  SingleAgentList: () => null,
}));
vi.mock('@/components/Workspace/WorkforceAgentList', () => ({
  WorkforceAgentList: () => null,
}));
vi.mock('@/components/Workspace/WorkspaceAllSessions', () => ({
  WorkspaceAllSessions: () => null,
}));
vi.mock('@/components/Workspace/WorkspaceCoworkPanel', () => ({
  WorkspaceCoworkPanel: () => null,
}));
vi.mock('@/components/Workspace/WorkspaceExamplePrompts', () => ({
  WorkspaceExamplePrompts: () => null,
}));
vi.mock('@/components/Workspace/WorkspaceInstructionMd', () => ({
  WorkspaceInstructionMd: () => null,
}));
vi.mock('@/components/Workspace/WorkspaceProjectPicker', () => ({
  WorkspaceProjectPicker: () => null,
}));
vi.mock('@/components/Workspace/WorkspaceRecentSessions', () => ({
  WorkspaceRecentSessions: () => null,
}));

const renderWorkspace = () =>
  render(
    <MemoryRouter>
      <Workspace />
    </MemoryRouter>
  );

describe('Workspace project creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSyncedProjectInSpace).mockResolvedValue({
      projectId: 'new-project',
      spaceId: 'space-1',
    });
    mocks.newStartTask.mockResolvedValue(undefined);
  });

  it('creates a fresh project and sends only Workspace draft attachments', async () => {
    renderWorkspace();

    fireEvent.change(screen.getByLabelText('workspace-message'), {
      target: { value: 'Start fresh work' },
    });
    fireEvent.click(screen.getByText('Attach draft'));
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => {
      expect(createSyncedProjectInSpace).toHaveBeenCalledTimes(1);
    });
    expect(createSyncedProjectInSpace).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: 'space-1',
        name: 'Start fresh work',
      })
    );
    expect(mocks.newStartTask).toHaveBeenCalledWith(
      'new-task',
      undefined,
      undefined,
      undefined,
      'Start fresh work',
      [{ fileName: 'draft.txt', filePath: '/draft.txt' }],
      undefined,
      'new-project',
      'single-agent'
    );
    expect(mocks.oldSetAttaches).not.toHaveBeenCalled();
  });

  it('guards against duplicate submissions while project creation is pending', async () => {
    let resolveCreation:
      | ((value: { projectId: string; spaceId: string }) => void)
      | undefined;
    vi.mocked(createSyncedProjectInSpace).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreation = resolve;
        })
    );
    renderWorkspace();

    fireEvent.change(screen.getByLabelText('workspace-message'), {
      target: { value: 'Only once' },
    });
    fireEvent.click(screen.getByText('Send'));
    fireEvent.click(screen.getByText('Send'));

    expect(createSyncedProjectInSpace).toHaveBeenCalledTimes(1);
    resolveCreation?.({ projectId: 'new-project', spaceId: 'space-1' });
    await waitFor(() => expect(mocks.newStartTask).toHaveBeenCalledTimes(1));
  });
});
