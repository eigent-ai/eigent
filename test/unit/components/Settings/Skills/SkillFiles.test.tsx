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

import { fetchGet, fetchGetBlob } from '@/api/http';
import SkillFiles from '@/components/Settings/Skills/components/SkillFiles';
import type { SkillLibraryEntry } from '@/components/Settings/Skills/skillLibrary';
import { FILE_PREVIEW_LIMITS } from '@/shared/filePreviewContract';
import { useAuthStore } from '@/store/authStore';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/http')>()),
  fetchGet: vi.fn(),
  fetchGetBlob: vi.fn(),
}));

vi.mock('@/components/ChatBox/MessageItem/MarkDown', () => ({
  MarkDown: ({ content }: { content: string }) => <article>{content}</article>,
}));

vi.mock('@/components/CodeViewer/SourceCodeViewer', () => ({
  SourceCodeViewer: ({ value }: { value: string }) => (
    <pre data-testid="skill-source">{value}</pre>
  ),
}));

const createObjectURL = vi.fn(() => 'blob:skill-file');
const revokeObjectURL = vi.fn();

function fileBlob(content: string) {
  const blob = new Blob([content]);
  Object.defineProperty(blob, 'text', {
    value: vi.fn().mockResolvedValue(content),
  });
  return blob;
}

function globalEntry(
  directory = 'research',
  kind: 'global' | 'builtin' = 'global'
): Exclude<SkillLibraryEntry, { kind: 'space' }> {
  return {
    id: `global:${directory}`,
    kind,
    name: directory,
    description: 'Research instructions',
    skill: {
      id: `disk-${directory}`,
      skillDirName: directory,
      name: directory,
      description: 'Research instructions',
      filePath: `/fixtures/skills/${directory}/SKILL.md`,
      fileContent: 'Cached content must not replace the real document.',
      addedAt: 1,
      enabled: true,
      isExample: kind === 'builtin',
      scope: { isGlobal: true, selectedAgents: [] },
    },
  };
}

function inventory(
  files: Array<{
    path: string;
    size: number;
    mimeType?: string;
  }> = [
    { path: 'SKILL.md', size: 32, mimeType: 'text/markdown' },
    { path: 'scripts/helper.py', size: 24, mimeType: 'text/x-python' },
  ]
) {
  return { success: true, files };
}

function Location() {
  const location = useLocation();
  return (
    <div data-testid="location">{location.pathname + location.search}</div>
  );
}

function renderPackage(entry: SkillLibraryEntry) {
  return render(
    <MemoryRouter>
      <SkillFiles entry={entry} />
      <Location />
    </MemoryRouter>
  );
}

