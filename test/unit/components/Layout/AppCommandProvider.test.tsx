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

import {
  AppCommandProvider,
  useAppCommand,
} from '@/components/Layout/AppCommandProvider';
import { HostProvider, type AppHost } from '@/host';
import { APP_COMMAND, type AppCommandId } from '@/shared/appCommands';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const setActiveProject = vi.fn();
  const setNuwFileNum = vi.fn();
  const activeChatStore = {
    getState: () => ({
      activeTaskId: 'task-1',
      setNuwFileNum,
    }),
  };
  const projectRuntimeState = {
    activeProjectId: 'project-1' as string | null,
    getProjectById: vi.fn(() => ({ metadata: {} })),
    historyLoadIncompleteProjectIds: {} as Record<string, true>,
    peekActiveChatStore: vi.fn(() => activeChatStore),
    setActiveProject,
  };
  const spaceState = {
    activeSpaceId: 'space-1',
    getProjectsForSpace: vi.fn(() => [{ id: 'project-1' }]),
    lastVisitedProjectBySpace: {} as Record<string, string>,
  };

  return {
    activeChatStore,
    closeSettings: vi.fn(),
    ensureProjectRuntimeLoaded: vi.fn(),
    openSettings: vi.fn(),
    openPreviewTab: vi.fn(),
    projectRuntimeState,
    requestToggleSessionSidePanel: vi.fn(),
    requestWorkspaceChatFocus: vi.fn(),
    runAfterWorkspaceConfigurationSave: vi.fn(),
    setActiveProject,
    setActiveWorkspaceTab: vi.fn(),
    setChatTimelineDetailLevel: vi.fn(),
    setNuwFileNum,
    spaceState,
    toggleSessionPreview: vi.fn(),
    toggleWorkspaceSidebar: vi.fn(),
  };
});

vi.mock('@/components/Dialog/ReportBugDialog', () => ({
  default: ({ open }: { open: boolean }) => (
    <span data-testid="report-bug-state">{String(open)}</span>
  ),
}));

vi.mock('@/components/Dialog/KeyboardShortcutsDialog', () => ({
  default: ({ open, platform }: { open: boolean; platform: string }) => (
    <span data-testid="keyboard-shortcuts-state">
      {String(open)}:{platform}
    </span>
  ),
}));

vi.mock('@/lib/workspaceConfigurationNavigationGuard', () => ({
  runAfterWorkspaceConfigurationSave: mocks.runAfterWorkspaceConfigurationSave,
}));

vi.mock('@/lib/projectRuntimeHydration', () => ({
  ensureProjectRuntimeLoaded: mocks.ensureProjectRuntimeLoaded,
}));

vi.mock('@/store/projectRuntimeStore', () => {
  const useProjectRuntimeStore = Object.assign(
    (selector: (state: typeof mocks.projectRuntimeState) => unknown) =>
      selector(mocks.projectRuntimeState),
    { getState: () => mocks.projectRuntimeState }
  );
  return { useProjectRuntimeStore };
});

vi.mock('@/store/pageTabStore', () => ({
  WorkspaceTab: {
    Dispatch: 'dispatch',
    Files: 'files',
    NewProject: 'new-project',
    Project: 'project',
    Triggers: 'triggers',
    Workforce: 'workforce',
  },
  usePageTabStore: (
    selector: (state: {
      activeWorkspaceTab: string;
      chatTimelineDetailLevel: string;
      openPreviewTab: typeof mocks.openPreviewTab;
      requestToggleSessionSidePanel: typeof mocks.requestToggleSessionSidePanel;
      setActiveWorkspaceTab: typeof mocks.setActiveWorkspaceTab;
      setChatTimelineDetailLevel: typeof mocks.setChatTimelineDetailLevel;
      requestWorkspaceChatFocus: typeof mocks.requestWorkspaceChatFocus;
      toggleSessionPreview: typeof mocks.toggleSessionPreview;
      toggleWorkspaceSidebar: typeof mocks.toggleWorkspaceSidebar;
    }) => unknown
  ) =>
    selector({
      activeWorkspaceTab: 'project',
      chatTimelineDetailLevel: 'narrative',
      openPreviewTab: mocks.openPreviewTab,
      requestToggleSessionSidePanel: mocks.requestToggleSessionSidePanel,
      setActiveWorkspaceTab: mocks.setActiveWorkspaceTab,
      setChatTimelineDetailLevel: mocks.setChatTimelineDetailLevel,
      requestWorkspaceChatFocus: mocks.requestWorkspaceChatFocus,
      toggleSessionPreview: mocks.toggleSessionPreview,
      toggleWorkspaceSidebar: mocks.toggleWorkspaceSidebar,
    }),
}));

