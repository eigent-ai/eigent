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
        metadata: {},
      },
    },
    projectsBySpaceId: {},
    getProjectMeta: vi.fn(() => null),
    setActiveSpace: vi.fn(),
    updateSpace: vi.fn(),
    updateSpaceOnServer: vi.fn().mockResolvedValue(undefined),
  };
  const dashboardLoadContent = vi.fn(async (file: FileInfo) => ({
    ...file,
    content: '# Delivery\n- [ ] Send client sample',
  }));
  const dashboardFileState = {
    activeSpace: spaceState.spaces['space-1'],
    files: [] as FileInfo[],
    loading: false,
    error: null as string | null,
    refresh: vi.fn(),
    loadContent: dashboardLoadContent,
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
    dashboardFileState,
    dashboardLoadContent,
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

vi.mock('@/components/Workspace/useWorkspaceDashboardFiles', () => ({
  useWorkspaceDashboardFiles: () => mocks.dashboardFileState,
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
    mocks.spaceState.spaces['space-1'].metadata = {};
    mocks.dashboardFileState.activeSpace = mocks.spaceState.spaces['space-1'];
    mocks.dashboardFileState.files = [];
    mocks.dashboardFileState.loading = false;
    mocks.dashboardFileState.error = null;
    mocks.dashboardLoadContent.mockImplementation(async (file: FileInfo) => ({
      ...file,
      content: '# Delivery\n- [ ] Send client sample',
    }));
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

  it('does not show a Workspace Profile control in the header', () => {
    renderWorkspace();

    expect(
      screen.queryByRole('button', { name: 'layout.workspace-profile' })
    ).not.toBeInTheDocument();
  });

  it('places the composer above the CRM dashboard without management subpages', () => {
    const { container } = renderWorkspace();

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
      'shrink-0',
      'min-h-[55vh]',
      'items-end',
      'justify-center',
      'pb-ds-64'
    );
    expect(screen.getByLabelText('Workspace header')).not.toHaveClass(
      'border-b'
    );
    expect(
      container.querySelector('[data-workspace-dashboard-scroll-root]')
    ).toHaveClass('scrollbar-always-visible', 'overflow-y-auto');
    expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'To-dos' })).toHaveClass(
      'max-w-[400px]'
    );
    const tabsRegion = container.querySelector(
      '[data-workspace-dashboard-tabs-region]'
    );
    const stickyTabs = container.querySelector(
      '[data-workspace-dashboard-tabs-sticky]'
    );
    expect(stickyTabs).toHaveClass('sticky', 'border-b');
    expect(stickyTabs).not.toHaveClass('blur-[2px]');
    expect(tabsRegion).toHaveClass('opacity-40', 'transition-opacity');
    expect(tabsRegion).toHaveAttribute(
      'data-workspace-dashboard-tabs-revealed',
      'false'
    );
    expect(
      screen.getByText(
        'Link the Markdown documents that should appear in this dashboard section.'
      ).className
    ).not.toMatch(/(?:^|\s)max-w-/);
    expect(
      screen.getByText(
        'Link one or more Markdown files containing task checkboxes.'
      ).className
    ).not.toMatch(/(?:^|\s)max-w-/);
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
    expect(workspaceHeader).toHaveClass(
      'shrink-0',
      'min-h-[55vh]',
      'items-end',
      'justify-center',
      'pb-ds-64'
    );
    expect(inputSection).toHaveClass('max-w-[600px]', 'min-w-0', 'flex-col');
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

  it('manually links a Markdown file to the active CRM section', () => {
    mocks.dashboardFileState.files = [
      {
        name: 'acme.md',
        type: 'md',
        path: '/space/clients/acme.md',
        relativePath: 'clients/acme.md',
      },
    ];
    renderWorkspace();

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Link files' })[0] as HTMLElement
    );
    fireEvent.click(screen.getByLabelText(/acme\.md/));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mocks.spaceState.updateSpace).toHaveBeenCalledWith(
      'space-1',
      expect.objectContaining({
        metadata: expect.objectContaining({
          workspaceDashboard: {
            version: 1,
            sources: { overview: ['clients/acme.md'] },
          },
        }),
      })
    );
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
