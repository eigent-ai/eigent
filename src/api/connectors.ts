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
  proxyFetchDelete,
  proxyFetchGet,
  proxyFetchPost,
  proxyFetchPut,
} from '@/api/http';

export type ConnectorAuthType =
  | 'no_auth'
  | 'api_key'
  | 'custom_credential'
  | 'oauth2'
  | string;

export interface ConnectorCredentialField {
  key: string;
  label: string;
  inputType: 'text' | 'password' | 'textarea' | 'json' | string;
  required: boolean;
  secret: boolean;
  placeholder?: string | null;
  description?: string | null;
}

export interface ConnectorAuthDefinition {
  type: ConnectorAuthType;
  label?: string | null;
  placeholder?: string | null;
  description?: string | null;
  extraFields?: ConnectorCredentialField[];
  fields?: ConnectorCredentialField[];
  scopes?: string[];
  clientConfigFields?: ConnectorCredentialField[];
}

export interface ConnectorAction {
  id?: string;
  name?: string;
  description?: string;
}

export interface ConnectorConnection {
  id?: string | null;
  service: string;
  connectionName: string;
  authType: ConnectorAuthType;
  configured: boolean;
  virtual: boolean;
  default: boolean;
  profile?: {
    displayName?: string | null;
    grantedScopes?: string[];
  } | null;
}

export interface ConnectorProvider {
  service: string;
  displayName?: string;
  description?: string | null;
  iconUrl?: string | null;
  homepageUrl?: string | null;
  categories?: string[];
  authTypes?: ConnectorAuthType[];
  auth?: ConnectorAuthDefinition[];
  action_count?: number;
  locally_executable_action_count?: number;
  catalog_only_action_count?: number;
  recommended?: boolean;
  sort_rank?: number | null;
  connection?: ConnectorConnection | null;
  actions?: ConnectorAction[];
}

export interface ConnectorProvidersResponse {
  enabled: boolean;
  source: 'connector_gateway';
  provider_count: number;
  filtered_count: number;
  connected_count: number;
  page: number;
  page_size: number;
  total_pages: number;
  providers: ConnectorProvider[];
}

export interface ConnectorProviderResponse {
  enabled: boolean;
  source: 'connector_gateway';
  provider: ConnectorProvider;
}

export interface ConnectProviderRequest {
  auth_type: ConnectorAuthType;
  values?: Record<string, unknown>;
  connection_name?: string;
}

export interface ConnectorOAuthAuthorization {
  service: string;
  authorizationUrl: string;
  state?: string;
}

export interface FetchConnectorProvidersOptions {
  page?: number;
  pageSize?: number;
  query?: string;
}

export function providerLabel(provider: ConnectorProvider): string {
  return provider.displayName || provider.service;
}

export function isConnectedProvider(
  provider: ConnectorProvider | null | undefined
): boolean {
  const connection = provider?.connection;
  return connection?.configured === true && connection.virtual !== true;
}

export interface FetchConnectorProvidersRequestOptions {
  /** Skip the short-lived list cache and force a network fetch. */
  bypassCache?: boolean;
}

const PROVIDERS_LIST_CACHE_TTL_MS = 60_000;

type ProvidersListCacheEntry = {
  expiresAt: number;
  data: ConnectorProvidersResponse;
};

const providersListCache = new Map<string, ProvidersListCacheEntry>();
const providersListInflight = new Map<
  string,
  Promise<ConnectorProvidersResponse>
>();

function providersListCacheKey(
  options: FetchConnectorProvidersOptions = {}
): string {
  return [
    options.page || 1,
    options.pageSize || 24,
    options.query?.trim() || '',
  ].join('::');
}

function normalizeProvidersResponse(
  response: any,
  options: FetchConnectorProvidersOptions = {}
): ConnectorProvidersResponse {
  const providers = Array.isArray(response?.providers)
    ? response.providers
    : [];
  const providerCount =
    typeof response?.provider_count === 'number'
      ? response.provider_count
      : providers.length;
  const filteredCount =
    typeof response?.filtered_count === 'number'
      ? response.filtered_count
      : providerCount;
  const pageSize =
    typeof response?.page_size === 'number'
      ? response.page_size
      : options.pageSize || 24;
  return {
    enabled: response?.enabled === true,
    source: 'connector_gateway',
    provider_count: providerCount,
    filtered_count: filteredCount,
    connected_count:
      typeof response?.connected_count === 'number'
        ? response.connected_count
        : 0,
    page:
      typeof response?.page === 'number' ? response.page : options.page || 1,
    page_size: pageSize,
    total_pages:
      typeof response?.total_pages === 'number'
        ? response.total_pages
        : Math.max(1, Math.ceil(filteredCount / pageSize)),
    providers,
  };
}

