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
import { fetchGet } from '@/api/http';
import { getAccountEnvironmentKey } from '@/lib/authEnvironment';
import type { WorkspaceConfigurationIdentity } from '@/service/workspaceConfigurationApi';
import { getAuthStore } from '@/store/authStore';

export { discoverSpaceModels } from '@/service/spaceModelDiscovery';

export type SpaceDiscoverySource =
  | 'cloud_catalog'
  | 'custom_catalog'
  | 'local_catalog'
  | 'user_default'
  | 'connector_catalog'
  | 'global_configuration'
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

const globalRef = (value: unknown, kind: 'skills' | 'mcp'): string | null =>
  typeof value === 'string' &&
  new RegExp(`^registry://global/${kind}/[a-f0-9]{64}$`).test(value)
    ? value
    : null;

function globalAvailability(
  item: Record<string, unknown>
): Pick<SpaceDiscoveryCandidate, 'availability' | 'disabled' | 'reason'> {
  if (item.enabled === true && item.unavailableReason == null)
    return { availability: 'available', disabled: false };
  const reason = [
    'global_resource_disabled',
    'global_skill_invalid',
    'global_mcp_invalid',
  ].includes(String(item.unavailableReason))
    ? String(item.unavailableReason)
    : 'global_resource_unavailable';
  return { availability: 'requires_setup', disabled: true, reason };
}

function disableDuplicates<T extends SpaceDiscoveryCandidate>(
  items: T[],
  identity: (item: T) => string = (item) => item.value
): T[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = identity(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return unique(
    items.map((item) =>
      counts.get(identity(item))! > 1
        ? {
            ...item,
            availability: 'requires_setup',
            disabled: true,
            reason: 'global_resource_ambiguous',
          }
        : item
    )
  );
}

/** Global metadata only. Runtime resolves opaque registry references locally. */
export async function discoverGlobalSpaceResources(
  identity: WorkspaceConfigurationIdentity
): Promise<SpaceBundleDiscovery> {
  const auth = getAuthStore();
  const owner = getAccountEnvironmentKey(auth);
  const token = auth.token;
  const assertCurrent = () => {
    const current = getAuthStore();
    if (getAccountEnvironmentKey(current) !== owner || current.token !== token)
      throw new Error('global_resource_account_changed');
  };
  const response = record(
    await fetchGet(
      '/workspace-configuration/global-resources',
      {
        email: identity.email,
        ...(identity.userId == null ? {} : { user_id: identity.userId }),
      },
      undefined,
      { expectedAccountKey: owner, beforeRequest: assertCurrent }
    )
  );
  assertCurrent();
  if (!Array.isArray(response.skills) || !Array.isArray(response.mcp_servers))
    throw new Error('global_resource_discovery_unavailable');
  const skills = response.skills.flatMap((raw): SpaceSkillCandidate[] => {
    const item = record(raw);
    const value = globalRef(item.ref, 'skills');
    if (!value || item.source !== 'global_configuration') return [];
    return [
      {
        value,
        label: textValue(item.label) ?? value,
        source: 'global_configuration',
        ...globalAvailability(item),
      },
    ];
  });
  const mcpServers = response.mcp_servers.flatMap(
    (raw): SpaceMcpCandidate[] => {
      const item = record(raw);
      const definition = globalRef(item.definition, 'mcp');
      const id = textValue(item.id);
      if (
        !definition ||
        !id ||
        id !== item.id ||
        item.source !== 'global_configuration'
      )
        return [];
      return [
        {
          value: JSON.stringify([definition, id]),
          definition,
          id,
          label: textValue(item.label) ?? id,
          source: 'global_configuration',
          ...globalAvailability(item),
          ...(Array.isArray(item.secretSlots) && item.secretSlots.length === 0
            ? {}
            : {
                availability: 'requires_setup' as const,
                disabled: true,
                reason: 'global_mcp_invalid',
              }),
          // Global MCP credentials are already configured. Never transplant
          // private environment/header data into Bundle secret bindings.
          secretSlots: [],
        },
      ];
    }
  );
  return {
    skills: disableDuplicates(skills),
    mcpServers: disableDuplicates(mcpServers, (item) => item.id),
  };
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
  if (!response.enabled) throw new Error('connector_catalog_disabled');
  return {
    items: unique(
      response.providers.flatMap((provider) => {
        const candidate = connectorCandidate(provider);
        return candidate ? [candidate] : [];
      })
    ),
    hasMore:
      Number.isFinite(response.total_pages) && page < response.total_pages,
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
