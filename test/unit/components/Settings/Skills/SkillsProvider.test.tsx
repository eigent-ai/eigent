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
  SkillsProvider,
  useSkillsLibrary,
} from '@/components/Settings/Skills/SkillsProvider';
import type { Skill } from '@/store/skillsStore';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  language: 'en',
  skillState: { skills: [], syncFromDisk: vi.fn(), updateSkill: vi.fn() },
  spaceState: { spaces: {}, projectsBySpaceId: {} },
}));

vi.mock('@/api/http', () => ({ getBaseURL: vi.fn().mockResolvedValue('') }));
vi.mock('@/service/workspaceConfigurationApi', () => ({
  fetchWorkspaceConfiguration: vi.fn(),
}));
vi.mock('@/store/skillsStore', async (importOriginal) => ({
  SkillSignInRequiredError: (
    await importOriginal<typeof import('@/store/skillsStore')>()
  ).SkillSignInRequiredError,
  useSkillsStore: Object.assign(
    (selector: (state: typeof mocks.skillState) => unknown) =>
      selector(mocks.skillState),
    { getState: () => mocks.skillState }
  ),
}));
vi.mock('@/store/spaceStore', () => ({
  isUnconfiguredPlaceholderSpace: () => false,
  useSpaceStore: (selector: (state: typeof mocks.spaceState) => unknown) =>
    selector(mocks.spaceState),
}));
vi.mock('@/store/authStore', () => ({
  useAuthStore: (
    selector: (state: { email: string; user_id: number }) => unknown
  ) => selector({ email: 'preview@example.invalid', user_id: 7 }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => `${mocks.language}:${key}`,
  }),
}));
vi.mock('@/components/Settings/Skills/components/SkillUploadDialog', () => ({
  default: () => null,
}));
vi.mock('@/components/Settings/Skills/components/SkillDeleteDialog', () => ({
  default: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) =>
    open ? <button onClick={onConfirm}>Confirm delete</button> : null,
}));

const skill: Skill = {
  id: 'disk-research',
  name: 'research',
  description: 'Find sources',
  skillDirName: 'research',
  filePath: 'research/SKILL.md',
  fileContent: '',
  addedAt: 0,
  enabled: true,
  isExample: false,
  scope: { isGlobal: true, selectedAgents: [] },
};
let library: ReturnType<typeof useSkillsLibrary>;

function LibraryProbe() {
  const value = useSkillsLibrary();
  useEffect(() => {
    library = value;
  }, [value]);
  const { errors, loading, setDeleteTarget } = value;
  const location = useLocation();
  return (
    <div>
      <div role="alert">{errors.join(' ')}</div>
      <output aria-label="Current route" aria-busy={loading}>
        {location.pathname}
        {location.search}
      </output>
      <button onClick={() => setDeleteTarget(skill)}>Delete research</button>
    </div>
  );
}

function Library({
  initialEntry = '/home?section=settings&tab=skills',
}: {
  initialEntry?: string;
}) {
  return (
    <MemoryRouter initialEntries={[initialEntry]}>
      <SkillsProvider active>
        <LibraryProbe />
      </SkillsProvider>
    </MemoryRouter>
  );
}

