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

import Folder from '@/components/Folder';
import { RIGHT_RAIL_CONTENT_WIDTH_CLASS } from '@/components/Layout/rightRail';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchGet: vi.fn(),
  getBaseURL: vi.fn(),
  chatStore: null as any,
  getElectronAPI: vi.fn(),
  getIpcRenderer: vi.fn(),
  loadFilePreview: vi.fn(),
  openInIDE: vi.fn(),
  revealLocalPath: vi.fn(),
  resolveArtifactAssetFile: vi.fn(),
  setPreferredIDE: vi.fn(),
  spaceState: {
    activeSpaceId: 'space-1',
    spaces: {
      'space-1': {
        id: 'space-1',
        name: 'Remote space',
        sourceType: 'blank' as 'blank' | 'folder',
        rootPath: null as string | null,
        status: 'active',
        schemaVersion: 2,
        createdAt: 1,
        updatedAt: 1,
      },
    },
    projectsBySpaceId: {
      'space-1': {
        'project-1': {
          id: 'project-1',
          spaceId: 'space-1',
          name: 'Project One',
          status: 'active',
          createdAt: 1,
          updatedAt: 1,
        },
      },
    },
    getProjectMeta: vi.fn(() => null),
  },
}));

vi.mock('@/api/http', () => ({
  fetchGet: mocks.fetchGet,
  getBaseURL: mocks.getBaseURL,
}));

vi.mock('@/lib/filePreviewLoader', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/filePreviewLoader')>();
  return { ...actual, loadFilePreview: mocks.loadFilePreview };
});

vi.mock('@/service/artifactAssetApi', () => ({
  resolveArtifactAssetFile: mocks.resolveArtifactAssetFile,
}));

vi.mock('@/hooks/useChatStoreAdapter', () => ({
  default: () => ({
    chatStore: mocks.chatStore,
    projectStore: { activeProjectId: null },
  }),
}));

vi.mock('@/host', () => ({
  useHost: () => ({
    ipcRenderer: mocks.getIpcRenderer(),
    electronAPI: mocks.getElectronAPI(),
  }),
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: () => ({
    email: 'person@example.com',
    user_id: 'user-1',
    preferredIDE: 'cursor',
    setPreferredIDE: mocks.setPreferredIDE,
  }),
}));

vi.mock('@/store/spaceStore', () => ({
  useSpaceStore: (selector: (state: typeof mocks.spaceState) => unknown) =>
    selector(mocks.spaceState),
}));

