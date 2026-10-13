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

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  listSummaries: vi.fn(),
  listReconciliation: vi.fn(),
  resolveReconciliation: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  settings: vi.fn(),
  consolidate: vi.fn(),
  remove: vi.fn(),
  confirm: vi.fn(),
  pin: vi.fn(),
  restore: vi.fn(),
}));

const spaceStoreState = vi.hoisted(() => ({
  activeSpaceId: 'space-1',
  spaces: {
    'space-1': {
      id: 'space-1',
      name: 'Design Space',
      description: 'Product design work',
      sourceType: 'folder' as const,
      rootPath: '/work/design',
      status: 'active' as const,
      schemaVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    },
  },
  projectsBySpaceId: {
    'space-1': {
      'project-1': {
        id: 'project-1',
        spaceId: 'space-1',
        name: 'Launch Plan',
        status: 'active' as const,
        createdAt: 1,
        updatedAt: 1,
      },
    },
  },
}));

vi.mock('@/service/memoryApi', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listMemoryEntries: api.list,
  listMemoryScopeSummaries: api.listSummaries,
  listMemoryReconciliation: api.listReconciliation,
  resolveMemoryReconciliation: api.resolveReconciliation,
  createMemoryEntry: api.create,
  updateMemoryEntry: api.update,
  updateMemoryScopeSettings: api.settings,
  consolidateMemoryScope: api.consolidate,
  archiveMemoryEntry: api.remove,
  confirmMemoryEntry: api.confirm,
  pinMemoryEntry: api.pin,
  restoreMemoryEntry: api.restore,
}));
vi.mock('@/store/projectStore', () => ({
  useProjectStore: (selector: (state: object) => unknown) =>
    selector({ activeProjectId: 'project-1' }),
}));
vi.mock('@/store/spaceStore', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSpaceStore: (selector: (state: object) => unknown) =>
    selector(spaceStoreState),
}));
vi.mock('@/store/authStore', () => ({
  getAuthStore: () => ({ user_id: 'user-1', token: null }),
  useAuthStore: (selector: (state: object) => unknown) =>
    selector({ user_id: 'user-1' }),
}));

import Memory from '@/components/Settings/Memory';

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="memory-location">
      {location.pathname}
      {location.search}
    </output>
  );
}

const scopeState = {
  scope_type: 'user',
  scope_id: 'user-1',
  owner_kind: 'desktop',
  revision: 1,
  capture_enabled: true,
  use_enabled: true,
  sync_scope: 'full_memory',
  token_limit: 1024,
  current_token_count: 10,
  consolidate_threshold: 0.75,
  processed_through_watermark: 'sqlite-project-v1:4',
  extractor_version: 'memory-v2',
  last_consolidated_at: null,
  last_error: null,
  updated_at: 1,
};

