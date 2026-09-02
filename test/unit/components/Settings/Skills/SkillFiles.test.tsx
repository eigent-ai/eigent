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

import { fetchGet } from '@/api/http';
import SkillFiles from '@/components/Settings/Skills/components/SkillFiles';
import type { SkillLibraryEntry } from '@/components/Settings/Skills/skillLibrary';
import { FILE_PREVIEW_LIMITS } from '@/shared/filePreviewContract';
import { useAuthStore } from '@/store/authStore';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/http')>()),
  fetchGet: vi.fn(),
}));

vi.mock('@/components/ChatBox/MessageItem/MarkDown', () => ({
  MarkDown: ({ content }: { content: string }) => <article>{content}</article>,
}));

vi.mock('@/components/CodeViewer/SourceCodeViewer', () => ({
  SourceCodeViewer: ({ value }: { value: string }) => (
    <pre data-testid="skill-source">{value}</pre>
  ),
}));

const createObjectURL = vi.fn(() => 'blob:skill-document');
const revokeObjectURL = vi.fn();

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

function deferredResponse() {
  let resolve!: (response: { success: boolean; content: string }) => void;
  const promise = new Promise<{ success: boolean; content: string }>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function Location() {
  const location = useLocation();
  return (
    <div data-testid="location">{location.pathname + location.search}</div>
  );
}

function renderDocument(entry: SkillLibraryEntry) {
  return render(
    <MemoryRouter>
      <SkillFiles entry={entry} />
      <Location />
    </MemoryRouter>
  );
}

describe('Skills document preview with the existing API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchGet).mockReset();
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
    'loads a %s SKILL.md from the existing endpoint and toggles source locally',
    async (kind) => {
      const user = userEvent.setup();
      const pending = deferredResponse();
      vi.mocked(fetchGet).mockReturnValueOnce(pending.promise);
      renderDocument(globalEntry('research notes', kind));

      expect(screen.getByRole('status')).toHaveTextContent(
        'Loading skill document…'
      );
      await act(async () => {
        pending.resolve({ success: true, content: '# Current instructions' });
      });

      expect(screen.getByRole('article')).toHaveTextContent(
        '# Current instructions'
      );
      expect(fetchGet).toHaveBeenCalledTimes(1);
      expect(fetchGet).toHaveBeenCalledWith('/skills/research%20notes');
      expect(screen.queryByText(/Cached content/)).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /file tree/i })
      ).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Source' }));
      expect(screen.getByTestId('skill-source')).toHaveTextContent(
        '# Current instructions'
      );
      await user.click(screen.getByRole('button', { name: 'Preview' }));
      expect(screen.getByRole('article')).toBeVisible();
      expect(fetchGet).toHaveBeenCalledTimes(1);
    }
  );

  it('omits YAML frontmatter only in Preview and preserves the complete Source', async () => {
    const user = userEvent.setup();
    const body = '\n# Research instructions\n\nCheck each cited source.\n';
    const raw = `---\nname: research\ndescription: Verify references\n---\n${body}`;
    vi.mocked(fetchGet).mockResolvedValueOnce({ success: true, content: raw });
    renderDocument(globalEntry());

    expect((await screen.findByRole('article')).textContent).toBe(body);
    expect(screen.queryByText(/name: research/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Source' }));
    expect(screen.getByTestId('skill-source').textContent).toBe(raw);
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByRole('article').textContent).toBe(body);
    expect(fetchGet).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it.each([
    { success: false, content: '# Failed response' },
    { success: true, content: null },
  ])('rejects invalid document responses: %j', async (response) => {
    vi.mocked(fetchGet).mockResolvedValueOnce(response);
    renderDocument(globalEntry());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load the skill document.'
    );
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('reloads the document when the same package is replaced in place', async () => {
    vi.mocked(fetchGet)
      .mockResolvedValueOnce({ success: true, content: '# Original' })
      .mockResolvedValueOnce({ success: true, content: '# Replaced' });
    const view = renderDocument(globalEntry());
    expect(await screen.findByRole('article')).toHaveTextContent('# Original');

    view.rerender(
      <MemoryRouter>
        <SkillFiles entry={globalEntry()} revision="replaced" />
        <Location />
      </MemoryRouter>
    );

    expect(await screen.findByRole('article')).toHaveTextContent('# Replaced');
    expect(fetchGet).toHaveBeenCalledTimes(2);
  });

  it('retries a failed read without needing any package-browser endpoint', async () => {
    vi.mocked(fetchGet)
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce({ success: true, content: '# Recovered' });
    const user = userEvent.setup();
    renderDocument(globalEntry());
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('article')).toHaveTextContent('# Recovered');
    expect(vi.mocked(fetchGet).mock.calls).toEqual([
      ['/skills/research'],
      ['/skills/research'],
    ]);
  });

  it.each(['skill', 'account'] as const)(
    'ignores an old response after switching %s',
    async (switchTarget) => {
      const old = deferredResponse();
      const current = deferredResponse();
      vi.mocked(fetchGet)
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(current.promise);
      const view = renderDocument(globalEntry());

      if (switchTarget === 'skill') {
        view.rerender(
          <MemoryRouter>
            <SkillFiles entry={globalEntry('writing')} />
          </MemoryRouter>
        );
      } else {
        act(() => {
          useAuthStore.setState({ email: 'other@example.com', user_id: 2 });
        });
      }
      await waitFor(() => expect(fetchGet).toHaveBeenCalledTimes(2));
      await act(async () => {
        current.resolve({ success: true, content: '# Current document' });
      });
      await act(async () => {
        old.resolve({ success: true, content: '# Stale document' });
      });

      expect(screen.getByRole('article')).toHaveTextContent(
        '# Current document'
      );
      expect(screen.queryByText('# Stale document')).not.toBeInTheDocument();
      expect(createObjectURL).toHaveBeenCalledTimes(1);
    }
  );

  it('downloads the actual document and releases its URL on unmount', async () => {
    vi.mocked(fetchGet).mockResolvedValueOnce({
      success: true,
      content: '# Read me',
    });
    const user = userEvent.setup();
    let download: HTMLAnchorElement | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
      function () {
        download = this;
      }
    );
    const view = renderDocument(globalEntry());
    await user.click(
      await screen.findByRole('button', { name: 'Download file' })
    );

    expect(download?.download).toBe('SKILL.md');
    expect(download?.getAttribute('href')).toBe('blob:skill-document');
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(revokeObjectURL).not.toHaveBeenCalled();
    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:skill-document');
  });

  it('keeps oversized instructions downloadable without mounting their preview', async () => {
    vi.mocked(fetchGet).mockResolvedValueOnce({
      success: true,
      content: 'a'.repeat(FILE_PREVIEW_LIMITS.textBytes + 1),
    });
    renderDocument(globalEntry());
    expect(
      await screen.findByText(
        'This file exceeds the safe in-app preview limit.'
      )
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Download file' })).toBeEnabled();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('shows the exact Space reference and its settings without fetching another skill', async () => {
    const user = userEvent.setup();
    const ref = 'bundle://skills/research/SKILL.md';
    renderDocument({
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
    expect(
      screen.queryByRole('button', { name: 'Retry' })
    ).not.toBeInTheDocument();
    expect(fetchGet).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole('button', { name: 'Manage in Space settings' })
    );
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/home?section=spaces&spaceId=space%201&spaceTab=workspace-profile'
    );
    expect(fetchGet).not.toHaveBeenCalled();
  });
});
