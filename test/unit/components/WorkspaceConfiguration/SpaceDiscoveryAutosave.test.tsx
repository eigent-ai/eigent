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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  flushWorkspaceConfigurationBeforeNavigation,
  hasPendingWorkspaceConfigurationChanges,
} from '@/lib/workspaceConfigurationNavigationGuard';
import { WorkspaceConfigurationEditor } from '@/pages/WorkspaceConfiguration';
import type { SpaceBundleDiscovery } from '@/service/spaceSettingsDiscovery';
import type {
  WorkspaceConfigurationDocument,
  WorkspaceConfigurationDraft,
  WorkspaceConfigurationIdentity,
} from '@/service/workspaceConfigurationApi';

const mocks = vi.hoisted(() => ({
  auth: { email: 'fixture@example.com', user_id: 7 },
  fetch: vi.fn(),
  save: vi.fn(),
  bundle: vi.fn(),
  models: vi.fn(),
  connectors: vi.fn(),
  details: vi.fn(),
}));

vi.mock('framer-motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('framer-motion')>()),
  useReducedMotion: () => true,
}));

vi.mock('@/store/spaceStore', () => ({
  useSpaceStore: (selector: (state: object) => unknown) =>
    selector({
      activeSpaceId: 'space-1',
      spaces: {
        'space-1': { id: 'space-1', name: 'Fixture One' },
        'space-2': { id: 'space-2', name: 'Fixture Two' },
      },
    }),
}));

vi.mock('@/store/authStore', () => ({
  getAuthStore: () => ({ appearance: 'light', language: 'en', ...mocks.auth }),
  useAuthStore: (selector: (state: object) => unknown) =>
    selector({ appearance: 'light', language: 'en', ...mocks.auth }),
  useWorkerList: () => [],
}));

vi.mock('@/service/workspaceConfigurationApi', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/service/workspaceConfigurationApi')
  >()),
  fetchWorkspaceConfiguration: mocks.fetch,
  saveWorkspaceConfiguration: mocks.save,
}));

vi.mock('@/service/spaceSettingsDiscovery', () => ({
  discoverSpaceBundleResources: mocks.bundle,
  discoverSpaceModels: mocks.models,
  discoverSpaceConnectors: mocks.connectors,
  discoverSpaceConnectorDetails: mocks.details,
}));

vi.mock(
  '@/components/WorkspaceConfiguration/WorkspaceBundleSaveDialog',
  () => ({
    WorkspaceBundleSaveDialog: () => null,
  })
);

const makeDocument = (spaceId: string): WorkspaceConfigurationDocument => ({
  apiVersion: 'eigent.ai/v1alpha1',
  kind: 'WorkspaceBundle',
  metadata: {
    id: `bundle-${spaceId}`,
    name: `Fixture ${spaceId}`,
    revision: 1,
  },
  spec: {
    instructions: {},
    context: [],
    skills: [],
    connectors: [],
    mcpServers: [],
    agents: [],
    environment: { variables: [] },
    models: {
      default: { modelRef: 'provider://default', thinkingEffort: 'medium' },
    },
    permissions: { profile: 'request_approval', rules: [] },
    git: {
      enabled: false,
      checkpointPolicy: 'user_and_run_terminal',
      agentIsolation: 'worktree',
      remotePolicy: 'prompt',
    },
  },
});

const draft = (
  spaceId: string,
  version: number,
  document = makeDocument(spaceId)
): WorkspaceConfigurationDraft => ({
  space_id: spaceId,
  version,
  base_revision_id: null,
  document,
  document_digest: 'a'.repeat(64),
  persisted: version > 0,
  updated_at: version > 0 ? 10 : null,
});

const resources = (name = 'verified'): SpaceBundleDiscovery => ({
  skills: [
    {
      value: `bundle://skills/${name}/SKILL.md`,
      label: name,
      source: 'materialized_bundle',
      availability: 'available',
    },
  ],
  mcpServers: [],
});

const advance = async (milliseconds = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
};

const openSkill = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Add skill' }));
  await advance();
  return screen.getByRole('complementary', { name: 'Add skill' });
};

