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

import { proxyFetchGet, proxyFetchPost } from '@/api/http';
import { LOCAL_MODEL_OPTIONS } from '@/components/Settings/Models/localModels';
import { isCloudModelAvailable } from '@/lib/cloudModelAvailability';
import { INIT_PROVODERS } from '@/lib/llm';
import { getProviderValid } from '@/lib/providerStatus';
import { getAuthStore } from '@/store/authStore';
import type { CloudModel } from '@/store/cloudModelStore';
import type { Provider } from '@/types';

export type ConfiguredProvider = {
  id: number;
  provider_name: string;
  model_type: string;
  api_key: string;
  endpoint_url: string;
  encrypted_config?: Record<string, unknown> | null;
  prefer?: boolean;
  is_valid?: number | boolean;
  is_vaild?: number | boolean;
};

export type ConfiguredModelChoice =
  | { id: string; group: 'eigent'; name: string; cloudModel: CloudModel }
  | { id: string; group: string; name: string; record: ConfiguredProvider }
  | { id: 'codex'; group: 'codex-subscription'; name: string };

export function selectableConfiguredModels({
  records,
  cloudModels,
  hidden,
  cloudAvailable,
  codexConnected,
  codexModelType,
  planKey,
}: {
  records: ConfiguredProvider[];
  cloudModels: CloudModel[];
  hidden: string[];
  cloudAvailable: boolean;
  codexConnected: boolean;
  codexModelType: string;
  planKey?: string | null;
}): ConfiguredModelChoice[] {
  return [
    ...(cloudAvailable
      ? cloudModels
          .filter(
            (model) =>
              !hidden.includes(model.id) &&
              isCloudModelAvailable(model, planKey)
          )
          .map((model) => ({
            id: `cloud:${model.id}`,
            group: 'eigent' as const,
            name: model.display_name,
            cloudModel: model,
          }))
      : []),
    ...records.filter(getProviderValid).map((record) => ({
      id: `provider:${record.id}`,
      group: record.provider_name,
      name: record.model_type,
      record,
    })),
    ...(codexConnected
      ? [
          {
            id: 'codex' as const,
            group: 'codex-subscription' as const,
            name: codexModelType,
          },
        ]
      : []),
  ];
}

const UNSET_KEYS = new Set(['', 'not-required']);

function endpointHost(endpoint: string) {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint.trim();
  }
}

function keySuffix(apiKey: string) {
  const key = apiKey.trim();
  return UNSET_KEYS.has(key) ? '' : key.slice(-4);
}

/**
 * Tells a record apart from saved records with the same provider and model:
 * its endpoint host, else its key suffix, else its ID. Empty when unique.
 */
export function configurationHint(
  record: ConfiguredProvider,
  records: ConfiguredProvider[]
): string {
  const twins = records.filter(
    (other) =>
      other.id !== record.id &&
      other.provider_name === record.provider_name &&
      other.model_type === record.model_type
  );
  if (!twins.length) return '';
  const host = endpointHost(record.endpoint_url ?? '');
  if (
    host &&
    twins.every((other) => endpointHost(other.endpoint_url ?? '') !== host)
  )
    return host;
  const suffix = keySuffix(record.api_key ?? '');
  if (
    suffix &&
    twins.every((other) => keySuffix(other.api_key ?? '') !== suffix)
  )
    return `…${suffix}`;
  return `#${record.id}`;
}

export const MODEL_CONFIGURATIONS_CHANGED =
  'eigent:model-configurations-changed';
export function notifyModelConfigurationsChanged() {
  window.dispatchEvent(new Event(MODEL_CONFIGURATIONS_CHANGED));
}

export const modelProviders: Provider[] = [
  ...INIT_PROVODERS.filter((provider) => provider.id !== 'local'),
  ...LOCAL_MODEL_OPTIONS.map((provider) => ({
    id: provider.id,
    name: provider.name,
    apiKey: '',
    apiHost: provider.defaultEndpoint,
    description: '',
  })),
];

export function providerDefinition(id: string): Provider {
  return (
    modelProviders.find((provider) => provider.id === id) ?? {
      id,
      name: id,
      apiKey: '',
      apiHost: '',
      description: '',
    }
  );
}

export function providerCategory(id: string): 'local' | 'custom' {
  return LOCAL_MODEL_OPTIONS.some((provider) => provider.id === id)
    ? 'local'
    : 'custom';
}

/** Do not collapse records by provider name: credentials belong to a record ID. */
export async function fetchConfiguredProviders(): Promise<
  ConfiguredProvider[]
> {
  const records = new Map<number, ConfiguredProvider>();
  for (let page = 1; ; page++) {
    const response = await proxyFetchGet('/api/v1/providers', {
      page,
      size: 100,
    });
    if (
      !Array.isArray(response) &&
      response?.code != null &&
      response.code !== 0
    ) {
      throw new Error('Configured providers request failed');
    }
    if (
      !Array.isArray(response) &&
      (!response || !Array.isArray(response.items))
    ) {
      throw new Error('Invalid configured providers response');
    }
    const items: ConfiguredProvider[] = Array.isArray(response)
      ? response
      : response.items;
    const previousSize = records.size;
    for (const record of items) records.set(record.id, record);
    if (page > 1 && items.length > 0 && previousSize === records.size) {
      throw new Error('Provider pagination did not advance');
    }
    if (
      Array.isArray(response) ||
      items.length === 0 ||
      (response.pages != null && page >= response.pages) ||
      (response.total != null && records.size >= response.total) ||
      (response.pages == null && response.total == null)
    )
      break;
  }
  return [...records.values()];
}

export async function setConfiguredProviderDefault(
  provider: ConfiguredProvider
) {
  const { user_id: account, email } = getAuthStore();
  await proxyFetchPost('/api/v1/provider/prefer', { provider_id: provider.id });
  if (getAuthStore().user_id === account && getAuthStore().email === email) {
    getAuthStore().setModelType(providerCategory(provider.provider_name));
  }
  notifyModelConfigurationsChanged();
}