vi.mock('@/store/spaceStore', () => {
  const useSpaceStore = Object.assign(
    (selector: (state: typeof mocks.spaceState) => unknown) =>
      selector(mocks.spaceState),
    { getState: () => mocks.spaceState }
  );
  return { useSpaceStore };
});

vi.mock('@/store/settingsStore', () => ({
  openSettings: mocks.openSettings,
  useSettingsStore: (
    selector: (state: { closeSettings: typeof mocks.closeSettings }) => unknown
  ) => selector({ closeSettings: mocks.closeSettings }),
}));

function CommandButtons() {
  const executeAppCommand = useAppCommand();
  return (
    <>
      <button onClick={() => executeAppCommand(APP_COMMAND.newProject)}>
        New
      </button>
      <button onClick={() => executeAppCommand(APP_COMMAND.reportBug)}>
        Report
      </button>
      <button onClick={() => executeAppCommand(APP_COMMAND.keyboardShortcuts)}>
        Shortcuts
      </button>
    </>
  );
}

function LocationProbe() {
  const location = useLocation();
  return (
    <span data-testid="location">
      {location.pathname}
      {location.search}
    </span>
  );
}

function renderProvider(
  electronAPI: AppHost['electronAPI'],
  initialEntry = '/home?section=settings'
) {
  const host: AppHost = { electronAPI, ipcRenderer: null };
  return render(
    <HostProvider host={host}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <AppCommandProvider>
          <CommandButtons />
          <LocationProbe />
        </AppCommandProvider>
      </MemoryRouter>
    </HostProvider>
  );
}