describe('Memory Center', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue({
      scope_state: scopeState,
      items: [],
      sync_status: {
        state: 'synced',
        pending_count: 0,
        blocked_count: 0,
        last_error: null,
        last_synced_at: 1,
      },
    });
    api.create.mockResolvedValue({});
    api.listSummaries.mockImplementation(
      (scopes: Array<{ scopeType: 'space' | 'project'; scopeId: string }>) =>
        Promise.resolve({
          items: scopes.map((scope) => ({
            scope_type: scope.scopeType,
            scope_id: scope.scopeId,
            entry_count: 1,
            scope_state: {
              ...scopeState,
              scope_type: scope.scopeType,
              scope_id: scope.scopeId,
            },
          })),
        })
    );
    api.settings.mockResolvedValue({
      ...scopeState,
      revision: 2,
      capture_enabled: false,
    });
    api.consolidate.mockResolvedValue({});
    api.remove.mockResolvedValue({});
    api.listReconciliation.mockResolvedValue({ items: [] });
    api.resolveReconciliation.mockResolvedValue({});
  });

  it('offers bounded organization without exposing a sync chooser', async () => {
    api.list.mockResolvedValue({
      scope_state: scopeState,
      items: [
        {
          memory_id: 'one',
          scope_type: 'user',
          scope_id: 'user-1',
          kind: 'fact',
          content: 'First fact',
          priority: 'normal',
          version: 1,
          token_count: 2,
          pinned_by_user: false,
          confirmed_by_user: true,
          created_by: 'user',
          source_trust: 'user_confirmed',
          sensitivity: 'normal',
          source_refs: [],
          deleted_at: null,
          created_at: 1,
          updated_at: 1,
        },
        {
          memory_id: 'two',
          scope_type: 'user',
          scope_id: 'user-1',
          kind: 'fact',
          content: 'Second fact',
          priority: 'normal',
          version: 1,
          token_count: 2,
          pinned_by_user: false,
          confirmed_by_user: true,
          created_by: 'user',
          source_trust: 'user_confirmed',
          sensitivity: 'normal',
          source_refs: [],
          deleted_at: null,
          created_at: 2,
          updated_at: 2,
        },
      ],
      sync_status: { state: 'synced' },
    });
    const user = userEvent.setup();
    render(<Memory />);

    await screen.findByText(/Up to date on your Eigent account/);
    expect(screen.queryByRole('combobox', { name: /sync/i })).toBeNull();
    const organize = screen.getByRole('button', { name: /Organise/ });
    await waitFor(() => expect(organize).toBeEnabled());
    await user.click(organize);

    expect(api.consolidate).toHaveBeenCalledWith('user', 'user-1');
  });

  it('ignores a stale scope response after the user switches scope', async () => {
    let resolveUser!: (value: unknown) => void;
    api.list.mockImplementation((scopeType: string) => {
      if (scopeType === 'user') {
        return new Promise((resolve) => {
          resolveUser = resolve;
        });
      }
      return Promise.resolve({
        scope_state: {
          ...scopeState,
          scope_type: 'space',
          scope_id: 'space-1',
        },
        items: [
          {
            memory_id: 'space-memory',
            scope_type: 'space',
            scope_id: 'space-1',
            kind: 'fact',
            content: 'Space response',
            priority: 'normal',
            version: 1,
            token_count: 2,
            pinned_by_user: false,
            confirmed_by_user: true,
            created_by: 'user',
            source_trust: 'user_confirmed',
            sensitivity: 'normal',
            source_refs: [],
            deleted_at: null,
            created_at: 1,
            updated_at: 1,
          },
        ],
      });
    });
    const user = userEvent.setup();
    render(<Memory />);

    await user.click(screen.getByRole('tab', { name: 'Space' }));
    expect(await screen.findByText('Space response')).toBeInTheDocument();
    resolveUser({
      scope_state: scopeState,
      items: [{ content: 'Stale user response' }],
    });

    await waitFor(() =>
      expect(screen.queryByText('Stale user response')).toBeNull()
    );
  });

  it('explains the History boundary and creates editable Memory', async () => {
    const user = userEvent.setup();
    render(<Memory />);

    expect(
      screen.getByText(/Canonical task history is stored separately/)
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(api.list).toHaveBeenCalledWith('user', 'user-1', false)
    );

    await user.type(
      screen.getByPlaceholderText(
        'Add a preference, constraint, or fact for Eigent to remember'
      ),
      'Use ISO dates.'
    );
    await user.click(screen.getByRole('button', { name: /Add/ }));
    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith(
        'user',
        'user-1',
        expect.objectContaining({ content: 'Use ISO dates.' })
      )
    );
  });

  it('uses scope pills, one-row controls, and saved Memory tools', async () => {
    api.list.mockResolvedValue({
      scope_state: scopeState,
      items: [
        {
          memory_id: 'memory-visible',
          scope_type: 'user',
          scope_id: 'user-1',
          kind: 'fact',
          content: 'Visible note',
          priority: 'normal',
          version: 1,
          token_count: 2,
          pinned_by_user: false,
          confirmed_by_user: true,
          created_by: 'user',
          source_trust: 'user_confirmed',
          sensitivity: 'normal',
          source_refs: [],
          deleted_at: null,
          created_at: 1,
          updated_at: 1,
        },
      ],
      sync_status: { state: 'synced' },
    });
    render(<Memory />);

    await screen.findByText('Synced');
    expect(
      screen.getByRole('tablist', { name: 'Memory scope' })
    ).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Personal',
      'Space',
      'Session',
    ]);
    expect(screen.getByRole('tab', { name: 'Personal' })).toHaveAttribute(
      'data-state',
      'active'
    );
    expect(screen.getByRole('switch', { name: 'Auto Memory' })).toBeChecked();
    expect(
      screen.getByRole('switch', { name: 'Use Personal Memory' })
    ).toBeInTheDocument();
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent(
      'Synced'
    );
    const storageProgress = screen.getByRole('progressbar', {
      name: 'Memory storage used',
    });
    expect(storageProgress).toHaveClass('bg-ds-neutral-subtle-default');
    expect(storageProgress.firstElementChild).toHaveClass(
      'bg-ds-accent-default-default'
    );
    expect(
      screen.getByRole('textbox', { name: 'New Memory' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: 'Memory type' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: 'Order Memory' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Show archived' })
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it.each([
    ['user', 'user-1', 'Space used by saved personal Memory.'],
    ['space', 'space-1', 'Space used by saved shared Memory.'],
    ['project', 'project-1', 'Space used by saved session Memory.'],
  ] as const)(
    'uses UI terminology for the %s capacity description',
    async (scopeType, scopeId, description) => {
      render(
        <Memory
          fixedScope={{ type: scopeType, id: scopeId }}
          showScopeSelector={false}
        />
      );

      expect(await screen.findByText(description)).toBeInTheDocument();
    }
  );

  it.each([
    ['user', 'user-1'],
    ['space', 'space-1'],
    ['project', 'project-1'],
  ] as const)(
    'shows the %s capacity token count once',
    async (scopeType, scopeId) => {
      render(
        <Memory
          fixedScope={{ type: scopeType, id: scopeId }}
          showScopeSelector={false}
        />
      );

      const tokenCount = await screen.findByText('10 / 1024 tokens');
      expect(tokenCount.textContent).toBe('10 / 1024 tokens');
      expect(screen.queryByText(/10 \/ 10 \//)).not.toBeInTheDocument();
    }
  );

  it('shows searchable Space and Project Memory directories', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/home?section=settings&tab=memory']}>
        <Memory homeOverview />
        <LocationProbe />
      </MemoryRouter>
    );

    expect(screen.getByRole('tab', { name: 'Personal' })).toHaveAttribute(
      'data-state',
      'active'
    );
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Personal',
      'Space',
      'Session',
    ]);
    await waitFor(() =>
      expect(api.list).toHaveBeenCalledWith('user', 'user-1', false)
    );
    const listCallCount = api.list.mock.calls.length;

    await user.click(screen.getByRole('tab', { name: 'Space' }));
    expect(await screen.findByText('Design Space')).toBeVisible();
    expect(screen.getByText('1 Session')).toBeVisible();
    expect(
      screen.queryByRole('textbox', { name: 'New Memory' })
    ).not.toBeInTheDocument();
    expect(api.list).toHaveBeenCalledTimes(listCallCount);
    await user.click(
      screen.getByRole('button', { name: 'Manage Memory for Design Space' })
    );
    expect(screen.getByTestId('memory-location')).toHaveTextContent(
      '/home?section=spaces&spaceId=space-1&spaceTab=memory'
    );

    await user.click(screen.getByRole('tab', { name: 'Session' }));
    expect(await screen.findByText('Launch Plan')).toBeVisible();
    expect(screen.getByText('Space: Design Space')).toBeVisible();
    expect(api.list).toHaveBeenCalledTimes(listCallCount);
    await user.click(
      screen.getByRole('button', { name: 'Manage Memory for Launch Plan' })
    );
    expect(screen.getByTestId('memory-location')).toHaveTextContent(
      '/home?section=spaces&spaceId=space-1&spaceTab=memory&memoryScope=project&projectId=project-1'
    );
  });

  it('locks the Space detail Memory view to the selected Space', async () => {
    render(
      <Memory
        fixedScope={{ type: 'space', id: 'selected-space' }}
        showScopeSelector={false}
      />
    );

    await waitFor(() =>
      expect(api.list).toHaveBeenCalledWith('space', 'selected-space', false)
    );
    expect(
      screen.queryByRole('tablist', { name: 'Memory scope' })
    ).not.toBeInTheDocument();
  });

  it('updates Auto Memory immediately', async () => {
    const user = userEvent.setup();
    render(<Memory />);

    await screen.findByText('Synced');
    const autoMemory = await screen.findByRole('switch', {
      name: 'Auto Memory',
    });
    expect(autoMemory).toBeEnabled();
    expect(autoMemory).toBeChecked();

    await user.click(autoMemory);

    expect(autoMemory).not.toBeChecked();
    expect(api.settings).toHaveBeenCalledWith('user', 'user-1', {
      expectedRevision: 1,
      captureEnabled: false,
    });
  });

  it('shows archived entries only on request and restores them', async () => {
    const archived = {
      memory_id: 'memory-1',
      scope_type: 'user',
      scope_id: 'user-1',
      kind: 'fact',
      content: 'Old fact',
      priority: 'normal',
      version: 2,
      token_count: 2,
      pinned_by_user: false,
      confirmed_by_user: false,
      created_by: 'user',
      source_trust: 'user_confirmed',
      sensitivity: 'normal',
      source_refs: [],
      deleted_at: 2,
      created_at: 1,
      updated_at: 2,
    };
    api.list.mockImplementation(
      (_scopeType: string, _scopeId: string, includeDeleted: boolean) =>
        Promise.resolve({
          scope_state: scopeState,
          items: includeDeleted ? [archived] : [],
        })
    );
    api.restore.mockResolvedValue({});
    const user = userEvent.setup();
    render(<Memory />);

    await user.click(
      await screen.findByRole('button', { name: 'View archived' })
    );
    expect(
      screen.getByRole('button', { name: 'Hide archived' })
    ).toBeInTheDocument();
    expect(await screen.findByText('Old fact')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'More Memory actions' })
    );
    await user.click(
      await screen.findByRole('menuitem', { name: 'Restore Memory' })
    );

    expect(api.restore).toHaveBeenCalledWith(archived);
  });

  it('stars Memory from item actions and shows starred state as a non-control', async () => {
    const pinned = {
      memory_id: 'memory-pinned',
      scope_type: 'user',
      scope_id: 'user-1',
      kind: 'fact',
      content: 'Pinned first',
      priority: 'normal',
      version: 2,
      token_count: 2,
      pinned_by_user: true,
      confirmed_by_user: true,
      created_by: 'user',
      source_trust: 'user_confirmed',
      sensitivity: 'normal',
      source_refs: [],
      deleted_at: null,
      created_at: 1,
      updated_at: 1,
    };
    const unpinned = {
      ...pinned,
      memory_id: 'memory-unpinned',
      content: 'Unpinned second',
      pinned_by_user: false,
      created_at: 2,
      updated_at: 2,
    };
    api.list.mockResolvedValue({
      scope_state: scopeState,
      items: [unpinned, pinned],
      sync_status: { state: 'synced' },
    });
    api.pin.mockResolvedValue({});
    const user = userEvent.setup();
    render(<Memory />);

    expect(await screen.findByText('Pinned first')).toBeInTheDocument();
    const memoryItems = screen
      .getByText('Pinned first')
      .closest('[data-settings-row]')
      ?.querySelectorAll('article');
    expect(memoryItems?.[0]).toHaveTextContent('Pinned first');

    // Starring is one-way until the backend gains an un-pin transition, so a
    // starred entry renders the filled star as state rather than a control.
    const starredIndicator = screen.getByRole('img', {
      name: 'Starred Memory',
    });
    expect(starredIndicator.querySelector('svg')).toHaveClass('fill-current');
    expect(
      screen.queryByRole('button', { name: 'Unstar Memory' })
    ).not.toBeInTheDocument();

    const starButton = screen.getByRole('button', { name: 'Star Memory' });
    expect(starButton.querySelector('svg')).toHaveClass('fill-none');

    await user.click(starButton);
    expect(api.pin).toHaveBeenCalledWith(unpinned);

    // Permanent delete needs a backend endpoint this branch does not ship.
    await user.click(
      screen.getAllByRole('button', { name: 'More Memory actions' })[0]
    );
    expect(
      await screen.findByRole('menuitem', { name: 'Archive Memory' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('menuitem', { name: 'Delete Memory' })
    ).not.toBeInTheDocument();
  });

  describe('Suggested Memory', () => {
    const entry = (overrides: Record<string, unknown>) => ({
      scope_type: 'user',
      scope_id: 'user-1',
      kind: 'fact',
      priority: 'normal',
      version: 1,
      token_count: 2,
      pinned_by_user: false,
      confirmed_by_user: false,
      created_by: 'user',
      source_trust: 'user_asserted',
      sensitivity: 'normal',
      source_refs: [],
      source_excerpts: [],
      deleted_at: null,
      created_at: 1,
      updated_at: 1,
      ...overrides,
    });
    const suggestion = entry({
      memory_id: 'suggestion',
      kind: 'preference',
      content: 'Use pnpm for installs.',
      created_by: 'agent',
      source_refs: ['event-1'],
      source_excerpts: ['From now on, always use pnpm.'],
      created_at: 3,
    });
    const savedEntries = [
      // Accepted, extractor-written, and Agent facts are ordinary Memory.
      entry({
        memory_id: 'accepted',
        kind: 'constraint',
        content: 'Accepted rule',
        created_by: 'agent',
        confirmed_by_user: true,
      }),
      entry({
        memory_id: 'extracted',
        kind: 'preference',
        content: 'Extracted preference',
        created_by: 'extractor',
      }),
      entry({
        memory_id: 'agent-fact',
        content: 'Agent fact',
        created_by: 'agent',
        source_trust: 'model_inferred',
      }),
    ];

    const listWith = (items: unknown[]) =>
      api.list.mockResolvedValue({
        scope_state: scopeState,
        items,
        sync_status: { state: 'synced' },
      });
    const suggestedGroup = async () => {
      await screen.findByText('Suggested');
      const group = document.querySelector<HTMLElement>(
        '[data-memory-suggestions]'
      );
      expect(group).not.toBeNull();
      return group!;
    };

    it('lists only pending suggestions with the cited message', async () => {
      listWith([...savedEntries, suggestion]);
      render(<Memory />);

      const group = await suggestedGroup();
      expect(within(group).getAllByRole('article')).toHaveLength(1);
      expect(within(group).getByText('Use pnpm for installs.')).toBeVisible();
      expect(within(group).getByText('Preference')).toBeVisible();
      expect(within(group).getByText('From your message')).toBeVisible();
      expect(
        within(group).getByText('From now on, always use pnpm.')
      ).toBeVisible();
      for (const saved of ['Accepted rule', 'Extracted preference']) {
        expect(within(group).queryByText(saved)).toBeNull();
        expect(screen.getByText(saved)).toBeVisible();
      }

      // A pending suggestion is not also listed as unconfirmed Memory.
      expect(screen.getAllByText('Use pnpm for installs.')).toHaveLength(1);
      expect(
        screen.getByText('Agent fact').closest('[data-settings-row-group]')
      ).not.toBe(group);
      expect(
        screen.getByText('Personal Memory').parentElement
      ).toHaveTextContent('3');
    });

    it('hides the group when nothing is pending', async () => {
      listWith([
        ...savedEntries,
        { ...suggestion, memory_id: 'dismissed', deleted_at: 5 },
      ]);
      render(<Memory />);

      expect(await screen.findByText('Accepted rule')).toBeVisible();
      expect(screen.queryByText('Suggested')).toBeNull();
      expect(document.querySelector('[data-memory-suggestions]')).toBeNull();
    });

    it('accepts a suggestion with the existing confirm action', async () => {
      listWith([suggestion]);
      api.confirm.mockResolvedValue({});
      const user = userEvent.setup();
      render(<Memory />);

      const group = await suggestedGroup();
      const listCalls = api.list.mock.calls.length;
      await user.click(within(group).getByRole('button', { name: 'Accept' }));

      expect(api.confirm).toHaveBeenCalledWith(suggestion);
      expect(api.update).not.toHaveBeenCalled();
      expect(api.remove).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(api.list.mock.calls.length).toBeGreaterThan(listCalls)
      );
    });

    it('dismisses a suggestion by archiving it', async () => {
      listWith([suggestion]);
      const user = userEvent.setup();
      render(<Memory />);

      const group = await suggestedGroup();
      await user.click(within(group).getByRole('button', { name: 'Dismiss' }));

      expect(api.remove).toHaveBeenCalledWith(suggestion);
      expect(api.confirm).not.toHaveBeenCalled();
    });

    it('edits a suggestion with the existing edit action', async () => {
      listWith([suggestion]);
      api.update.mockResolvedValue({});
      const user = userEvent.setup();
      render(<Memory />);

      const group = await suggestedGroup();
      await user.click(within(group).getByRole('button', { name: 'Edit' }));
      const editor = within(group).getByRole('textbox', {
        name: 'Edit Memory',
      });
      expect(editor).toHaveValue('Use pnpm for installs.');
      await user.clear(editor);
      await user.type(editor, 'Use pnpm 9 for installs.');
      await user.click(within(group).getByRole('button', { name: 'Save' }));

      expect(api.update).toHaveBeenCalledWith(suggestion, {
        content: 'Use pnpm 9 for installs.',
        kind: 'preference',
        reason: 'Edited in Memory Center',
      });
      expect(api.confirm).not.toHaveBeenCalled();
    });

    it('keeps an edit cancellable and shows a failed action', async () => {
      listWith([suggestion]);
      api.confirm.mockRejectedValue(new Error('Memory changed elsewhere'));
      const user = userEvent.setup();
      render(<Memory />);

      const group = await suggestedGroup();
      await user.click(within(group).getByRole('button', { name: 'Edit' }));
      await user.click(within(group).getByRole('button', { name: 'Cancel' }));
      expect(within(group).queryByRole('textbox')).toBeNull();

      await user.click(within(group).getByRole('button', { name: 'Accept' }));
      expect(await within(group).findByRole('alert')).toHaveTextContent(
        'Memory changed elsewhere'
      );
      expect(
        within(group).getByRole('button', { name: 'Accept' })
      ).toBeEnabled();
    });

    it('shows suggestions in the Space Memory view', async () => {
      const spaceSuggestion = {
        ...suggestion,
        scope_type: 'space',
        scope_id: 'space-1',
      };
      listWith([spaceSuggestion]);
      render(
        <Memory
          fixedScope={{ type: 'space', id: 'space-1' }}
          showScopeSelector={false}
        />
      );

      const group = await suggestedGroup();
      expect(api.list).toHaveBeenCalledWith('space', 'space-1', false);
      expect(
        within(group).getByText('From now on, always use pnpm.')
      ).toBeVisible();
      expect(screen.getByText('No shared Memory yet')).toBeVisible();
    });
  });
});
