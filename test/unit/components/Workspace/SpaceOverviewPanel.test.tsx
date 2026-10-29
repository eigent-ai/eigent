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

import { useWorkspaceComposerRequests } from '@/components/Workspace/composerRequests';
import { SpaceOverviewPanel } from '@/components/Workspace/SpaceOverview';
import type { SpaceOverviewStats } from '@/components/Workspace/SpaceOverview/useSpaceOverviewStats';
import { APP_COMMAND } from '@/shared/appCommands';
import {
  SPACE_OVERVIEW_BOXES,
  useSpaceOverviewStore,
} from '@/store/spaceOverviewStore';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runCommand: vi.fn(),
  invoke: vi.fn(),
  openInIDE: vi.fn(),
  setPreferredIDE: vi.fn(),
  openAddAutomation: vi.fn(),
  space: null as Record<string, unknown> | null,
  stats: null as unknown as SpaceOverviewStats,
}));

vi.mock('@/components/Layout/AppCommandProvider', () => ({
  useAppCommand: () => mocks.runCommand,
}));
vi.mock('@/host', () => ({
  useHost: () => ({
    ipcRenderer: { invoke: mocks.invoke },
    electronAPI: {
      getPlatform: () => 'darwin',
      openInIDE: mocks.openInIDE,
    },
  }),
}));
vi.mock('@/components/Workspace/WorkspaceVersionHistoryDialog', () => ({
  WorkspaceVersionHistoryDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">Version history dialog</div> : null,
}));
vi.mock('@/components/Workspace/SpaceOverview/useSpaceOverviewStats', () => ({
  useSpaceOverviewStats: () => mocks.stats,
}));
vi.mock('@/store/authStore', () => ({
  useAuthStore: () => ({ email: 'fixture@example.test', user_id: 7 }),
  getAuthStore: () => ({ setPreferredIDE: mocks.setPreferredIDE }),
}));
vi.mock('@/store/pageTabStore', () => ({
  usePageTabStore: (selector: (state: unknown) => unknown) =>
    selector({ requestOpenTriggerAddDialog: mocks.openAddAutomation }),
}));
vi.mock('@/store/projectRuntimeStore', () => ({
  useProjectRuntimeStore: (selector: (state: unknown) => unknown) =>
    selector({
      activeProjectId: null,
      navLeadByProjectId: {
        'session-1': { kind: 'running' },
        'session-2': { kind: 'completed' },
      },
    }),
}));
vi.mock('@/store/triggerStore', () => ({
  useTriggerStore: (selector: (state: unknown) => unknown) =>
    selector({ activeRemoteControlSessions: [] }),
}));
vi.mock('@/store/spaceStore', () => ({
  useSpaceStore: (selector: (state: unknown) => unknown) =>
    selector({
      activeSpaceId: mocks.space ? 'space-1' : null,
      spaces: mocks.space ? { 'space-1': mocks.space } : {},
      projectsBySpaceId: {},
    }),
  getVisibleProjectMetasForSpace: () => [
    { id: 'session-1' },
    { id: 'session-2' },
  ],
}));

const localSpace = {
  id: 'space-1',
  name: 'Product',
  sourceType: 'folder',
  rootPath: '/Users/fixture/eigent-product',
  status: 'active',
};

const loadedStats: SpaceOverviewStats = {
  files: {
    count: 128,
    recent: [
      { name: 'report.md', relativePath: 'out/report.md', modifiedAt: 1 },
      { name: 'chart.png', relativePath: 'out/chart.png', modifiedAt: 0 },
    ],
  },
  automations: { total: 3, active: 2 },
  versionHistory: {
    enabled: true,
    branch: 'main',
    unsavedChanges: 4,
    unsavedChangesTruncated: false,
  },
};

const boxList = () => document.querySelector('[data-space-overview] ol');
const box = (id: string) =>
  document.querySelector(`[data-space-overview-box="${id}"]`);
// Version history is hidden until added in edit mode.
const showAllBoxes = () =>
  useSpaceOverviewStore.getState().saveLayout('space-1', {
    order: [...SPACE_OVERVIEW_BOXES],
    hiddenBoxes: [],
  });

const boxOrder = () =>
  Array.from(boxList()?.children ?? []).map((item) =>
    item.getAttribute('data-space-overview-box')
  );

