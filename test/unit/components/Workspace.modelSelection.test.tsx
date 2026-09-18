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
import {
  fetchSpaceModelSelection,
  resolveSpaceModelBinding,
} from '@/lib/spaceModelBinding';
import { createSyncedProjectInSpace } from '@/lib/spaceProject';
import { useAuthStore } from '@/store/authStore';
import { openSettings } from '@/store/settingsStore';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface ComposerInput {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onSend: () => Promise<void>;
}

const mocks = vi.hoisted(() => {
  const newChatState = {
    activeTaskId: 'new-task',
    setHasMessages: vi.fn(),
    setAttaches: vi.fn(),
    startTask: vi.fn(),
    setHasWaitComfirm: vi.fn(),
  };
  const projectState = {
    activeProjectId: 'old-session',
    projects: { 'old-session': { metadata: {}, mode: 'workforce' } },
    navLeadByProjectId: {},
    getComposerThinkingEffort: vi.fn(() => undefined),
    getActiveChatStore: vi.fn(() => ({ getState: () => newChatState })),
    setProjectModel: vi.fn(),
  };
  const spaceState = {
    resetForUser: vi.fn(),
    ensureLegacySpace: vi.fn(),
    activeSpaceId: 'space-1' as string | null,
    spaces: {} as Record<
      string,
      { id: string; userId: string; sourceType: string; status: string }
    >,
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
    input: null as ComposerInput | null,
    network: vi.fn(),
    get: vi.fn(),
    localGet: vi.fn(),
    newChatState,
    projectState,
    spaceState,
    pageState,
  };
});

vi.mock('@/hooks/useChatStoreAdapter', () => ({
  default: () => ({
    chatStore: { activeTaskId: null, tasks: {} },
    projectStore: mocks.projectState,
  }),
}));

vi.mock('@/host', () => ({ useHost: () => ({ electronAPI: {} }) }));
vi.mock('@/api/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/http')>()),
  proxyFetchGet: mocks.get,
  fetchGet: mocks.localGet,
}));
vi.mock('@/store/settingsStore', () => ({ openSettings: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('@/store/pageTabStore', () => ({
  usePageTabStore: Object.assign(
    (selector: (state: typeof mocks.pageState) => unknown) =>
      selector(mocks.pageState),
    { getState: () => mocks.pageState }
  ),
}));
vi.mock('@/store/projectRuntimeStore', () => ({
  useProjectRuntimeStore: Object.assign(
    (selector: (state: typeof mocks.projectState) => unknown) =>
      selector(mocks.projectState),
    { getState: () => mocks.projectState }
  ),
}));
vi.mock('@/store/spaceStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/spaceStore')>()),
  useSpaceStore: Object.assign(
    (selector: (state: typeof mocks.spaceState) => unknown) =>
      selector(mocks.spaceState),
    { getState: () => mocks.spaceState }
  ),
}));
vi.mock('@/lib/spaceProject', () => ({
  createSyncedProjectInSpace: vi.fn(),
}));

vi.mock('@/components/ChatBox/BottomBox', () => ({
  default: ({
    inputProps,
    noModelOverlay,
  }: {
    inputProps: ComposerInput;
    noModelOverlay?: boolean;
  }) => {
    mocks.input = inputProps;
    return (
      <div>
        {noModelOverlay && <div data-testid="no-model-overlay" />}
        <input
          aria-label="Session message"
          value={inputProps.value}
          onChange={(event) => inputProps.onChange(event.target.value)}
        />
        <button
          type="button"
          disabled={inputProps.disabled}
          onClick={inputProps.onSend}
        >
          Send
        </button>
      </div>
    );
  },
}));
vi.mock('@/components/AddWorker', () => ({ AddWorker: () => null }));
vi.mock('@/components/Workspace/SingleAgentList', () => ({
  SingleAgentList: () => null,
}));
vi.mock('@/components/Workspace/WorkforceAgentList', () => ({
  WorkforceAgentList: () => null,
}));

const variants = ['workspace', 'new-project'] as const;
const question = 'Use the installed Space model';

async function renderAfterGlobalProviderReset(
  variant: (typeof variants)[number]
) {
  render(
    <MemoryRouter>
      <Workspace variant={variant} />
    </MemoryRouter>
  );
  await waitFor(() =>
    expect(useAuthStore.getState().hasModelConfigured).toBe(false)
  );
  expect(mocks.get).toHaveBeenCalledWith('/api/v1/providers', { prefer: true });
  fireEvent.change(screen.getByLabelText('Session message'), {
    target: { value: question },
  });
}