describe('Skills library state', () => {
  beforeEach(() => {
    mocks.language = 'en';
    mocks.skillState.syncFromDisk.mockReset().mockResolvedValue(undefined);
    mocks.skillState.updateSkill.mockReset().mockResolvedValue(undefined);
  });

  it('prevents settings writes while a refresh is reading configuration', async () => {
    let finishRefresh!: () => void;
    mocks.skillState.syncFromDisk.mockReturnValue(
      new Promise<void>((resolve) => {
        finishRefresh = resolve;
      })
    );
    render(<Library />);
    await waitFor(() =>
      expect(mocks.skillState.syncFromDisk).toHaveBeenCalledTimes(1)
    );

    await act(async () => {
      expect(await library.updateGlobal(skill, { enabled: false })).toBe(false);
    });
    expect(mocks.skillState.updateSkill).not.toHaveBeenCalled();

    await act(async () => finishRefresh());
    await waitFor(() => expect(library.loading).toBe(false));
    await act(async () => {
      expect(await library.updateGlobal(skill, { enabled: false })).toBe(true);
    });
    expect(mocks.skillState.updateSkill).toHaveBeenCalledWith(skill.id, {
      enabled: false,
    });
  });

  it('blocks refresh, upload and delete while a settings write is pending', async () => {
    let finishSave!: () => void;
    mocks.skillState.updateSkill.mockReturnValue(
      new Promise<void>((resolve) => {
        finishSave = resolve;
      })
    );
    render(<Library />);
    await waitFor(() => expect(library.loading).toBe(false));

    let save!: Promise<boolean>;
    act(() => {
      save = library.updateGlobal(skill, { enabled: false });
    });
    expect(library.pendingIds.has(skill.id)).toBe(true);
    act(() => {
      library.refresh();
      library.openUpload();
      library.setDeleteTarget(skill);
    });
    expect(mocks.skillState.syncFromDisk).toHaveBeenCalledTimes(1);
    expect(library.uploadMode).toBeNull();
    expect(library.deleteTarget).toBeNull();

    await act(async () => {
      finishSave();
      await save;
    });
    act(() => library.refresh());
    await waitFor(() =>
      expect(mocks.skillState.syncFromDisk).toHaveBeenCalledTimes(2)
    );
  });

  it('keeps an upload deep link until the initial refresh has finished', async () => {
    let finishRefresh!: () => void;
    mocks.skillState.syncFromDisk.mockReturnValue(
      new Promise<void>((resolve) => {
        finishRefresh = resolve;
      })
    );
    render(
      <Library initialEntry="/home?section=settings&tab=skills&skillAction=create" />
    );
    await waitFor(() =>
      expect(mocks.skillState.syncFromDisk).toHaveBeenCalledTimes(1)
    );
    expect(library.uploadMode).toBeNull();
    expect(screen.getByLabelText('Current route').textContent).toContain(
      'skillAction=create'
    );

    await act(async () => finishRefresh());
    await waitFor(() => expect(library.uploadMode).toBe('create'));
    expect(screen.getByLabelText('Current route').textContent).toBe(
      '/home?section=settings&tab=skills'
    );
  });

  it('retranslates existing failures without refetching when the language changes', async () => {
    mocks.skillState.syncFromDisk.mockRejectedValue(new Error('offline'));
    const view = render(<Library />);

    expect(
      await screen.findByText('en:agents.library-global-load-failed')
    ).toBeVisible();

    mocks.language = 'fr';
    view.rerender(<Library />);

    expect(
      screen.getByText('fr:agents.library-global-load-failed')
    ).toBeVisible();
    expect(mocks.skillState.syncFromDisk).toHaveBeenCalledTimes(1);
  });

  it('saves bulk enablement one skill at a time', async () => {
    const notes: Skill = {
      ...skill,
      id: 'disk-notes',
      name: 'notes',
      skillDirName: 'notes',
    };
    let inflight = 0;
    let maxInflight = 0;
    mocks.skillState.updateSkill.mockImplementation(async () => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      await Promise.resolve();
      inflight -= 1;
    });
    render(<Library />);
    await waitFor(() => expect(library.loading).toBe(false));

    await act(async () => {
      await library.updateGlobalMany([skill, notes], { enabled: false });
    });

    expect(maxInflight).toBe(1);
    expect(mocks.skillState.updateSkill.mock.calls.map(([id]) => id)).toEqual([
      skill.id,
      notes.id,
    ]);
  });

  it.each([
    { skillId: 'global:research', remainingSkillId: '' },
    {
      skillId: 'global:writing',
      remainingSkillId: '&skillId=global%3Awriting',
    },
  ])(
    'only leaves the deleted skill detail and preserves overview filters ($skillId)',
    async ({ skillId, remainingSkillId }) => {
      const overview =
        '/home?section=settings&tab=skills&skillSearch=research&skillFilter=global';
      render(
        <Library
          initialEntry={`${overview}&skillId=${encodeURIComponent(skillId)}`}
        />
      );
      await waitFor(() =>
        expect(screen.getByLabelText('Current route')).toHaveAttribute(
          'aria-busy',
          'false'
        )
      );

      fireEvent.click(screen.getByRole('button', { name: 'Delete research' }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));

      expect(screen.getByLabelText('Current route').textContent).toBe(
        `${overview}${remainingSkillId}`
      );
      expect(
        screen.queryByRole('button', { name: 'Confirm delete' })
      ).not.toBeInTheDocument();
    }
  );
});