describe('Folder page layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.chatStore = null;
    mocks.getElectronAPI.mockReturnValue(null);
    mocks.getIpcRenderer.mockReturnValue(null);
    Object.assign(mocks.spaceState.spaces['space-1'], {
      name: 'Remote space',
      sourceType: 'blank',
      rootPath: null,
    });
    mocks.getBaseURL.mockResolvedValue('https://api.example.test');
    mocks.openInIDE.mockResolvedValue({ success: true });
    mocks.revealLocalPath.mockResolvedValue({ success: true });
    mocks.resolveArtifactAssetFile.mockImplementation(async (file) => file);
    mocks.loadFilePreview.mockImplementation(async (file) => ({
      ...file,
      content: file.content ?? '# Loaded file',
    }));
    mocks.fetchGet.mockResolvedValue([
      {
        filename: 'needle.md',
        relativePath: 'src/nested/needle.md',
        url: '/files/needle.md',
      },
      {
        filename: 'other.txt',
        relativePath: 'docs/other.txt',
        url: '/files/other.txt',
      },
    ]);
  });

  afterEach(() => {
    cleanup();
  });

  it('removes the far-right rail completely and reopens it from the viewer toolbar', async () => {
    const user = userEvent.setup();
    const { container } = render(<Folder spaceId="space-1" />);
    const rail = container.querySelector<HTMLElement>('[data-file-tree-rail]');

    expect(rail).not.toBeNull();
    expect(rail?.parentElement?.lastElementChild).toBe(rail);
    expect(rail).toHaveClass(...RIGHT_RAIL_CONTENT_WIDTH_CLASS.split(' '));
    expect(rail).toHaveStyle({ maxWidth: '50%' });

    const foldButton = screen.getByRole('button', {
      name: 'Hide file tree',
    });
    expect(rail).not.toContainElement(foldButton);
    expect(foldButton.parentElement?.lastElementChild).toBe(foldButton);
    expect(foldButton).toHaveAttribute('aria-expanded', 'true');
    expect(
      document.getElementById(foldButton.getAttribute('aria-controls') || '')
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'File tree scope' })
    ).not.toBeInTheDocument();

    await user.click(foldButton);

    expect(container.querySelector('[data-file-tree-rail]')).toBeNull();
    const reopenButton = screen.getByRole('button', { name: 'Show file tree' });
    expect(reopenButton).toHaveAttribute('aria-expanded', 'false');
    expect(reopenButton.parentElement?.lastElementChild).toBe(reopenButton);
    expect(
      screen.queryByRole('searchbox', { name: 'Search files' })
    ).not.toBeInTheDocument();

    await user.click(reopenButton);

    const reopenedRail = container.querySelector<HTMLElement>(
      '[data-file-tree-rail]'
    );
    expect(reopenedRail).not.toBeNull();
    expect(reopenedRail).toHaveClass(
      ...RIGHT_RAIL_CONTENT_WIDTH_CLASS.split(' ')
    );
    expect(
      screen.getByRole('button', { name: 'Hide file tree' })
    ).toHaveAttribute('aria-expanded', 'true');
  });

  it('filters by filename and reveals every matching ancestor folder', async () => {
    const user = userEvent.setup();
    render(<Folder spaceId="space-1" />);

    await user.type(
      screen.getByRole('searchbox', { name: 'Search files' }),
      'needle'
    );

    expect(
      await screen.findByRole('treeitem', { name: 'needle.md' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('treeitem', { name: 'other.txt' })).toBeNull();
    expect(
      screen.getByRole('treeitem', { name: 'Project One' })
    ).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('treeitem', { name: 'src' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    expect(screen.getByRole('treeitem', { name: 'nested' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });

  it('opens an HTTPS-backed local Space file through its exact workspace path', async () => {
    const user = userEvent.setup();
    Object.assign(mocks.spaceState.spaces['space-1'], {
      name: 'Local space',
      sourceType: 'folder',
      rootPath: '/workspace/local-space',
    });
    mocks.getElectronAPI.mockReturnValue({
      getPlatform: () => 'darwin',
      openInIDE: mocks.openInIDE,
      revealLocalPath: mocks.revealLocalPath,
    } as ElectronAPI);
    mocks.getIpcRenderer.mockReturnValue({ invoke: vi.fn() } as IpcRenderer);
    mocks.fetchGet.mockResolvedValue([
      {
        filename: 'needle.md',
        relativePath: 'src/nested/needle.md',
        url: 'https://api.example.test/files/needle.md',
      },
    ]);

    render(<Folder spaceId="space-1" />);

    await user.type(
      screen.getByRole('searchbox', { name: 'Search files' }),
      'needle'
    );
    await user.click(
      await screen.findByRole('treeitem', { name: 'needle.md' })
    );
    await user.click(await screen.findByRole('button', { name: 'Open in' }));

    const menuItems = await screen.findAllByRole('menuitem');
    expect(menuItems.map((item) => item.textContent?.trim())).toEqual([
      'Show in Finder',
      'Cursor',
      'VS Code',
    ]);
    expect(
      screen.queryByRole('menuitem', { name: 'Open in browser' })
    ).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /default app/i })).toBeNull();

    await user.click(menuItems[0]);

    await waitFor(() =>
      expect(mocks.revealLocalPath).toHaveBeenCalledWith(
        '/workspace/local-space/src/nested/needle.md'
      )
    );
  });

  it('opens the exact selected local folder instead of its parent', async () => {
    const user = userEvent.setup();
    Object.assign(mocks.spaceState.spaces['space-1'], {
      name: 'Local space',
      sourceType: 'folder',
      rootPath: '/workspace/local-space',
    });
    mocks.getElectronAPI.mockReturnValue({
      getPlatform: () => 'darwin',
      openInIDE: mocks.openInIDE,
      revealLocalPath: mocks.revealLocalPath,
    } as ElectronAPI);
    mocks.getIpcRenderer.mockReturnValue({ invoke: vi.fn() } as IpcRenderer);
    mocks.fetchGet.mockResolvedValue([
      {
        filename: 'needle.md',
        relativePath: 'src/nested/needle.md',
        url: 'https://api.example.test/files/needle.md',
      },
    ]);

    render(<Folder spaceId="space-1" />);

    await user.type(
      screen.getByRole('searchbox', { name: 'Search files' }),
      'needle'
    );
    await user.click(await screen.findByRole('button', { name: 'nested' }));
    await user.click(await screen.findByRole('button', { name: 'Open in' }));

    const menuItems = await screen.findAllByRole('menuitem');
    expect(menuItems.map((item) => item.textContent?.trim())).toEqual([
      'Open in Finder',
      'Cursor',
      'VS Code',
    ]);

    await user.click(menuItems[0]);

    await waitFor(() =>
      expect(mocks.revealLocalPath).toHaveBeenCalledWith(
        '/workspace/local-space/src/nested'
      )
    );
  });

  it('offers only Open in browser for a remote file on the web', async () => {
    const user = userEvent.setup();
    render(<Folder spaceId="space-1" />);

    await user.type(
      screen.getByRole('searchbox', { name: 'Search files' }),
      'needle'
    );
    await user.click(
      await screen.findByRole('treeitem', { name: 'needle.md' })
    );
    await user.click(await screen.findByRole('button', { name: 'Open in' }));

    const menuItems = await screen.findAllByRole('menuitem');
    expect(menuItems.map((item) => item.textContent?.trim())).toEqual([
      'Open in browser',
    ]);
    expect(screen.queryByRole('menuitem', { name: 'Cursor' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'VS Code' })).toBeNull();
  });
});
