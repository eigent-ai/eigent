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
import { notifyError, reportError } from '@/lib/notifyError';
import { createSyncedProjectInSpace } from '@/lib/spaceProject';
import { errorCopy } from '@/lib/usageErrors';
import {
  setUsageAccount,
  setUsageModelType,
  useUsageNoticeStore,
} from '@/store/usageNoticeStore';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
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
    activeProjectId: 'old-project' as string | null,
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
    modelType: 'local',
    auth: { token: 'fixture-a', user_id: 101 as number | null },
    modelConfig: { hasModel: true, cloudUsageLimitReached: false },
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
  useModelConfigCheck: () => mocks.modelConfig,
}));

vi.mock('@/lib/notifyError', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/notifyError')>();
  return { ...actual, notifyError: vi.fn(actual.notifyError) };
});

vi.mock('sonner', () => ({ toast: { error: vi.fn(), dismiss: vi.fn() } }));

vi.mock('@/host', () => ({
  useHost: () => ({ electronAPI: {} }),
}));

vi.mock('@/store/authStore', () => ({
  getAuthStore: () => ({
    ...mocks.auth,
    language: 'en',
    setLanguage: vi.fn(),
  }),
  useAuthStore: () => ({
    modelType: mocks.modelType,
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
    modelSelectDisabled,
    usageLimitBanner,
  }: {
    inputProps: any;
    sessionModeSelectInteractive?: boolean;
    modelSelectProjectId?: string | null;
    modelSelectDisabled?: boolean;
    usageLimitBanner?: { message: string } | null;
  }) => (
    <div>
      <div
        data-testid="workspace-bottom-box-footer-props"
        data-interactive={String(Boolean(sessionModeSelectInteractive))}
        data-project-id={modelSelectProjectId ?? ''}
        data-model-disabled={String(Boolean(modelSelectDisabled))}
      />
      {usageLimitBanner && <div role="alert">{usageLimitBanner.message}</div>}
      {inputProps.files.map((file: { filePath: string; fileName: string }) => (
        <span key={file.filePath}>{file.fileName}</span>
      ))}
      <input
        aria-label="workspace-message"
        disabled={inputProps.disabled}
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
      <button
        type="button"
        onClick={inputProps.onSend}
        disabled={inputProps.disabled}
      >
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
    mocks.modelType = 'local';
    mocks.auth = { token: 'fixture-a', user_id: 101 };
    mocks.modelConfig = { hasModel: true, cloudUsageLimitReached: false };
    mocks.spaceState.activeSpaceId = 'space-1';
    mocks.pageState.activeWorkspaceTab = 'workforce';
    mocks.projectState.activeProjectId = 'old-project';
    setUsageAccount(null);
    setUsageAccount('101');
    setUsageModelType('local');
    useUsageNoticeStore.setState({
      incidents: [],
      refreshing: false,
      refreshError: null,
    });
    mocks.spaceState.projectsBySpaceId = {};
    vi.mocked(createSyncedProjectInSpace).mockImplementation(async () => {
      // Match createSyncedProjectInSpace's default setActive behavior.
      mocks.projectState.activeProjectId = 'new-project';
      return { projectId: 'new-project', spaceId: 'space-1' };
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
      'single-agent',
      { awaitAdmission: true }
    );
    expect(mocks.oldSetAttaches).not.toHaveBeenCalled();
  });

  it('keeps the draft until startup is accepted, then opens the Session', async () => {
    let accept!: () => void;
    mocks.newStartTask.mockReturnValue(
      new Promise<void>((resolve) => {
        accept = resolve;
      })
    );
    renderWorkspace();
    fireEvent.change(screen.getByLabelText('workspace-message'), {
      target: { value: 'Keep this draft' },
    });
    fireEvent.click(screen.getByText('Attach draft'));
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => expect(mocks.newStartTask).toHaveBeenCalledTimes(1));
    expect(mocks.pageState.setActiveWorkspaceTab).not.toHaveBeenCalled();
    expect(screen.getByLabelText('workspace-message')).toHaveValue(
      'Keep this draft'
    );
    expect(screen.getByText('draft.txt')).toBeInTheDocument();
    expect(
      screen.getByTestId('workspace-bottom-box-footer-props')
    ).toHaveAttribute('data-model-disabled', 'true');

    await act(async () => accept());
    expect(mocks.pageState.setActiveWorkspaceTab).toHaveBeenCalledWith(
      'project'
    );
    expect(screen.getByLabelText('workspace-message')).toHaveValue('');
    expect(screen.queryByText('draft.txt')).not.toBeInTheDocument();
  });

  it.each(['workforce', 'new-project'])(
    'preserves text, attachments and the %s page on startup failure',
    async (tab) => {
      mocks.pageState.activeWorkspaceTab = tab;
      mocks.newStartTask.mockRejectedValue(new Error('Usage limit reached'));
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      renderWorkspace({
        variant: tab === 'new-project' ? 'new-project' : 'workspace',
      });
      fireEvent.change(screen.getByLabelText('workspace-message'), {
        target: { value: 'Retry this work' },
      });
      fireEvent.click(screen.getByText('Attach draft'));
      fireEvent.click(screen.getByText('Send'));

      await waitFor(() =>
        expect(notifyError).toHaveBeenCalledWith('Usage limit reached')
      );
      expect(mocks.pageState.setActiveWorkspaceTab).not.toHaveBeenCalled();
      expect(screen.getByLabelText('workspace-message')).toHaveValue(
        'Retry this work'
      );
      expect(screen.getByText('draft.txt')).toBeInTheDocument();
      expect(screen.getByText('Send')).not.toBeDisabled();
      expect(
        screen.getByTestId('workspace-bottom-box-footer-props')
      ).toHaveAttribute('data-model-disabled', 'false');
      consoleError.mockRestore();
    }
  );

  it('does not redirect a user who leaves while startup is pending', async () => {
    let accept!: () => void;
    mocks.newStartTask.mockReturnValue(
      new Promise<void>((resolve) => {
        accept = resolve;
      })
    );
    const view = renderWorkspace();
    fireEvent.change(screen.getByLabelText('workspace-message'), {
      target: { value: 'Start in background' },
    });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(mocks.newStartTask).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => accept());
    expect(mocks.pageState.setActiveWorkspaceTab).not.toHaveBeenCalled();
  });

  it.each([null, 'another-project'])(
    'preserves the composer when a newer Session selection is %s before admission',
    async (activeProjectId) => {
      mocks.pageState.activeWorkspaceTab = 'new-project';
      let accept!: () => void;
      mocks.newStartTask.mockReturnValue(
        new Promise<void>((resolve) => {
          accept = resolve;
        })
      );
      const view = renderWorkspace({ variant: 'new-project' });
      fireEvent.change(screen.getByLabelText('workspace-message'), {
        target: { value: 'Keep my draft' },
      });
      fireEvent.click(screen.getByText('Attach draft'));
      fireEvent.click(screen.getByText('Send'));
      await waitFor(() => expect(mocks.newStartTask).toHaveBeenCalledTimes(1));

      // New session clears selection without changing Space/tab or unmounting
      // Workspace. A different selection likewise belongs to the newer intent.
      mocks.projectState.activeProjectId = activeProjectId;
      view.rerender(
        <MemoryRouter>
          <Workspace variant="new-project" />
        </MemoryRouter>
      );
      await act(async () => accept());

      expect(mocks.pageState.setActiveWorkspaceTab).not.toHaveBeenCalled();
      expect(screen.getByLabelText('workspace-message')).toHaveValue(
        'Keep my draft'
      );
      expect(screen.getByText('draft.txt')).toBeInTheDocument();
      expect(screen.getByText('Send')).not.toBeDisabled();
      // The admitted submission still settles only its own run-local state.
      expect(mocks.newChatState.setHasWaitComfirm).toHaveBeenCalledWith(
        'new-task',
        true
      );
      expect(mocks.newSetAttaches).toHaveBeenLastCalledWith('new-task', []);
    }
  );

  it.each([20, 22])(
    'does not assign departed account key denial %s to the new account',
    async (code) => {
      mocks.modelType = 'cloud';
      setUsageModelType('cloud');
      let reject!: (error: Error) => void;
      mocks.newStartTask.mockReturnValue(
        new Promise<void>((_resolve, rejectPromise) => {
          reject = rejectPromise;
        })
      );
      const view = renderWorkspace();
      fireEvent.change(screen.getByLabelText('workspace-message'), {
        target: { value: 'Start account A work' },
      });
      fireEvent.click(screen.getByText('Send'));
      await waitFor(() => expect(mocks.newStartTask).toHaveBeenCalledTimes(1));
      expect(mocks.newStartTask.mock.calls[0][6]).toBeUndefined();

      view.unmount();
      mocks.auth = { token: 'fixture-b', user_id: 202 };
      setUsageAccount('202');
      await act(async () => {
        // The HTTP layer keeps A's request identity; startTask passes its
        // sanitized rejection to the Workspace catch without an executionId.
        reportError({ code }, { modelType: 'cloud' }, '101');
        reject(
          Object.assign(new Error(errorCopy('credits')), {
            usageReason: 'credits',
            response: { data: { code } },
          })
        );
      });

      expect(useUsageNoticeStore.getState()).toMatchObject({
        account: '202',
        incidents: [],
      });
      expect(notifyError).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
    }
  );

  it.each([null, '101'])(
    'uses current auth when the usage account is %s after logout or account change',
    async (usageAccount) => {
      mocks.modelType = 'cloud';
      setUsageModelType('cloud');
      let reject!: (error: Error) => void;
      mocks.newStartTask.mockReturnValue(
        new Promise<void>((_resolve, rejectPromise) => {
          reject = rejectPromise;
        })
      );
      renderWorkspace();
      fireEvent.change(screen.getByLabelText('workspace-message'), {
        target: { value: 'Pending A work' },
      });
      fireEvent.click(screen.getByText('Send'));
      await waitFor(() => expect(mocks.newStartTask).toHaveBeenCalledTimes(1));

      // Auth updates synchronously, whereas useUsageNotices runs in an effect.
      mocks.auth =
        usageAccount === null
          ? { token: '', user_id: null }
          : { token: 'fixture-b', user_id: 202 };
      setUsageAccount(usageAccount);
      await act(async () => reject(new Error(errorCopy('credits'))));

      expect(notifyError).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
      expect(useUsageNoticeStore.getState().incidents).toEqual([]);
    }
  );

  it.each([20, 22])(
    'keeps the current account key denial %s actionable and deduplicated',
    async (code) => {
      mocks.modelType = 'cloud';
      setUsageModelType('cloud');
      mocks.newStartTask.mockImplementation(async () => {
        reportError({ code }, { modelType: 'cloud' }, '101');
        throw Object.assign(new Error(errorCopy('credits')), {
          usageReason: 'credits',
          response: { data: { code } },
        });
      });
      renderWorkspace();
      fireEvent.change(screen.getByLabelText('workspace-message'), {
        target: { value: 'Keep this rejected draft' },
      });
      fireEvent.click(screen.getByText('Attach draft'));
      fireEvent.click(screen.getByText('Send'));

      await waitFor(() =>
        expect(notifyError).toHaveBeenCalledWith(errorCopy('credits'))
      );
      expect(useUsageNoticeStore.getState()).toMatchObject({
        account: '101',
        incidents: [{ reason: 'credits' }],
      });
      expect(toast.error).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('alert')).toHaveTextContent(errorCopy('credits'));
      expect(screen.getByLabelText('workspace-message')).toHaveValue(
        'Keep this rejected draft'
      );
      expect(screen.getByText('draft.txt')).toBeInTheDocument();
      expect(mocks.pageState.setActiveWorkspaceTab).not.toHaveBeenCalled();
    }
  );

  it('blocks known cloud limits before creating a Session and allows switching to a custom model', async () => {
    mocks.modelType = 'cloud';
    mocks.modelConfig.cloudUsageLimitReached = true;
    useUsageNoticeStore.setState({ incidents: [{ reason: 'credits' }] });
    const view = renderWorkspace({ variant: 'new-project' });
    expect(screen.getByLabelText('workspace-message')).toBeDisabled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(
      screen.getByTestId('workspace-bottom-box-footer-props')
    ).toHaveAttribute('data-model-disabled', 'false');
    fireEvent.click(screen.getByText('Send'));
    expect(createSyncedProjectInSpace).not.toHaveBeenCalled();

    mocks.modelType = 'custom';
    view.rerender(
      <MemoryRouter>
        <Workspace variant="new-project" />
      </MemoryRouter>
    );
    expect(screen.getByLabelText('workspace-message')).not.toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('workspace-message'), {
      target: { value: 'Use my custom model' },
    });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(mocks.newStartTask).toHaveBeenCalledTimes(1));
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
    const coworkRow = coworkLabel.closest('[data-workspace-cowork-row]');
    const agentList = container.querySelector('[data-workspace-agent-list]');
    const bottomBox = container.querySelector('[data-workspace-bottom-box]');
    const inputSection = container.querySelector(
      '[data-workspace-input-section]'
    );
    const workspaceHeader = screen.getByLabelText('Workspace header');

    expect(coworkLabel).toHaveClass('text-ds-text-display', 'font-display');
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
    expect(screen.getByText('Single Agent')).toHaveClass('sr-only');
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

  it('keeps the Single Agent mode accessible without restoring its heading', () => {
    const { unmount } = renderWorkspace({ sessionMode: 'single-agent' });

    expect(screen.getByText('Cowork with')).toBeInTheDocument();
    expect(screen.getByText('Single Agent')).toHaveClass('sr-only');
    expect(
      document.querySelector('[data-workspace-single-agent-label]')
    ).not.toBeInTheDocument();

    unmount();
    renderWorkspace({ sessionMode: 'workforce' });

    expect(screen.getByText('Cowork with')).toBeInTheDocument();
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