describe('SpaceOverviewPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.space = { ...localSpace };
    mocks.stats = loadedStats;
    mocks.invoke.mockResolvedValue({ success: true });
    mocks.openInIDE.mockResolvedValue({ success: true });
    useSpaceOverviewStore.setState({ layouts: {} });
  });

  it('summarizes a local folder Space in one column of boxes', () => {
    render(<SpaceOverviewPanel />);

    // Every Space starts with these five; Version history is added on request.
    expect(boxOrder()).toEqual([
      'location',
      'files',
      'sessions',
      'automations',
      'dispatch',
    ]);
    expect(box('location')).toHaveTextContent('eigent-product');
    // A local folder needs no tag; only cloud and missing folders get one.
    expect(box('location')).not.toHaveTextContent('Local');
    // The path reads from the home folder rather than the full machine path.
    expect(box('location')).toHaveTextContent('~/eigent-product');
    expect(box('location')).not.toHaveTextContent('/Users/fixture');
    expect(box('files')).toHaveTextContent('Files128');
    expect(box('files')).toHaveTextContent('report.md');
    expect(box('sessions')).toHaveTextContent('Sessions2');
    expect(box('sessions')).toHaveTextContent('Running: 1');
    expect(box('automations')).toHaveTextContent('Automations3');
    expect(box('automations')).toHaveTextContent('On: 2');
    expect(box('dispatch')).toHaveTextContent('DispatchOff');
    // Drag handles exist only while editing.
    expect(screen.queryByRole('button', { name: /^Reorder / })).toBeNull();
  });

  it('shows the branch and unsaved changes once Version history is added', () => {
    showAllBoxes();
    render(<SpaceOverviewPanel />);

    expect(box('versionHistory')).toHaveTextContent('main');
    expect(box('versionHistory')).toHaveTextContent('Unsaved changes: 4');
  });

  it('opens the Space folder in Finder or an editor from the Open menu', async () => {
    const user = userEvent.setup();
    render(<SpaceOverviewPanel />);

    await user.click(screen.getByRole('button', { name: 'Open folder' }));
    expect(
      (await screen.findAllByRole('menuitem')).map((item) => item.textContent)
    ).toEqual(['Open in Finder', 'Cursor', 'VS Code']);
    await user.click(screen.getByRole('menuitem', { name: 'Open in Finder' }));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenLastCalledWith(
        'reveal-local-path',
        '/Users/fixture/eigent-product'
      )
    );

    await user.click(screen.getByRole('button', { name: 'Open folder' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Cursor' }));
    // The editor may open only a registered Space root.
    await waitFor(() =>
      expect(mocks.openInIDE).toHaveBeenCalledWith(
        '/Users/fixture/eigent-product',
        'cursor'
      )
    );
    expect(mocks.invoke).toHaveBeenLastCalledWith(
      'set-local-file-preview-roots',
      ['/Users/fixture/eigent-product']
    );
  });

  it('shows counts and statuses in the accent color', () => {
    render(<SpaceOverviewPanel />);

    for (const [id, value] of [
      ['files', '128'],
      ['sessions', '2'],
      ['automations', '3'],
      ['dispatch', 'Off'],
    ])
      expect(
        Array.from(box(id)!.querySelectorAll('span')).find(
          (node) => node.textContent === value
        )
      ).toHaveClass('text-ds-accent-default-default');
  });

  it('runs each box action and opens pages from its title', () => {
    showAllBoxes();
    render(<SpaceOverviewPanel />);
    const attachRequests =
      useWorkspaceComposerRequests.getState().attachFilesRequestId;

    fireEvent.click(screen.getByRole('button', { name: 'Add files' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add automation' }));
    fireEvent.click(screen.getByRole('button', { name: 'View history' }));
    expect(useWorkspaceComposerRequests.getState().attachFilesRequestId).toBe(
      attachRequests + 1
    );
    expect(mocks.openAddAutomation).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Version history dialog'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open Files' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Automations' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Dispatch' }));
    fireEvent.click(screen.getByRole('button', { name: /report\.md/ }));
    expect(mocks.runCommand.mock.calls.map(([command]) => command)).toEqual([
      APP_COMMAND.navigateFiles,
      APP_COMMAND.navigateScheduled,
      APP_COMMAND.navigateDispatch,
      APP_COMMAND.navigateFiles,
    ]);
  });

  it('gives Sessions neither an action nor a page link', () => {
    render(<SpaceOverviewPanel />);

    expect(box('sessions')?.querySelector('button')).toBeNull();
  });

  it('offers Files instead of a folder for a cloud Space', () => {
    mocks.space = {
      ...localSpace,
      sourceType: 'blank',
      rootPath: null,
      name: 'Research',
    };
    render(<SpaceOverviewPanel />);

    expect(box('location')).toHaveTextContent('Research');
    expect(box('location')).toHaveTextContent('Cloud');
    expect(box('versionHistory')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open files' }));
    expect(mocks.runCommand).toHaveBeenCalledWith(APP_COMMAND.navigateFiles);
  });

  it('shows a dash for counts whose service did not answer', () => {
    mocks.stats = { files: null, automations: null, versionHistory: null };
    showAllBoxes();
    render(<SpaceOverviewPanel />);

    expect(box('files')).toHaveTextContent('Files—');
    expect(box('automations')).toHaveTextContent('Automations—');
    expect(box('versionHistory')).toHaveTextContent('—');
  });

  it('reorders and hides full boxes in edit mode, then saves for this Space', () => {
    render(<SpaceOverviewPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    // Boxes keep their content while editing; their actions give way to
    // hide and add controls.
    expect(box('files')).toHaveTextContent('report.md');
    expect(screen.queryByRole('button', { name: 'Add files' })).toBeNull();
    const handle = screen.getByRole('button', { name: 'Reorder Files' });
    handle.focus();
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(boxOrder().slice(0, 2)).toEqual(['files', 'location']);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Files moved to position 1 of 6'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Hide Sessions' }));
    expect(box('sessions')).toHaveAttribute('data-hidden', 'true');
    expect(
      screen.getByRole('button', { name: 'Show Sessions' })
    ).toBeInTheDocument();
    // Nothing is saved until Save.
    expect(useSpaceOverviewStore.getState().layouts).toEqual({});

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(useSpaceOverviewStore.getState().layouts['space-1']).toEqual({
      order: [
        'files',
        'location',
        'sessions',
        'automations',
        'dispatch',
        'versionHistory',
      ],
      hiddenBoxes: ['versionHistory', 'sessions'],
    });
    expect(boxOrder()).toEqual([
      'files',
      'location',
      'automations',
      'dispatch',
    ]);
  });

  it('keeps each Space’s layout separate', () => {
    useSpaceOverviewStore.getState().saveLayout('other-space', {
      order: ['dispatch'],
      hiddenBoxes: ['files'],
    });
    render(<SpaceOverviewPanel />);

    expect(boxOrder()[0]).toBe('location');
    expect(box('files')).not.toBeNull();
  });

  it('discards edits on Cancel', () => {
    render(<SpaceOverviewPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide Files' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(useSpaceOverviewStore.getState().layouts).toEqual({});
    expect(box('files')).not.toBeNull();
  });
});
