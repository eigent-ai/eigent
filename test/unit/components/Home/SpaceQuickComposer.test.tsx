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

import '@/api/http';

import { SpaceQuickComposer } from '@/components/Home/SpaceQuickComposer';
import { peekWorkspaceSendRecovery } from '@/components/Workspace/sendRecovery';
import { notifyError } from '@/lib/notifyError';
import { startSessionInSpace } from '@/lib/startSessionInSpace';
import { usePageTabStore } from '@/store/pageTabStore';
import { useSpaceStore, type Space } from '@/store/spaceStore';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  switchToSpace: vi.fn(),
  selectFile: vi.fn(),
  beforeCreate: vi.fn(),
  bottomBoxProps: null as Record<string, any> | null,
  hasModel: true,
  quota: {
    blocked: false,
    error: undefined as { message: string } | undefined,
  },
}));

vi.mock('@/hooks/useSpaceSwitch', () => ({
  useSpaceSwitch: () => ({
    switchToSpace: mocks.switchToSpace,
    switchingSpaceId: null,
  }),
}));
vi.mock('@/hooks/useModelConfigCheck', () => ({
  useModelConfigCheck: () => ({ hasModel: mocks.hasModel }),
}));
// Shaped like the real hook: its context check is pinned to the Space that
// was active when it rendered, and throws once another Space is active.
vi.mock('@/hooks/useNewSessionModelQuota', async () => {
  const { useSpaceStore } = await import('@/store/spaceStore');
  return {
    useNewSessionModelQuota: () => {
      const renderedActiveSpaceId = useSpaceStore.getState().activeSpaceId;
      const assertCurrent = () => {
        if (useSpaceStore.getState().activeSpaceId !== renderedActiveSpaceId)
          throw new Error('Space model context changed');
      };
      return {
        ...mocks.quota,
        pending: false,
        isCurrentAccount: true,
        effectiveModelType: 'custom',
        refresh: vi.fn(),
        beforeCreate: async () => {
          mocks.beforeCreate();
          assertCurrent();
          return assertCurrent;
        },
      };
    },
  };
});
vi.mock('@/hooks/useUsageIncidentBanner', () => ({
  useUsageIncidentBanner: () => null,
}));
vi.mock('@/lib/startSessionInSpace', () => ({
  startSessionInSpace: vi.fn(),
}));
vi.mock('@/lib/notifyError', () => ({ notifyError: vi.fn() }));
vi.mock('@/host', () => ({
  useHost: () => ({ electronAPI: { selectFile: mocks.selectFile } }),
}));
// The real composer is covered by its own tests; this checks what the Space
// page hands it and what Send does.
vi.mock('@/components/ChatBox/BottomBox', () => ({
  default: (props: Record<string, any>) => {
    mocks.bottomBoxProps = props;
    const { inputProps } = props;
    return (
      <div data-testid="bottom-box">
        <input
          aria-label="composer"
          disabled={inputProps.disabled}
          placeholder={inputProps.placeholder}
          value={inputProps.value}
          onChange={(event) => inputProps.onChange(event.target.value)}
        />
        <button type="button" onClick={inputProps.onSend}>
          Send
        </button>
        <button type="button" onClick={inputProps.onAddFile}>
          Add
        </button>
        <button
          type="button"
          onClick={() => props.onSessionModeChange('workforce')}
        >
          Multi-agent
        </button>
        {inputProps.files.map((file: { fileName: string }) => (
          <span key={file.fileName}>{file.fileName}</span>
        ))}
      </div>
    );
  },
}));

const research: Space = {
  id: 'space-1',
  name: 'Research',
  sourceType: 'folder',
  rootPath: '/work/research',
  status: 'active',
  schemaVersion: 1,
  createdAt: 0,
  updatedAt: 0,
};

function Location() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

const renderComposer = (readOnly = false) =>
  render(
    <MemoryRouter initialEntries={['/home?section=spaces&spaceId=space-1']}>
      <SpaceQuickComposer spaceId="space-1" readOnly={readOnly} />
      <Location />
    </MemoryRouter>
  );

const type = (value: string) =>
  fireEvent.change(screen.getByLabelText('composer'), { target: { value } });

