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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  language: 'en',
  authState: { email: 'preview@example.invalid', user_id: 7 },
  skillState: {
    skills: [] as Skill[],
    syncFromDisk: vi.fn(),
    updateSkill: vi.fn(),
  },
  spaceState: { spaces: {}, projectsBySpaceId: {} },
  fetchWorkspaceCurrent: vi.fn(),
  fetchWorkspaceConfiguration: vi.fn(),
}));

vi.mock('@/api/http', () => ({ getBaseURL: vi.fn().mockResolvedValue('') }));
vi.mock('@/service/workspaceConfigurationApi', () => ({
  fetchWorkspaceConfiguration: mocks.fetchWorkspaceConfiguration,
}));
vi.mock('@/service/workspaceApi', () => ({
  fetchWorkspaceCurrent: mocks.fetchWorkspaceCurrent,
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
  ) => selector(mocks.authState),
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

const setSpaces = (...ids: string[]) => {
  mocks.spaceState.spaces = Object.fromEntries(
    ids.map((id) => [
      id,
      { id, name: `Space ${id}`, status: 'active', sourceType: 'cloud' },
    ])
  );
};
const profile = (ref = 'bundle://skills/research/SKILL.md') => ({
  document: { spec: { skills: [{ ref, assignTo: [] }] } },
});
const httpError = (status: number, code: string) =>
  Object.assign(new Error(code), {
    status,
    response: { data: { detail: { code } }, status },
  });
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
  active = true,
}: {
  initialEntry?: string;
  active?: boolean;
}) {
  return (
    <MemoryRouter initialEntries={[initialEntry]}>
      <SkillsProvider active={active}>
        <LibraryProbe />
      </SkillsProvider>
    </MemoryRouter>
  );
}

