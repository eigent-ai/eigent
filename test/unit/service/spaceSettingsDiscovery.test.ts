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

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchGetMock, proxyGetMock, auth } = vi.hoisted(() => ({
  auth: { token: 'fixture-token', user_id: 7, email: 'fixture@example.com' },
  fetchGetMock: vi.fn(),
  proxyGetMock: vi.fn(),
}));

vi.mock('@/store/authStore', () => ({ getAuthStore: () => auth }));

vi.mock('@/api/http', () => ({
  fetchGet: fetchGetMock,
  proxyFetchGet: proxyGetMock,
  proxyFetchPost: vi.fn(() => {
    throw new Error('unexpected mutation');
  }),
  proxyFetchPut: vi.fn(() => {
    throw new Error('unexpected mutation');
  }),
  proxyFetchDelete: vi.fn(() => {
    throw new Error('unexpected mutation');
  }),
}));

import {
  fetchConnectorProviders,
  invalidateConnectorProvidersCache,
} from '@/api/connectors';
import {
  discoverGlobalSpaceResources,
  discoverSpaceBundleResources,
  discoverSpaceConnectorDetails,
  discoverSpaceConnectors,
  discoverSpaceModels,
} from '@/service/spaceSettingsDiscovery';

const provider = (service = 'github') => ({
  service,
  displayName: 'GitHub',
  auth: [{ type: 'oauth2', scopes: ['repository.read', 'repository.read'] }],
  connection: {
    id: 'fixture-private-connection',
    configured: true,
    virtual: false,
    profile: {
      displayName: 'Private user',
      grantedScopes: ['admin.everything'],
    },
  },
  api_key: 'fixture-secret',
  path: '/fixture/private/path',
});

const providersResponse = (providers = [provider()]) => ({
  enabled: true,
  providers,
  total_pages: 3,
  page: 1,
  page_size: 24,
});