/** Synchronous cache read for instant UI hydration. */
export function getCachedConnectorProviders(
  options: FetchConnectorProvidersOptions = {}
): ConnectorProvidersResponse | null {
  const entry = providersListCache.get(providersListCacheKey(options));
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.data;
}

export function invalidateConnectorProvidersCache(): void {
  providersListCache.clear();
  providersListInflight.clear();
}

/** Warm the list cache without waiting for dialog open. */
export function prefetchConnectorProviders(
  options: FetchConnectorProvidersOptions = {}
): Promise<ConnectorProvidersResponse> {
  return fetchConnectorProviders(options);
}

export async function fetchConnectorProviders(
  options: FetchConnectorProvidersOptions = {},
  requestOptions: FetchConnectorProvidersRequestOptions = {}
): Promise<ConnectorProvidersResponse> {
  const cacheKey = providersListCacheKey(options);
  if (!requestOptions.bypassCache) {
    const cached = getCachedConnectorProviders(options);
    if (cached) return cached;
  }
  // Always coalesce concurrent identical requests, even when bypassing cache.
  const inflight = providersListInflight.get(cacheKey);
  if (inflight) return inflight;

  const request = (async () => {
    const params: Record<string, string | number> = {
      page: options.page || 1,
      page_size: options.pageSize || 24,
    };
    const query = options.query?.trim();
    if (query) {
      params.q = query;
    }
    const response = await proxyFetchGet(
      '/api/v1/connectors/providers',
      params
    );
    const normalized = normalizeProvidersResponse(response, options);
    providersListCache.set(cacheKey, {
      expiresAt: Date.now() + PROVIDERS_LIST_CACHE_TTL_MS,
      data: normalized,
    });
    return normalized;
  })();

  providersListInflight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    if (providersListInflight.get(cacheKey) === request) {
      providersListInflight.delete(cacheKey);
    }
  }
}

/** Fetch every provider page and return only connected providers. */
export async function fetchConnectedProviders(): Promise<ConnectorProvider[]> {
  const pageSize = 60;
  const first = await fetchConnectorProviders({ page: 1, pageSize });
  let providers = first.providers;
  const connectedPages = Math.ceil(
    first.connected_count / (first.page_size || pageSize)
  );
  for (let page = 2; page <= connectedPages; page += 1) {
    const response = await fetchConnectorProviders({
      page,
      pageSize: first.page_size || pageSize,
    });
    providers = providers.concat(response.providers);
  }
  const unique = new Map(
    providers.map((provider) => [provider.service, provider])
  );
  return Array.from(unique.values()).filter(isConnectedProvider);
}

export async function fetchConnectorProvider(
  service: string
): Promise<ConnectorProviderResponse> {
  const response = await proxyFetchGet(
    `/api/v1/connectors/providers/${encodeURIComponent(service)}`
  );
  return {
    enabled: response?.enabled === true,
    source: 'connector_gateway',
    provider: response?.provider,
  };
}

export async function connectProvider(
  service: string,
  request: ConnectProviderRequest
) {
  return proxyFetchPut(
    `/api/v1/connectors/connections/${encodeURIComponent(service)}`,
    request
  );
}

export async function disconnectProvider(
  service: string,
  connectionName?: string
) {
  return proxyFetchDelete(
    `/api/v1/connectors/connections/${encodeURIComponent(service)}`,
    connectionName ? { connection_name: connectionName } : undefined
  );
}

export async function createConnectorOAuthAuthorization(
  service: string,
  connectionName?: string
): Promise<ConnectorOAuthAuthorization> {
  const response = await proxyFetchPost(
    '/api/v1/connectors/oauth/authorizations',
    {
      service,
      connection_name: connectionName,
    }
  );
  const authorization = response?.authorization;
  return {
    service: authorization?.service || service,
    authorizationUrl: authorization?.authorizationUrl || '',
    state: authorization?.state,
  };
}