describe('Space discovery with configuration autosave', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.resetAllMocks();
    mocks.auth.email = 'fixture@example.com';
    mocks.auth.user_id = 7;
    mocks.fetch.mockImplementation((spaceId: string) =>
      Promise.resolve(draft(spaceId, 0))
    );
    mocks.save.mockImplementation(
      (
        spaceId: string,
        _identity: WorkspaceConfigurationIdentity,
        input: {
          expectedVersion: number;
          document: WorkspaceConfigurationDocument;
        }
      ) =>
        Promise.resolve(
          draft(spaceId, input.expectedVersion + 1, input.document)
        )
    );
    mocks.bundle.mockResolvedValue(resources());
    mocks.models.mockResolvedValue([]);
    mocks.connectors.mockResolvedValue({ items: [], hasMore: false });
    mocks.details.mockResolvedValue(null);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('keeps unique prefill local until Save, then uses the 700ms CAS queue and next version', async () => {
    render(
      <WorkspaceConfigurationEditor presentation="settings" spaceId="space-1" />
    );
    await advance();
    const panel = await openSkill();
    expect(
      within(panel).getByRole('textbox', { name: 'Skill reference' })
    ).toHaveValue('bundle://skills/verified/SKILL.md');
    expect(
      within(panel).getByRole('textbox', { name: 'Assign to agents' })
    ).toHaveValue('');
    await advance(1_000);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(hasPendingWorkspaceConfigurationChanges()).toBe(false);

    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }));
    expect(hasPendingWorkspaceConfigurationChanges()).toBe(true);
    await advance(699);
    expect(mocks.save).not.toHaveBeenCalled();
    await advance(1);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    const [spaceId, identity, first] = mocks.save.mock.calls[0];
    expect(spaceId).toBe('space-1');
    expect(identity).toEqual({ email: 'fixture@example.com', userId: 7 });
    expect(first.expectedVersion).toBe(0);
    expect(first.document.spec.skills).toEqual([
      { ref: 'bundle://skills/verified/SKILL.md', assignTo: [] },
    ]);
    expect(first.document.spec.models.default.modelRef).toBe(
      'provider://default'
    );
    expect(first.document.spec.git.enabled).toBe(false);

    fireEvent.change(screen.getByRole('textbox', { name: 'Profile name' }), {
      target: { value: 'Confirmed second edit' },
    });
    await advance(699);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save.mock.calls[1][2].expectedVersion).toBe(1);
    expect(mocks.save.mock.calls[1][2].document.metadata.name).toBe(
      'Confirmed second edit'
    );
    expect(hasPendingWorkspaceConfigurationChanges()).toBe(false);
  });

  it('flushes confirmed discovery plus the newest edit through the existing navigation guard', async () => {
    render(
      <WorkspaceConfigurationEditor presentation="settings" spaceId="space-1" />
    );
    await advance();
    const panel = await openSkill();
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Profile name' }), {
      target: { value: 'Intermediate edit' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Profile name' }), {
      target: { value: 'Newest before navigation' },
    });
    expect(mocks.save).not.toHaveBeenCalled();
    await act(async () => {
      expect(await flushWorkspaceConfigurationBeforeNavigation()).toBe(true);
    });
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0][2].document.metadata.name).toBe(
      'Newest before navigation'
    );
    expect(mocks.save.mock.calls[0][2].document.spec.skills).toEqual([
      { ref: 'bundle://skills/verified/SKILL.md', assignTo: [] },
    ]);
    expect(hasPendingWorkspaceConfigurationChanges()).toBe(false);
    await advance(1_000);
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it.each(['Space', 'account'] as const)(
    'does not apply or save an old pending catalog after a %s switch',
    async (switchKind) => {
      let resolveOld!: (value: SpaceBundleDiscovery) => void;
      const oldCatalog = new Promise<SpaceBundleDiscovery>((resolve) => {
        resolveOld = resolve;
      });
      mocks.bundle.mockImplementation(
        (spaceId: string, identity: WorkspaceConfigurationIdentity) =>
          spaceId === 'space-1' && identity.email === 'fixture@example.com'
            ? oldCatalog
            : Promise.resolve(resources('new-scope'))
      );
      const { rerender } = render(
        <WorkspaceConfigurationEditor
          presentation="settings"
          spaceId="space-1"
        />
      );
      await advance();
      const oldPanel = await openSkill();
      expect(
        within(oldPanel).getByRole('textbox', { name: 'Skill reference' })
      ).toHaveValue('');

      const nextSpaceId = switchKind === 'Space' ? 'space-2' : 'space-1';
      if (switchKind === 'account') {
        mocks.auth.email = 'other-fixture@example.com';
        mocks.auth.user_id = 8;
      }
      rerender(
        <WorkspaceConfigurationEditor
          presentation="settings"
          spaceId={nextSpaceId}
        />
      );
      await advance();
      const currentPanel = await openSkill();
      expect(
        within(currentPanel).getByRole('textbox', { name: 'Skill reference' })
      ).toHaveValue('bundle://skills/new-scope/SKILL.md');
      await act(async () => {
        resolveOld(resources('old-scope'));
      });
      await advance(1_000);
      expect(
        within(currentPanel).getByRole('textbox', { name: 'Skill reference' })
      ).toHaveValue('bundle://skills/new-scope/SKILL.md');
      expect(mocks.save).not.toHaveBeenCalled();
      fireEvent.click(
        within(currentPanel).getByRole('button', { name: 'Save' })
      );
      await advance(700);
      expect(mocks.save).toHaveBeenCalledTimes(1);
      const [savedSpace, savedIdentity, input] = mocks.save.mock.calls[0];
      expect(savedSpace).toBe(nextSpaceId);
      expect(savedIdentity).toEqual({
        email: mocks.auth.email,
        userId: mocks.auth.user_id,
      });
      expect(input.document.spec.skills).toEqual([
        { ref: 'bundle://skills/new-scope/SKILL.md', assignTo: [] },
      ]);
      expect(JSON.stringify(input.document)).not.toContain('old-scope');
    }
  );
});