describe('SpaceQuickComposer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.bottomBoxProps = null;
    mocks.hasModel = true;
    mocks.quota = { blocked: false, error: undefined };
    // Switching makes the page's Space active, as the real switch does.
    mocks.switchToSpace.mockImplementation(async (spaceId: string) => {
      useSpaceStore.setState({ activeSpaceId: spaceId });
      return true;
    });
    mocks.selectFile.mockResolvedValue({
      success: true,
      files: [{ fileName: 'brief.pdf', filePath: '/work/brief.pdf' }],
    });
    vi.mocked(startSessionInSpace).mockImplementation(async ({ onOpened }) => {
      onOpened('new-session');
      return 'new-session';
    });
    useSpaceStore.setState({
      spaces: { [research.id]: research },
      activeSpaceId: 'space-other',
    });
    usePageTabStore.setState({
      shellPlace: 'space',
      activeWorkspaceTab: 'workforce',
      homeFoldedSpaceIds: ['space-1'],
    });
  });

  it("uses the chat composer's inline layout with this Space's controls", () => {
    renderComposer();

    expect(mocks.bottomBoxProps).toMatchObject({
      layout: 'inline',
      state: 'input',
      footerSpaceId: 'space-1',
      sessionMode: 'single-agent',
      sessionModeSelectInteractive: true,
      noModelOverlay: false,
      usageLimitBanner: null,
    });
    expect(mocks.bottomBoxProps?.inputProps).toMatchObject({
      allowDragDrop: true,
      disabled: false,
      placeholder: 'Describe what you want to accomplish...',
    });
  });

  it('starts the Session here and opens it under its Space, without New session', async () => {
    renderComposer();

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('brief.pdf')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Multi-agent' }));
    type('  Draft the launch plan  ');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
    );
    // The Space becomes active without opening New session.
    expect(mocks.switchToSpace).toHaveBeenCalledWith('space-1', {
      project: null,
      tab: null,
      hydrate: false,
    });
    // Usage is re-read before the switch, so the switch can't trip its check.
    expect(mocks.beforeCreate).toHaveBeenCalled();
    expect(notifyError).not.toHaveBeenCalled();
    expect(startSessionInSpace).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: 'space-1',
        message: 'Draft the launch plan',
        sessionMode: 'workforce',
        files: [{ fileName: 'brief.pdf', filePath: '/work/brief.pdf' }],
      })
    );
    const pageTabs = usePageTabStore.getState();
    expect(pageTabs.activeWorkspaceTab).toBe('project');
    expect(pageTabs.shellPlace).toBe('home');
    // Its Space unfolds in the sidebar so the new Session shows under it.
    expect(pageTabs.homeFoldedSpaceIds).not.toContain('space-1');
  });

  it('skips the Space switch when the Space is already active', async () => {
    useSpaceStore.setState({ activeSpaceId: 'space-1' });
    renderComposer();

    type('Draft the launch plan');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(startSessionInSpace).toHaveBeenCalled());
    expect(mocks.switchToSpace).not.toHaveBeenCalled();
  });

  it('returns a refused Session’s message to New session for the Space', async () => {
    vi.mocked(startSessionInSpace).mockImplementation(
      async ({ onOpened, onRejected }) => {
        onOpened('new-session');
        onRejected('new-session');
        throw new Error('Rejected');
      }
    );
    renderComposer();

    type('Draft the launch plan');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    expect(usePageTabStore.getState().activeWorkspaceTab).toBe('new-project');
    expect(peekWorkspaceSendRecovery('space-1', 'new-project')).toMatchObject({
      message: 'Draft the launch plan',
    });
  });

  it('stays on the page with the message when the start fails before opening', async () => {
    vi.mocked(startSessionInSpace).mockRejectedValue(new Error('Offline'));
    renderComposer();

    type('Draft the launch plan');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith(new Error('Offline'))
    );
    await waitFor(() =>
      expect(screen.getByLabelText('composer')).toBeEnabled()
    );
    expect(screen.getByTestId('location')).toHaveTextContent('/home');
    expect(screen.getByLabelText('composer')).toHaveValue(
      'Draft the launch plan'
    );
  });

  it('keeps the message when the Space switch fails', async () => {
    mocks.switchToSpace.mockResolvedValue(false);
    renderComposer();

    type('Draft the launch plan');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(screen.getByLabelText('composer')).toBeEnabled()
    );
    expect(startSessionInSpace).not.toHaveBeenCalled();
    expect(screen.getByLabelText('composer')).toHaveValue(
      'Draft the launch plan'
    );
  });

  it('does nothing for an empty message', () => {
    renderComposer();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(startSessionInSpace).not.toHaveBeenCalled();
  });

  it('asks for a model, and blocks at the usage limit, like New session', () => {
    mocks.hasModel = false;
    useSpaceStore.setState({
      spaces: { [research.id]: { ...research, id: 'legacy_space-1' } },
    });
    const { unmount } = render(
      <MemoryRouter>
        <SpaceQuickComposer spaceId="legacy_space-1" />
      </MemoryRouter>
    );
    expect(mocks.bottomBoxProps?.noModelOverlay).toBe(true);
    expect(mocks.bottomBoxProps?.inputProps.disabled).toBe(true);
    unmount();

    mocks.hasModel = true;
    mocks.quota = { blocked: true, error: { message: 'Out of credits' } };
    renderComposer();
    expect(mocks.bottomBoxProps?.inputProps.disabled).toBe(true);
    expect(mocks.bottomBoxProps?.usageLimitBanner).toMatchObject({
      message: 'Out of credits',
    });
  });

  it('is read-only for a legacy Space', () => {
    renderComposer(true);
    expect(screen.getByLabelText('composer')).toBeDisabled();
    expect(mocks.bottomBoxProps?.sessionModeSelectInteractive).toBe(false);
    expect(mocks.bottomBoxProps?.modelSelectDisabled).toBe(true);
    expect(mocks.bottomBoxProps?.noModelOverlay).toBe(false);
  });
});
