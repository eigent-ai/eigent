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
import type { ComponentProps } from 'react';
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
    getComposerThinkingEffort: vi.fn<() => 'high' | undefined>(() => 'high'),
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
  default: ({
    inputProps,
    sessionModeSelectInteractive,
    modelSelectProjectId,
  }: {
    inputProps: any;
    sessionModeSelectInteractive?: boolean;
    modelSelectProjectId?: string | null;
  }) => (
    <div>
      <div
        data-testid="workspace-bottom-box-footer-props"
        data-interactive={String(Boolean(sessionModeSelectInteractive))}
        data-project-id={modelSelectProjectId ?? ''}
      />
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
vi.mock('@/components/Workspace/WorkspaceProjectPicker', () => ({
  WorkspaceProjectPicker: () => <div>Space switch</div>,
}));
const renderWorkspace = (props: ComponentProps<typeof Workspace> = {}) =>
  render(
    <MemoryRouter>
      <Workspace {...props} />
    </MemoryRouter>
  );

describe('Workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.spaceState.projectsBySpaceId = {};
    vi.mocked(createSyncedProjectInSpace).mockResolvedValue({
      projectId: 'new-project',
      spaceId: 'space-1',
    });
    mocks.projectState.getComposerThinkingEffort.mockReturnValue('high');
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
        metadata: expect.objectContaining({
          createdFrom: 'workspace_direct_chat',
          thinkingEffort: 'high',
        }),
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

  it('shares the projectless interactive footer across Workspace and New session', () => {
    const workspace = renderWorkspace();

    expect(
      screen.getByTestId('workspace-bottom-box-footer-props')
    ).toHaveAttribute('data-interactive', 'true');
    expect(
      screen.getByTestId('workspace-bottom-box-footer-props')
    ).toHaveAttribute('data-project-id', '');

    workspace.unmount();
    renderWorkspace({ variant: 'new-project' });

    expect(
      screen.getByTestId('workspace-bottom-box-footer-props')
    ).toHaveAttribute('data-interactive', 'true');
    expect(
      screen.getByTestId('workspace-bottom-box-footer-props')
    ).toHaveAttribute('data-project-id', '');
  });

  it('inherits the configured thinking effort when the composer is untouched', async () => {
    mocks.projectState.getComposerThinkingEffort.mockReturnValue(undefined);
    renderWorkspace();

    fireEvent.change(screen.getByLabelText('workspace-message'), {
      target: { value: 'Use the configured effort' },
    });
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => {
      expect(createSyncedProjectInSpace).toHaveBeenCalledTimes(1);
    });
    const createInput = vi.mocked(createSyncedProjectInSpace).mock.calls[0][0];
    expect(createInput.metadata).toEqual({
      createdFrom: 'workspace_direct_chat',
    });
  });

  it('does not show a Workspace Profile control in the header', () => {
    renderWorkspace();

    expect(
      screen.queryByRole('button', { name: 'layout.workspace-profile' })
    ).not.toBeInTheDocument();
  });

  it('centers the composer without Workspace management subpages', () => {
    renderWorkspace();

    expect(
      screen.queryByRole('complementary', { name: 'Workspace management' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Space settings' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Memory settings' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /All projects/ })
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Workspace header')).toHaveClass(
      'flex-1',
      'items-center'
    );
  });

  it('uses one left-aligned Cowork row without the Space switch above BottomBox', () => {
    const { container } = renderWorkspace();

    expect(screen.queryByText('Space switch')).not.toBeInTheDocument();
    const coworkLabel = screen.getByText('Cowork with');
    const singleAgentLabel = screen.getByText('Single Agent');
    const coworkRow = coworkLabel.closest('[data-workspace-cowork-row]');
    const agentList = container.querySelector('[data-workspace-agent-list]');
    const bottomBox = container.querySelector('[data-workspace-bottom-box]');
    const inputSection = container.querySelector(
      '[data-workspace-input-section]'
    );
    const workspaceHeader = screen.getByLabelText('Workspace header');

    expect(coworkLabel).toHaveClass('text-ds-text-display', 'font-display');
    expect(singleAgentLabel).toHaveClass(
      'text-ds-text-display',
      'font-display'
    );
    expect(workspaceHeader).toHaveClass('flex-1', 'items-center', 'gap-0');
    expect(inputSection).toHaveClass('items-center', 'p-4');
    expect(coworkRow).toHaveClass(
      'min-h-[46px]',
      'items-center',
      'justify-start'
    );
    expect(agentList).toHaveClass(
      'h-[46px]',
      'min-h-[46px]',
      'items-center',
      'justify-start',
      'overflow-visible'
    );
    expect(coworkRow?.nextElementSibling).toBe(bottomBox);
  });

  it('uses the same Cowork composer for the new-project variant', () => {
    const { container } = renderWorkspace({
      variant: 'new-project',
      embedded: true,
    });

    expect(screen.getByText('Cowork with')).toBeInTheDocument();
    expect(screen.getByText('Single Agent')).toBeInTheDocument();
    expect(screen.queryByText('Space switch')).not.toBeInTheDocument();
    expect(container.querySelector('#workspace-bottom-group')).toBeNull();
    expect(screen.getByLabelText('Workspace header')).toHaveClass(
      'flex-1',
      'items-center',
      'gap-0'
    );
  });

  it('keeps the agent-list height fixed across Single Agent and Workforce modes', () => {
    const singleAgentView = renderWorkspace({ sessionMode: 'single-agent' });
    const singleAgentList = singleAgentView.container.querySelector(
      '[data-workspace-agent-list]'
    );

    expect(singleAgentList).toHaveClass('h-[46px]', 'min-h-[46px]');

    singleAgentView.unmount();
    const workforceView = renderWorkspace({ sessionMode: 'workforce' });
    const workforceAgentList = workforceView.container.querySelector(
      '[data-workspace-agent-list]'
    );

    expect(workforceAgentList).toHaveClass('h-[46px]', 'min-h-[46px]');
  });

  it('shows the mode label only for Single Agent mode', () => {
    const { unmount } = renderWorkspace({ sessionMode: 'single-agent' });

    expect(screen.getByText('Single Agent')).toBeInTheDocument();

    unmount();
    renderWorkspace({ sessionMode: 'workforce' });

    expect(screen.queryByText('Single Agent')).not.toBeInTheDocument();
  });

  it('guards against duplicate submissions while project creation is pending', async () => {
    let resolveCreation:
      ((value: { projectId: string; spaceId: string }) => void) | undefined;
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