describe('Workspace delegates current Space model validation to launch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.input = null;
    mocks.network.mockImplementation(async () => {
      throw new Error('Network forbidden in the synthetic fixture');
    });
    vi.stubGlobal('fetch', mocks.network);
    useAuthStore.setState({
      token: 'synthetic-token',
      email: 'fixture@example.test',
      user_id: 7,
      modelType: 'custom',
      hasModelConfigured: true,
    });
    mocks.spaceState.activeSpaceId = 'space-1';
    mocks.spaceState.spaces = {
      'space-1': {
        id: 'space-1',
        userId: '7',
        sourceType: 'blank',
        status: 'active',
      },
    };
    mocks.get.mockImplementation(async (url) => {
      if (url === '/api/v1/providers') return { items: [], pages: 1 };
      if (url === '/api/v1/cloud-models')
        return {
          models: [
            {
              id: 'space-model',
              display_name: 'Space Cloud',
              model_type: 'gpt-6-astra',
              model_platform: 'azure',
              provider_family: 'openai',
              kind: 'chat',
            },
          ],
        };
      throw new Error(`Unexpected proxy request: ${url}`);
    });
    mocks.localGet.mockImplementation(async (url) => {
      if (url.endsWith('/model-selection'))
        return {
          space_id: 'space-1',
          selection: {
            materialization_id: 'fixture-materialization',
            revision_id: 'bundle@1',
            model_profile: 'default',
            model_ref: 'provider://cloud/space-model',
            thinking_effort: 'high',
          },
        };
      throw new Error(`Unexpected local request: ${url}`);
    });
    vi.mocked(createSyncedProjectInSpace).mockResolvedValue({
      projectId: 'new-session',
      spaceId: 'space-1',
    });
    mocks.newChatState.startTask.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    expect(mocks.network).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it.each(variants)(
    'starts a Session through the actual %s handler despite a deleted global custom provider',
    async (variant) => {
      // The same launch helpers can resolve this materialized Space policy.
      const selection = await fetchSpaceModelSelection(
        'space-1',
        { email: 'fixture@example.test', userId: 7 },
        () => {}
      );
      const binding = await resolveSpaceModelBinding(
        selection!.model_ref,
        () => {}
      );
      expect(binding.selection).toMatchObject({
        modelType: 'cloud',
        cloud_model_type: 'space-model',
        model_type: 'gpt-6-astra',
      });
      mocks.get.mockClear();
      mocks.localGet.mockClear();

      await renderAfterGlobalProviderReset(variant);
      expect(screen.queryByTestId('no-model-overlay')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      await waitFor(() =>
        expect(mocks.newChatState.setHasWaitComfirm).toHaveBeenCalledWith(
          'new-task',
          true
        )
      );
      expect(createSyncedProjectInSpace).toHaveBeenCalledTimes(1);
      expect(createSyncedProjectInSpace).toHaveBeenCalledWith(
        expect.objectContaining({ spaceId: 'space-1', name: question })
      );
      expect(mocks.newChatState.startTask).toHaveBeenCalledWith(
        'new-task',
        undefined,
        undefined,
        undefined,
        question,
        [],
        undefined,
        'new-session',
        'single-agent'
      );
      expect(openSettings).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
      expect(useAuthStore.getState()).toMatchObject({
        modelType: 'custom',
        hasModelConfigured: false,
      });
      // Workspace adds no duplicate catalog/credential preflight before Chat.
      expect(mocks.localGet).not.toHaveBeenCalled();
      expect(
        mocks.get.mock.calls.every(([url]) => url === '/api/v1/providers')
      ).toBe(true);
      expect(mocks.projectState.setProjectModel).not.toHaveBeenCalled();
    }
  );

  const ineligibleStates = [
    'unauthenticated',
    'missing-account',
    'legacy',
    'legacy-id',
    'foreign-space',
    'missing-space',
    'no-active-space',
  ] as const;

  describe.each(variants)('%s entry safeguards', (variant) => {
    it.each(ineligibleStates)(
      'keeps the model gate for %s and rejects the actual send handler',
      async (state) => {
        if (state === 'unauthenticated') useAuthStore.setState({ token: null });
        if (state === 'missing-account')
          useAuthStore.setState({ user_id: null });
        if (state === 'legacy')
          mocks.spaceState.spaces['space-1'].sourceType = 'legacy';
        if (state === 'legacy-id') {
          mocks.spaceState.activeSpaceId = 'legacy_7';
          mocks.spaceState.spaces = {
            legacy_7: {
              ...mocks.spaceState.spaces['space-1'],
              id: 'legacy_7',
            },
          };
        }
        if (state === 'foreign-space')
          mocks.spaceState.spaces['space-1'].userId = '8';
        if (state === 'missing-space') mocks.spaceState.spaces = {};
        if (state === 'no-active-space') mocks.spaceState.activeSpaceId = null;

        await renderAfterGlobalProviderReset(variant);
        expect(screen.getByTestId('no-model-overlay')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
        await act(async () => mocks.input!.onSend());
        expect(createSyncedProjectInSpace).not.toHaveBeenCalled();
        expect(mocks.newChatState.startTask).not.toHaveBeenCalled();
        expect(mocks.projectState.setProjectModel).not.toHaveBeenCalled();
        expect(mocks.localGet).not.toHaveBeenCalled();
      }
    );
  });

  it.each(variants)(
    'surfaces the %s launch rejection without pinning or confirming success',
    async (variant) => {
      const failure = new Error('Synthetic Space model cannot be resolved');
      mocks.newChatState.startTask.mockRejectedValueOnce(failure);
      await renderAfterGlobalProviderReset(variant);
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(failure.message)
      );
      expect(createSyncedProjectInSpace).toHaveBeenCalledTimes(1);
      expect(mocks.newChatState.startTask).toHaveBeenCalledTimes(1);
      expect(mocks.projectState.setProjectModel).not.toHaveBeenCalled();
      expect(mocks.newChatState.setHasWaitComfirm).not.toHaveBeenCalled();
      expect(mocks.pageState.setActiveWorkspaceTab).toHaveBeenLastCalledWith(
        'workforce'
      );
      expect(screen.getByLabelText('Session message')).toHaveValue(question);
      expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
      expect(openSettings).not.toHaveBeenCalled();
      expect(useAuthStore.getState()).toMatchObject({
        modelType: 'custom',
        hasModelConfigured: false,
      });
    }
  );
});