describe('AppCommandProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.projectRuntimeState.activeProjectId = 'project-1';
    mocks.projectRuntimeState.historyLoadIncompleteProjectIds = {};
    mocks.projectRuntimeState.getProjectById.mockReturnValue({ metadata: {} });
    mocks.projectRuntimeState.peekActiveChatStore.mockReturnValue(
      mocks.activeChatStore
    );
    mocks.setActiveProject.mockImplementation((projectId) => {
      mocks.projectRuntimeState.activeProjectId = projectId;
    });
    mocks.spaceState.getProjectsForSpace.mockReturnValue([{ id: 'project-1' }]);
    mocks.spaceState.lastVisitedProjectBySpace = {};
    mocks.ensureProjectRuntimeLoaded.mockResolvedValue(undefined);
    mocks.runAfterWorkspaceConfigurationSave.mockImplementation(
      async (action: () => void | Promise<void>) => {
        await action();
        return true;
      }
    );
  });

  it('subscribes once, routes typed native commands, and runs the exact unsubscribe', () => {
    let nativeCommand: ((command: AppCommandId) => void) | undefined;
    const unsubscribe = vi.fn();
    const onAppCommand = vi.fn((callback: (command: AppCommandId) => void) => {
      nativeCommand = callback;
      return unsubscribe;
    });

    const view = renderProvider({ onAppCommand });

    expect(onAppCommand).toHaveBeenCalledTimes(1);
    act(() => nativeCommand?.(APP_COMMAND.openSettings));
    expect(mocks.openSettings).toHaveBeenCalledWith('settings');

    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('normalizes and syncs the renderer locale to native menus', async () => {
    const setNativeMenuLocale = vi.fn();
    renderProvider({ setNativeMenuLocale });

    await waitFor(() =>
      expect(setNativeMenuLocale).toHaveBeenLastCalledWith('en-US')
    );
  });

  it('flushes pending workspace configuration before starting a new project', async () => {
    const user = userEvent.setup();
    renderProvider(null);

    await user.click(screen.getByRole('button', { name: 'New' }));

    await waitFor(() => {
      expect(mocks.closeSettings).toHaveBeenCalledTimes(1);
    });
    expect(mocks.runAfterWorkspaceConfigurationSave).toHaveBeenCalledTimes(1);
    expect(mocks.setActiveProject).toHaveBeenCalledWith(null);
    expect(mocks.setActiveWorkspaceTab).toHaveBeenCalledWith('new-project');
    expect(mocks.requestWorkspaceChatFocus).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('location')).toHaveTextContent('/');
  });

  it('owns the report bug dialog for both renderer and native entry points', async () => {
    const user = userEvent.setup();
    renderProvider(null);

    expect(screen.getByTestId('report-bug-state')).toHaveTextContent('false');
    await user.click(screen.getByRole('button', { name: 'Report' }));
    expect(screen.getByTestId('report-bug-state')).toHaveTextContent('true');
  });

  it('opens the keyboard shortcuts dialog through the shared command', async () => {
    const user = userEvent.setup();
    renderProvider({ getPlatform: () => 'darwin' });

    expect(screen.getByTestId('keyboard-shortcuts-state')).toHaveTextContent(
      'false:darwin'
    );
    await user.click(screen.getByRole('button', { name: 'Shortcuts' }));
    expect(screen.getByTestId('keyboard-shortcuts-state')).toHaveTextContent(
      'true:darwin'
    );
  });

  it('routes workspace and project shortcuts to their existing state actions', () => {
    let nativeCommand: ((command: AppCommandId) => void) | undefined;
    renderProvider(
      {
        onAppCommand: (callback) => {
          nativeCommand = callback;
          return vi.fn();
        },
      },
      '/'
    );

    act(() => {
      nativeCommand?.(APP_COMMAND.toggleTimelineView);
      nativeCommand?.(APP_COMMAND.togglePreviewPanel);
      nativeCommand?.(APP_COMMAND.openPreviewBrowser);
      nativeCommand?.(APP_COMMAND.openPreviewTerminal);
      nativeCommand?.(APP_COMMAND.toggleWorkspaceSidebar);
      nativeCommand?.(APP_COMMAND.toggleSessionSidePanel);
    });

    expect(mocks.setChatTimelineDetailLevel).toHaveBeenCalledWith('trajectory');
    expect(mocks.toggleSessionPreview).toHaveBeenCalledOnce();
    expect(mocks.openPreviewTab.mock.calls).toEqual([
      ['browser'],
      ['terminal'],
    ]);
    expect(mocks.toggleWorkspaceSidebar).toHaveBeenCalledOnce();
    expect(mocks.requestToggleSessionSidePanel).toHaveBeenCalledOnce();
  });

  it('ignores scoped shortcuts outside the workspace and matches topbar Home', () => {
    let nativeCommand: ((command: AppCommandId) => void) | undefined;
    renderProvider({
      onAppCommand: (callback) => {
        nativeCommand = callback;
        return vi.fn();
      },
    });

    act(() => {
      nativeCommand?.(APP_COMMAND.togglePreviewPanel);
      nativeCommand?.(APP_COMMAND.toggleWorkspaceSidebar);
      nativeCommand?.(APP_COMMAND.navigateHome);
    });

    expect(mocks.toggleSessionPreview).not.toHaveBeenCalled();
    expect(mocks.toggleWorkspaceSidebar).not.toHaveBeenCalled();
    expect(mocks.closeSettings).toHaveBeenCalledOnce();
    expect(mocks.setActiveProject).toHaveBeenCalledWith(null);
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/home?section=spaces'
    );
  });

  it('routes the ordered workspace shortcuts to their matching sidebar tabs', () => {
    let nativeCommand: ((command: AppCommandId) => void) | undefined;
    renderProvider({
      onAppCommand: (callback) => {
        nativeCommand = callback;
        return vi.fn();
      },
    });

    act(() => {
      nativeCommand?.(APP_COMMAND.navigateWorkspace);
      nativeCommand?.(APP_COMMAND.navigateFiles);
      nativeCommand?.(APP_COMMAND.navigateScheduled);
      nativeCommand?.(APP_COMMAND.navigateDispatch);
      nativeCommand?.(APP_COMMAND.navigateConfiguration);
    });

    expect(mocks.setActiveWorkspaceTab.mock.calls).toEqual([
      ['workforce'],
      ['files', { clearFilesForProjectId: 'project-1' }],
      ['triggers'],
      ['dispatch'],
    ]);
    expect(mocks.setNuwFileNum).toHaveBeenCalledWith('task-1', 0);
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/home?section=spaces&spaceId=space-1&spaceTab=workspace-profile'
    );
  });

  it('selects the last Project and hydrates it before opening Files', () => {
    mocks.projectRuntimeState.activeProjectId = null;
    mocks.spaceState.getProjectsForSpace.mockReturnValue([
      { id: 'project-1' },
      { id: 'project-2' },
    ]);
    mocks.spaceState.lastVisitedProjectBySpace = {
      'space-1': 'project-2',
    };
    mocks.projectRuntimeState.peekActiveChatStore.mockReturnValue(
      null as never
    );
    mocks.projectRuntimeState.getProjectById.mockReturnValue({
      metadata: { remoteHistoryHydrationPending: true },
    });

    let nativeCommand: ((command: AppCommandId) => void) | undefined;
    renderProvider({
      onAppCommand: (callback) => {
        nativeCommand = callback;
        return vi.fn();
      },
    });

    act(() => nativeCommand?.(APP_COMMAND.navigateFiles));

    expect(mocks.setActiveProject).toHaveBeenCalledWith('project-2');
    expect(mocks.setActiveWorkspaceTab).toHaveBeenCalledWith('files', {
      clearFilesForProjectId: 'project-2',
    });
    expect(mocks.ensureProjectRuntimeLoaded).toHaveBeenCalledWith(
      mocks.projectRuntimeState,
      'project-2',
      { requireActiveSelection: true }
    );
  });

  describe('terminal-owned accelerators on Windows and Linux', () => {
    it('dispatches Ctrl+N and Ctrl+B the native menu deliberately skips', () => {
      // Ctrl+B only toggles on the workspace route, same as the menu command.
      renderProvider({ getPlatform: () => 'win32' }, '/');

      act(() => {
        fireEvent.keyDown(window, { key: 'n', ctrlKey: true });
        fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
      });

      expect(mocks.runAfterWorkspaceConfigurationSave).toHaveBeenCalled();
      expect(mocks.toggleWorkspaceSidebar).toHaveBeenCalledOnce();
    });

    it('guards Ctrl+W in the renderer and rejects text and Shift variants', () => {
      const closeWindow = vi.fn();
      renderProvider({ getPlatform: () => 'win32', closeWindow }, '/');

      act(() => {
        fireEvent.keyDown(window, { key: 'w', ctrlKey: true });
      });
      expect(closeWindow).toHaveBeenCalledWith(false);

      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();
      act(() => {
        fireEvent.keyDown(window, { key: 'w', ctrlKey: true });
      });
      input.remove();

      act(() => {
        fireEvent.keyDown(window, {
          key: 'n',
          ctrlKey: true,
          shiftKey: true,
        });
        fireEvent.keyDown(window, {
          key: 'b',
          ctrlKey: true,
          shiftKey: true,
        });
        fireEvent.keyDown(window, {
          key: 'w',
          ctrlKey: true,
          shiftKey: true,
        });
      });

      expect(closeWindow).toHaveBeenCalledOnce();
      expect(mocks.runAfterWorkspaceConfigurationSave).not.toHaveBeenCalled();
      expect(mocks.toggleWorkspaceSidebar).not.toHaveBeenCalled();
    });

    it('yields to the embedded terminal so readline keeps Ctrl+N / Ctrl+B / Ctrl+W', () => {
      const closeWindow = vi.fn();
      renderProvider({ getPlatform: () => 'linux', closeWindow }, '/');

      // xterm holds focus in a helper textarea inside its `.xterm` root.
      const terminal = document.createElement('div');
      terminal.className = 'xterm';
      const helper = document.createElement('textarea');
      terminal.appendChild(helper);
      document.body.appendChild(terminal);
      helper.focus();

      act(() => {
        fireEvent.keyDown(window, { key: 'n', ctrlKey: true });
        fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
        fireEvent.keyDown(window, { key: 'w', ctrlKey: true });
      });

      expect(mocks.toggleWorkspaceSidebar).not.toHaveBeenCalled();
      expect(closeWindow).not.toHaveBeenCalled();
      terminal.remove();
    });

    it('leaves the accelerators to the native menu on macOS', () => {
      renderProvider({ getPlatform: () => 'darwin' }, '/');

      act(() => {
        fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
      });

      expect(mocks.toggleWorkspaceSidebar).not.toHaveBeenCalled();
    });
  });
});