describe('Space Settings metadata discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateConnectorProvidersCache();
    Object.assign(auth, {
      token: 'fixture-token',
      user_id: 7,
      email: 'fixture@example.com',
    });
  });

  it('projects selectable portable Cloud/custom/local refs without secrets or private IDs', async () => {
    proxyGetMock.mockImplementation(async (url) =>
      url === '/api/v1/cloud-models'
        ? {
            default_model_id: 'model-a',
            models: [
              {
                id: 'model-a',
                display_name: 'Model A',
                model_type: 'deployment-a',
                model_platform: 'azure',
                kind: 'chat',
                api_key: 'fixture-secret',
                capabilities: { unknown: 'private' },
              },
              {
                id: 'image-a',
                model_type: 'image',
                model_platform: 'openai',
                kind: 'image',
              },
              { id: 'broken', kind: 'chat' },
            ],
          }
        : [
            {
              category: 'custom',
              model_platform: 'azure',
              model_type: 'custom-a',
              available: true,
              id: 193,
              api_key: 'fixture-secret',
              endpoint_url: 'https://private.example',
            },
            {
              category: 'local',
              model_platform: 'ollama',
              model_type: 'org/model:8b',
              available: true,
            },
            {
              category: 'custom',
              model_platform: 'openai',
              model_type: 'unavailable',
              available: false,
            },
            {
              category: 'custom',
              model_platform: 'openai',
              model_type: 'duplicate',
              available: true,
            },
            {
              category: 'custom',
              model_platform: 'openai',
              model_type: 'duplicate',
              available: true,
            },
          ]
    );
    const { items: result, unavailableSources } = await discoverSpaceModels();
    expect(unavailableSources).toEqual([]);
    expect(result.map((item) => item.value)).toEqual([
      'provider://default',
      'provider://cloud/model-a',
      'provider://custom/azure/custom-a',
      'provider://local/ollama/org%2Fmodel%3A8b',
      'provider://custom/openai/unavailable',
      'provider://custom/openai/duplicate',
    ]);
    expect(result[1]).toMatchObject({
      label: 'Model A',
      availability: 'available',
      modelType: 'deployment-a',
      isDefault: true,
    });
    expect(result[4]).toMatchObject({
      disabled: true,
      reason: 'model_unavailable',
    });
    expect(result[5]).toMatchObject({
      disabled: true,
      reason: 'model_ambiguous',
    });
    expect(JSON.stringify(result)).not.toMatch(
      /fixture-secret|private|193|endpoint_url|api_key/
    );
    expect(proxyGetMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/cloud-models',
      '/api/v1/provider-models',
    ]);
    expect(fetchGetMock).not.toHaveBeenCalled();
    proxyGetMock.mockImplementation(async (url) =>
      url === '/api/v1/cloud-models' ? { models: [] } : []
    );
    expect(
      (await discoverSpaceModels()).items.map((item) => item.value)
    ).toEqual(['provider://default']);
    proxyGetMock.mockRejectedValue(new Error('offline'));
    expect((await discoverSpaceModels()).unavailableSources).toEqual([
      'cloud_catalog',
      'provider_catalog',
    ]);
  });

  it('returns only contained current-bundle refs and explicit metadata fields', async () => {
    fetchGetMock.mockResolvedValue({
      space_id: 'space-1',
      skills: [
        {
          ref: 'bundle://agent-plugins/research/skills/facts/SKILL.md',
          label: 'Facts',
          source: 'materialized_bundle',
          availability: 'available',
          assignTo: ['other-agent'],
          absolute_path: '/fixture/private/path',
        },
        {
          ref: 'bundle://skills/draft/SKILL.md',
          label: 'Draft',
          source: 'draft_bundle',
          availability: 'requires_setup',
          reason: '/fixture/private/path',
        },
        ...[
          '/fixture/skill',
          'registry://skills/a@1',
          'bundle://../SKILL.md',
          'bundle://skills/%2e%2e/SKILL.md',
          'bundle://skills//SKILL.md',
        ].map((ref) => ({
          ref,
          source: 'materialized_bundle',
          availability: 'available',
        })),
      ],
      mcp_servers: [
        {
          id: 'research',
          definition: 'bundle://agent-plugins/research/mcp.json',
          label: 'Research',
          secret_slots: ['TOKEN', 'TOKEN', '/fixture/secret-path'],
          source: 'materialized_bundle',
          availability: 'available',
          connection_id: 'fixture-private-connection',
        },
      ],
    });
    const result = await discoverSpaceBundleResources('space-1', {
      email: 'fixture@example.com',
      userId: 7,
    });
    expect(result.skills).toEqual([
      {
        value: 'bundle://agent-plugins/research/skills/facts/SKILL.md',
        label: 'Facts',
        source: 'materialized_bundle',
        availability: 'available',
      },
      {
        value: 'bundle://skills/draft/SKILL.md',
        label: 'Draft',
        source: 'draft_bundle',
        availability: 'requires_setup',
        reason: 'bundle_setup_required',
      },
    ]);
    expect(result.mcpServers[0].secretSlots).toEqual(['TOKEN']);
    expect(JSON.stringify(result)).not.toMatch(
      /fixture-private|fixture\/private|connection_id|absolute_path|assignTo/
    );
    expect(fetchGetMock).toHaveBeenCalledTimes(1);
    expect(fetchGetMock).toHaveBeenCalledWith(
      '/spaces/space-1/workspace-configuration/discovery',
      { email: 'fixture@example.com', user_id: 7 }
    );
    expect(proxyGetMock).not.toHaveBeenCalled();
  });

  it('rejects a bundle response belonging to another Space', async () => {
    fetchGetMock.mockResolvedValue({
      space_id: 'space-2',
      skills: [],
      mcp_servers: [],
    });
    await expect(
      discoverSpaceBundleResources('space-1', { email: 'fixture@example.com' })
    ).rejects.toThrow('space_discovery_mismatch');
  });

  it('projects only global registry metadata, keeps disabled resources visible, and accepts configured MCP names', async () => {
    const skillRef = `registry://global/skills/${'a'.repeat(64)}`;
    const mcpRef = `registry://global/mcp/${'b'.repeat(64)}`;
    fetchGetMock.mockResolvedValue({
      skills: [
        {
          ref: skillRef,
          label: 'Research',
          source: 'global_configuration',
          enabled: false,
          unavailableReason: 'global_resource_disabled',
          assignTo: ['private-agent'],
          path: '/private/skill',
        },
      ],
      mcp_servers: [
        {
          id: 'Research tools',
          definition: mcpRef,
          label: 'Research tools',
          source: 'global_configuration',
          enabled: true,
          unavailableReason: null,
          secretSlots: [],
          assignTo: ['private-agent'],
          env: { API_KEY: 'fixture-secret' },
          url: 'https://private.example',
        },
      ],
    });
    const result = await discoverGlobalSpaceResources({
      email: auth.email,
      userId: auth.user_id,
    });
    expect(result.skills).toEqual([
      {
        value: skillRef,
        label: 'Research',
        source: 'global_configuration',
        availability: 'requires_setup',
        disabled: true,
        reason: 'global_resource_disabled',
      },
    ]);
    expect(result.mcpServers).toEqual([
      {
        value: JSON.stringify([mcpRef, 'Research tools']),
        definition: mcpRef,
        id: 'Research tools',
        label: 'Research tools',
        source: 'global_configuration',
        availability: 'available',
        disabled: false,
        secretSlots: [],
      },
    ]);
    expect(fetchGetMock).toHaveBeenCalledWith(
      '/workspace-configuration/global-resources',
      { email: auth.email, user_id: auth.user_id },
      undefined,
      {
        expectedAccountKey: expect.any(String),
        beforeRequest: expect.any(Function),
      }
    );
    expect(JSON.stringify(result)).not.toMatch(
      /private|fixture-secret|API_KEY|assignTo|url|path/
    );
    expect(proxyGetMock).not.toHaveBeenCalled();
  });

  it('disables duplicate global identities, rejects unsupported refs and sanitizes unavailable reasons', async () => {
    const skill = {
      ref: `registry://global/skills/${'a'.repeat(64)}`,
      label: 'Research',
      source: 'global_configuration',
      enabled: true,
    };
    const mcp = {
      id: 'research',
      definition: `registry://global/mcp/${'b'.repeat(64)}`,
      source: 'global_configuration',
      enabled: true,
      secretSlots: [],
    };
    fetchGetMock.mockResolvedValue({
      skills: [
        skill,
        skill,
        {
          ...skill,
          ref: `registry://global/skills/${'c'.repeat(64)}`,
          enabled: false,
          unavailableReason: '/private/api_key=fixture-secret',
        },
        ...[
          'bundle://skills/a',
          'registry://global/skills/../private',
          'registry://global/skills/not-a-hash',
        ].map((ref) => ({ ...skill, ref })),
      ],
      mcp_servers: [
        mcp,
        { ...mcp, definition: `registry://global/mcp/${'d'.repeat(64)}` },
        {
          ...mcp,
          id: 'bad-slots',
          definition: `registry://global/mcp/${'e'.repeat(64)}`,
          secretSlots: ['API_KEY'],
        },
      ],
    });
    const result = await discoverGlobalSpaceResources({ email: auth.email });
    expect(result.skills).toHaveLength(2);
    expect(result.skills[0]).toMatchObject({
      disabled: true,
      reason: 'global_resource_ambiguous',
    });
    expect(result.skills[1]).toMatchObject({
      disabled: true,
      reason: 'global_resource_unavailable',
    });
    expect(result.mcpServers.slice(0, 2)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          disabled: true,
          reason: 'global_resource_ambiguous',
        }),
      ])
    );
    expect(result.mcpServers[2]).toMatchObject({
      disabled: true,
      reason: 'global_mcp_invalid',
      secretSlots: [],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /private|fixture-secret|API_KEY/
    );
  });

  it('rejects malformed global catalog envelopes instead of presenting a successful empty catalog', async () => {
    fetchGetMock.mockResolvedValue({ skills: [], mcp_servers: null });
    await expect(
      discoverGlobalSpaceResources({ email: auth.email })
    ).rejects.toThrow('global_resource_discovery_unavailable');
  });

  it('guards global discovery at delivery and after an account changes while awaiting a response', async () => {
    let resolve!: (value: unknown) => void;
    fetchGetMock.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const request = discoverGlobalSpaceResources({
      email: auth.email,
      userId: auth.user_id,
    });
    const beforeRequest = fetchGetMock.mock.calls[0][3].beforeRequest;
    auth.user_id = 8;
    expect(beforeRequest).toThrow('global_resource_account_changed');
    resolve({ skills: [], mcp_servers: [] });
    await expect(request).rejects.toThrow('global_resource_account_changed');
  });

  it('keeps separate MCP server IDs that share one verified definition file', async () => {
    const definition = 'bundle://agent-plugins/research/mcp.json';
    fetchGetMock.mockResolvedValue({
      space_id: 'space-1',
      skills: [],
      mcp_servers: ['search', 'notes', 'search'].map((id) => ({
        id,
        definition,
        source: 'materialized_bundle',
        availability: 'available',
        secret_slots: [],
      })),
    });
    const result = await discoverSpaceBundleResources('space-1', {
      email: 'fixture@example.com',
    });
    expect(result.mcpServers.map((item) => item.id)).toEqual([
      'search',
      'notes',
    ]);
    expect(new Set(result.mcpServers.map((item) => item.value)).size).toBe(2);
    expect(result.mcpServers.map((item) => item.definition)).toEqual([
      definition,
      definition,
    ]);
  });

  it('searches provider pages, deduplicates, and never copies account grants or connection IDs', async () => {
    proxyGetMock.mockResolvedValue(providersResponse([provider(), provider()]));
    const result = await discoverSpaceConnectors(' git ', 2);
    expect(proxyGetMock).toHaveBeenCalledTimes(1);
    expect(proxyGetMock).toHaveBeenCalledWith('/api/v1/connectors/providers', {
      page: 2,
      page_size: 24,
      q: 'git',
    });
    expect(result).toEqual({
      items: [
        {
          value: 'github',
          service: 'github',
          label: 'GitHub',
          source: 'connector_catalog',
          availability: 'available',
          connected: true,
          supportedGrants: ['repository.read'],
        },
      ],
      hasMore: true,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /fixture|admin.everything|Private user|api_key|connection/
    );
  });

  it('isolates discovery from other accounts cached and inflight provider responses', async () => {
    let resolveShared!: (value: unknown) => void;
    proxyGetMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveShared = resolve;
        })
    );
    const previousAccount = fetchConnectorProviders({ page: 1, pageSize: 24 });
    proxyGetMock.mockResolvedValueOnce(
      providersResponse([provider('new-account')])
    );
    expect((await discoverSpaceConnectors()).items[0].service).toBe(
      'new-account'
    );
    resolveShared(providersResponse([provider('old-account')]));
    await previousAccount;
    proxyGetMock.mockResolvedValueOnce(
      providersResponse([provider('fresh-account')])
    );
    expect((await discoverSpaceConnectors()).items[0].service).toBe(
      'fresh-account'
    );
    expect(proxyGetMock).toHaveBeenCalledTimes(3);
  });

  it('distinguishes a disabled connector gateway from an enabled empty catalog', async () => {
    proxyGetMock.mockResolvedValue({
      ...providersResponse([]),
      enabled: false,
    });
    await expect(discoverSpaceConnectors()).rejects.toThrow(
      'connector_catalog_disabled'
    );
    proxyGetMock.mockResolvedValue({
      ...providersResponse([]),
      total_pages: 1,
    });
    await expect(discoverSpaceConnectors()).resolves.toEqual({
      items: [],
      hasMore: false,
    });
  });

  it('reads provider detail supported scopes without connecting or granting them', async () => {
    proxyGetMock.mockResolvedValue({
      enabled: true,
      provider: {
        ...provider(),
        connection: { ...provider().connection, virtual: true },
      },
    });
    const result = await discoverSpaceConnectorDetails('github');
    expect(result.connected).toBe(false);
    expect(result.supportedGrants).toEqual(['repository.read']);
    expect(proxyGetMock).toHaveBeenCalledTimes(1);
    expect(proxyGetMock).toHaveBeenCalledWith(
      '/api/v1/connectors/providers/github'
    );
    proxyGetMock.mockResolvedValue({ provider: provider('different') });
    await expect(discoverSpaceConnectorDetails('github')).rejects.toThrow(
      'connector_discovery_mismatch'
    );
  });
});
