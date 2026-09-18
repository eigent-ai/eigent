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
  fetchConnectorProvider,
  fetchConnectorProviders,
  isConnectedProvider,
  providerLabel,
  type ConnectorProvider,
} from '@/api/connectors';
import { fetchGet, proxyFetchGet } from '@/api/http';
import {
  parseSpaceModelReference,
  spaceModelReference,
} from '@/lib/spaceModelReference';
import type { WorkspaceConfigurationIdentity } from '@/service/workspaceConfigurationApi';
import i18next from 'i18next';

export type SpaceDiscoverySource =
  | 'cloud_catalog'
  | 'custom_catalog'
  | 'local_catalog'
  | 'user_default'
  | 'connector_catalog'
  | 'materialized_bundle'
  | 'draft_bundle';

export interface SpaceDiscoveryCandidate {
  value: string;
  label: string;
  source: SpaceDiscoverySource;
  availability: 'available' | 'requires_setup';
  reason?: string;
  disabled?: boolean;
}

export interface SpaceModelCandidate extends SpaceDiscoveryCandidate {
  modelId: string;
  modelType: string;
  platform: string;
  isDefault: boolean;
}

export type SpaceSkillCandidate = SpaceDiscoveryCandidate;

export interface SpaceMcpCandidate extends SpaceDiscoveryCandidate {
  id: string;
  definition: string;
  secretSlots: string[];
}

export interface SpaceConnectorCandidate extends SpaceDiscoveryCandidate {
  service: string;
  connected: boolean;
  supportedGrants: string[];
}

export interface SpaceBundleDiscovery {
  skills: SpaceSkillCandidate[];
  mcpServers: SpaceMcpCandidate[];
}

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const textValue = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() && !/[\u0000-\u001f]/.test(value)
    ? value.trim()
    : null;

const identifier = (value: unknown): string | null => {
  const text = textValue(value);
  return text && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(text) ? text : null;
};

const unique = <T extends { value: string }>(items: T[]): T[] =>
  Array.from(new Map(items.map((item) => [item.value, item])).values());

