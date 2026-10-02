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
  blocksLocalBundlePublish,
  bundleAssetReferenceFindings,
  preflightWorkspaceBundleReferences,
} from '@/service/workspaceBundleReferencePreflight';
import type { WorkspaceConfigurationDocument } from '@/service/workspaceConfigurationApi';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { models, auth } = vi.hoisted(() => ({
  models: vi.fn(),
  auth: { token: 'token-a', user_id: 7, email: 'user@example.com' },
}));
vi.mock('@/service/spaceModelDiscovery', () => ({
  discoverSpaceModels: models,
}));
vi.mock('@/store/authStore', () => ({ getAuthStore: () => auth }));

const document = (
  modelRef = 'provider://default'
): WorkspaceConfigurationDocument => ({
  apiVersion: 'eigent.ai/v1alpha1',
  kind: 'WorkspaceBundle',
  metadata: { id: 'bundle', name: 'Bundle', revision: 1 },
  spec: {
    instructions: {},
    context: [],
    skills: [],
    mcpServers: [],
    connectors: [],
    agents: [],
    models: { default: { modelRef, thinkingEffort: 'medium' } },
    permissions: { profile: 'request_approval', rules: [] },
    git: {
      enabled: true,
      checkpointPolicy: 'user_and_run_terminal',
      agentIsolation: 'worktree',
      remotePolicy: 'prompt',
    },
  },
});

const available = {
  value: 'provider://cloud/known',
  availability: 'available',
  source: 'cloud_catalog',
  disabled: false,
};

describe('device reference preflight', () => {
  beforeEach(() => {
    models.mockReset();
    auth.token = 'token-a';
    models.mockResolvedValue({ items: [available], unavailableSources: [] });
  });
  afterEach(() => vi.useRealTimers());

  it('keeps the recipient default late-bound and accepts known models', async () => {
    expect(await preflightWorkspaceBundleReferences(document(), [])).toEqual(
      []
    );
    expect(models).not.toHaveBeenCalled();
    expect(
      await preflightWorkspaceBundleReferences(document(available.value), [])
    ).toEqual([]);
    expect(models).toHaveBeenCalledWith({ requireComplete: true });
  });

  it.each([
    ['provider://unsupported/format', 'unsupported'],
    ['provider://cloud/authoring-probe-missing-model', 'model_setup_required'],
    ['provider://custom/openai/not-configured', 'model_setup_required'],
    ['provider://cloud/%broken', 'malformed'],
  ])('classifies %s as %s without changing the draft', async (ref, code) => {
    const draft = document(ref);
    const before = JSON.stringify(draft);
    expect(await preflightWorkspaceBundleReferences(draft, [])).toEqual([
      { location: 'spec.models.default.modelRef', reference: ref, code },
    ]);
    expect(JSON.stringify(draft)).toBe(before);
  });

  it('does not treat a partial source as valid even if it includes the model', async () => {
    models.mockResolvedValue({
      items: [available],
      unavailableSources: ['cloud_catalog'],
    });
    expect(
      (
        await preflightWorkspaceBundleReferences(document(available.value), [])
      )[0].code
    ).toBe('verification_unavailable');
  });

  it('does not treat ambiguous metadata as available', async () => {
    models.mockResolvedValue({
      items: [{ ...available, disabled: true, reason: 'model_ambiguous' }],
      unavailableSources: [],
    });
    expect(
      (
        await preflightWorkspaceBundleReferences(document(available.value), [])
      )[0].code
    ).toBe('verification_unavailable');
  });

  it('reports denied or failed catalog reads as unavailable, never missing', async () => {
    models.mockRejectedValue(new Error('403 private-detail'));
    const result = await preflightWorkspaceBundleReferences(
      document(available.value),
      []
    );
    expect(result[0].code).toBe('verification_unavailable');
    expect(JSON.stringify(result)).not.toContain('private-detail');
  });

  it('bounds a stalled catalog and ignores a late successful response', async () => {
    vi.useFakeTimers();
    let resolve!: (value: unknown) => void;
    models.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    const pending = preflightWorkspaceBundleReferences(
      document(available.value),
      []
    );
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;
    expect(result[0].code).toBe('verification_unavailable');
    resolve({ items: [available], unavailableSources: [] });
    await Promise.resolve();
    expect(result[0].code).toBe('verification_unavailable');
  });

  it('rejects a stale account response and gets a fresh catalog on retry', async () => {
    models.mockImplementationOnce(async () => {
      auth.token = 'token-b';
      return { items: [available], unavailableSources: [] };
    });
    expect(
      (
        await preflightWorkspaceBundleReferences(document(available.value), [])
      )[0].code
    ).toBe('verification_unavailable');
    expect(
      await preflightWorkspaceBundleReferences(document(available.value), [])
    ).toEqual([]);
    expect(models).toHaveBeenCalledTimes(2);
  });

  it('requires an explicit device result and preserves setup findings', async () => {
    expect(
      (await preflightWorkspaceBundleReferences(document(), undefined))[0].code
    ).toBe('verification_unavailable');
    const setup = {
      code: 'global_setup_required' as const,
      location: 'spec.skills[0].ref',
      reference: 'registry://global/skills/' + 'a'.repeat(64),
    };
    expect(
      await preflightWorkspaceBundleReferences(document(), [setup])
    ).toEqual([setup]);
    expect(blocksLocalBundlePublish(setup)).toBe(false);
    expect(blocksLocalBundlePublish({ ...setup, code: 'unsupported' })).toBe(
      true
    );
  });

  it('checks exact Bundle paths against selected assets without consulting global catalogs', () => {
    const draft = document();
    draft.spec.skills = [
      { ref: 'bundle://skills/test/SKILL.md', assignTo: [] },
    ];
    draft.spec.mcpServers = [
      {
        id: 'test',
        definition: 'bundle://mcp.json',
        assignTo: [],
        secretSlots: [],
      },
    ];
    expect(
      bundleAssetReferenceFindings(draft, new Set()).map((item) => item.code)
    ).toEqual(['bundle_asset_required', 'bundle_asset_required']);
    expect(
      bundleAssetReferenceFindings(
        draft,
        new Set(['skills/test/SKILL.md', 'mcp.json'])
      )
    ).toEqual([]);
    draft.spec.skills[0].ref = 'bundle://skills/test';
    draft.spec.mcpServers[0].definition = 'bundle://../mcp.json';
    expect(
      bundleAssetReferenceFindings(draft, new Set()).map((item) => item.code)
    ).toEqual(['unsupported', 'malformed']);
    expect(models).not.toHaveBeenCalled();
  });
});