describe('Skills library state', () => {
  beforeEach(() => {
    mocks.language = 'en';
    mocks.authState = { email: 'preview@example.invalid', user_id: 7 };
    mocks.skillState.skills = [];
    mocks.skillState.syncFromDisk.mockReset().mockResolvedValue(undefined);
    mocks.skillState.updateSkill.mockReset().mockResolvedValue(undefined);
    mocks.fetchWorkspaceCurrent.mockReset().mockImplementation(async (id) => ({
      space_id: id,
      bound: true,
    }));
    mocks.fetchWorkspaceConfiguration.mockReset();
    mocks.spaceState.spaces = {};
    mocks.spaceState.projectsBySpaceId = {};
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads skill counts even while another Settings section is active', async () => {
    render(<Library active={false} />);

    await waitFor(() =>
      expect(mocks.skillState.syncFromDisk).toHaveBeenCalledTimes(1)
    );
    await waitFor(() => expect(library.loading).toBe(false));
  });

  it('keeps global Skills visible and avoids configuration requests for unbound Spaces', async () => {
    setSpaces('local-unbound', 'bound');
    mocks.skillState.skills = [skill];
    mocks.fetchWorkspaceCurrent.mockImplementation(async (id) => ({
      space_id: id,
      bound: id === 'bound',
    }));
    mocks.fetchWorkspaceConfiguration.mockResolvedValue(profile());
    render(<Library />);

    await waitFor(() => expect(library.profilesLoading).toBe(false));
    expect(library.errors).toEqual([]);
    expect(library.entries.map(({ id }) => id)).toEqual([
      'global:research',
      'space:bound:bundle://skills/research/SKILL.md',
    ]);
    expect(mocks.fetchWorkspaceConfiguration).toHaveBeenCalledTimes(1);
    expect(mocks.fetchWorkspaceConfiguration).toHaveBeenCalledWith(
      'bound',
      { email: 'preview@example.invalid', userId: 7 },
      'Space bound',
      { signal: expect.any(AbortSignal) }
    );
    expect(mocks.fetchWorkspaceCurrent).toHaveBeenCalledWith(
      'local-unbound',
      'preview@example.invalid',
      7,
      { signal: expect.any(AbortSignal) }
    );
  });

  it('treats only the explicit missing-binding race as a normal absent profile', async () => {
    setSpaces('removed');
    mocks.skillState.skills = [skill];
    mocks.fetchWorkspaceConfiguration.mockRejectedValue(
      httpError(404, 'workspace_binding_not_found')
    );
    render(<Library />);

    await waitFor(() => expect(library.profilesLoading).toBe(false));
    expect(library.errors).toEqual([]);
    expect(library.entries.map(({ id }) => id)).toEqual(['global:research']);
  });

  it.each([
    { label: 'unrelated 404', error: httpError(404, 'route_not_found') },
    {
      label: 'permission failure',
      error: httpError(403, 'workspace_binding_not_found'),
    },
    { label: 'network failure', error: new TypeError('Failed to fetch') },
    {
      label: 'unstructured missing-binding text',
      error: new Error('workspace_binding_not_found'),
    },
  ])('reports $label without hiding global Skills', async ({ error }) => {
    setSpaces('failed');
    mocks.skillState.skills = [skill];
    mocks.fetchWorkspaceConfiguration.mockRejectedValue(error);
    render(<Library />);

    await waitFor(() => expect(library.profilesLoading).toBe(false));
    expect(library.errors).toEqual(['en:agents.library-space-load-failed']);
    expect(library.entries.map(({ id }) => id)).toEqual(['global:research']);
  });

  it.each([
    {
      label: 'failed binding lookup',
      error: httpError(404, 'route_not_found'),
      response: undefined,
    },
    {
      label: 'missing bound state',
      error: undefined,
      response: { space_id: 'failed' },
    },
    {
      label: 'wrong Space response',
      error: undefined,
      response: { space_id: 'other', bound: false },
    },
  ])(
    'reports $label and allows a successful retry',
    async ({ error, response }) => {
      setSpaces('failed');
      if (error) mocks.fetchWorkspaceCurrent.mockRejectedValueOnce(error);
      else mocks.fetchWorkspaceCurrent.mockResolvedValueOnce(response);
      mocks.fetchWorkspaceConfiguration.mockResolvedValue(profile());
      render(<Library />);

      await waitFor(() => expect(library.profilesLoading).toBe(false));
      expect(library.errors).toEqual(['en:agents.library-space-load-failed']);
      expect(mocks.fetchWorkspaceConfiguration).not.toHaveBeenCalled();

      act(() => library.refresh());
      await waitFor(() => expect(library.entries).toHaveLength(1));
      expect(library.errors).toEqual([]);
      expect(mocks.fetchWorkspaceConfiguration).toHaveBeenCalledTimes(1);
    }
  );

  it('rechecks an unbound Space on refresh without creating a binding', async () => {
    setSpaces('later-bound');
    mocks.fetchWorkspaceCurrent.mockResolvedValueOnce({
      space_id: 'later-bound',
      bound: false,
    });
    mocks.fetchWorkspaceConfiguration.mockResolvedValue(profile());
    render(<Library />);

    await waitFor(() => expect(library.profilesLoading).toBe(false));
    expect(mocks.fetchWorkspaceConfiguration).not.toHaveBeenCalled();
    act(() => library.refresh());
    await waitFor(() => expect(library.entries).toHaveLength(1));
    expect(mocks.fetchWorkspaceCurrent).toHaveBeenCalledTimes(2);
    expect(mocks.fetchWorkspaceConfiguration).toHaveBeenCalledTimes(1);
  });

  it('aborts an old account lookup and never starts its subsequent profile request', async () => {
    setSpaces('same-space');
    let finishOldLookup!: (value: unknown) => void;
    let oldSignal!: AbortSignal;
    mocks.fetchWorkspaceCurrent.mockImplementationOnce(
      (_id, _email, _userId, options) => {
        oldSignal = options.signal;
        return new Promise((resolve) => {
          finishOldLookup = resolve;
        });
      }
    );
    mocks.fetchWorkspaceConfiguration.mockResolvedValue(profile());
    const view = render(<Library />);

    mocks.authState = { email: 'second@example.invalid', user_id: 8 };
    view.rerender(<Library />);
    await waitFor(() => expect(library.profilesLoading).toBe(false));
    expect(oldSignal.aborted).toBe(true);
    await act(async () =>
      finishOldLookup({ space_id: 'same-space', bound: true })
    );

    expect(mocks.fetchWorkspaceConfiguration).toHaveBeenCalledTimes(1);
    expect(mocks.fetchWorkspaceConfiguration).toHaveBeenCalledWith(
      'same-space',
      { email: 'second@example.invalid', userId: 8 },
      'Space same-space',
      { signal: expect.any(AbortSignal) }
    );
    expect(library.errors).toEqual([]);
    expect(library.entries).toHaveLength(1);
  });

  it('bounds binding lookups in the same batch timeout while global Skills remain available', async () => {
    vi.useFakeTimers();
    setSpaces('one', 'two', 'three', 'queued');
    mocks.skillState.skills = [skill];
    mocks.fetchWorkspaceCurrent.mockImplementation(
      (_id, _email, _userId, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          );
        })
    );
    render(<Library />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(library.loading).toBe(false);
    expect(library.profilesLoading).toBe(false);
    expect(library.entries.map(({ id }) => id)).toEqual(['global:research']);
    expect(library.errors).toHaveLength(4);
    expect(mocks.fetchWorkspaceCurrent).toHaveBeenCalledTimes(3);
    expect(mocks.fetchWorkspaceConfiguration).not.toHaveBeenCalled();
  });

  it('aborts a previous account profile and discards its late completion', async () => {
    setSpaces('same-space');
    let finishOldProfile!: (value: unknown) => void;
    let oldSignal!: AbortSignal;
    mocks.fetchWorkspaceConfiguration
      .mockImplementationOnce((_id, _identity, _name, options) => {
        oldSignal = options.signal;
        return new Promise((resolve) => {
          finishOldProfile = resolve;
        });
      })
      .mockResolvedValue(profile('bundle://skills/current/SKILL.md'));
    const view = render(<Library />);
    await waitFor(() =>
      expect(mocks.fetchWorkspaceConfiguration).toHaveBeenCalledTimes(1)
    );

    mocks.authState = { email: 'second@example.invalid', user_id: 8 };
    view.rerender(<Library />);
    await waitFor(() => expect(library.profilesLoading).toBe(false));
    expect(oldSignal.aborted).toBe(true);
    await act(async () =>
      finishOldProfile(profile('bundle://skills/old-account/SKILL.md'))
    );

    expect(library.entries.map(({ id }) => id)).toEqual([
      'space:same-space:bundle://skills/current/SKILL.md',
    ]);
    expect(library.errors).toEqual([]);
  });

  it('requires sign-in for Space reads while continuing to show global Skills', async () => {
    setSpaces('signed-out');
    mocks.authState.email = '';
    mocks.skillState.skills = [skill];
    render(<Library />);

    await waitFor(() => expect(library.loading).toBe(false));
    expect(library.errors).toEqual(['en:agents.library-sign-in']);
    expect(library.entries.map(({ id }) => id)).toEqual(['global:research']);
    expect(mocks.fetchWorkspaceCurrent).not.toHaveBeenCalled();
    expect(mocks.fetchWorkspaceConfiguration).not.toHaveBeenCalled();
  });

  it('bounds the whole Space batch without blocking global Skill writes', async () => {
    vi.useFakeTimers();
    mocks.spaceState.spaces = Object.fromEntries(
      Array.from({ length: 7 }, (_, index) => [
        `space-${index}`,
        {
          id: `space-${index}`,
          name: `Space ${index}`,
          status: 'active',
          sourceType: 'cloud',
        },
      ])
    );
    mocks.fetchWorkspaceConfiguration.mockImplementation(
      (
        _spaceId: string,
        _identity: unknown,
        _name: string,
        options: { signal?: AbortSignal }
      ) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        })
    );

    render(<Library />);
    expect(library.loading).toBe(true);
    expect(library.profilesLoading).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(library.loading).toBe(false);
    expect(library.profilesLoading).toBe(true);
    await act(async () => {
      expect(await library.updateGlobal(skill, { enabled: false })).toBe(true);
    });
    expect(mocks.skillState.updateSkill).toHaveBeenCalledTimes(1);
    expect(mocks.fetchWorkspaceConfiguration).toHaveBeenCalledTimes(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(library.loading).toBe(false);
    expect(library.profilesLoading).toBe(false);
    expect(library.errors).toHaveLength(7);
    expect(mocks.fetchWorkspaceConfiguration).toHaveBeenCalledTimes(3);
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