const bundleRef = (value: unknown): string | null => {
  const text = textValue(value);
  if (!text?.startsWith('bundle://')) return null;
  const logicalPath = text.slice('bundle://'.length);
  if (
    /[\\%?#]/.test(logicalPath) ||
    logicalPath
      .split('/')
      .some((segment) => !segment || segment === '.' || segment === '..')
  )
    return null;
  return text;
};

const bundleSource = (
  value: unknown
): 'materialized_bundle' | 'draft_bundle' | null =>
  value === 'materialized_bundle' || value === 'draft_bundle' ? value : null;

/** Metadata only: no keys, endpoints or account-private Provider IDs in this projection. */
export async function discoverSpaceModels(): Promise<SpaceModelCandidate[]> {
  const [cloudResponse, providerResponse] = await Promise.all([
    import.meta.env.VITE_USE_LOCAL_PROXY === 'true'
      ? Promise.resolve({ models: [] })
      : proxyFetchGet('/api/v1/cloud-models', { kind: 'chat' }),
    proxyFetchGet('/api/v1/provider-models'),
  ]);
  const response = record(cloudResponse);
  if (!Array.isArray(providerResponse))
    throw new Error('model_catalog_unavailable');
  const models = Array.isArray(response.models) ? response.models : [];
  const candidates = models.flatMap((raw): SpaceModelCandidate[] => {
    const model = record(raw);
    const modelId = textValue(model.id);
    const modelType = textValue(model.model_type);
    const platform = identifier(model.model_platform);
    if (!modelId || !modelType || !platform || model.kind !== 'chat') return [];
    const value = spaceModelReference({ category: 'cloud', modelId });
    if (!parseSpaceModelReference(value)) return [];
    return [
      {
        value,
        label: textValue(model.display_name) ?? modelId,
        source: 'cloud_catalog',
        availability: 'available',
        modelId,
        modelType,
        platform,
        isDefault:
          response.default_model_id === modelId || model.is_default === true,
      },
    ];
  });
  const configured = providerResponse.flatMap((raw): SpaceModelCandidate[] => {
    const provider = record(raw);
    const category = provider.category;
    const platform = identifier(provider.model_platform);
    const modelId = textValue(provider.model_type);
    if (
      (category !== 'custom' && category !== 'local') ||
      !platform ||
      !modelId
    )
      return [];
    const value = spaceModelReference({ category, platform, modelId });
    if (!parseSpaceModelReference(value)) return [];
    const available = provider.available === true;
    return [
      {
        value,
        label: `${platform} · ${modelId}`,
        source: category === 'local' ? 'local_catalog' : 'custom_catalog',
        availability: available ? 'available' : 'requires_setup',
        disabled: !available,
        ...(available ? {} : { reason: 'model_unavailable' }),
        modelId,
        modelType: modelId,
        platform,
        isDefault: false,
      },
    ];
  });
  const counts = new Map<string, number>();
  configured.forEach((candidate) =>
    counts.set(candidate.value, (counts.get(candidate.value) ?? 0) + 1)
  );
  return [
    {
      value: 'provider://default',
      label: i18next.t('layout.default'),
      source: 'user_default',
      availability: 'available',
      modelId: 'default',
      modelType: '',
      platform: '',
      isDefault: true,
    },
    ...unique([
      ...candidates,
      ...configured.map((candidate) =>
        counts.get(candidate.value)! > 1
          ? {
              ...candidate,
              availability: 'requires_setup' as const,
              disabled: true,
              reason: 'model_ambiguous',
            }
          : candidate
      ),
    ]),
  ];
}

/** Only current-Space, verified bundle metadata; never scan global Skills/MCP. */
export async function discoverSpaceBundleResources(
  spaceId: string,
  identity: WorkspaceConfigurationIdentity
): Promise<SpaceBundleDiscovery> {
  const response = record(
    await fetchGet(
      `/spaces/${encodeURIComponent(spaceId)}/workspace-configuration/discovery`,
      {
        email: identity.email,
        ...(identity.userId == null ? {} : { user_id: identity.userId }),
      }
    )
  );
  if (response.space_id !== spaceId)
    throw new Error('space_discovery_mismatch');
  const skills = (
    Array.isArray(response.skills) ? response.skills : []
  ).flatMap((raw): SpaceSkillCandidate[] => {
    const item = record(raw);
    const value = bundleRef(item.ref);
    const source = bundleSource(item.source);
    if (!value || !source) return [];
    return [
      {
        value,
        label: textValue(item.label) ?? value,
        source,
        availability:
          item.availability === 'available' ? 'available' : 'requires_setup',
        ...(item.availability === 'available'
          ? {}
          : { reason: 'bundle_setup_required' }),
      },
    ];
  });
  const mcpServers = (
    Array.isArray(response.mcp_servers) ? response.mcp_servers : []
  ).flatMap((raw): SpaceMcpCandidate[] => {
    const item = record(raw);
    const definition = bundleRef(item.definition);
    const id = identifier(item.id);
    const source = bundleSource(item.source);
    if (!definition || !id || !source) return [];
    return [
      {
        value: JSON.stringify([definition, id]),
        definition,
        id,
        label: textValue(item.label) ?? id,
        source,
        availability:
          item.availability === 'available' ? 'available' : 'requires_setup',
        ...(item.availability === 'available'
          ? {}
          : { reason: 'bundle_setup_required' }),
        secretSlots: Array.from(
          new Set(
            (Array.isArray(item.secret_slots) ? item.secret_slots : []).flatMap(
              (slot) => {
                const name = identifier(slot);
                return name ? [name] : [];
              }
            )
          )
        ),
      },
    ];
  });
  return { skills: unique(skills), mcpServers: unique(mcpServers) };
}

function connectorCandidate(raw: unknown): SpaceConnectorCandidate | null {
  const provider = record(raw);
  const service = identifier(provider.service);
  if (!service) return null;
  // Read supported scopes from the provider definition, never connection.profile.
  const auth = Array.isArray(provider.auth) ? provider.auth : [];
  const supportedGrants = Array.from(
    new Set(
      auth.flatMap((definition) => {
        const scopes = record(definition).scopes;
        return (Array.isArray(scopes) ? scopes : []).flatMap((scope) => {
          const value = textValue(scope);
          return value ? [value] : [];
        });
      })
    )
  );
  const safeProvider: ConnectorProvider = {
    service,
    displayName: textValue(provider.displayName) ?? undefined,
    connection: provider.connection as ConnectorProvider['connection'],
  };
  return {
    value: service,
    service,
    label: providerLabel(safeProvider),
    source: 'connector_catalog',
    availability: 'available',
    connected: isConnectedProvider(safeProvider),
    supportedGrants,
  };
}

export async function discoverSpaceConnectors(
  query = '',
  page = 1
): Promise<{
  items: SpaceConnectorCandidate[];
  hasMore: boolean;
}> {
  // bypassCache alone still coalesces a previous account's inflight request.
  const response = await fetchConnectorProviders(
    { query, page, pageSize: 24 },
    { isolated: true }
  );
  return {
    items: unique(
      response.providers.flatMap((provider) => {
        const candidate = connectorCandidate(provider);
        return candidate ? [candidate] : [];
      })
    ),
    hasMore:
      response.enabled &&
      Number.isFinite(response.total_pages) &&
      page < response.total_pages,
  };
}

export async function discoverSpaceConnectorDetails(
  service: string
): Promise<SpaceConnectorCandidate> {
  if (!identifier(service)) throw new Error('invalid_connector_service');
  const response = await fetchConnectorProvider(service);
  const candidate = connectorCandidate(response.provider);
  if (!candidate || candidate.service !== service)
    throw new Error('connector_discovery_mismatch');
  return candidate;
}