describe('Skill package file browser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchGet).mockReset();
    vi.mocked(fetchGetBlob).mockReset();
    useAuthStore.setState({ email: 'viewer@example.com', user_id: 1 });
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = createObjectURL;
        static revokeObjectURL = revokeObjectURL;
      }
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(['global', 'builtin'] as const)(
    'loads the complete %s package and previews nested files',
    async (kind) => {
      const user = userEvent.setup();
      vi.mocked(fetchGet).mockResolvedValueOnce(inventory());
      vi.mocked(fetchGetBlob).mockImplementation(
        async (_url, params: Record<string, string>) =>
          fileBlob(
            params.path === 'SKILL.md'
              ? '# Current instructions'
              : 'print("helper")'
          )
      );

      renderPackage(globalEntry('research notes', kind));

      expect(screen.getByRole('status')).toHaveTextContent(
        'Loading skill document…'
      );
      expect(await screen.findByRole('article')).toHaveTextContent(
        '# Current instructions'
      );
      expect(fetchGet).toHaveBeenCalledWith('/skills/research%20notes/files');
      expect(fetchGetBlob).toHaveBeenCalledWith(
        '/skills/research%20notes/file',
        { path: 'SKILL.md' },
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
      expect(screen.getByRole('tree', { name: 'Files' })).toBeVisible();

      await user.click(screen.getByRole('treeitem', { name: 'helper.py' }));
      expect(await screen.findByTestId('skill-source')).toHaveTextContent(
        'print("helper")'
      );
      expect(fetchGetBlob).toHaveBeenLastCalledWith(
        '/skills/research%20notes/file',
        { path: 'scripts/helper.py' },
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    }
  );

  it('omits SKILL.md frontmatter only in Preview and preserves Source', async () => {
    const user = userEvent.setup();
    const body = '\n# Research instructions\n\nCheck each cited source.\n';
    const raw = `---\nname: research\ndescription: Verify references\n---\n${body}`;
    vi.mocked(fetchGet).mockResolvedValueOnce(
      inventory([{ path: 'SKILL.md', size: raw.length }])
    );
    vi.mocked(fetchGetBlob).mockResolvedValueOnce(fileBlob(raw));
    renderPackage(globalEntry());

    expect((await screen.findByRole('article')).textContent).toBe(body);
    await user.click(screen.getByRole('button', { name: 'Source' }));
    expect(screen.getByTestId('skill-source').textContent).toBe(raw);
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByRole('article').textContent).toBe(body);
    expect(fetchGetBlob).toHaveBeenCalledTimes(1);
  });

  it.each([
    { success: false, files: [] },
    { success: true, files: [] },
  ])('rejects an unusable package inventory: %j', async (response) => {
    vi.mocked(fetchGet).mockResolvedValueOnce(response);
    renderPackage(globalEntry());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load the skill document.'
    );
    expect(fetchGetBlob).not.toHaveBeenCalled();
  });

  it('retries an inventory failure and then loads the package', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchGet)
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce(inventory());
    vi.mocked(fetchGetBlob).mockResolvedValueOnce(fileBlob('# Recovered'));
    renderPackage(globalEntry());

    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('article')).toHaveTextContent('# Recovered');
    expect(fetchGet).toHaveBeenCalledTimes(2);
  });

  it('retries the selected file without refetching the inventory', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchGet).mockResolvedValueOnce(inventory());
    vi.mocked(fetchGetBlob)
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce(fileBlob('# Recovered file'));
    renderPackage(globalEntry());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load the skill document.'
    );
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('article')).toHaveTextContent(
      '# Recovered file'
    );
    expect(fetchGet).toHaveBeenCalledTimes(1);
    expect(fetchGetBlob).toHaveBeenCalledTimes(2);
  });

  it('reloads package inventory and content when it is replaced in place', async () => {
    vi.mocked(fetchGet)
      .mockResolvedValueOnce(inventory())
      .mockResolvedValueOnce(inventory());
    vi.mocked(fetchGetBlob)
      .mockResolvedValueOnce(fileBlob('# Original'))
      .mockResolvedValueOnce(fileBlob('# Replaced'));
    const view = renderPackage(globalEntry());
    expect(await screen.findByRole('article')).toHaveTextContent('# Original');

    view.rerender(
      <MemoryRouter>
        <SkillFiles entry={globalEntry()} revision="replaced" />
        <Location />
      </MemoryRouter>
    );

    expect(await screen.findByRole('article')).toHaveTextContent('# Replaced');
    expect(fetchGet).toHaveBeenCalledTimes(2);
    expect(fetchGetBlob).toHaveBeenCalledTimes(2);
  });

  it('does not automatically read a file above the preview limit', async () => {
    vi.mocked(fetchGet).mockResolvedValueOnce(
      inventory([
        {
          path: 'SKILL.md',
          size: FILE_PREVIEW_LIMITS.textBytes + 1,
          mimeType: 'text/markdown',
        },
      ])
    );
    renderPackage(globalEntry());

    expect(
      await screen.findByText(
        'This file exceeds the safe in-app preview limit.'
      )
    ).toBeVisible();
    expect(fetchGetBlob).not.toHaveBeenCalled();
  });

  it('releases the selected file object URL on unmount', async () => {
    vi.mocked(fetchGet).mockResolvedValueOnce(inventory());
    vi.mocked(fetchGetBlob).mockResolvedValueOnce(fileBlob('# Read me'));
    const view = renderPackage(globalEntry());
    await screen.findByRole('article');

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(revokeObjectURL).not.toHaveBeenCalled();
    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:skill-file');
  });

  it('shows the exact Space reference and settings without fetching a package', async () => {
    const user = userEvent.setup();
    const ref = 'bundle://skills/research/SKILL.md';
    renderPackage({
      id: `space:space 1:${ref}`,
      kind: 'space',
      name: 'research',
      description: ref,
      ref,
      spaceId: 'space 1',
      spaceName: 'Research Space',
      assignTo: [],
    });

    expect(screen.getByText(ref)).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Space skill file previews are not supported here.'
    );
    expect(fetchGet).not.toHaveBeenCalled();
    expect(fetchGetBlob).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole('button', { name: 'Manage in Space settings' })
    );
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/home?section=spaces&spaceId=space%201&spaceTab=workspace-profile'
    );
  });

  it('ignores a stale inventory after switching accounts', async () => {
    let resolveOld!: (value: ReturnType<typeof inventory>) => void;
    const oldInventory = new Promise<ReturnType<typeof inventory>>(
      (resolve) => {
        resolveOld = resolve;
      }
    );
    vi.mocked(fetchGet)
      .mockReturnValueOnce(oldInventory)
      .mockResolvedValueOnce(inventory());
    vi.mocked(fetchGetBlob).mockResolvedValueOnce(fileBlob('# Current'));
    renderPackage(globalEntry());

    act(() => {
      useAuthStore.setState({ email: 'other@example.com', user_id: 2 });
    });
    expect(await screen.findByRole('article')).toHaveTextContent('# Current');
    await act(async () => resolveOld(inventory()));

    expect(screen.getByRole('article')).toHaveTextContent('# Current');
    expect(fetchGetBlob).toHaveBeenCalledTimes(1);
  });
});
